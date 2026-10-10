/**
 * ماژول گزارش رویدادها (Audit Log)
 */
const express = require('express');
const router = express.Router();
const db = require('../../core/db');
const { requireAuth } = require('../../core/auth');
const { canMiddleware } = require('../../core/rbac');

router.use(requireAuth, canMiddleware('audit.view'));

router.get('/', async (req, res, next) => {
  try {
    const { q, action, user_id } = req.query;
    let where = '1=1';
    const params = [];
    if (q) {
      where += ' AND (al.action LIKE ? OR al.entity_type LIKE ? OR al.details LIKE ?)';
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (action) {
      where += ' AND al.action = ?';
      params.push(action);
    }
    if (user_id) {
      where += ' AND al.user_id = ?';
      params.push(parseInt(user_id, 10));
    }

    const page = parseInt(req.query.page || '1', 10);
    const result = await db.paginate(
      `SELECT al.*, u.first_name, u.last_name, u.username
       FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id
       WHERE ${where} ORDER BY al.created_at DESC`,
      params,
      page,
      40
    );

    const actions = await db.query('SELECT DISTINCT action FROM audit_logs ORDER BY action LIMIT 60');

    res.render('settings/audit', {
      title: 'گزارش رویدادها',
      page: 'audit',
      ...result,
      actions,
      filters: { q: q || '', action: action || '', user_id: user_id || '' },
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
