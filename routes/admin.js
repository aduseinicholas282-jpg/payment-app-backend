const express = require('express');
const axios = require('axios');
const Payment = require('../models/Payment');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_BASE_URL = 'https://api.paystack.co';

// All routes here require a logged-in admin
router.use(requireAuth, requireAdmin);

// GET /api/admin/transactions?status=success&page=1&limit=20
router.get('/transactions', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.email) filter.email = req.query.email.toLowerCase();

    const [payments, total] = await Promise.all([
      Payment.find(filter)
        .populate('user', 'name email')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Payment.countDocuments(filter),
    ]);

    res.json({ payments, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('Admin transactions error:', err.message);
    res.status(500).json({ error: 'Unable to fetch transactions' });
  }
});

// POST /api/admin/refund/:reference
router.post('/refund/:reference', async (req, res) => {
  try {
    if (!PAYSTACK_SECRET_KEY) {
      return res.status(503).json({ error: 'Payment provider not configured yet' });
    }

    const { reference } = req.params;
    const payment = await Payment.findOne({ reference });
    if (!payment) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    if (payment.status !== 'success') {
      return res.status(400).json({ error: 'Only successful transactions can be refunded' });
    }

    const response = await axios.post(
      `${PAYSTACK_BASE_URL}/refund`,
      { transaction: reference },
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    payment.status = 'refunded';
    payment.refundedAt = new Date();
    payment.refundReference = response.data.data?.transaction?.reference || reference;
    await payment.save();

    res.json({ message: 'Refund initiated', payment });
  } catch (err) {
    console.error('Refund error:', err.response?.data || err.message);
    res.status(502).json({ error: 'Unable to process refund' });
  }
});

module.exports = router;
