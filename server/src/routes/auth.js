const express = require('express');
const bcrypt = require('bcrypt');
const speakeasy = require('speakeasy');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { z } = require('zod');
const rateLimit = require('express-rate-limit');
const pool = require('../db');
const { sendMail } = require('../services/email');
const { decrypt } = require('../services/encryption');
const authMiddleware = require('../authMiddleware');

const router = express.Router();

// Rate limiter for auth-sensitive endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many attempts. Please try again later.' },
});

const otpStore = new Map();
const otpCodeSchema = z.string().regex(/^\d{6}$/);

const loginSchema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1)
});

const requestOtpSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('email'),
    value: z.string().email()
  }),
  z.object({
    type: z.literal('phone'),
    value: z.string().min(7).max(24)
  })
]);

const verifyOtpSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('email'),
    value: z.string().email(),
    otp: otpCodeSchema
  }),
  z.object({
    type: z.literal('phone'),
    value: z.string().min(7).max(24),
    otp: otpCodeSchema
  })
]);

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8)
});

const mfaLoginSchema = z.object({
  token: z.string().min(1),
  code: otpCodeSchema
});

const buildOtpKey = (userId, type) => `${userId}:${type}`;

async function createSessionToken(user, req) {
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const rawToken = crypto.randomBytes(32).toString('hex');
  const sessionTokenHash = await bcrypt.hash(rawToken, 10);
  const userAgent = req.get('User-Agent') || '';
  const ipAddress = (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();

  const sessionResult = await pool.query(
    `INSERT INTO user_sessions
       (user_id, session_token_hash, created_at, last_seen_at, expires_at, ip_address, user_agent)
     VALUES ($1, $2, NOW(), NOW(), $3, $4, $5)
     RETURNING id`,
    [user.id, sessionTokenHash, expiresAt, ipAddress, userAgent]
  );

  const sessionId = sessionResult.rows[0]?.id;

  const token = jwt.sign(
    {
      id: user.id,
      username: user.username,
      sessionId,
      municipality_id: user.municipality_id,
      role: user.role,
    },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );

  return { token, username: user.username };
}

async function handleRequestPasswordReset(req, res) {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: 'Email is required' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT id, username FROM users WHERE email = $1',
      [email]
    );
    const user = rows[0];

    if (!user) {
      // Email must already be registered
      return res.status(404).json({ message: 'Email is not registered' });
    }

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min
    const now = new Date();

    // ONE row per user_id in password_reset_otps
    await pool.query(
      `INSERT INTO password_reset_otps (user_id, email, otp_code, expires_at, last_sent_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id) DO UPDATE
         SET otp_code   = EXCLUDED.otp_code,
             email      = EXCLUDED.email,
             expires_at = EXCLUDED.expires_at,
             last_sent_at = EXCLUDED.last_sent_at,
             is_verified = FALSE`,
      [user.id, email, otpCode, expiresAt, now]
    );

    await sendMail({
      to: email,
      subject: 'Smart Waste Password Reset OTP',
      html: `
        <p>Hello ${user.username},</p>
        <p>Your OTP to reset your password is:</p>
        <h2>${otpCode}</h2>
        <p>This code will expire in 10 minutes.</p>
        <p>If you did not request this, you can ignore this email.</p>
      `
    });

    res.json({ message: 'OTP sent to registered email' });
  } catch (err) {
    console.error('forgot-password error', err);
    res.status(500).json({ message: 'Server error' });
  }
}

/**
 * POST /api/auth/login
 */
router.post('/login', authLimiter, async (req, res) => {
  const identifier = req.body?.username || req.body?.email || req.body?.identifier;
  const parsed = loginSchema.safeParse({ identifier, password: req.body?.password });

  try {
    if (!parsed.success) {
      return res.status(400).json({ message: 'Username/email and password are required' });
    }

    const { identifier: userIdentifier, password } = parsed.data;
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE username = $1 OR email = $1',
      [userIdentifier]
    );
    const user = rows[0];

    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const { rows: mfaRows } = await pool.query(
      'SELECT totp_enabled FROM user_mfa WHERE user_id = $1',
      [user.id]
    );
    const mfaEnabled = Boolean(mfaRows[0]?.totp_enabled);
    if (mfaEnabled) {
      const mfaToken = jwt.sign(
        { id: user.id, username: user.username, mfa: 'totp' },
        process.env.JWT_SECRET,
        { expiresIn: '10m' }
      );
      return res.json({ mfaRequired: true, mfaToken });
    }

    const sessionPayload = await createSessionToken(user, req);
    res.json(sessionPayload);
  } catch (err) {
    console.error('Login error', err);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * POST /api/auth/login/2fa
 */
router.post('/login/2fa', authLimiter, async (req, res) => {
  const parsed = mfaLoginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid 2FA payload' });
  }

  let payload;
  try {
    payload = jwt.verify(parsed.data.token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ message: '2FA token expired or invalid' });
  }

  if (!payload?.id || payload?.mfa !== 'totp') {
    return res.status(401).json({ message: 'Invalid 2FA token' });
  }

  try {
    const mfaResult = await pool.query(
      'SELECT totp_enabled, totp_secret_encrypted FROM user_mfa WHERE user_id = $1',
      [payload.id]
    );
    const mfaRow = mfaResult.rows[0];
    if (!mfaRow || !mfaRow.totp_enabled) {
      return res.status(400).json({ message: '2FA is not enabled for this account' });
    }

    let secret = null;
    try {
      secret = decrypt(mfaRow.totp_secret_encrypted);
    } catch (err) {
      console.error('2FA decrypt failed', err);
    }
    if (!secret) {
      return res.status(500).json({ message: 'Could not read 2FA secret' });
    }

    const verified = speakeasy.totp.verify({
      secret,
      encoding: 'base32',
      token: parsed.data.code,
      window: 1,
    });

    if (!verified) {
      return res.status(400).json({ message: 'Invalid verification code' });
    }

    const { rows: userRows } = await pool.query('SELECT * FROM users WHERE id = $1', [payload.id]);
    const user = userRows[0];
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const sessionPayload = await createSessionToken(user, req);
    res.json(sessionPayload);
  } catch (err) {
    console.error('2FA login error', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/auth/request-otp
router.post('/request-otp', authMiddleware, async (req, res) => {
  const parsed = requestOtpSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid OTP request payload' });
  }

  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { type, value } = parsed.data;
  const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = Date.now() + 10 * 60 * 1000;

  otpStore.set(buildOtpKey(userId, type), { code: otpCode, value, expiresAt });

  if (type === 'email') {
    try {
      await sendMail({
        to: value,
        subject: 'Smart Waste Settings OTP',
        html: `
          <p>Hello,</p>
          <p>Your OTP for updating your account is:</p>
          <h2>${otpCode}</h2>
          <p>This code will expire in 10 minutes.</p>
        `
      });
    } catch (err) {
      console.error('OTP email send failed', err);
    }
  } else {
    console.log(`OTP for ${value}: ${otpCode}`);
  }

  if (process.env.NODE_ENV !== 'production') {
    console.log(`[DEV] OTP for settings update: ${otpCode}`);
  }

  res.json({ message: 'OTP sent' });
});

// POST /api/auth/change-password
router.post('/change-password', authMiddleware, async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid password change payload' });
  }

  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { currentPassword, newPassword } = parsed.data;

  try {
    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
    const user = rows[0];
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const ok = await bcrypt.compare(currentPassword, user.password_hash);
    if (!ok) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }

    const hasLower = /[a-z]/.test(newPassword);
    const hasUpper = /[A-Z]/.test(newPassword);
    const hasNumber = /[0-9]/.test(newPassword);
    const hasLength = newPassword.length >= 8;

    if (!hasLower || !hasUpper || !hasNumber || !hasLength) {
      return res.status(400).json({
        message:
          'Password must contain at least 8 characters, including lowercase, uppercase, and a number.'
      });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, userId]);

    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    console.error('Change password error', err);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * POST /api/auth/forgot-password
 * Step 1: user submits email. We validate that email exists, create OTP, send mail.
 */
router.post('/forgot-password', authLimiter, handleRequestPasswordReset);
router.post('/request-password-reset', authLimiter, handleRequestPasswordReset);

// POST /api/auth/logout
router.post('/logout', authMiddleware, async (req, res) => {
  try {
    if (req.user?.sessionId) {
      await pool.query(
        `UPDATE user_sessions SET revoked_at = NOW()
         WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
        [req.user.sessionId, req.user.id]
      );
    }
    res.json({ message: 'Logged out' });
  } catch (err) {
    console.error('Logout error', err);
    res.json({ message: 'Logged out' });
  }
});

// POST /api/auth/resend-otp
router.post('/resend-otp', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: 'Email is required' });
  }

  try {
    const { rows: userRows } = await pool.query(
      'SELECT id, username FROM users WHERE email = $1',
      [email]
    );
    const user = userRows[0];

    if (!user) {
      return res.status(404).json({ message: 'Email is not registered' });
    }

    const { rows: otpRows } = await pool.query(
      'SELECT * FROM password_reset_otps WHERE user_id = $1',
      [user.id]
    );
    const otpRow = otpRows[0];

    const now = new Date();

    if (otpRow) {
      const lastSent = new Date(otpRow.last_sent_at);
      const diffSec = (now - lastSent) / 1000;
      if (diffSec < 30) {
        return res.status(429).json({
          message: `Please wait ${Math.ceil(30 - diffSec)} seconds before resending`
        });
      }
    }

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await pool.query(
      `INSERT INTO password_reset_otps (user_id, email, otp_code, expires_at, last_sent_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id) DO UPDATE
         SET otp_code = EXCLUDED.otp_code,
             email = EXCLUDED.email,
             expires_at = EXCLUDED.expires_at,
             last_sent_at = EXCLUDED.last_sent_at,
             is_verified = FALSE`,
      [user.id, email, otpCode, expiresAt, now]
    );

    await sendMail({
      to: email,
      subject: 'Smart Waste Password Reset OTP (Resent)',
      html: `
        <p>Hello ${user.username},</p>
        <p>Your new OTP is:</p>
        <h2>${otpCode}</h2>
        <p>This code will expire in 10 minutes.</p>
      `
    });

    res.json({ message: 'OTP resent to registered email' });
  } catch (err) {
    console.error('resend-otp error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/auth/verify-otp
router.post('/verify-otp', async (req, res) => {
  if (req.body?.type) {
    const parsed = verifyOtpSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Invalid OTP verification payload' });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    let userId;
    try {
      const token = authHeader.split(' ')[1];
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      userId = payload?.id;
    } catch (err) {
      return res.status(401).json({ message: 'Invalid token' });
    }

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const { type, value, otp } = parsed.data;
    const key = buildOtpKey(userId, type);
    const record = otpStore.get(key);

    if (!record) {
      return res.status(400).json({ message: 'No OTP request found' });
    }

    if (record.value !== value) {
      return res.status(400).json({ message: 'OTP target mismatch' });
    }

    if (Date.now() > record.expiresAt) {
      otpStore.delete(key);
      return res.status(400).json({ message: 'OTP has expired' });
    }

    if (record.code !== otp) {
      return res.status(400).json({ message: 'Invalid OTP' });
    }

    otpStore.delete(key);
    return res.json({ verified: true });
  }

  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json({ message: 'Email and OTP are required' });
  }

  try {
    const { rows: userRows } = await pool.query(
      'SELECT id, username FROM users WHERE email = $1',
      [email]
    );
    const user = userRows[0];
    if (!user) {
      return res.status(404).json({ message: 'Email is not registered' });
    }

    const { rows: otpRows } = await pool.query(
      'SELECT * FROM password_reset_otps WHERE user_id = $1',
      [user.id]
    );
    const otpRow = otpRows[0];

    if (!otpRow) {
      return res.status(400).json({ message: 'No OTP request found' });
    }

    const now = new Date();
    if (otpRow.is_verified) {
      return res.status(400).json({ message: 'OTP already used' });
    }
    if (new Date(otpRow.expires_at) < now) {
      return res.status(400).json({ message: 'OTP has expired' });
    }
    if (otpRow.otp_code !== otp) {
      return res.status(400).json({ message: 'Invalid OTP' });
    }

    // mark OTP verified
    await pool.query(
      'UPDATE password_reset_otps SET is_verified = TRUE WHERE id = $1',
      [otpRow.id]
    );

    // create reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(
      Date.now() +
        Number(process.env.RESET_TOKEN_EXPIRES_HOURS || 1) * 60 * 60 * 1000
    );

    await pool.query(
      `INSERT INTO password_resets (user_id, reset_token, expires_at)
       VALUES ($1,$2,$3)`,
      [user.id, resetToken, expiresAt]
    );

    const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

    await sendMail({
      to: email,
      subject: 'Smart Waste Reset your password',
      html: `
        <p>Hello ${user.username},</p>
        <p>Your OTP has been verified. Click the link below to reset your password:</p>
        <p><a href="${resetLink}">${resetLink}</a></p>
        <p>This link expires in ${process.env.RESET_TOKEN_EXPIRES_HOURS || 1} hour(s).</p>
      `
    });

    res.json({ message: 'OTP verified, reset link sent to your email' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', authLimiter, async (req, res) => {
  const { token, newPassword } = req.body;

  if (!token || !newPassword) {
    return res
      .status(400)
      .json({ message: 'Token and new password are required' });
  }

  const cleanToken = String(token).trim();
  // console.log('reset-password called with token:', cleanToken);

  // Password policy – matches frontend rules
  const hasLower = /[a-z]/.test(newPassword);
  const hasUpper = /[A-Z]/.test(newPassword);
  const hasNumber = /[0-9]/.test(newPassword);
  const hasLength = newPassword.length >= 8;

  if (!hasLower || !hasUpper || !hasNumber || !hasLength) {
    return res.status(400).json({
      message:
        'Password must contain at least 8 characters, including lowercase, uppercase, and a number.'
    });
  }

  try {
    const { rows } = await pool.query(
      `SELECT pr.id, pr.user_id, pr.expires_at, pr.used
       FROM password_resets pr
       WHERE pr.reset_token = $1`,
      [cleanToken]
    );
    const reset = rows[0];

    if (!reset) {
      return res.status(400).json({ message: 'Invalid reset token' });
    }

    if (reset.used) {
      return res.status(400).json({ message: 'Reset token already used' });
    }

    const now = new Date();
    if (new Date(reset.expires_at) < now) {
      return res.status(400).json({ message: 'Reset token has expired' });
    }

    // Get current password hash to check "same as old"
    const { rows: userRows } = await pool.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [reset.user_id]
    );
    const user = userRows[0];
    if (!user) {
      return res.status(400).json({ message: 'User not found' });
    }

    const isSameAsOld = await bcrypt.compare(newPassword, user.password_hash);
    if (isSameAsOld) {
      return res.status(400).json({
        message: 'New password cannot be the same as the old password.'
      });
    }

    const hash = await bcrypt.hash(newPassword, 10);

    await pool.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [hash, reset.user_id]
    );

    await pool.query('UPDATE password_resets SET used = TRUE WHERE id = $1', [
      reset.id
    ]);

    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;


