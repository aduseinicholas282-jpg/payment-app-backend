const express = require('express');
const crypto = require('crypto');
const Payment = require('../models/Payment');
const Subscription = require('../models/Subscription');
const { encryptToken } = require('../utils/paystackToken');
const { sendReceiptEmail, sendSubscriptionReceiptEmail, sendExpiryReminderEmail, sendSubscriptionReminderEmail, sendSubscriptionFailedEmail } = require('../utils/mailer');
const { getDurationDays } = require('../config/plans');

const router = express.Router();

function subscriptionCode(data = {}) {
  if (typeof data.subscription === 'string') return data.subscription;
  return data.subscription?.subscription_code || data.subscription?.code || data.subscription_code || null;
}

function periodFromInterval(interval = '') {
  if (interval === 'biannually') return 'six-months';
  if (interval === 'annually') return 'yearly';
  return 'monthly';
}

async function findSubscription(data = {}) {
  const code = subscriptionCode(data);
  if (code) {
    const byCode = await Subscription.findOne({ subscriptionCode: code });
    if (byCode) return byCode;
  }
  const email = data.customer?.email || data.customer_email || data.email;
  const customerCode = data.customer?.customer_code || data.customer_code;
  const match = [];
  if (email) match.push({ email: email.toLowerCase() });
  if (customerCode) match.push({ customerCode });
  if (!match.length) return null;
  return Subscription.findOne({ $or: match, status: { $in: ['active', 'attention', 'non-renewing'] }, subscriptionCode: { $exists: true } }).sort({ createdAt: -1 });
}

router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) return res.status(503).send('Payment provider not configured');
  try {
    const signature = req.headers['x-paystack-signature'];
    const expectedHash = crypto.createHmac('sha512', secret).update(req.body).digest('hex');
    const valid = signature && signature.length === expectedHash.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedHash));
    if (!valid) {
      console.warn('Rejected webhook: invalid Paystack signature');
      return res.status(401).send('Invalid signature');
    }

    const event = JSON.parse(req.body.toString('utf8'));
    const data = event.data || {};

    if (event.event === 'charge.success') {
      const { reference, status, paid_at, channel, currency, gateway_response } = data;
      let payment = await Payment.findOne({ reference });
      let newlyPaid = false;
      if (payment && payment.status !== 'success' && status === 'success') {
        payment = await Payment.findOneAndUpdate({ reference, status: { $ne: 'success' } }, {
          status: 'success', paidAt: paid_at || new Date(), channel, currency, gatewayResponse: gateway_response,
        }, { new: true });
        newlyPaid = !!payment;
      } else if (!payment && status === 'success') {
        const subscription = await findSubscription(data);
        if (subscription) {
          try {
            payment = await Payment.create({
              user: subscription.user,
              email: subscription.email,
              amount: Number(data.amount || 0) / 100,
              reference,
              status: 'success',
              paidAt: paid_at || new Date(),
              channel,
              currency: currency || subscription.currency,
              gatewayResponse: gateway_response,
              metadata: { kind: 'ledger_subscription', tier: subscription.tier || subscription.plan, billingPeriod: subscription.billingPeriod || subscription.duration },
            });
            newlyPaid = true;
          } catch (error) {
            if (error.code !== 11000) throw error;
            payment = await Payment.findOne({ reference });
          }
        }
      }

      // Keep the original fixed-term subscription flow working for existing
      // customers while new Paystack plan charges use the recurring path.
      if (status === 'success' && payment?.metadata?.type === 'subscription') {
        const legacy = await Subscription.findOne({ reference });
        if (legacy && legacy.status !== 'active') {
          const now = new Date();
          const days = getDurationDays(legacy.duration);
          legacy.status = 'active';
          legacy.startDate = now;
          legacy.expiryDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
          legacy.expiryNotifiedAt = undefined;
          await legacy.save();
        }
        if (legacy && payment && !payment.receiptEmailSentAt) {
          if (!(await sendSubscriptionReceiptEmail(legacy))) return res.sendStatus(500);
          await Payment.updateOne({ reference, receiptEmailSentAt: { $exists: false } }, { $set: { receiptEmailSentAt: new Date() } });
        }
      } else if (status === 'success' && payment && !payment.receiptEmailSentAt) {
        if (!(await sendReceiptEmail(payment))) return res.sendStatus(500);
        await Payment.updateOne({ reference, receiptEmailSentAt: { $exists: false } }, { $set: { receiptEmailSentAt: new Date() } });
      }

      const code = subscriptionCode(data);
      if (code) {
        const dueDate = data.subscription?.next_payment_date;
        await Subscription.updateOne({ subscriptionCode: code }, { $set: { status: 'active', ...(dueDate ? { nextPaymentDate: dueDate } : {}) } });
      }
    }

    if (event.event === 'subscription.create') {
      const email = data.customer?.email || data.email;
      const code = subscriptionCode(data);
      if (code && email) {
        const initialPayment = await Payment.findOne({ email: email.toLowerCase(), 'metadata.kind': 'ledger_subscription' }).sort({ createdAt: -1 });
        const plan = data.plan || {};
        const meta = initialPayment?.metadata || {};
        const rawTier = meta.tier || String(plan.name || '').toLowerCase().split(' ')[1] || 'promotion';
        const tier = ['promotion', 'gold', 'diamond'].includes(rawTier) ? rawTier : 'promotion';
        const billingPeriod = meta.billingPeriod || periodFromInterval(plan.interval);
        const amountPesewas = Number(plan.amount || data.amount || 0);
        const update = {
          email: email.toLowerCase(),
          tier,
          billingPeriod,
          amount: amountPesewas ? amountPesewas / 100 : (initialPayment?.amount || 0),
          currency: plan.currency || 'GHS',
          planCode: plan.plan_code || meta.planCode,
          customerCode: data.customer?.customer_code || data.customer_code,
          status: data.status === 'active' || !data.status ? 'active' : 'pending',
          nextPaymentDate: data.next_payment_date || data.subscription?.next_payment_date,
        };
        if (data.email_token) update.emailTokenEncrypted = encryptToken(data.email_token);
        if (meta.tier) update.user = initialPayment.user;
        const existing = await Subscription.findOne({ subscriptionCode: code });
        if (!existing && !update.user) {
          console.warn('Subscription webhook lacked a matching initial payment; Paystack will retry');
          return res.sendStatus(500);
        }
        await Subscription.findOneAndUpdate({ subscriptionCode: code }, {
          $set: update,
          $setOnInsert: { user: update.user, subscriptionCode: code },
        }, { upsert: true, new: true, setDefaultsOnInsert: true });
      }
    }

    if (event.event === 'invoice.create') {
      const subscription = await findSubscription(data);
      const invoiceCode = data.invoice_code || data.invoice?.invoice_code || data.id;
      if (subscription && invoiceCode && subscription.lastReminderInvoiceCode !== String(invoiceCode)) {
        if (!(await sendSubscriptionReminderEmail(subscription, data))) return res.sendStatus(500);
        subscription.lastReminderInvoiceCode = String(invoiceCode);
        await subscription.save();
      }
    }

    if (event.event === 'invoice.payment_failed') {
      const subscription = await findSubscription(data);
      if (subscription) {
        const invoiceCode = String(data.invoice_code || data.invoice?.invoice_code || data.id || 'unknown');
        if (subscription.lastFailedInvoiceCode !== invoiceCode && !(await sendSubscriptionFailedEmail(subscription))) return res.sendStatus(500);
        subscription.status = 'attention';
        subscription.lastFailedInvoiceCode = invoiceCode;
        await subscription.save();
      }
    }

    if (event.event === 'invoice.update') {
      const subscription = await findSubscription(data);
      if (subscription && data.status === 'success') {
        if (subscription.status !== 'non-renewing') subscription.status = 'active';
        const nextDate = data.subscription?.next_payment_date || data.next_payment_date;
        if (nextDate) subscription.nextPaymentDate = nextDate;
        await subscription.save();
      }
    }

    if (event.event === 'subscription.not_renew') {
      const code = subscriptionCode(data);
      if (code) await Subscription.updateOne({ subscriptionCode: code }, { $set: { status: 'non-renewing' } });
    }

    if (event.event === 'subscription.disable') {
      const code = subscriptionCode(data);
      if (code) await Subscription.updateOne({ subscriptionCode: code }, { $set: { status: data.status === 'complete' ? 'completed' : 'cancelled' } });
    }

    if (event.event === 'subscription.expiring_cards') {
      const subscription = await findSubscription(data);
      if (subscription) await sendExpiryReminderEmail(subscription);
    }

    return res.sendStatus(200);
  } catch (error) {
    console.error('Webhook processing error:', error.response?.data || error.message);
    // A non-2xx response lets Paystack retry transient database/provider errors.
    return res.sendStatus(500);
  }
});

module.exports = router;
