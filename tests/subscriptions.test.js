const request = require('supertest');
const crypto = require('crypto');
const createApp = require('../app');
const Subscription = require('../models/Subscription');
const Payment = require('../models/Payment');

const app = createApp();

async function registerAndLogin(email) {
  const res = await request(app).post('/api/auth/register').send({
    name: 'Sub Test',
    email,
    password: 'password123',
  });
  return { token: res.body.token, userId: res.body.user.id };
}

describe('GET /api/subscriptions/plans', () => {
  it('returns the pricing grid with all three tiers, no auth required', async () => {
    const res = await request(app).get('/api/subscriptions/plans');
    expect(res.status).toBe(200);
    const planKeys = res.body.plans.map((p) => p.plan);
    expect(planKeys).toEqual(expect.arrayContaining(['promotion', 'gold', 'diamond']));
    for (const p of res.body.plans) {
      expect(p.prices.monthly).toBeGreaterThan(0);
      expect(p.prices.sixMonth).toBeGreaterThan(0);
      expect(p.prices.yearly).toBeGreaterThan(0);
    }
  });
});

describe('POST /api/subscriptions/initialize', () => {
  it('rejects requests with no auth token', async () => {
    const res = await request(app)
      .post('/api/subscriptions/initialize')
      .send({ plan: 'gold', duration: 'monthly' });
    expect(res.status).toBe(401);
  });

  it('rejects an invalid plan', async () => {
    const { token } = await registerAndLogin('sub1@example.com');
    const res = await request(app)
      .post('/api/subscriptions/initialize')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'platinum', duration: 'monthly' });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid duration', async () => {
    const { token } = await registerAndLogin('sub2@example.com');
    const res = await request(app)
      .post('/api/subscriptions/initialize')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'gold', duration: 'weekly' });
    expect(res.status).toBe(400);
  });

  it('returns 503 when Paystack is not configured', async () => {
    const { token } = await registerAndLogin('sub3@example.com');
    const res = await request(app)
      .post('/api/subscriptions/initialize')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'diamond', duration: 'yearly' });
    // PAYSTACK_SECRET_KEY is unset in the test env
    expect(res.status).toBe(503);
  });
});

describe('GET /api/subscriptions/my', () => {
  it('rejects requests with no auth token', async () => {
    const res = await request(app).get('/api/subscriptions/my');
    expect(res.status).toBe(401);
  });

  it('returns null current subscription for a brand new user', async () => {
    const { token } = await registerAndLogin('sub4@example.com');
    const res = await request(app)
      .get('/api/subscriptions/my')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.current).toBeNull();
    expect(res.body.history).toEqual([]);
  });
});

describe('POST /api/payments/webhook activating a subscription', () => {
  const originalSecret = process.env.PAYSTACK_SECRET_KEY;

  beforeAll(() => {
    process.env.PAYSTACK_SECRET_KEY = 'test-paystack-secret';
  });

  afterAll(() => {
    process.env.PAYSTACK_SECRET_KEY = originalSecret;
  });

  function signedWebhookRequest(body) {
    const payload = JSON.stringify(body);
    const signature = crypto
      .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
      .update(payload)
      .digest('hex');
    return request(app)
      .post('/api/payments/webhook')
      .set('x-paystack-signature', signature)
      .set('Content-Type', 'application/json')
      .send(payload);
  }

  it('activates the matching subscription and sets an expiry date', async () => {
    const { token, userId } = await registerAndLogin('sub5@example.com');
    const reference = 'sub_ref_test_1';

    await Subscription.create({
      user: userId,
      email: 'sub5@example.com',
      plan: 'gold',
      duration: 'monthly',
      amount: 70,
      status: 'pending',
      reference,
    });
    await Payment.create({
      user: userId,
      email: 'sub5@example.com',
      amount: 70,
      reference,
      status: 'pending',
      metadata: { type: 'subscription', plan: 'gold', duration: 'monthly' },
    });

    const res = await signedWebhookRequest({
      event: 'charge.success',
      data: {
        reference,
        status: 'success',
        paid_at: new Date().toISOString(),
        channel: 'card',
        currency: 'GHS',
        gateway_response: 'Successful',
      },
    });
    expect(res.status).toBe(200);

    const subscription = await Subscription.findOne({ reference });
    expect(subscription.status).toBe('active');
    expect(subscription.startDate).toBeTruthy();
    expect(subscription.expiryDate).toBeTruthy();

    const daysDiff =
      (subscription.expiryDate.getTime() - subscription.startDate.getTime()) /
      (24 * 60 * 60 * 1000);
    expect(Math.round(daysDiff)).toBe(30);

    const check = await request(app)
      .get('/api/subscriptions/my')
      .set('Authorization', `Bearer ${token}`);
    expect(check.body.current.plan).toBe('gold');
    expect(check.body.current.status).toBe('active');
  });
});

describe('POST /api/subscriptions/cancel', () => {
  it('returns 404 when there is no active subscription', async () => {
    const { token } = await registerAndLogin('sub6@example.com');
    const res = await request(app)
      .post('/api/subscriptions/cancel')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('cancels an active subscription', async () => {
    const { token, userId } = await registerAndLogin('sub7@example.com');
    await Subscription.create({
      user: userId,
      email: 'sub7@example.com',
      plan: 'promotion',
      duration: 'yearly',
      amount: 280,
      status: 'active',
      startDate: new Date(),
      expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      reference: 'sub_ref_test_2',
    });

    const res = await request(app)
      .post('/api/subscriptions/cancel')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.subscription.status).toBe('cancelled');
  });
});
