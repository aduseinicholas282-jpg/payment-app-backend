// Strips MongoDB operator keys ($gt, $where, etc.) and dotted keys from
// user-supplied input, to prevent NoSQL injection via req.body / req.params.
//
// Note: req.query is intentionally NOT mutated here. Express 5 made
// req.query a read-only getter, so packages (like express-mongo-sanitize)
// that try to overwrite it in place will crash. None of this app's routes
// currently build MongoDB filters from req.query, so this is safe; if that
// ever changes, sanitize the specific value at the point of use instead.

function sanitizeValue(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  if (value && typeof value === 'object') {
    const clean = {};
    for (const key of Object.keys(value)) {
      if (key.startsWith('$') || key.includes('.')) continue;
      clean[key] = sanitizeValue(value[key]);
    }
    return clean;
  }
  return value;
}

function sanitizeRequest(req, res, next) {
  if (req.body) req.body = sanitizeValue(req.body);
  if (req.params) req.params = sanitizeValue(req.params);
  next();
}

module.exports = sanitizeRequest;
