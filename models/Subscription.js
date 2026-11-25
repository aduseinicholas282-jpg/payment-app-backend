const mongoose = require('mongoose');

// Keep the original fixed-term fields so existing Ledger subscriptions remain
// readable while new purchases can use Paystack's automatic recurring plans.
const subscriptionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  email: { type: String, required: true, trim: true, lowercase: true },
  plan: { type: String, enum: ['promotion', 'gold', 'diamond'] },
  duration: { type: String, enum: ['monthly', 'sixMonth', 'yearly'] },
  tier: { type: String, enum: ['promotion', 'gold', 'diamond'] },
  billingPeriod: { type: String, enum: ['monthly', 'six-months', 'yearly'] },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'GHS' },
  status: {
    type: String,
    enum: ['pending', 'active', 'attention', 'non-renewing', 'expired', 'cancelled', 'completed'],
    default: 'pending',
    index: true,
  },
  // Fixed-term checkout references and dates (legacy subscription flow).
  reference: { type: String, unique: true, sparse: true, index: true },
  startDate: Date,
  expiryDate: { type: Date, index: true },
  expiryNotifiedAt: Date,
  cancelledAt: Date,
  // Recurring Paystack plan fields (new auto-renewing subscription flow).
  planCode: { type: String, sparse: true },
  subscriptionCode: { type: String, unique: true, sparse: true },
  customerCode: String,
  emailTokenEncrypted: String,
  nextPaymentDate: Date,
  lastReminderInvoiceCode: String,
  lastFailedInvoiceCode: String,
}, { timestamps: true });

module.exports = mongoose.model('Subscription', subscriptionSchema);
