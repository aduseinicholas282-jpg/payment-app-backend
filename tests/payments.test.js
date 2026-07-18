const request = require('supertest');
const createApp = require('../app');

const app = createApp();

async function registerAndLogin(email) {
  const res = await request(app).post('/api/auth/register').send({
    name: 'Payment Test',
    email,
    password: 'password123',
  });
  return res.body.token;
}

describe('POST /api/payments/initialize', () => {
  it('rejects requests with no auth token', async () => {
    const res = await request(app)
      .post('/api/payments/initialize')
      .send({ email: 'x@example.com', amount: 10 });
    expect(res.status).toBe(401);
  });

  it('rejects a missing amount', async () => {
    const token = await registerAndLogin('payer1@example.com');
    const res = await request(app)
      .post('/api/payments/initialize')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'payer1@example.com' });
    expect(res.status).toBe(400);
  });

  it('rejects a zero or negative amount', async () => {
    const token = await registerAndLogin('payer2@example.com');
    const res = await request(app)
      .post('/api/payments/initialize')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'payer2@example.com', amount: 0 });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/payments/my-transactions', () => {
  it('rejects requests with no auth token', async () => {
    const res = await request(app).get('/api/payments/my-transactions');
    expect(res.status).toBe(401);
  });

  it('returns an empty list for a brand new user', async () => {
    const token = await registerAndLogin('newuser@example.com');
    const res = await request(app)
      .get('/api/payments/my-transactions')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.payments).toEqual([]);
    expect(res.body.total).toBe(0);
  });
});
