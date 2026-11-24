// Central config for subscription tiers, durations, and pricing.
// Amounts are in GHS (major units — Paystack conversion to pesewas happens
// at the point of calling their API, same as the existing one-off payments).
// Adjust freely here; nothing else in the app hardcodes prices.

const PLANS = {
  promotion: { label: 'Promotion' },
  gold: { label: 'Gold' },
  diamond: { label: 'Diamond' },
};

const DURATIONS = {
  monthly: { label: 'Monthly', days: 30 },
  sixMonth: { label: '6 Months', days: 182 },
  yearly: { label: 'Yearly', days: 365 },
};

// pricing[plan][duration] = amount in GHS
const PRICING = {
  promotion: { monthly: 30, sixMonth: 150, yearly: 280 },
  gold: { monthly: 70, sixMonth: 380, yearly: 700 },
  diamond: { monthly: 150, sixMonth: 800, yearly: 1500 },
};

const PLAN_KEYS = Object.keys(PLANS);
const DURATION_KEYS = Object.keys(DURATIONS);

function isValidPlan(plan) {
  return PLAN_KEYS.includes(plan);
}

function isValidDuration(duration) {
  return DURATION_KEYS.includes(duration);
}

function getPrice(plan, duration) {
  if (!isValidPlan(plan) || !isValidDuration(duration)) return null;
  return PRICING[plan][duration];
}

function getDurationDays(duration) {
  return DURATIONS[duration]?.days;
}

// Flat grid the frontend can render directly: [{ plan, label, prices: { monthly, sixMonth, yearly } }]
function getPricingGrid() {
  return PLAN_KEYS.map((plan) => ({
    plan,
    label: PLANS[plan].label,
    prices: PRICING[plan],
  }));
}

module.exports = {
  PLANS,
  DURATIONS,
  PRICING,
  PLAN_KEYS,
  DURATION_KEYS,
  isValidPlan,
  isValidDuration,
  getPrice,
  getDurationDays,
  getPricingGrid,
};
