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
  if (!transporter) return true; // Paystack sends the customer receipt.

  try {
    await transporter.sendMail({
      from: `"Ledger" <${process.env.EMAIL_USER}>`,
      to: payment.email,
      subject: payment.metadata?.kind === 'ledger_subscription' ? 'Ledger subscription payment confirmed' : 'Ledger payment receipt',
      text:
        `Your payment was successful.\n\n` +
        (payment.metadata?.kind === 'ledger_subscription' ? `Your Ledger ${payment.metadata.tier || ''} subscription payment is confirmed. Your next charge follows the schedule you selected.\n\n` : '') +
        `Amount: ${payment.currency || 'GHS'} ${payment.amount}\n` +
        `Reference: ${payment.reference}\n` +
        `Date: ${payment.paidAt || new Date().toISOString()}\n`,
    });
    console.log(`Receipt email sent to ${payment.email}`);
    return true;
  } catch (err) {
    // Email failures should never break the payment flow itself
    console.error('Failed to send receipt email:', err.message);
    return false;
  }
}

async function sendSubscriptionReminderEmail(subscription, invoice) {
  if (!transporter) return true; // Paystack plan invoices are enabled in this case.
  try {
    const dueDate = invoice?.due_date || invoice?.period_end || subscription.nextPaymentDate;
    await transporter.sendMail({
      from: `"Ledger" <${process.env.EMAIL_USER}>`,
      to: subscription.email,
      subject: 'Your Ledger subscription renews soon',
      text: `Your ${subscription.tier} Ledger plan is scheduled to renew for GHS ${subscription.amount.toFixed(2)} on ${dueDate ? new Date(dueDate).toLocaleDateString('en-GB') : 'the next billing date'}. Paystack will charge the card you authorized. To stop future renewals, open Ledger and choose “Turn off renewal”.`,
    });
    return true;
  } catch (err) {
    console.error('Failed to send subscription reminder:', err.message);
    return false;
  }
}

async function sendSubscriptionFailedEmail(subscription) {
  if (!transporter) return true;
  try {
    await transporter.sendMail({
      from: `"Ledger" <${process.env.EMAIL_USER}>`,
      to: subscription.email,
      subject: 'Action needed for your Ledger subscription',
      text: `We could not collect your GHS ${subscription.amount.toFixed(2)} subscription payment. Your plan needs attention. Please visit Ledger to update your payment method or manage your subscription.`,
    });
    return true;
  } catch (err) {
    console.error('Failed to send subscription payment alert:', err.message);
    return false;
  }
}

const PLAN_LABELS = { promotion: 'Promotion', gold: 'Gold', diamond: 'Diamond' };
const DURATION_LABELS = { monthly: 'Monthly', sixMonth: '6 Months', yearly: 'Yearly' };

function formatDate(date) {
  return new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

async function sendSubscriptionReceiptEmail(subscription) {
  if (!transporter) return true;
  try {
    await transporter.sendMail({
      from: `"Ledger" <${process.env.EMAIL_USER}>`,
      to: subscription.email,
      subject: `Your ${PLAN_LABELS[subscription.plan]} plan is active`,
      text: `Your subscription payment was successful.\n\nPlan: ${PLAN_LABELS[subscription.plan]}\nDuration: ${DURATION_LABELS[subscription.duration]}\nAmount: ${subscription.currency || 'GHS'} ${subscription.amount}\nReference: ${subscription.reference}\nActive from: ${formatDate(subscription.startDate)}\nExpires on: ${formatDate(subscription.expiryDate)}\n`,
    });
    return true;
  } catch (err) {
    console.error('Failed to send fixed-term subscription receipt:', err.message);
    return false;
  }
}

async function sendExpiryReminderEmail(subscription) {
  if (!transporter) return true;
  try {
    const daysLeft = Math.max(0, Math.ceil((new Date(subscription.expiryDate) - Date.now()) / (24 * 60 * 60 * 1000)));
    await transporter.sendMail({
      from: `"Ledger" <${process.env.EMAIL_USER}>`,
      to: subscription.email,
      subject: `Your ${PLAN_LABELS[subscription.plan]} plan expires soon`,
      text: `Your ${PLAN_LABELS[subscription.plan]} plan expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}, on ${formatDate(subscription.expiryDate)}. Renew before then to keep uninterrupted access.\n\nPlan: ${PLAN_LABELS[subscription.plan]}\nDuration: ${DURATION_LABELS[subscription.duration]}\n`,
    });
    return true;
  } catch (err) {
    console.error('Failed to send expiry reminder:', err.message);
    return false;
  }
}

module.exports = {
  sendReceiptEmail,
  sendPasswordResetEmail,
  sendSubscriptionReceiptEmail,
  sendExpiryReminderEmail,
  sendSubscriptionReminderEmail,
  sendSubscriptionFailedEmail,
  isEmailConfigured: !!transporter,
};

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
