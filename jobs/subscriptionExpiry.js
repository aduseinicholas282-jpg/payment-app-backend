const cron = require('node-cron');
const Subscription = require('../models/Subscription');
const { sendExpiryReminderEmail } = require('../utils/mailer');

const REMINDER_WINDOW_DAYS = 3;

// Runs once an hour. Two responsibilities:
//   1. Warn users whose active subscription expires within the next
//      REMINDER_WINDOW_DAYS, exactly once per subscription.
//   2. Flip any active subscription whose expiryDate has already passed
//      over to 'expired', so /api/subscriptions/my and admin views stay accurate.
function startSubscriptionExpiryJob() {
  cron.schedule('0 * * * *', async () => {
    try {
      await sendExpiryReminders();
      await expirePastDue();
    } catch (err) {
      console.error('Cron subscription-expiry error:', err.message);
    }
  });
  console.log('Cron job scheduled: subscription expiry reminders + expiration, hourly');
}

async function sendExpiryReminders() {
  const now = new Date();
  const reminderCutoff = new Date(now.getTime() + REMINDER_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const dueForReminder = await Subscription.find({
    status: 'active',
    expiryDate: { $gte: now, $lte: reminderCutoff },
    expiryNotifiedAt: { $exists: false },
  });

  for (const subscription of dueForReminder) {
    await sendExpiryReminderEmail(subscription);
    subscription.expiryNotifiedAt = now;
    await subscription.save();
  }

  if (dueForReminder.length > 0) {
    console.log(`Cron: sent ${dueForReminder.length} subscription expiry reminder(s)`);
  }
}

async function expirePastDue() {
  const now = new Date();
  const result = await Subscription.updateMany(
    { status: 'active', expiryDate: { $lt: now } },
    { status: 'expired' }
  );
  if (result.modifiedCount > 0) {
    console.log(`Cron: expired ${result.modifiedCount} subscription(s)`);
  }
}

module.exports = { startSubscriptionExpiryJob };
