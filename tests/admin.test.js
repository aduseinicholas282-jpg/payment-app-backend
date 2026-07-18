const request = require('supertest');
const createApp = require('../app');
const User = require('../models/User');

const app = createApp();

async function registerAndLogin(email, role = 'user') {
  const res = await request(app).post('/api/auth/register').send({
    name: 'Test User',
    email,
    password: 'password123',
  });
  if (role === 'admin') {
    await User.updateOne({ email }, { role: 'admin' });
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'password123' });
    return login.body.token;
  }
  return res.body.token;
}

describe('Admin route authorization', () => {
  it('blocks a regular user from the admin transactions list', async () => {
    const token = await registerAndLogin('regular@example.com');
    const res = await request(app)
      .get('/api/admin/transactions')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('blocks requests with no token at all', async () => {
    const res = await request(app).get('/api/admin/transactions');
    expect(res.status).toBe(401);
  });

  it('allows an admin user through', async () => {
    const token = await registerAndLogin('theadmin@example.com', 'admin');
    const res = await request(app)
      .get('/api/admin/transactions')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.payments).toEqual([]);
  });
});
