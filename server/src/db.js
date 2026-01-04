import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function getDb() {
  const configuredPath = (process.env.DB_PATH || '').trim();
  const dbPath = configuredPath
    ? (path.isAbsolute(configuredPath)
      ? configuredPath
      : path.resolve(process.cwd(), configuredPath))
    : path.join(__dirname, '../data.db');

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new sqlite3.Database(dbPath);
  // Promisify common methods for async/await usage
  db.runAsync = promisify(db.run.bind(db));
  db.getAsync = promisify(db.get.bind(db));
  db.allAsync = promisify(db.all.bind(db));

  // Ensure schema exists
  await new Promise((resolve, reject) => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      phone TEXT,
      address TEXT,
      is_admin INTEGER DEFAULT 0,
      email_verified INTEGER DEFAULT 0,
      phone_verified INTEGER DEFAULT 0
    );`, (err) => {
      if (err) reject(err); else resolve();
    });
  });
  // Orders table
  await new Promise((resolve, reject) => {
    db.run(`CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      serviceType TEXT,
      size TEXT,
      customW REAL,
      customH REAL,
      finish TEXT,
      quantity INTEGER,
      delivery TEXT,
      instructions TEXT,
      price REAL,
      deliveryFee REAL,
      total REAL,
      files TEXT,
      status TEXT,
      payment_status TEXT,
      payment_provider TEXT,
      payment_order_id TEXT,
      payment_payment_id TEXT,
      payment_signature TEXT,
      paid_at TEXT,
      created_at TEXT NOT NULL
    );`, (err) => { if (err) reject(err); else resolve(); });
  });

  // Backfill payment columns if table already existed without them
  await new Promise((resolve) => {
    db.run('ALTER TABLE orders ADD COLUMN payment_status TEXT', () => resolve());
  });
  await new Promise((resolve) => {
    db.run('ALTER TABLE orders ADD COLUMN payment_provider TEXT', () => resolve());
  });
  await new Promise((resolve) => {
    db.run('ALTER TABLE orders ADD COLUMN payment_order_id TEXT', () => resolve());
  });
  await new Promise((resolve) => {
    db.run('ALTER TABLE orders ADD COLUMN payment_payment_id TEXT', () => resolve());
  });
  await new Promise((resolve) => {
    db.run('ALTER TABLE orders ADD COLUMN payment_signature TEXT', () => resolve());
  });
  await new Promise((resolve) => {
    db.run('ALTER TABLE orders ADD COLUMN paid_at TEXT', () => resolve());
  });
  // Backfill columns if table already existed without new fields
  await new Promise((resolve) => {
    db.run('ALTER TABLE users ADD COLUMN phone TEXT', () => resolve());
  });
  await new Promise((resolve) => {
    db.run('ALTER TABLE users ADD COLUMN address TEXT', () => resolve());
  });
  await new Promise((resolve) => {
    db.run('ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0', () => resolve());
  });
  await new Promise((resolve) => {
    db.run('ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0', () => resolve());
  });
  await new Promise((resolve) => {
    db.run('ALTER TABLE users ADD COLUMN phone_verified INTEGER DEFAULT 0', () => resolve());
  });

  // OTP logins (hashed OTP, expiring)
  await new Promise((resolve, reject) => {
    db.run(`CREATE TABLE IF NOT EXISTS otp_logins (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      email TEXT,
      phone TEXT,
      otp_hash TEXT NOT NULL,
      attempts INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      consumed_at TEXT
    );`, (err) => { if (err) reject(err); else resolve(); });
  });
  return db;
}
