import express from 'express';
import { getDb } from './db.js';

const router = express.Router();

function requireAdmin(req, res, next){
  const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase();
  if(!req.session.user || !req.session.user.is_admin || req.session.user.email.toLowerCase() !== adminEmail){
    return res.status(403).json({ error: 'Admin only' });
  }
  next();
}

// List all orders with optional filters
router.get('/orders', requireAdmin, async (req, res) => {
  try{
    const { status, q, sort } = req.query;
    const db = await getDb();
    let where = [];
    let params = [];
    if(status){ where.push('o.status = ?'); params.push(status); }
    if(q){
      where.push('(u.email LIKE ? OR u.name LIKE ? OR o.id LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const orderBy = (sort === 'total_asc') ? 'o.total ASC' : (sort === 'total_desc') ? 'o.total DESC' : (sort === 'status') ? 'o.status ASC' : 'o.created_at DESC';
    const sql = `SELECT o.*, u.email as user_email, u.name as user_name, u.phone as user_phone
                 FROM orders o JOIN users u ON u.id = o.user_id
                 ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY ${orderBy}`;
    const rows = await db.allAsync(sql, params);
    const orders = rows.map(r => ({ ...r, files: r.files ? JSON.parse(r.files) : [] }));
    res.json({ orders });
  }catch(e){
    console.error(e);
    res.status(500).json({ error: 'Failed to load orders' });
  }
});

// Update order status
router.post('/orders/:id/status', requireAdmin, async (req, res) => {
  try{
    const { id } = req.params;
    const { status } = req.body;
    const allowed = ['pending','confirmed','designing','printing','completed','cancelled'];
    if(!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const db = await getDb();
    await db.runAsync('UPDATE orders SET status = ? WHERE id = ?', [status, id]);
    res.json({ ok: true });
  }catch(e){
    console.error(e);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// Update payment status (e.g., offline payments)
router.post('/orders/:id/payment-status', requireAdmin, async (req, res) => {
  try{
    const { id } = req.params;
    const status = String(req.body?.status || '').toLowerCase();
    const allowed = ['unpaid', 'paid'];
    if(!allowed.includes(status)) return res.status(400).json({ error: 'Invalid payment status' });

    const db = await getDb();
    if (status === 'paid') {
      await db.runAsync(
        `UPDATE orders
         SET payment_status = ?, payment_provider = ?, paid_at = ?
         WHERE id = ?`,
        ['paid', 'offline', new Date().toISOString(), id]
      );
    } else {
      await db.runAsync(
        `UPDATE orders
         SET payment_status = ?, payment_provider = NULL,
             payment_order_id = NULL, payment_payment_id = NULL,
             payment_signature = NULL, paid_at = NULL
         WHERE id = ?`,
        ['unpaid', id]
      );
    }
    res.json({ ok: true });
  }catch(e){
    console.error(e);
    res.status(500).json({ error: 'Failed to update payment status' });
  }
});

export default router;
