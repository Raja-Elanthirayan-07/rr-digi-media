import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from './db.js';
import { sendEmailIfConfigured } from './notify.js';
import rateLimit from 'express-rate-limit';

const router = express.Router();

const createOrderLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many order requests. Please try again later.' }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const configuredUploadDir = (process.env.UPLOAD_DIR || '').trim();
const uploadDir = configuredUploadDir
  ? (path.isAbsolute(configuredUploadDir)
    ? configuredUploadDir
    : path.resolve(process.cwd(), configuredUploadDir))
  : path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, uploadDir); },
  filename: function (req, file, cb) {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, Date.now() + '-' + safeName);
  }
});

const upload = multer({
  storage,
  limits: { files: 8, fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = (file.mimetype || '').startsWith('image/') || file.mimetype === 'application/pdf';
    if(!ok) return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
    cb(null, true);
  }
});

router.post('/', createOrderLimiter, upload.array('images', 8), async (req, res) => {
  try{
    if(!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
    const id = uuidv4();
    const user = req.session.user;
    const body = req.body;
    const files = (req.files || []).map(f => ({ filename: f.filename, path: '/uploads/'+f.filename, originalname: f.originalname, mimetype: f.mimetype, size: f.size, absolutePath: f.path }));

    const order = {
      id,
      user_id: user.id,
      serviceType: body.serviceType || 'print',
      size: body.size || body.sizeSelect || '',
      customW: Number(body.customW || 0),
      customH: Number(body.customH || 0),
      finish: body.finish || 'vinyl',
      quantity: Number(body.quantity || 1),
      delivery: body.delivery || 'deliver',
      instructions: body.instructions || '',
      price: Number(body.price || 0),
      deliveryFee: Number(body.deliveryFee || 0),
      total: Number(body.total || 0),
      files: JSON.stringify(files),
      status: 'pending',
      payment_status: 'unpaid',
      payment_provider: null,
      payment_order_id: null,
      payment_payment_id: null,
      payment_signature: null,
      paid_at: null,
      created_at: new Date().toISOString()
    };

    const db = await getDb();
    await db.runAsync(`INSERT INTO orders (
      id, user_id, serviceType, size, customW, customH, finish, quantity, delivery, instructions, price, deliveryFee, total, files, status,
      payment_status, payment_provider, payment_order_id, payment_payment_id, payment_signature, paid_at,
      created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      order.id, order.user_id, order.serviceType, order.size, order.customW, order.customH, order.finish, order.quantity, order.delivery, order.instructions, order.price, order.deliveryFee, order.total, order.files, order.status,
      order.payment_status, order.payment_provider, order.payment_order_id, order.payment_payment_id, order.payment_signature, order.paid_at,
      order.created_at
    ]);

    // Email notification (optional config)
    const businessEmail = process.env.BUSINESS_EMAIL;
    const subject = `New Order #${id} from ${user.email}`;
    const esc = (s) => String(s || '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
    const orderSummary = `
      <table style="width:100%;border-collapse:collapse" cellpadding="6">
        <tr>
          <td style="border:1px solid #eee"><strong>Customer</strong></td>
          <td style="border:1px solid #eee">${esc(user.name || '')} &lt;${esc(user.email)}&gt;<br>📞 ${esc(user.phone || '')}</td>
        </tr>
        <tr>
          <td style="border:1px solid #eee"><strong>Address</strong></td>
          <td style="border:1px solid #eee">${esc(user.address || '')}</td>
        </tr>
        <tr>
          <td style="border:1px solid #eee"><strong>Service</strong></td>
          <td style="border:1px solid #eee">${esc(order.serviceType)}</td>
        </tr>
        <tr>
          <td style="border:1px solid #eee"><strong>Size</strong></td>
          <td style="border:1px solid #eee">${esc(order.size)}${order.size==='custom' ? ` (${esc(order.customW)}x${esc(order.customH)} ft)` : ''}</td>
        </tr>
        <tr>
          <td style="border:1px solid #eee"><strong>Finish / Qty</strong></td>
          <td style="border:1px solid #eee">${esc(order.finish)} / ${esc(order.quantity)}</td>
        </tr>
        <tr>
          <td style="border:1px solid #eee"><strong>Delivery</strong></td>
          <td style="border:1px solid #eee">${esc(order.delivery)}</td>
        </tr>
        <tr>
          <td style="border:1px solid #eee"><strong>Totals</strong></td>
          <td style="border:1px solid #eee">Price: ₹${esc(order.price)} + Delivery: ₹${esc(order.deliveryFee)} = <strong>Total: ₹${esc(order.total)}</strong></td>
        </tr>
      </table>`;

    const instructionsBlock = `
      <div style="margin-top:14px;padding:12px;border-radius:8px;background:#fff3cd;border:1px solid #ffeeba">
        <div style="font-weight:700;color:#856404;margin-bottom:6px">Design Instructions</div>
        <div style="white-space:pre-wrap;color:#343a40">${esc(order.instructions) || '—'}</div>
      </div>`;

    const filesList = files.length
      ? `<div style="margin-top:10px;color:#6b7280;font-size:14px">Files (${files.length}): ${files.map(f=>esc(f.originalname)).join(', ')}</div>`
      : '<div style="margin-top:10px;color:#6b7280;font-size:14px">No files attached.</div>';

    const html = `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif">
        <h2 style="margin:0 0 10px;color:#d7261b">New Order ${esc(id)}</h2>
        ${orderSummary}
        ${instructionsBlock}
        ${filesList}
      </div>`;

    const attachments = files.map(f => ({ filename: f.originalname, path: f.absolutePath, contentType: f.mimetype }));
    await sendEmailIfConfigured(businessEmail, subject, html, attachments);

    res.json({ ok: true, orderId: id });
  }catch(e){
    console.error(e);
    res.status(500).json({ error: 'Failed to place order' });
  }
});

router.get('/my', async (req, res) => {
  try{
    if(!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
    const db = await getDb();
    const rows = await db.allAsync('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC', [req.session.user.id]);
    const orders = rows.map(r => ({ ...r, files: r.files ? JSON.parse(r.files) : [] }));
    res.json({ orders });
  }catch(e){
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

export default router;

// Friendly JSON errors for upload limit violations
router.use((err, req, res, next) => {
  if(err && err instanceof multer.MulterError){
    if(err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large. Max 10MB per file.' });
    if(err.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ error: 'Too many files. Max 8 files.' });
    if(err.code === 'LIMIT_UNEXPECTED_FILE') return res.status(400).json({ error: 'Only image files and PDF are allowed.' });
    return res.status(400).json({ error: 'Upload error: ' + err.code });
  }
  next(err);
});
