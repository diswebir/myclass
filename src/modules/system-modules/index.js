/**
 * ماژول مدیریت ماژول‌های سیستم — فعال/غیرفعال‌سازی قابلیت‌ها
 */
const express = require('express');
const router = express.Router();
const db = require('../../core/db');
const { requireAuth } = require('../../core/auth');
const { canMiddleware } = require('../../core/rbac');
const { flash } = require('../../core/viewHelpers');
const audit = require('../../core/audit');

router.use(requireAuth, canMiddleware('modules.manage'));

router.get('/', async (req, res, next) => {
  try {
    const modules = await db.query('SELECT * FROM system_modules ORDER BY sort_order');
    res.render('settings/modules', { title: 'ماژول‌های سیستم', page: 'modules', modules });
  } catch (e) {
    next(e);
  }
});

router.post('/:code/toggle', async (req, res, next) => {
  try {
    const mod = await db.one('SELECT * FROM system_modules WHERE code = ?', [req.params.code]);
    if (!mod) return res.status(404).render('errors/404', { title: 'ماژول یافت نشد' });
    if (mod.is_system) {
      flash(req, 'danger', 'ماژول‌های سیستمی قابل غیرفعال‌سازی نیستند');
      return res.redirect('/panel/modules');
    }
    const newVal = mod.is_enabled ? 0 : 1;
    await db.update('system_modules', { is_enabled: newVal }, 'id = ?', [mod.id]);
    await audit.log(req, 'module.toggle', 'module', mod.code, newVal ? 'enabled' : 'disabled');
    flash(req, newVal ? 'success' : 'warning', `ماژول «${mod.title}» ${newVal ? 'فعال' : 'غیرفعال'} شد`);
    res.redirect('/panel/modules');
  } catch (e) {
    next(e);
  }
});

module.exports = router;
