const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const sanitizeRequest = require('./middleware/sanitize');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
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

// Test Route
app.get('/', (req, res) => {
    res.send('Payment App Backend is running!');
});

// Database Connection
mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/payment_db')
    .then(() => console.log('MongoDB connected successfully'))
    .catch(err => console.error('MongoDB connection error:', err.message));

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

// Start Server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
