const express = require('express');
const crypto = require('crypto');
const Payment = require('../models/Payment');

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
      await Payment.findOneAndUpdate(
        { reference },
        {
          status: status === 'success' ? 'success' : 'failed',
          paidAt: paid_at,
          channel,
          currency,
          gatewayResponse: gateway_response,
        }
      );
      console.log(`Webhook: payment ${reference} marked ${status}`);
    }

    // Always acknowledge quickly so Paystack doesn't retry unnecessarily
    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook processing error:', err.message);
    res.sendStatus(200); // still acknowledge receipt to avoid retry storms
  }
});

module.exports = router;
