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

module.exports = { sendReceiptEmail, sendPasswordResetEmail, isEmailConfigured: !!transporter };

async function sendPasswordResetEmail(user, resetUrl) {
  if (!transporter) return;
  try {
    await transporter.sendMail({
      from: `"Payment App" <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: 'Reset your password',
      text:
        `Hi ${user.name},\n\n` +
        `We received a request to reset your password. This link expires in 1 hour:\n\n` +
        `${resetUrl}\n\n` +
        `If you didn't request this, you can safely ignore this email.\n`,
    });
    console.log(`Password reset email sent to ${user.email}`);
  } catch (err) {
    console.error('Failed to send password reset email:', err.message);
  }
}
