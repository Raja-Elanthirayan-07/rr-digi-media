import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';
import authRouter from './src/auth.routes.js';
import ordersRouter from './src/orders.routes.js';
import adminRouter from './src/admin.routes.js';
import paymentsRouter from './src/payments.routes.js';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const isProd = process.env.NODE_ENV === 'production';

if (isProd) {
  const secret = process.env.SESSION_SECRET || '';
  if (secret.length < 32) {
    console.error('SESSION_SECRET must be at least 32 characters in production.');
    process.exit(1);
  }
  if (!process.env.ADMIN_EMAIL) {
    console.error('ADMIN_EMAIL is required in production.');
    process.exit(1);
  }
}

// When deployed behind a reverse proxy (Render/Nginx/etc.), this enables correct client IP detection
app.set('trust proxy', 1);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// Basic API abuse protection (fine-grained limits are applied in routers too)
app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' }
}));
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-only-insecure-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd
  }
}));

app.get('/healthz', (req, res) => {
  res.status(200).json({ ok: true });
});

// Uploaded files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Static files (serve existing HTML/CSS)
app.use(express.static(path.join(__dirname, '..'), {
  setHeaders(res, filePath){
    // Avoid back-button showing stale authenticated UI (bfcache / caching)
    if(String(filePath).toLowerCase().endsWith('.html')){
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// API routes
app.use('/api/auth', authRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/admin', adminRouter);
app.use('/api/payments', paymentsRouter);

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`RR Digi Media server running at http://localhost:${PORT}`);
});

function shutdown(signal) {
  console.log(`${signal} received. Shutting down...`);
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => {
    console.error('Forced shutdown after timeout.');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
