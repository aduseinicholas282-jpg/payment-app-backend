const mongoose = require('mongoose');

const subscriptionPlanSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'GHS' },
  interval: { type: String, enum: ['monthly', 'biannually', 'annually'], required: true },
  planCode: { type: String, required: true, unique: true },
}, { timestamps: true });

module.exports = mongoose.model('SubscriptionPlan', subscriptionPlanSchema);
