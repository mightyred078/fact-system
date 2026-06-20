const nodemailer = require('nodemailer');

let transporter = null;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });
  }
  return transporter;
}

const BUSINESS_NAME = process.env.BUSINESS_NAME || 'FACT';

function formatItems(items) {
  return items
    .map((i) => {
      const variant = i.variant_summary ? ` (${i.variant_summary})` : '';
      return `  ${i.quantity} x ${i.name_snapshot}${variant} — $${i.line_total.toFixed(2)}`;
    })
    .join('\n');
}

async function sendOrderConfirmation(order, slot, items) {
  if (!order.customer_email) return;
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    console.warn('Email not sent: GMAIL_USER / GMAIL_APP_PASSWORD not configured.');
    return;
  }

  const paymentLine =
    order.payment_method === 'paynow'
      ? 'Payment: PayNow — please complete payment using the QR code shown at checkout.'
      : 'Payment: pay on pickup.';

  const text = `Hi ${order.customer_name},

Thanks for your order at ${BUSINESS_NAME}!

Order reference: ${order.order_code}
Pickup: ${slot.slot_date}, ${slot.start_time}–${slot.end_time}

${formatItems(items)}

Total: $${order.total_amount.toFixed(2)}
${paymentLine}

You can check your order status anytime by giving us your order reference and phone number.

See you soon!
${BUSINESS_NAME}`;

  try {
    await getTransporter().sendMail({
      from: `"${BUSINESS_NAME}" <${process.env.GMAIL_USER}>`,
      to: order.customer_email,
      subject: `Order confirmed — ${order.order_code}`,
      text,
    });
  } catch (err) {
    console.error('Failed to send confirmation email:', err.message);
  }
}

async function sendReadyForPickup(order, slot) {
  if (!order.customer_email) return false;
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    console.warn('Email not sent: GMAIL_USER / GMAIL_APP_PASSWORD not configured.');
    return false;
  }

  const text = `Hi ${order.customer_name},

Your order ${order.order_code} is ready for pickup!

Pickup window: ${slot.slot_date}, ${slot.start_time}–${slot.end_time}

See you soon!
${BUSINESS_NAME}`;

  try {
    await getTransporter().sendMail({
      from: `"${BUSINESS_NAME}" <${process.env.GMAIL_USER}>`,
      to: order.customer_email,
      subject: `Ready for pickup — ${order.order_code}`,
      text,
    });
    return true;
  } catch (err) {
    console.error('Failed to send ready-for-pickup email:', err.message);
    return false;
  }
}

module.exports = { sendOrderConfirmation, sendReadyForPickup };
