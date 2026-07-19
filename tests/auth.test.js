const request = require('supertest');
const createApp = require('../app');

const app = createApp();

describe('POST /api/auth/register', () => {
  it('creates a new user and returns a token', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'Jane Doe',
      email: 'jane@example.com',
      password: 'password123',
    });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.email).toBe('jane@example.com');
    expect(res.body.user.role).toBe('user');
  });

  it('rejects a password shorter than 8 characters', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'Jane Doe',
      email: 'jane2@example.com',
      password: 'short',
    });
    expect(res.status).toBe(400);
  });

  it('rejects duplicate emails', async () => {
    await request(app).post('/api/auth/register').send({
      name: 'Jane Doe',
      email: 'dupe@example.com',
      password: 'password123',
    });
    const res = await request(app).post('/api/auth/register').send({
      name: 'Someone Else',
      email: 'dupe@example.com',
      password: 'password123',
    });
    expect(res.status).toBe(409);
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await request(app).post('/api/auth/register').send({
      name: 'Login Test',
      email: 'login@example.com',
      password: 'password123',
    });
  });

  it('logs in with correct credentials', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: 'login@example.com',
      password: 'password123',
    });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  it('rejects a wrong password', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: 'login@example.com',
      password: 'wrongpassword',
    });
    expect(res.status).toBe(401);
  });

  it('rejects an email that does not exist', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: 'nobody@example.com',
      password: 'password123',
    });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/me', () => {
  it('rejects requests with no token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('rejects an invalid token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });

  it('returns the user for a valid token', async () => {
    const register = await request(app).post('/api/auth/register').send({
      name: 'Me Test',
      email: 'me@example.com',
      password: 'password123',
    });
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${register.body.token}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('me@example.com');
  });
});

describe('Password reset flow', () => {
  it('issues a reset token and allows setting a new password with it', async () => {
    await request(app).post('/api/auth/register').send({
      name: 'Reset Test',
      email: 'reset@example.com',
      password: 'oldpassword1',
    });

    const forgot = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'reset@example.com' });
    expect(forgot.status).toBe(200);
    expect(forgot.body.devResetUrl).toBeDefined(); // email not configured in test env

    const token = forgot.body.devResetUrl.split('/').pop();

    const reset = await request(app)
      .post(`/api/auth/reset-password/${token}`)
      .send({ password: 'newpassword1' });
    expect(reset.status).toBe(200);

    const oldLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'reset@example.com', password: 'oldpassword1' });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'reset@example.com', password: 'newpassword1' });
    expect(newLogin.status).toBe(200);
  });

  it('rejects an invalid/expired reset token', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password/not-a-real-token')
      .send({ password: 'somethingnew1' });
    expect(res.status).toBe(400);
  });

  it('does not reveal whether an email exists', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'nonexistent@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.devResetUrl).toBeUndefined();
  });
});

describe('PUT /api/auth/me', () => {
  it('updates name and email', async () => {
    const register = await request(app).post('/api/auth/register').send({
      name: 'Old Name',
      email: 'update1@example.com',
      password: 'password123',
    });
    const res = await request(app)
      .put('/api/auth/me')
      .set('Authorization', `Bearer ${register.body.token}`)
      .send({ name: 'New Name', email: 'update1new@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('New Name');
    expect(res.body.email).toBe('update1new@example.com');
  });

  it('rejects changing to an email already in use', async () => {
    await request(app).post('/api/auth/register').send({
      name: 'Taken',
      email: 'taken@example.com',
      password: 'password123',
    });
    const register2 = await request(app).post('/api/auth/register').send({
      name: 'Wants Taken',
      email: 'wantstaken@example.com',
      password: 'password123',
    });
    const res = await request(app)
      .put('/api/auth/me')
      .set('Authorization', `Bearer ${register2.body.token}`)
      .send({ email: 'taken@example.com' });
    expect(res.status).toBe(409);
  });
});

describe('POST /api/auth/change-password', () => {
  it('changes the password when current password is correct', async () => {
    const register = await request(app).post('/api/auth/register').send({
      name: 'Change Pw',
      email: 'changepw@example.com',
      password: 'oldpassword1',
    });
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${register.body.token}`)
      .send({ currentPassword: 'oldpassword1', newPassword: 'newpassword1' });
    expect(res.status).toBe(200);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'changepw@example.com', password: 'newpassword1' });
    expect(login.status).toBe(200);
  });

  it('rejects an incorrect current password', async () => {
    const register = await request(app).post('/api/auth/register').send({
      name: 'Change Pw2',
      email: 'changepw2@example.com',
      password: 'oldpassword1',
    });
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${register.body.token}`)
      .send({ currentPassword: 'wrongpassword', newPassword: 'newpassword1' });
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/auth/me', () => {
  it('deletes the account and prevents further login', async () => {
    const register = await request(app).post('/api/auth/register').send({
      name: 'Delete Me',
      email: 'deleteme@example.com',
      password: 'password123',
    });
    const del = await request(app)
      .delete('/api/auth/me')
      .set('Authorization', `Bearer ${register.body.token}`);
    expect(del.status).toBe(200);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'deleteme@example.com', password: 'password123' });
    expect(login.status).toBe(401);
  });
});
