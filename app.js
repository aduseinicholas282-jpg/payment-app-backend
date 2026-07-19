const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const sanitizeRequest = require('./middleware/sanitize');

function createApp() {
  const app = express();
  const isProd = process.env.NODE_ENV === 'production';

  // Trust the first proxy hop (needed for correct client IPs behind Render/Railway/etc.)
  app.set('trust proxy', 1);

  // --- Security headers ---
  app.use(helmet());

  // --- CORS: only allow the configured frontend origin, not "*" ---
  const allowedOrigin = process.env.FRONTEND_URL || 'http://localhost:3000';
  app.use(cors({ origin: allowedOrigin, credentials: true }));

  // --- General rate limiting across the whole API ---
  const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => !!process.env.JEST_WORKER_ID,
  });
  app.use(generalLimiter);

  // --- Webhook route MUST be mounted before the JSON body parser below,
  // because it needs the raw (unparsed) request body to verify Paystack's
  // HMAC signature. ---
  app.use('/api/payments/webhook', require('./routes/webhook'));

  // --- Body parsing (applies to every route registered after this point) ---
  app.use(bodyParser.json());

  // --- Strip any keys starting with "$" or containing "." from user input
  // to prevent MongoDB operator/NoSQL injection ---
  app.use(sanitizeRequest);

  // --- Payment routes (initialize + verify) ---
  app.use('/api/payments', require('./routes/payments'));

  // --- Auth routes (register/login/me/forgot-password/reset-password) ---
  app.use('/api/auth', require('./routes/auth'));

  // --- Admin routes (transaction list + refunds) ---
  app.use('/api/admin', require('./routes/admin'));

  // Test Route
  app.get('/', (req, res) => {
    res.send('Payment App Backend is running!');
  });

  // --- 404 handler ---
  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // --- Centralized error handler: never leak stack traces or internal
  // details to the client, only log them server-side for debugging. ---
  app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(err.status || 500).json({
      error: isProd ? 'Something went wrong' : err.message,
    });
  });

  return app;
}

module.exports = createApp;
