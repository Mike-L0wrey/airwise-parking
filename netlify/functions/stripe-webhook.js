// netlify/functions/stripe-webhook.js
//
// Stripe calls this automatically the moment a customer's payment succeeds.
// It verifies the request really came from Stripe, then sends the customer
// a confirmation email via Resend using the booking details we stored
// as "metadata" when the checkout session was created.
//
// SETUP NEEDED (one-time, in Stripe dashboard + Netlify):
// 1. Stripe dashboard → Developers → Webhooks → Add endpoint
//    URL: https://airwiseparking.co.uk/.netlify/functions/stripe-webhook
//    Event to send: checkout.session.completed
// 2. Stripe will show a "Signing secret" (starts with whsec_...)
//    Add this to Netlify as an environment variable: STRIPE_WEBHOOK_SECRET

const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed.' };
  }

  const signature = event.headers['stripe-signature'];
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  // We only care about successful payments right now.
  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;
    const meta = session.metadata || {};
    const customerEmail = session.customer_details?.email || session.customer_email;

    if (customerEmail) {
      try {
        await sendConfirmationEmail({
          to: customerEmail,
          terminalLabel: meta.terminalLabel || 'your terminal',
          dropoff: meta.dropoff,
          days: meta.days,
          priceGBP: meta.priceGBP,
        });
      } catch (err) {
        // We don't fail the whole webhook if the email fails —
        // Stripe would just keep retrying otherwise, and the payment
        // itself has already succeeded. We log it so it can be checked.
        console.error('Failed to send confirmation email:', err.message);
      }
    } else {
      console.error('No customer email found on session', session.id);
    }

    try {
      await createCalendarEvent({
        customerEmail,
        terminalLabel: meta.terminalLabel || 'Unknown terminal',
        dropoff: meta.dropoff,
        days: meta.days,
        priceGBP: meta.priceGBP,
      });
    } catch (err) {
      // Same principle — a calendar hiccup shouldn't block the webhook
      // or affect the customer. We just log it so it can be checked.
      console.error('Failed to create calendar event:', err.message);
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};

async function sendConfirmationEmail({ to, terminalLabel, dropoff, days, priceGBP }) {
  const formattedDate = dropoff
    ? new Date(dropoff + 'T00:00:00Z').toLocaleDateString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : 'your selected date';

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #0B1E3D;">
      <h1 style="font-size: 1.4rem; margin-bottom: 4px;">Booking confirmed ✅</h1>
      <p style="color: #6B7A8D; margin-top: 0;">Thanks for booking with Airwise Parking.</p>

      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <tr>
          <td style="padding: 8px 0; color: #6B7A8D;">Terminal</td>
          <td style="padding: 8px 0; text-align: right; font-weight: bold;">${terminalLabel}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #6B7A8D;">Drop-off date</td>
          <td style="padding: 8px 0; text-align: right; font-weight: bold;">${formattedDate}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #6B7A8D;">Number of days</td>
          <td style="padding: 8px 0; text-align: right; font-weight: bold;">${days || '-'}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #6B7A8D;">Amount paid</td>
          <td style="padding: 8px 0; text-align: right; font-weight: bold;">£${priceGBP || '-'}</td>
        </tr>
      </table>

      <h3 style="font-size: 1rem; margin-bottom: 4px;">What happens next</h3>
      <p style="color: #333; line-height: 1.6;">
        On your drop-off date, drive to departures and hand your keys to our operator's
        team — they'll take your car straight to the secure compound. When you land,
        it'll be ready and waiting for you at arrivals.
      </p>

      <p style="color: #6B7A8D; font-size: 0.85rem; margin-top: 24px;">
        Questions? Call us on 02045690803 or email
        <a href="mailto:info@airwiseparking.co.uk">info@airwiseparking.co.uk</a>.
      </p>
    </div>
  `;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Airwise Parking <info@airwiseparking.co.uk>',
      to: [to],
      subject: 'Your Airwise Parking booking is confirmed',
      html,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Resend API error: ${errText}`);
  }
}

// ---- Google Calendar integration ----
//
// We talk to Google's API directly (no extra npm packages needed) by:
// 1. Signing a short-lived JWT with our service account's private key
// 2. Exchanging that JWT for an access token
// 3. Using that access token to create a calendar event
//
// This uses Node's built-in "crypto" module, already available in
// Netlify Functions — nothing new to install.

const crypto = require('crypto');

async function getGoogleAccessToken() {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');

  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/calendar',
    aud: 'https://oauth2.googleapis.com/token',
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  };

  const base64url = (obj) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url');

  const unsignedJwt = `${base64url(header)}.${base64url(claims)}`;
  const signature = crypto
    .sign('RSA-SHA256', Buffer.from(unsignedJwt), privateKey)
    .toString('base64url');
  const signedJwt = `${unsignedJwt}.${signature}`;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signedJwt,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Google auth error: ${errText}`);
  }

  const data = await response.json();
  return data.access_token;
}

async function createCalendarEvent({ customerEmail, terminalLabel, dropoff, days, priceGBP }) {
  if (!dropoff || !days) {
    throw new Error('Missing dropoff or days, cannot create calendar event');
  }

  const accessToken = await getGoogleAccessToken();
  const calendarId = process.env.GOOGLE_CALENDAR_ID;

  const startDate = dropoff; // "YYYY-MM-DD"
  const endDateObj = new Date(dropoff + 'T00:00:00Z');
  endDateObj.setUTCDate(endDateObj.getUTCDate() + parseInt(days, 10));
  const endDate = endDateObj.toISOString().slice(0, 10);

  const event = {
    summary: `Airwise Booking — ${terminalLabel} — ${customerEmail || 'no email'}`,
    description: `Terminal: ${terminalLabel}\nDays: ${days}\nAmount paid: £${priceGBP}\nCustomer email: ${customerEmail || 'not provided'}`,
    start: { date: startDate },
    end: { date: endDate },
  };

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Google Calendar API error: ${errText}`);
  }
}
