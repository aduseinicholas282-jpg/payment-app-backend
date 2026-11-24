const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    plan: { type: String, enum: ['promotion', 'gold', 'diamond'], required: true },
    duration: { type: String, enum: ['monthly', 'sixMonth', 'yearly'], required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'GHS' },
    // 'pending' until Paystack confirms the charge (webhook), then 'active'.
    // Moves to 'expired' once the cron job sees expiryDate has passed, or
    // 'cancelled' if the user cancels before expiry.
    status: {
      type: String,
      enum: ['pending', 'active', 'expired', 'cancelled'],
      default: 'pending',
      index: true,
    },
    reference: { type: String, unique: true, sparse: true, index: true },
    startDate: Date,
    expiryDate: { type: Date, index: true },
    // Set once an expiry-reminder email has been sent, so the cron job
    // never sends more than one reminder per subscription.
    expiryNotifiedAt: Date,
    cancelledAt: Date,
  },
  { timestamps: true }
);

module.exports = mongoose.model('Subscription', subscriptionSchema);
