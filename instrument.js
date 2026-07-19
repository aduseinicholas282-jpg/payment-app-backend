const Sentry = require('@sentry/node');

// Sentry is entirely optional: if SENTRY_DSN isn't set (e.g. local dev
// without it configured), this silently does nothing. Also skipped
// under Jest so test runs never send spurious events to Sentry.
if (process.env.SENTRY_DSN && !process.env.JEST_WORKER_ID) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 1.0,
  });
  console.log('Sentry error monitoring initialized');
}

module.exports = Sentry;
