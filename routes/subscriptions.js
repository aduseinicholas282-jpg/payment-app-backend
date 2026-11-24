const express = require('express');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const Subscription = require('../models/Subscription');
const Payment = require('../models/Payment');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const {
  isValidPlan,
  isValidDuration,
  getPrice,
  getPricingGrid,
  DURATIONS,
  PLANS,
} = require('../config/plans');

const router = express.Router();
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_BASE_URL = 'https://api.paystack.co';

// Same abuse-prevention pattern as the existing /api/payments/initialize
const subscribeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many subscription attempts. Please try again later.' },
  skip: () => !!process.env.JEST_WORKER_ID,
});

// GET /api/subscriptions/plans (public)
// Returns the tier/duration/pricing grid so the frontend never hardcodes prices.
router.get('/plans', (req, res) => {
  res.json({
    plans: getPricingGrid(),
    durations: DURATIONS,
  });
});

// POST /api/subscriptions/initialize (requires login)
// body: { plan: 'promotion'|'gold'|'diamond', duration: 'monthly'|'sixMonth'|'yearly' }
router.post('/initialize', requireAuth, subscribeLimiter, async (req, res) => {
  try {
    const { plan, duration } = req.body;

    if (!isValidPlan(plan)) {
      return res.status(400).json({ error: 'Invalid plan. Choose promotion, gold, or diamond' });
    }
    if (!isValidDuration(duration)) {
      return res.status(400).json({ error: 'Invalid duration. Choose monthly, sixMonth, or yearly' });
    }
    if (!PAYSTACK_SECRET_KEY) {
      return res.status(503).json({ error: 'Payment provider not configured yet' });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const amount = getPrice(plan, duration);

    const response = await axios.post(
      `${PAYSTACK_BASE_URL}/transaction/initialize`,
      {
        email: user.email,
        amount: Math.round(amount * 100), // Paystack expects kobo/pesewas
        metadata: {
          type: 'subscription',
          plan,
          duration,
          userId: String(user._id),
        },
      },
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    const { authorization_url, access_code, reference } = response.data.data;

    // Create the pending Subscription now; the webhook activates it once
    // Paystack confirms the charge succeeded.
    await Subscription.create({
      user: user._id,
      email: user.email,
      plan,
      duration,
      amount,
      status: 'pending',
      reference,
    });

    // Also record it as a Payment so it shows up in the existing
    // transaction history / stats views alongside one-off payments.
    await Payment.create({
      user: user._id,
      email: user.email,
      amount,
      reference,
      status: 'pending',
      metadata: { type: 'subscription', plan, duration },
    });

    res.json({ authorization_url, access_code, reference, plan, duration, amount });
  } catch (err) {
    console.error('Subscription initialize error:', err.response?.data || err.message);
    res.status(502).json({ error: 'Unable to initialize subscription payment' });
  }
});

// GET /api/subscriptions/my (requires login)
// Returns the user's current subscription (most recent active one if present,
// otherwise the most recently created subscription of any status) plus a
// short history.
router.get('/my', requireAuth, async (req, res) => {
  try {
    const [current, history] = await Promise.all([
      Subscription.findOne({ user: req.user.id, status: 'active' }).sort({ createdAt: -1 }),
      Subscription.find({ user: req.user.id }).sort({ createdAt: -1 }).limit(10),
    ]);

    const latest = current || history[0] || null;

    res.json({
      current: latest,
      history,
      planLabels: Object.fromEntries(Object.entries(PLANS).map(([k, v]) => [k, v.label])),
      durationLabels: Object.fromEntries(Object.entries(DURATIONS).map(([k, v]) => [k, v.label])),
    });
  } catch (err) {
    console.error('My-subscription error:', err.message);
    res.status(500).json({ error: 'Unable to fetch subscription' });
  }
});

// POST /api/subscriptions/cancel (requires login)
// Cancels the user's currently active subscription (does not refund;
// simply stops it from renewing/being treated as active).
router.post('/cancel', requireAuth, async (req, res) => {
  try {
    const subscription = await Subscription.findOne({ user: req.user.id, status: 'active' });
    if (!subscription) {
      return res.status(404).json({ error: 'No active subscription to cancel' });
    }
    subscription.status = 'cancelled';
    subscription.cancelledAt = new Date();
    await subscription.save();
    res.json({ message: 'Subscription cancelled', subscription });
  } catch (err) {
    console.error('Cancel subscription error:', err.message);
    res.status(500).json({ error: 'Unable to cancel subscription' });
  }
});

module.exports = router;
