// netlify/functions/create-checkout-session.js
//
// This runs on Netlify's server, not in the customer's browser.
// It re-calculates the price from scratch using the real rate tables below,
// so nobody can tamper with the price before paying.
//
// IMPORTANT: If the pricing/band data in quote.html is ever updated,
// update the same data here too, so they stay in sync.

const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const RATES = {
  E1: [80,110,130,145,160,180,205,220,240,270,285,295,310,325,340],
  E3: [60,85,100,110,120,130,155,170,180,190,210,220,230,240,245,255,265,275,285,295,305,315,325,335,345,355,365,375,385,395],
  E4: [50,65,75,80,85,85,90,95,99,105,110,125,130,140,145,160,170,180,190,195,205,215,225,235,245,255,265,275,285,295],
  E5: [65,75,90,100,100,105,110,110,110,120,130,140,150,160,175,185,195,200,210,220,230,240,250,260,270,280,290,300,310,310],
  E8: [65,75,85,90,100,110,120,130,140,150,170,180,190,210,225,230,235,240,245,255,265,275,285,295,310,320,330,340,350,360],
  E9: [47,55,60,65,70,75,80,85,90,93,95,100,102,110,130,140,150,160,170,180,190,200,210,220,230,240,250,260,270,280],
  E6: [60,85,100,110,120,130,145,155,170,180,190,200,200,210,220,230,240,240,250,260,270,280,290,300,310,320,330,340,350,350]
};

const T235_CALENDAR = [["E9","E9","E9","E9","E9","E9","E9","E5","E9","E9","E9","E4"],["E9","E9","E9","E9","E9","E9","E9","E5","E9","E9","E9","E4"],["E9","E9","E9","E9","E9","E9","E9","E5","E9","E9","E9","E4"],["E9","E9","E9","E9","E9","E9","E9","E5","E9","E9","E9","E4"],["E9","E9","E9","E9","E9","E9","E9","E5","E9","E9","E9","E4"],["E9","E9","E9","E9","E9","E9","E9","E5","E9","E9","E9","E4"],["E9","E9","E9","E9","E9","E9","E9","E5","E9","E9","E9","E4"],["E9","E9","E9","E9","E9","E9","E9","E5","E9","E9","E9","E4"],["E9","E9","E9","E9","E9","E9","E9","E5","E9","E9","E9","E4"],["E9","E9","E9","E9","E9","E9","E9","E5","E9","E9","E9","E4"],["E9","E9","E9","E9","E9","E9","E9","E5","E9","E9","E9","E4"],["E9","E9","E9","E9","E9","E9","E9","E5","E9","E9","E9","E4"],["E9","E9","E9","E9","E9","E9","E9","E5","E9","E9","E9","E4"],["E9","E9","E9","E9","E9","E9","E9","E5","E9","E9","E9","E4"],["E9","E9","E9","E9","E9","E9","E9","E5","E9","E9","E9","E4"],["E9","E9","E9","E9","E9","E9","E9","E5","E9","E9","E9","E5"],["E9","E9","E9","E9","E9","E9","E9","E5","E9","E5","E9","E5"],["E9","E9","E9","E9","E9","E9","E9","E5","E9","E5","E9","E5"],["E9","E9","E9","E9","E9","E9","E9","E5","E9","E5","E9","E5"],["E9","E9","E9","E9","E9","E9","E9","E4","E9","E5","E9","E5"],["E9","E9","E9","E9","E9","E9","E9","E4","E9","E5","E9","E5"],["E9","E9","E9","E9","E9","E9","E9","E4","E9","E5","E9","E5"],["E9","E9","E9","E9","E9","E9","E9","E4","E9","E5","E9","E5"],["E9","E9","E9","E9","E9","E9","E5","E4","E9","E5","E9","E5"],["E9","E9","E9","E9","E9","E9","E5","E4","E9","E5","E9","E1"],["E9","E9","E9","E9","E9","E9","E5","E4","E9","E5","E9","E8"],["E9","E9","E9","E9","E9","E9","E5","E4","E9","E5","E9","E8"],["E9","E9","E9","E9","E9","E9","E5","E4","E9","E5","E9","E8"],["E9","E9","E9","E9","E9","E9","E5","E4","E9","E5","E9","E8"],["E9",null,"E9","E9","E9","E9","E5","E4","E9","E5","E9","E8"],["E9",null,"E9","E9","E9","E9","E5","E4",null,"E5",null,"E8"]];

const T4_CALENDAR = [["E9","E4","E4","E8","E4","E4","E9","E8","E8","E8","E4","E5"],["E9","E4","E4","E8","E4","E4","E9","E8","E8","E8","E4","E5"],["E9","E4","E4","E8","E4","E4","E9","E8","E8","E8","E4","E5"],["E9","E4","E4","E8","E4","E4","E9","E8","E8","E8","E4","E5"],["E9","E4","E4","E8","E4","E4","E9","E8","E8","E8","E4","E5"],["E9","E4","E4","E8","E4","E4","E9","E8","E8","E8","E4","E5"],["E9","E4","E4","E8","E4","E4","E9","E8","E8","E8","E4","E5"],["E9","E4","E4","E8","E4","E4","E9","E8","E8","E8","E4","E5"],["E9","E4","E4","E8","E4","E4","E9","E8","E8","E8","E4","E5"],["E9","E8","E4","E8","E4","E4","E9","E8","E8","E8","E4","E5"],["E9","E8","E4","E8","E4","E4","E9","E8","E8","E8","E4","E5"],["E9","E8","E4","E8","E4","E4","E9","E8","E8","E8","E4","E5"],["E9","E8","E4","E8","E4","E4","E9","E8","E8","E8","E4","E5"],["E9","E8","E4","E8","E4","E4","E9","E8","E8","E8","E4","E5"],["E9","E8","E4","E8","E4","E4","E9","E8","E8","E8","E4","E5"],["E9","E8","E4","E8","E4","E4","E9","E8","E8","E8","E4","E5"],["E9","E8","E4","E8","E4","E4","E9","E8","E8","E8","E4","E5"],["E9","E8","E4","E8","E4","E4","E9","E8","E8","E8","E4","E5"],["E9","E8","E4","E8","E4","E4","E9","E8","E8","E8","E4","E5"],["E9","E4","E4","E8","E4","E4","E9","E8","E8","E8","E4","E5"],["E9","E4","E4","E8","E4","E4","E9","E8","E8","E8","E4","E5"],["E9","E4","E4","E8","E4","E4","E9","E8","E8","E8","E4","E5"],["E9","E4","E4","E8","E4","E4","E9","E8","E8","E8","E4","E5"],["E9","E4","E4","E8","E4","E4","E8","E8","E8","E8","E4","E5"],["E9","E4","E4","E8","E4","E4","E8","E8","E8","E8","E4","E8"],["E9","E4","E4","E8","E4","E4","E8","E8","E8","E8","E4","E8"],["E9","E4","E4","E8","E4","E4","E8","E8","E8","E8","E4","E8"],["E9","E4","E4","E8","E4","E4","E8","E8","E8","E8","E4","E8"],["E9","E4","E4","E8","E4","E4","E8","E8","E8","E8","E4","E8"],["E9",null,"E4","E8","E4","E4","E8","E8","E8","E8","E4","E8"],["E9",null,"E4","E8","E4","E4","E8","E8",null,"E8",null,"E8"]];

function getBand(dateObj, terminalGroup) {
  const day = dateObj.getUTCDate() - 1;
  const month = dateObj.getUTCMonth();
  const calendar = terminalGroup === "4" ? T4_CALENDAR : T235_CALENDAR;
  if (!calendar[day]) return null;
  return calendar[day][month] || null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed.' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request.' }) };
  }

  const { terminal, dropoff, days, customerEmail } = body;
  const numDays = parseInt(days, 10);

  if (!terminal || !dropoff || !numDays || numDays < 1) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing or invalid booking details.' }) };
  }

  const dropoffDate = new Date(dropoff + 'T00:00:00Z');
  if (isNaN(dropoffDate.getTime())) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid date.' }) };
  }

  const band = getBand(dropoffDate, terminal);
  if (!band) {
    return { statusCode: 400, body: JSON.stringify({ error: "We couldn't find pricing for that date. Please contact us." }) };
  }

  const rateTable = RATES[band];
  if (!rateTable || numDays > rateTable.length) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: `For stays of ${numDays} days, please contact us directly for a custom quote.` }),
    };
  }

  const priceGBP = rateTable[numDays - 1];
  const amountPence = Math.round(priceGBP * 100);
  const terminalLabel = terminal === '4' ? 'Terminal 4' : 'Terminal 2/3/5';
  const siteUrl = process.env.URL || 'https://airwiseparking.co.uk';

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: customerEmail || undefined,
      line_items: [
        {
          price_data: {
            currency: 'gbp',
            product_data: {
              name: `Airwise Parking — ${terminalLabel} — ${numDays} day(s) from ${dropoff}`,
            },
            unit_amount: amountPence,
          },
          quantity: 1,
        },
      ],
      success_url: `${siteUrl}/quote.html?payment=success`,
      cancel_url: `${siteUrl}/quote.html?payment=cancelled`,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ url: session.url }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Something went wrong creating your checkout session. Please try again.' }),
    };
  }
};
