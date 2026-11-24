const express = require('express');
const crypto = require('crypto');
const Payment = require('../models/Payment');
const Subscription = require('../models/Subscription');
const { sendReceiptEmail, sendSubscriptionReceiptEmail } = require('../utils/mailer');
const { getDurationDays } = require('../config/plans');

const router = express.Router();

// IMPORTANT: this route needs the RAW request body (not JSON-parsed)
// to correctly verify Paystack's HMAC signature. It must be mounted
// in server.js BEFORE the global express.json()/body-parser middleware.
router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) {
      return res.status(503).send('Payment provider not configured');
    }

    const signature = req.headers['x-paystack-signature'];
    const expectedHash = crypto
      .createHmac('sha512', secret)
      .update(req.body)
      .digest('hex');

    if (!signature || signature !== expectedHash) {
      console.warn('Rejected webhook: invalid Paystack signature');
      return res.status(401).send('Invalid signature');
    }

    const event = JSON.parse(req.body.toString('utf8'));

    if (event.event === 'charge.success') {
      const { reference, status, paid_at, channel, currency, gateway_response } = event.data;
      const updated = await Payment.findOneAndUpdate(
        { reference },
        {
          status: status === 'success' ? 'success' : 'failed',
          paidAt: paid_at,
          channel,
          currency,
          gatewayResponse: gateway_response,
        },
        { new: true }
      );
      console.log(`Webhook: payment ${reference} marked ${status}`);

      if (updated && updated.status === 'success') {
        const isSubscription = updated.metadata?.type === 'subscription';

        if (isSubscription) {
          const subscription = await Subscription.findOne({ reference });
          if (subscription && subscription.status !== 'active') {
            const now = new Date();
            const days = getDurationDays(subscription.duration);
            subscription.status = 'active';
            subscription.startDate = now;
            subscription.expiryDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
            subscription.expiryNotifiedAt = undefined;
            await subscription.save();
            console.log(`Webhook: subscription ${reference} (${subscription.plan}/${subscription.duration}) activated, expires ${subscription.expiryDate.toISOString()}`);
            // Fire-and-forget, same pattern as the one-off receipt email
            sendSubscriptionReceiptEmail(subscription);
          }
        } else {
          // Fire-and-forget: never let a slow/failed email delay the webhook response
          sendReceiptEmail(updated);
        }
      }
    }

    // Always acknowledge quickly so Paystack doesn't retry unnecessarily
    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook processing error:', err.message);
    res.sendStatus(200); // still acknowledge receipt to avoid retry storms
  }
});

module.exports = router;
