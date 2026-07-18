const nodemailer = require('nodemailer');

// Email is entirely optional: if EMAIL_USER/EMAIL_PASS aren't set in the
// environment, sendReceiptEmail() silently does nothing rather than
// throwing, so the payment flow never breaks because email isn't configured.
let transporter = null;
if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
}

async function sendReceiptEmail(payment) {
  if (!transporter) return; // email not configured, skip quietly

  try {
    await transporter.sendMail({
      from: `"Payment App" <${process.env.EMAIL_USER}>`,
      to: payment.email,
      subject: 'Payment Receipt',
      text:
        `Your payment was successful.\n\n` +
        `Amount: ${payment.currency || 'GHS'} ${payment.amount}\n` +
        `Reference: ${payment.reference}\n` +
        `Date: ${payment.paidAt || new Date().toISOString()}\n`,
    });
    console.log(`Receipt email sent to ${payment.email}`);
  } catch (err) {
    // Email failures should never break the payment flow itself
    console.error('Failed to send receipt email:', err.message);
  }
}

module.exports = { sendReceiptEmail };
