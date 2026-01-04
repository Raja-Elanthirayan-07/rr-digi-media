import express from 'express';
import crypto from 'crypto';
import Razorpay from 'razorpay';
import { getDb } from './db.js';

const router = express.Router();

function isConfigured() {
  return Boolean((process.env.RAZORPAY_KEY_ID || '').trim() && (process.env.RAZORPAY_KEY_SECRET || '').trim());
}

function getClient() {
  return new Razorpay({
    key_id: (process.env.RAZORPAY_KEY_ID || '').trim(),
    key_secret: (process.env.RAZORPAY_KEY_SECRET || '').trim()
  });
}

router.post('/razorpay/create', async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!isConfigured()) return res.status(501).json({ error: 'Payments are not configured yet.' });

    const orderId = String(req.body?.orderId || '').trim();
    if (!orderId) return res.status(400).json({ error: 'orderId is required' });

    const db = await getDb();
    const order = await db.getAsync(
      'SELECT id, user_id, total, payment_status, payment_provider, payment_order_id FROM orders WHERE id = ? AND user_id = ?',
      [orderId, req.session.user.id]
    );
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const total = Number(order.total || 0);
    if (!(total > 0)) return res.status(400).json({ error: 'This order does not require payment.' });
    if (String(order.payment_status || '').toLowerCase() === 'paid') {
      return res.status(400).json({ error: 'Order is already paid.' });
    }

    // Reuse an existing Razorpay order id if present
    let razorpayOrderId = order.payment_order_id;
    let amount = Math.round(total * 100);
    const currency = 'INR';

    if (!razorpayOrderId) {
      const client = getClient();
      const rpOrder = await client.orders.create({
        amount,
        currency,
        receipt: `order_${orderId}`
      });

      razorpayOrderId = rpOrder.id;
      amount = rpOrder.amount;

      await db.runAsync(
        'UPDATE orders SET payment_provider = ?, payment_order_id = ?, payment_status = ? WHERE id = ? AND user_id = ?',
        ['razorpay', razorpayOrderId, 'created', orderId, req.session.user.id]
      );
    }

    res.json({
      keyId: (process.env.RAZORPAY_KEY_ID || '').trim(),
      razorpayOrderId,
      amount,
      currency,
      orderId
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create payment order' });
  }
});

router.post('/razorpay/verify', async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!isConfigured()) return res.status(501).json({ error: 'Payments are not configured yet.' });

    const orderId = String(req.body?.orderId || '').trim();
    const razorpay_order_id = String(req.body?.razorpay_order_id || '').trim();
    const razorpay_payment_id = String(req.body?.razorpay_payment_id || '').trim();
    const razorpay_signature = String(req.body?.razorpay_signature || '').trim();

    if (!orderId || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing payment verification fields' });
    }

    const expected = crypto
      .createHmac('sha256', (process.env.RAZORPAY_KEY_SECRET || '').trim())
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expected !== razorpay_signature) {
      return res.status(400).json({ error: 'Invalid payment signature' });
    }

    const db = await getDb();
    const existing = await db.getAsync(
      'SELECT id, payment_order_id FROM orders WHERE id = ? AND user_id = ?',
      [orderId, req.session.user.id]
    );

    if (!existing) return res.status(404).json({ error: 'Order not found' });
    if (existing.payment_order_id && existing.payment_order_id !== razorpay_order_id) {
      return res.status(400).json({ error: 'Payment order mismatch' });
    }

    await db.runAsync(
      `UPDATE orders
       SET payment_provider = ?,
           payment_order_id = ?,
           payment_payment_id = ?,
           payment_signature = ?,
           payment_status = ?,
           paid_at = ?
       WHERE id = ? AND user_id = ?`,
      ['razorpay', razorpay_order_id, razorpay_payment_id, razorpay_signature, 'paid', new Date().toISOString(), orderId, req.session.user.id]
    );

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to verify payment' });
  }
});

export default router;
