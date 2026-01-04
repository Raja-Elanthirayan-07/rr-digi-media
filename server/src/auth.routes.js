import express from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from './db.js';
import { sendEmailIfConfigured } from './notify.js';
import rateLimit from 'express-rate-limit';

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' }
});

const otpRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many OTP requests. Please wait and try again.' }
});

const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many OTP attempts. Please wait and try again.' }
});

function normalizeEmail(email){
  return String(email || '').trim().toLowerCase();
}

function normalizePhone(phone){
  return String(phone || '').replace(/\D/g, '');
}

function getAdminEmailNorm(){
  return normalizeEmail(process.env.ADMIN_EMAIL || '');
}

// Boolean check so the frontend never learns ADMIN_EMAIL unless the user typed it
router.post('/is-admin-email', (req, res) => {
  const emailNorm = normalizeEmail(req.body?.email);
  const adminEmailNorm = getAdminEmailNorm();
  res.json({ isAdmin: !!(emailNorm && adminEmailNorm && emailNorm === adminEmailNorm) });
});

async function syncAdminFlagForUser(db, user){
  const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase();
  const shouldBeAdmin = adminEmail && adminEmail === normalizeEmail(user.email);
  const isAdmin = user.is_admin ? 1 : 0;
  if((isAdmin === 1) !== !!shouldBeAdmin){
    await db.runAsync('UPDATE users SET is_admin = ? WHERE id = ?', [shouldBeAdmin ? 1 : 0, user.id]);
    user.is_admin = shouldBeAdmin ? 1 : 0;
  }
  return user;
}

function generateOtpCode(){
  // 6-digit numeric OTP
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function issueEmailOtp({ db, user, emailNorm }){
  const otp = generateOtpCode();
  const otp_hash = await bcrypt.hash(otp, 10);
  const created_at = new Date().toISOString();
  const expires_at = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 minutes
  const id = uuidv4();

  await db.runAsync(
    'INSERT INTO otp_logins (id, user_id, email, phone, otp_hash, attempts, created_at, expires_at, consumed_at) VALUES (?,?,?,?,?,?,?,?,?)',
    [id, user.id, emailNorm, null, otp_hash, 0, created_at, expires_at, null]
  );

  const subject = 'Your RR Digi Media verification OTP';
  const html = `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif">
        <h2 style="margin:0 0 10px">Verification code</h2>
        <p>Your one-time password (OTP) is:</p>
        <div style="font-size:28px;font-weight:800;letter-spacing:2px">${otp}</div>
        <p style="color:#6b7280">This code expires in 5 minutes. If you didn’t request this, you can ignore this email.</p>
      </div>`;

  await sendEmailIfConfigured(emailNorm, subject, html);

  // Dev-only helper for local testing
  return (process.env.NODE_ENV !== 'production') ? otp : null;
}

router.post('/signup', async (req, res) => {
  try {
  const { email, password, name, phone, address } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    if (!name) return res.status(400).json({ error: 'Name is required' });
    if (!phone) return res.status(400).json({ error: 'Mobile number is required' });
    if (!address) return res.status(400).json({ error: 'Address is required' });
  const db = await getDb();
    const emailNorm = normalizeEmail(email);
    const phoneNorm = normalizePhone(phone);
    const existing = await db.getAsync('SELECT id FROM users WHERE email = ?', [emailNorm]);
    if (existing) return res.status(409).json({ error: 'Email already registered' });
    const password_hash = await bcrypt.hash(password, 10);
    const id = uuidv4();
    const created_at = new Date().toISOString();
  const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase();
  const is_admin = adminEmail && adminEmail === emailNorm ? 1 : 0;
  await db.runAsync('INSERT INTO users (id, email, name, password_hash, created_at, phone, address, is_admin, email_verified, phone_verified) VALUES (?,?,?,?,?,?,?,?,?,?)', [id, emailNorm, name || '', password_hash, created_at, phoneNorm || '', address || '', is_admin, 0, 0]);

  // Do NOT create a logged-in session yet. Require OTP verification.
  const devOtp = await issueEmailOtp({ db, user: { id, email: emailNorm }, emailNorm });
  if(process.env.NODE_ENV !== 'production'){
    return res.json({ ok: true, requiresOtp: true, devOtp });
  }
  return res.json({ ok: true, requiresOtp: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Pre-check if user exists for email + phone (UX-driven, reveals existence)
router.post('/check-user', async (req, res) => {
  try{
    const emailNorm = normalizeEmail(req.body?.email);
    const phoneNorm = normalizePhone(req.body?.phone);
    if(!emailNorm || !phoneNorm) return res.status(400).json({ error: 'Email and phone are required' });
    const db = await getDb();
    const user = await db.getAsync('SELECT id, email, phone, email_verified FROM users WHERE email = ?', [emailNorm]);
    if(!user) return res.json({ exists: false });
    const storedPhone = normalizePhone(user.phone);
    if(!storedPhone || storedPhone !== phoneNorm) return res.json({ exists: false });
    return res.json({ exists: true, email_verified: !!user.email_verified });
  }catch(e){
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  const db = await getDb();
    const emailNorm = normalizeEmail(email);

    // Admin must log in via OTP only
    const adminEmailNorm = getAdminEmailNorm();
    if(adminEmailNorm && emailNorm === adminEmailNorm){
      return res.status(403).json({ error: 'Admin login requires OTP. Please request an OTP and verify to continue.' });
    }

    let user = await db.getAsync('SELECT * FROM users WHERE email = ?', [emailNorm]);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    if(!user.email_verified){
      return res.status(403).json({ error: 'Please verify your email using OTP to continue.' });
    }

    user = await syncAdminFlagForUser(db, user);
    req.session.user = { id: user.id, email: user.email, name: user.name, phone: user.phone, address: user.address, is_admin: user.is_admin || 0, email_verified: user.email_verified || 0, phone_verified: user.phone_verified || 0 };
    res.json({ ok: true, user: req.session.user });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// OTP (signup verification): request OTP (email only)
router.post('/request-otp', otpRequestLimiter, async (req, res) => {
  try{
    const emailNorm = normalizeEmail(req.body?.email);
    if(!emailNorm) return res.status(400).json({ error: 'Email is required' });

    const db = await getDb();
    let user = await db.getAsync('SELECT * FROM users WHERE email = ?', [emailNorm]);

    // Allow admin OTP login even if admin user hasn't been created yet.
    const adminEmailNorm = getAdminEmailNorm();
    if(!user && adminEmailNorm && emailNorm === adminEmailNorm){
      const id = uuidv4();
      const created_at = new Date().toISOString();
      // Unused password (admin uses OTP only)
      const password_hash = await bcrypt.hash(uuidv4(), 10);
      await db.runAsync(
        'INSERT INTO users (id, email, name, password_hash, created_at, phone, address, is_admin, email_verified, phone_verified) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [id, emailNorm, 'Admin', password_hash, created_at, '', '', 1, 0, 0]
      );
      user = await db.getAsync('SELECT * FROM users WHERE email = ?', [emailNorm]);
    }

    // For non-admins, require signup first.
    if(!user) return res.status(404).json({ error: 'Account not found. Please sign up first.' });

    const devOtp = await issueEmailOtp({ db, user, emailNorm });
    if(process.env.NODE_ENV !== 'production'){
      return res.json({ ok: true, devOtp });
    }
    return res.json({ ok: true });
  }catch(e){
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// OTP sign-in: verify OTP
router.post('/verify-otp', otpVerifyLimiter, async (req, res) => {
  try{
    const emailNorm = normalizeEmail(req.body?.email);
    const code = String(req.body?.code || '').trim();
    if(!emailNorm || !code) return res.status(400).json({ error: 'Email and code are required' });

    const db = await getDb();
    let user = await db.getAsync('SELECT * FROM users WHERE email = ?', [emailNorm]);
    if(!user) return res.status(401).json({ error: 'Invalid code' });

    const otpRow = await db.getAsync(
      'SELECT * FROM otp_logins WHERE email = ? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1',
      [emailNorm]
    );

    if(!otpRow) return res.status(401).json({ error: 'Invalid code' });
    if(Number(otpRow.attempts || 0) >= 5) return res.status(429).json({ error: 'Too many attempts. Request a new OTP.' });
    if(new Date(otpRow.expires_at).getTime() < Date.now()) return res.status(401).json({ error: 'OTP expired. Request a new one.' });

    const ok = await bcrypt.compare(code, otpRow.otp_hash);
    if(!ok){
      await db.runAsync('UPDATE otp_logins SET attempts = attempts + 1 WHERE id = ?', [otpRow.id]);
      return res.status(401).json({ error: 'Invalid code' });
    }

    await db.runAsync('UPDATE otp_logins SET consumed_at = ? WHERE id = ?', [new Date().toISOString(), otpRow.id]);
    await db.runAsync('UPDATE users SET email_verified = 1 WHERE id = ?', [user.id]);
    user.email_verified = 1;
    user = await syncAdminFlagForUser(db, user);

    req.session.user = { id: user.id, email: user.email, name: user.name, phone: user.phone, address: user.address, is_admin: user.is_admin || 0, email_verified: user.email_verified || 0, phone_verified: user.phone_verified || 0 };
    res.json({ ok: true, user: req.session.user });
  }catch(e){
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

router.get('/me', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
  try{
    const db = await getDb();
    const user = await db.getAsync('SELECT * FROM users WHERE id = ?', [req.session.user.id]);
    if(user){
      const synced = await syncAdminFlagForUser(db, user);
      req.session.user = { id: synced.id, email: synced.email, name: synced.name, phone: synced.phone, address: synced.address, is_admin: synced.is_admin || 0, email_verified: synced.email_verified || 0, phone_verified: synced.phone_verified || 0 };
    }
    res.json({ user: req.session.user });
  }catch(e){
    console.error(e);
    res.json({ user: req.session.user });
  }
});

// Update profile: name, phone, address
router.post('/update-profile', async (req, res) => {
  try{
    if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
    const { name, phone, address } = req.body;
    if(!name || !phone || !address) return res.status(400).json({ error: 'Name, phone, and address are required' });
    const db = await getDb();
    const phoneNorm = normalizePhone(phone);
    await db.runAsync('UPDATE users SET name = ?, phone = ?, address = ?, phone_verified = 0 WHERE id = ?', [name, phoneNorm, address, req.session.user.id]);
    // Update session
    req.session.user = { ...req.session.user, name, phone: phoneNorm, address, phone_verified: 0 };
    res.json({ ok: true, user: req.session.user });
  }catch(e){
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
