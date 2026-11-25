const express = require('express');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const Subscription = require('../models/Subscription');
const SubscriptionPlan = require('../models/SubscriptionPlan');
const Payment = require('../models/Payment');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const { decryptToken } = require('../utils/paystackToken');
const { isEmailConfigured } = require('../utils/mailer');
const { isValidPlan, isValidDuration, getPrice, getPricingGrid, DURATIONS, PLANS, getDurationDays } = require('../config/plans');

const router = express.Router();
const PAYSTACK_BASE_URL = 'https://api.paystack.co';
const recurringPeriods = {
  monthly: { label: 'Monthly', duration: 'monthly', interval: 'monthly' },
  'six-months': { label: '6 Months', duration: 'sixMonth', interval: 'biannually' },
  yearly: { label: 'Yearly', duration: 'yearly', interval: 'annually' },
};
const subscribeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many subscription attempts. Please try again later.' },
  skip: () => !!process.env.JEST_WORKER_ID,
});

function paystackConfig() {
  if (!process.env.PAYSTACK_SECRET_KEY) throw new Error('Payment provider is not configured');
  return { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' }, timeout: 10000 };
}

async function getOrCreatePlan(tier, billingPeriod) {
  const period = recurringPeriods[billingPeriod];
  const key = `${tier}-${billingPeriod}`;
  let saved = await SubscriptionPlan.findOne({ key });
  if (saved) return saved;

  const amount = getPrice(tier, period.duration);
  const result = await axios.post(`${PAYSTACK_BASE_URL}/plan`, {
    name: `Ledger ${PLANS[tier].label} - ${period.label}`,
    description: `${PLANS[tier].label} Ledger subscription, billed ${period.label.toLowerCase()}`,
    amount: Math.round(amount * 100),
    currency: 'GHS',
    interval: period.interval,
    send_invoices: !isEmailConfigured,
    send_sms: false,
  }, paystackConfig());

  try {
    return await SubscriptionPlan.create({ key, name: PLANS[tier].label, amount, currency: 'GHS', interval: period.interval, planCode: result.data.data.plan_code });
  } catch (error) {
    if (error.code === 11000) {
      saved = await SubscriptionPlan.findOne({ key });
      if (saved) return saved;
    }
    throw error;
  }
}

async function initializeLegacySubscription(user, plan, duration) {
  const amount = getPrice(plan, duration);
  const result = await axios.post(`${PAYSTACK_BASE_URL}/transaction/initialize`, {
    email: user.email,
    amount: Math.round(amount * 100),
    metadata: { type: 'subscription', plan, duration, userId: String(user._id) },
  }, paystackConfig());

  const { authorization_url, access_code, reference } = result.data.data;
  await Subscription.create({ user: user._id, email: user.email, plan, duration, amount, status: 'pending', reference });
  await Payment.create({ user: user._id, email: user.email, amount, reference, status: 'pending', metadata: { type: 'subscription', plan, duration } });
  return { authorization_url, access_code, reference, plan, duration, amount };
}

async function disableRecurringSubscription(subscription) {
  if (!subscription.subscriptionCode || !subscription.emailTokenEncrypted) {
    throw new Error('Recurring cancellation details are unavailable');
  }
  const result = await axios.post(`${PAYSTACK_BASE_URL}/subscription/disable`, {
    code: subscription.subscriptionCode,
    token: decryptToken(subscription.emailTokenEncrypted),
  }, paystackConfig());
  if (!result.data.status) throw new Error('Paystack could not cancel this subscription');
  subscription.status = 'non-renewing';
  await subscription.save();
  return subscription;
}

router.get('/plans', (req, res) => res.json({ plans: getPricingGrid(), durations: DURATIONS }));
router.post('/initialize', requireAuth, subscribeLimiter, async (req, res) => {
  try {
    const { plan, duration } = req.body;
    if (!isValidPlan(plan)) return res.status(400).json({ error: 'Choose a valid plan' });
    if (!isValidDuration(duration)) return res.status(400).json({ error: 'Choose a valid billing period' });
    if (!process.env.PAYSTACK_SECRET_KEY) return res.status(503).json({ error: 'Payment provider is not configured' });
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'Account not found' });
    res.json(await initializeLegacySubscription(user, plan, duration));
  } catch (error) {
    console.error('Fixed-term subscription checkout error:', error.response?.data || error.message);
    res.status(502).json({ error: 'Unable to start subscription checkout' });
  }
});

// New automatic renewal checkout. The subscriber sees the chosen tier, full
// charge amount and recurrence before confirming on Paystack's hosted page.
router.post('/checkout', requireAuth, subscribeLimiter, async (req, res) => {
  try {
    const { tier, billingPeriod } = req.body;
    if (!isValidPlan(tier) || !recurringPeriods[billingPeriod]) {
      return res.status(400).json({ error: 'Choose a valid plan and billing period' });
    }
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'Account not found' });

    const current = await Subscription.findOne({
      user: req.user.id,
      status: { $in: ['active', 'attention', 'non-renewing'] },
    });
    const legacyActive = await Subscription.findOne({ user: req.user.id, status: 'active', expiryDate: { $gt: new Date() } });
    if (current || legacyActive) {
      return res.status(409).json({ error: 'You already have an active plan. Manage it before starting another.' });
    }

    const plan = await getOrCreatePlan(tier, billingPeriod);
    const amount = getPrice(tier, recurringPeriods[billingPeriod].duration);
    const result = await axios.post(`${PAYSTACK_BASE_URL}/transaction/initialize`, {
      email: user.email,
      amount: Math.round(amount * 100),
      plan: plan.planCode,
      metadata: { kind: 'ledger_subscription', tier, tier_name: PLANS[tier].label, billing_period: billingPeriod, user_id: String(user._id) },
    }, paystackConfig());

    const { authorization_url, access_code, reference } = result.data.data;
    await Payment.create({
      user: user._id,
      email: user.email,
      amount,
      reference,
      status: 'pending',
      metadata: { kind: 'ledger_subscription', tier, billingPeriod, planCode: plan.planCode },
    });
    res.json({ authorization_url, access_code, reference, amount, currency: 'GHS' });
  } catch (error) {
    console.error('Recurring subscription checkout error:', error.response?.data || error.message);
    res.status(502).json({ error: 'Unable to start subscription checkout' });
  }
});

router.get('/mine', requireAuth, async (req, res) => {
  try {
    const records = await Subscription.find({ user: req.user.id }).sort({ createdAt: -1 }).select('-__v').lean();
    const subscriptions = records.map(({ emailTokenEncrypted, ...item }) => ({
      ...item,
      tier: item.tier || item.plan,
      billingPeriod: item.billingPeriod || ({ sixMonth: 'six-months' }[item.duration] || item.duration),
      nextPaymentDate: item.nextPaymentDate || item.expiryDate,
      isRecurring: !!item.subscriptionCode,
      canCancel: !!item.subscriptionCode && !!emailTokenEncrypted,
    }));
    res.json({ subscriptions });
  } catch (error) {
    console.error('Subscription list error:', error.message);
    res.status(500).json({ error: 'Unable to load subscriptions' });
  }
});

// Preserve the previous fixed-term subscription endpoint and history response.
router.get('/my', requireAuth, async (req, res) => {
  try {
    const [current, history] = await Promise.all([
      Subscription.findOne({ user: req.user.id, status: 'active' }).select('-emailTokenEncrypted').sort({ createdAt: -1 }),
      Subscription.find({ user: req.user.id }).select('-emailTokenEncrypted').sort({ createdAt: -1 }).limit(10),
    ]);
    res.json({ current: current || history[0] || null, history, planLabels: Object.fromEntries(Object.entries(PLANS).map(([key, value]) => [key, value.label])), durationLabels: Object.fromEntries(Object.entries(DURATIONS).map(([key, value]) => [key, value.label])) });
  } catch (error) {
    console.error('My-subscription error:', error.message);
    res.status(500).json({ error: 'Unable to fetch subscription' });
  }
});

async function cancelById(req, res) {
  const subscription = await Subscription.findOne({ _id: req.params.id, user: req.user.id });
  if (!subscription) return res.status(404).json({ error: 'Subscription not found' });
  if (['cancelled', 'completed', 'non-renewing'].includes(subscription.status)) {
    return res.json({ message: 'This subscription is already set not to renew', subscription: { id: subscription.id, status: subscription.status } });
  }
  if (subscription.subscriptionCode) {
    await disableRecurringSubscription(subscription);
  } else {
    subscription.status = 'cancelled';
    subscription.cancelledAt = new Date();
    await subscription.save();
  }
  return res.json({ message: subscription.subscriptionCode ? 'Subscription will not renew after the current period' : 'Subscription cancelled', subscription: { id: subscription.id, status: subscription.status, nextPaymentDate: subscription.nextPaymentDate || subscription.expiryDate } });
}

router.post('/:id/cancel', requireAuth, async (req, res) => {
  try { return await cancelById(req, res); }
  catch (error) {
    console.error('Subscription cancel error:', error.response?.data || error.message);
    return res.status(502).json({ error: 'Unable to cancel subscription renewal' });
  }
});

router.post('/cancel', requireAuth, async (req, res) => {
  try {
    const subscription = await Subscription.findOne({ user: req.user.id, status: { $in: ['active', 'attention'] } }).sort({ createdAt: -1 });
    if (!subscription) return res.status(404).json({ error: 'No active subscription to cancel' });
    req.params.id = subscription.id;
    return await cancelById(req, res);
  } catch (error) {
    console.error('Cancel subscription error:', error.response?.data || error.message);
    return res.status(502).json({ error: 'Unable to cancel subscription' });
  }
});

module.exports = router;
