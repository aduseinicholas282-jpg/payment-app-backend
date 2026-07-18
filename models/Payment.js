const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    amount: { type: Number, required: true },
    reference: { type: String, required: true, unique: true, index: true },
    status: {
      type: String,
      enum: ['pending', 'success', 'failed', 'refunded'],
      default: 'pending',
    },
    channel: String,
    currency: String,
    gatewayResponse: String,
    paidAt: Date,
    refundedAt: Date,
    refundReference: String,
    metadata: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Payment', paymentSchema);
