const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, trim: true, lowercase: true },
    amount: { type: Number, required: true },
    reference: { type: String, required: true, unique: true, index: true },
    status: {
      type: String,
      enum: ['pending', 'success', 'failed'],
      default: 'pending',
    },
    channel: String,
    currency: String,
    gatewayResponse: String,
    paidAt: Date,
    metadata: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Payment', paymentSchema);
