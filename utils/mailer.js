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

const PLAN_LABELS = { promotion: 'Promotion', gold: 'Gold', diamond: 'Diamond' };
const DURATION_LABELS = { monthly: 'Monthly', sixMonth: '6 Months', yearly: 'Yearly' };

function formatDate(date) {
  return new Date(date).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

async function sendSubscriptionReceiptEmail(subscription) {
  if (!transporter) return;

  try {
    await transporter.sendMail({
      from: `"Payment App" <${process.env.EMAIL_USER}>`,
      to: subscription.email,
      subject: `Your ${PLAN_LABELS[subscription.plan]} subscription is active`,
      text:
        `Your subscription payment was successful.\n\n` +
        `Plan: ${PLAN_LABELS[subscription.plan]}\n` +
        `Duration: ${DURATION_LABELS[subscription.duration]}\n` +
        `Amount: ${subscription.currency || 'GHS'} ${subscription.amount}\n` +
        `Reference: ${subscription.reference}\n` +
        `Active from: ${formatDate(subscription.startDate)}\n` +
        `Expires on: ${formatDate(subscription.expiryDate)}\n`,
    });
    console.log(`Subscription receipt email sent to ${subscription.email}`);
  } catch (err) {
    console.error('Failed to send subscription receipt email:', err.message);
  }
}

async function sendExpiryReminderEmail(subscription) {
  if (!transporter) return;

  try {
    const daysLeft = Math.max(
      0,
      Math.ceil((new Date(subscription.expiryDate) - Date.now()) / (24 * 60 * 60 * 1000))
    );
    await transporter.sendMail({
      from: `"Payment App" <${process.env.EMAIL_USER}>`,
      to: subscription.email,
      subject: `Your ${PLAN_LABELS[subscription.plan]} subscription expires soon`,
      text:
        `Your ${PLAN_LABELS[subscription.plan]} subscription is expiring in ${daysLeft} day${daysLeft === 1 ? '' : 's'}, on ${formatDate(subscription.expiryDate)}.\n\n` +
        `Renew before then to keep uninterrupted access.\n\n` +
        `Plan: ${PLAN_LABELS[subscription.plan]}\n` +
        `Duration: ${DURATION_LABELS[subscription.duration]}\n`,
    });
    console.log(`Expiry reminder email sent to ${subscription.email}`);
  } catch (err) {
    console.error('Failed to send expiry reminder email:', err.message);
  }
}

module.exports = {
  sendReceiptEmail,
  sendPasswordResetEmail,
  sendSubscriptionReceiptEmail,
  sendExpiryReminderEmail,
  isEmailConfigured: !!transporter,
};

async function sendPasswordResetEmail(user, resetUrl) {
  if (!transporter) return false;
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
    return true;
  } catch (err) {
    console.error('Failed to send password reset email:', err.message);
    return false;
  }
}
