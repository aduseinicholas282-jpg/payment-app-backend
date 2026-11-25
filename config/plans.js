// Amounts are GHS in major units. Keep these existing plan prices in one
// place so both the fixed-term and recurring checkouts use the same totals.
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

const PRICING = {
  promotion: { monthly: 30, sixMonth: 150, yearly: 280 },
  gold: { monthly: 70, sixMonth: 380, yearly: 700 },
  diamond: { monthly: 150, sixMonth: 800, yearly: 1500 },
};

const PLAN_KEYS = Object.keys(PLANS);
const DURATION_KEYS = Object.keys(DURATIONS);

function isValidPlan(plan) { return PLAN_KEYS.includes(plan); }
function isValidDuration(duration) { return DURATION_KEYS.includes(duration); }
function getPrice(plan, duration) {
  return isValidPlan(plan) && isValidDuration(duration) ? PRICING[plan][duration] : null;
}
function getDurationDays(duration) { return DURATIONS[duration]?.days; }
function getPricingGrid() {
  return PLAN_KEYS.map((plan) => ({ plan, label: PLANS[plan].label, prices: PRICING[plan] }));
}

module.exports = { PLANS, DURATIONS, PRICING, PLAN_KEYS, DURATION_KEYS, isValidPlan, isValidDuration, getPrice, getDurationDays, getPricingGrid };
