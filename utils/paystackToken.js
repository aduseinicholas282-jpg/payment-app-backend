const crypto = require('crypto');

function key() {
  const secret = process.env.PAYSTACK_TOKEN_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!secret) throw new Error('A server encryption key is required');
  return crypto.createHash('sha256').update(secret).digest();
}

function encryptToken(value) {
  if (!value) return undefined;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptToken(value) {
  if (!value) throw new Error('Subscription cancellation token is unavailable');
  const [ivHex, tagHex, dataHex] = value.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}

module.exports = { encryptToken, decryptToken };
