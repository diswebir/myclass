/**
 * ماژول سطوح دسترسی (RBAC) — ساخت نقش، ماتریس دسترسی و تخصیص به کاربران
 */
const express = require('express');
const router = express.Router();
const db = require('../../core/db');
const { requireAuth } = require('../../core/auth');
const { canMiddleware, isSuper } = require('../../core/rbac');
const { flash } = require('../../core/viewHelpers');
const audit = require('../../core/audit');

router.use(requireAuth, canMiddleware('roles.view'));

/** لیست نقش‌ها */
router.get('/', async (req, res, next) => {
  try {
    const roles = await db.query(
      `SELECT r.*,
        (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS users_count,
        (SELECT COUNT(*) FROM role_permissions rp WHERE rp.role_id = r.id) AS perms_count
       FROM roles r ORDER BY r.is_system DESC, r.id`
    );
    res.render('roles/list', { title: 'سطوح دسترسی', page: 'roles', roles });
  } catch (e) {
    next(e);
  }
});

/** فرم ایجاد نقش + ماتریس دسترسی */
router.get('/create', canMiddleware('roles.manage'), async (req, res, next) => {
  try {
    const perms = await db.query(
      `SELECT p.*, m.title AS module_title FROM permissions p
       LEFT JOIN system_modules m ON m.code = p.module_code
       ORDER BY p.module_code, p.sort_order`
    );
    res.render('roles/form', {
      title: 'ایجاد سطح دسترسی',
      page: 'roles',
      role: { title: '', description: '', is_active: 1 },
      perms,
      rolePerms: new Set(),
      isEdit: false,
    });
  } catch (e) {
    next(e);
  }
});

/** ایجاد نقش */
router.post('/', canMiddleware('roles.manage'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const title = String(b.title || '').trim();
    if (!title) {
      flash(req, 'danger', 'عنوان نقش الزامی است');
      return res.redirect('/panel/roles/create');
    }
    const exists = await db.one('SELECT id FROM roles WHERE title = ?', [title]);
    if (exists) {
      flash(req, 'danger', 'نقشی با این عنوان وجود دارد');
      return res.redirect('/panel/roles/create');
    }

    const roleId = await db.insert('roles', {
      title,
      description: String(b.description || '').trim(),
      is_system: 0,
      is_active: b.is_active ? 1 : 0,
      created_at: db.now(),
    });

    const perms = Array.isArray(b.perms) ? b.perms : [];
    for (const code of perms) {
      const p = await db.one('SELECT id FROM permissions WHERE code = ?', [code]);
      if (p) await db.insert('role_permissions', { role_id: roleId, permission_id: p.id });
    }

    await audit.log(req, 'role.create', 'role', roleId, title);
    flash(req, 'success', 'سطح دسترسی ساخته شد');
    res.redirect('/panel/roles');
  } catch (e) {
    next(e);
  }
});

/** فرم ویرایش نقش */
router.get('/:id/edit', canMiddleware('roles.manage'), async (req, res, next) => {
  try {
    const role = await db.one('SELECT * FROM roles WHERE id = ?', [req.params.id]);
    if (!role) return res.status(404).render('errors/404', { title: 'نقش یافت نشد' });
    const perms = await db.query(
      `SELECT p.*, m.title AS module_title FROM permissions p
       LEFT JOIN system_modules m ON m.code = p.module_code
       ORDER BY p.module_code, p.sort_order`
    );
    const links = await db.query('SELECT permission_id FROM role_permissions WHERE role_id = ?', [role.id]);
    res.render('roles/form', {
      title: `ویرایش ${role.title}`,
      page: 'roles',
      role,
      perms,
      rolePerms: new Set(links.map((l) => l.permission_id)),
      isEdit: true,
    });
  } catch (e) {
    next(e);
  }
});

/** ویرایش نقش */
router.post('/:id', canMiddleware('roles.manage'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const role = await db.one('SELECT * FROM roles WHERE id = ?', [id]);
    if (!role) return res.status(404).render('errors/404', { title: 'نقش یافت نشد' });

    const b = req.body || {};
    await db.update(
      'roles',
      {
        title: String(b.title || role.title).trim(),
        description: String(b.description || '').trim(),
        is_active: b.is_active ? 1 : 0,
      },
      'id = ?',
      [id]
    );

    await db.transaction(async (trx) => {
      await trx.exec('DELETE FROM role_permissions WHERE role_id = ?', [id]);
      const perms = Array.isArray(b.perms) ? b.perms : [];
      for (const code of perms) {
        const p = await trx.one('SELECT id FROM permissions WHERE code = ?', [code]);
        if (p) await trx.insert('role_permissions', { role_id: id, permission_id: p.id });
      }
    });

    await audit.log(req, 'role.update', 'role', id, role.title);
    flash(req, 'success', 'سطح دسترسی به‌روزرسانی شد');
    res.redirect('/panel/roles');
  } catch (e) {
    next(e);
  }
});

/** حذف نقش */
router.post('/:id/delete', canMiddleware('roles.manage'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const role = await db.one('SELECT * FROM roles WHERE id = ?', [id]);
    if (!role) return res.status(404).render('errors/404', { title: 'نقش یافت نشد' });
    if (role.is_system) {
      flash(req, 'danger', 'نقش سیستمی قابل حذف نیست');
      return res.redirect('/panel/roles');
    }
    const users = await db.one('SELECT COUNT(*) AS c FROM users WHERE role_id = ?', [id]);
    if (Number(users.c) > 0) {
      flash(req, 'danger', 'این نقش به کاربران تخصیص داده شده و قابل حذف نیست');
      return res.redirect('/panel/roles');
    }
    await db.exec('DELETE FROM roles WHERE id = ?', [id]);
    await audit.log(req, 'role.delete', 'role', id, role.title);
    flash(req, 'success', 'نقش حذف شد');
    res.redirect('/panel/roles');
  } catch (e) {
    next(e);
  }
});

module.exports = router;
