const express = require('express');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const Payment = require('../models/Payment');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_BASE_URL = 'https://api.paystack.co';

// Stricter limit specifically on payment initiation to prevent abuse/spam
const initializeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many payment attempts. Please try again later.' },
});

// POST /api/payments/initialize (requires login)
router.post('/initialize', requireAuth, initializeLimiter, async (req, res) => {
  try {
    const { email, amount, metadata } = req.body;
    if (!email || !amount || Number(amount) <= 0) {
      return res.status(400).json({ error: 'Valid email and amount are required' });
    }

    if (!PAYSTACK_SECRET_KEY) {
      return res.status(503).json({ error: 'Payment provider not configured yet' });
    }

    const response = await axios.post(
      `${PAYSTACK_BASE_URL}/transaction/initialize`,
      {
        email,
        amount: Math.round(Number(amount) * 100), // Paystack expects kobo/pesewas
        metadata: metadata || {},
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

    await Payment.create({
      user: req.user.id,
      email,
      amount: Number(amount),
      reference,
      status: 'pending',
      metadata: metadata || {},
    });

    res.json({ authorization_url, access_code, reference });
  } catch (err) {
    console.error('Paystack initialize error:', err.response?.data || err.message);
    res.status(502).json({ error: 'Unable to initialize payment' });
  }
});

// GET /api/payments/my-transactions (requires login)
// Returns the logged-in user's own payment history, paginated.
router.get('/my-transactions', requireAuth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);

    const [payments, total] = await Promise.all([
      Payment.find({ user: req.user.id })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Payment.countDocuments({ user: req.user.id }),
    ]);

    res.json({ payments, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('My-transactions error:', err.message);
    res.status(500).json({ error: 'Unable to fetch transactions' });
  }
});

// GET /api/payments/verify/:reference (requires login; owner or admin only)
router.get('/verify/:reference', requireAuth, async (req, res) => {
  try {
    if (!PAYSTACK_SECRET_KEY) {
      return res.status(503).json({ error: 'Payment provider not configured yet' });
    }

    const { reference } = req.params;
    const existing = await Payment.findOne({ reference });
    if (!existing) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    const isOwner = existing.user && existing.user.toString() === req.user.id;
    if (!isOwner && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized to view this transaction' });
    }

    const response = await axios.get(
      `${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`,
      {
        headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
        timeout: 10000,
      }
    );

    const data = response.data.data;
    const status = data.status === 'success' ? 'success' : 'failed';

    const payment = await Payment.findOneAndUpdate(
      { reference },
      {
        status,
        paidAt: data.paid_at,
        channel: data.channel,
        currency: data.currency,
        gatewayResponse: data.gateway_response,
      },
      { new: true }
    );

    res.json({ status, payment });
  } catch (err) {
    console.error('Paystack verify error:', err.response?.data || err.message);
    res.status(502).json({ error: 'Unable to verify payment' });
  }
});

module.exports = router;
