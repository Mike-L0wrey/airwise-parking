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
          bookingRef: meta.bookingRef,
          terminalLabel: meta.terminalLabel || 'your terminal',
          dropoff: meta.dropoff,
          dropoffTime: meta.dropoffTime,
          days: meta.days,
          returnTime: meta.returnTime,
          priceGBP: meta.priceGBP,
          customerName: meta.customerName,
          customerPhone: meta.customerPhone,
          vehicleReg: meta.vehicleReg,
          vehicleComments: meta.vehicleComments,
          returnTerminal: meta.returnTerminal,
          returnFlight: meta.returnFlight,
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
        bookingRef: meta.bookingRef,
        terminalLabel: meta.terminalLabel || 'Unknown terminal',
        dropoff: meta.dropoff,
        dropoffTime: meta.dropoffTime,
        days: meta.days,
        returnTime: meta.returnTime,
        priceGBP: meta.priceGBP,
        customerName: meta.customerName,
        customerPhone: meta.customerPhone,
        vehicleReg: meta.vehicleReg,
        vehicleComments: meta.vehicleComments,
        returnTerminal: meta.returnTerminal,
        returnFlight: meta.returnFlight,
      });
    } catch (err) {
      // Same principle — a calendar hiccup shouldn't block the webhook
      // or affect the customer. We just log it so it can be checked.
      console.error('Failed to create calendar event:', err.message);
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};

async function sendConfirmationEmail({
  to, bookingRef, terminalLabel, dropoff, dropoffTime, days, returnTime, priceGBP,
  customerName, customerPhone, vehicleReg, vehicleComments, returnTerminal, returnFlight,
}) {
  const formattedDropoffDate = dropoff
    ? new Date(dropoff + 'T00:00:00Z').toLocaleDateString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : 'your selected date';

  let formattedReturnDate = 'your return date';
  if (dropoff && days) {
    const returnDateObj = new Date(dropoff + 'T00:00:00Z');
    returnDateObj.setUTCDate(returnDateObj.getUTCDate() + parseInt(days, 10));
    formattedReturnDate = returnDateObj.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  const firstName = (customerName || '').trim().split(' ')[0];
  const greetingName = firstName ? `, ${escapeHtml(firstName)}` : '';
  const refDisplay = bookingRef || 'N/A';

  // Builds an anchor link straight to this customer's terminal section on
  // instructions.html (e.g. "Terminal 3" -> "#terminal-3"). Falls back to
  // no anchor (top of the page) if the terminal number can't be matched.
  const terminalMatch = (terminalLabel || '').match(/(\d)/);
  const terminalAnchor = terminalMatch ? `#terminal-${terminalMatch[1]}` : '';

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #0B1E3D;">
      <h1 style="font-size: 1.4rem; margin-bottom: 4px;">Booking confirmed ✅</h1>
      <p style="color: #6B7A8D; margin-top: 0;">Thanks for booking with Airwise Parking${greetingName}.</p>
      <p style="background: #EBF5FD; border-radius: 8px; padding: 10px 14px; font-size: 0.9rem; margin: 12px 0;">
        Booking reference: <strong>${escapeHtml(refDisplay)}</strong><br/>
        <span style="color: #6B7A8D; font-size: 0.8rem;">Please quote this if you need to contact us about your booking.</span>
      </p>

      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <tr>
          <td style="padding: 8px 0; color: #6B7A8D;">Terminal</td>
          <td style="padding: 8px 0; text-align: right; font-weight: bold;">${terminalLabel}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #6B7A8D;">Drop-off</td>
          <td style="padding: 8px 0; text-align: right; font-weight: bold;">${formattedDropoffDate}${dropoffTime ? ' at ' + dropoffTime : ''}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #6B7A8D;">Return</td>
          <td style="padding: 8px 0; text-align: right; font-weight: bold;">${formattedReturnDate}${returnTime ? ' at ' + returnTime : ''}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #6B7A8D;">Return terminal</td>
          <td style="padding: 8px 0; text-align: right; font-weight: bold;">${escapeHtml(returnTerminal) || '-'}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #6B7A8D;">Return flight</td>
          <td style="padding: 8px 0; text-align: right; font-weight: bold;">${escapeHtml(returnFlight) || '-'}</td>
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

      <h3 style="font-size: 1rem; margin-bottom: 4px;">Your details</h3>
      <table style="width: 100%; border-collapse: collapse; margin: 8px 0 20px;">
        <tr>
          <td style="padding: 6px 0; color: #6B7A8D;">Name</td>
          <td style="padding: 6px 0; text-align: right;">${escapeHtml(customerName) || '-'}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #6B7A8D;">Phone</td>
          <td style="padding: 6px 0; text-align: right;">${escapeHtml(customerPhone) || '-'}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #6B7A8D;">Vehicle registration</td>
          <td style="padding: 6px 0; text-align: right;">${escapeHtml(vehicleReg) || '-'}</td>
        </tr>
        ${vehicleComments ? `<tr><td style="padding: 6px 0; color: #6B7A8D;">Vehicle notes</td><td style="padding: 6px 0; text-align: right;">${escapeHtml(vehicleComments)}</td></tr>` : ''}
      </table>

      <h3 style="font-size: 1rem; margin-bottom: 4px;">Drop-off &amp; collection instructions</h3>
      <p style="color: #333; line-height: 1.6; margin-bottom: 14px;">
        Full step-by-step directions for your terminal — where to go, sat-nav details, and what
        happens on your return — are here:
      </p>
      <p style="margin-bottom: 20px;">
        <a href="https://airwiseparking.co.uk/instructions.html${terminalAnchor}"
           style="display: inline-block; background: #3B9EE8; color: #FFFFFF; text-decoration: none;
                  padding: 12px 22px; border-radius: 8px; font-weight: bold; font-size: 0.9rem;">
          View my instructions →
        </a>
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
      // BCC'd to our own inbox so every confirmation is searchable later
      // (e.g. by booking reference) without needing a separate database.
      bcc: ['info@airwiseparking.co.uk'],
      subject: `Your Airwise Parking booking is confirmed — Ref ${refDisplay}`,
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

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

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

async function createCalendarEvent({
  customerEmail, bookingRef, terminalLabel, dropoff, dropoffTime, days, returnTime, priceGBP,
  customerName, customerPhone, vehicleReg, vehicleComments, returnTerminal, returnFlight,
}) {
  if (!dropoff || !days) {
    throw new Error('Missing dropoff or days, cannot create calendar event');
  }

  const accessToken = await getGoogleAccessToken();
  const calendarId = process.env.GOOGLE_CALENDAR_ID;

  // Work out the return date from dropoff + days
  const returnDateObj = new Date(dropoff + 'T00:00:00Z');
  returnDateObj.setUTCDate(returnDateObj.getUTCDate() + parseInt(days, 10));
  const returnDate = returnDateObj.toISOString().slice(0, 10);

  // Default to a sensible time if either is somehow missing, so the event
  // still gets created rather than failing outright.
  const safeDropoffTime = dropoffTime || '09:00';
  const safeReturnTime = returnTime || '09:00';
  const refDisplay = bookingRef || 'N/A';

  const descriptionLines = [
    `Booking ref: ${refDisplay}`,
    `Terminal: ${terminalLabel}`,
    `Drop-off: ${dropoff} ${safeDropoffTime}`,
    `Return: ${returnDate} ${safeReturnTime}`,
    `Return terminal: ${returnTerminal || '-'}`,
    `Return flight: ${returnFlight || '-'}`,
    `Days: ${days}`,
    `Amount paid: £${priceGBP}`,
    ``,
    `Customer: ${customerName || 'not provided'}`,
    `Phone: ${customerPhone || 'not provided'}`,
    `Email: ${customerEmail || 'not provided'}`,
    `Vehicle reg: ${vehicleReg || 'not provided'}`,
  ];
  if (vehicleComments) {
    descriptionLines.push(`Vehicle notes: ${vehicleComments}`);
  }

  const event = {
    summary: `[${refDisplay}] ${terminalLabel} — ${customerName || customerEmail || 'no name'} — ${vehicleReg || 'no reg'}`,
    description: descriptionLines.join('\n'),
    start: {
      dateTime: `${dropoff}T${safeDropoffTime}:00`,
      timeZone: 'Europe/London',
    },
    end: {
      dateTime: `${returnDate}T${safeReturnTime}:00`,
      timeZone: 'Europe/London',
    },
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
