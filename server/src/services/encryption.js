const crypto = require('crypto');

const ENCRYPTION_SECRET = process.env.TOTP_ENCRYPTION_KEY || 'please-change-this-to-a-secure-key';
if (!process.env.TOTP_ENCRYPTION_KEY) {
  console.warn(
    '⚠️  TOTP_ENCRYPTION_KEY is not set – using an insecure fallback. ' +
    'Set TOTP_ENCRYPTION_KEY to a 32-byte hex string for production.'
  );
}
const KEY = crypto.createHash('sha256').update(ENCRYPTION_SECRET, 'utf8').digest();
const ALGORITHM = 'aes-256-gcm';

function encrypt(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return null;
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);

  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decrypt(payload) {
  if (!payload) {
    return null;
  }

  const buffer = Buffer.from(payload, 'base64');
  if (buffer.length < 28) {
    return null;
  }

  const iv = buffer.slice(0, 12);
  const tag = buffer.slice(12, 28);
  const encrypted = buffer.slice(28);

  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

  return decrypted.toString('utf8');
}

module.exports = {
  encrypt,
  decrypt,
};
