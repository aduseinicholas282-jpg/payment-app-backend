const cron = require('node-cron');
const Payment = require('../models/Payment');

// Runs every 30 minutes. Any transaction still "pending" after 1 hour
// almost certainly means the user abandoned checkout without paying or
// failing, since Paystack's webhook/verify would have already updated it
// otherwise. Marking these "failed" keeps transaction history/reports honest
// instead of leaving stale "pending" rows around forever.
function startExpirePendingJob() {
  cron.schedule('*/30 * * * *', async () => {
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const result = await Payment.updateMany(
        { status: 'pending', createdAt: { $lt: oneHourAgo } },
        { status: 'failed', gatewayResponse: 'Expired: abandoned checkout' }
      );
      if (result.modifiedCount > 0) {
        console.log(`Cron: expired ${result.modifiedCount} stale pending payment(s)`);
      }
    } catch (err) {
      console.error('Cron expire-pending error:', err.message);
    }
  });
  console.log('Cron job scheduled: expire stale pending payments every 30 min');
}

module.exports = { startExpirePendingJob };
