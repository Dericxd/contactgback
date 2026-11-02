/**
 * Endpoints de permisos:
 *  - /api/me/permissions          -> permisos efectivos + menú del usuario autenticado
 *  - /api/admin/...               -> gestión de user_permissions (solo administrador)
 */
const express = require('express');
const {
    pool,
    parseId,
    invalidate,
    authenticate,
    requireAdmin,
    buildMenu,
} = require('./access');

const router = express.Router();
const VALID_EFFECTS = new Set(['grant', 'revoke']);
const MAX_CHANGES = 200;

//? Permisos efectivos y menú del usuario actual
router.get('/api/me/permissions', authenticate, async (req, res) => {
    const { access } = req;
    const menu = await buildMenu(access);
    res.json({
        user: {
            id: access.user.id,
            name: access.user.name,
            last_name: access.user.last_name,
            username: access.user.username,
        },
        role: access.role ? { id: access.role.id, slug: access.role.slug, name: access.role.name } : null,
        isAdmin: access.isAdmin,
        permissions: [...access.permissions].sort(),
        menu,
    });
});

//? Lista de usuarios activos (para asignar permisos) - solo admin
router.get('/api/admin/users', authenticate, requireAdmin, async (req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
    const params = [];
    let where = 'WHERE u.status = 1 AND u.deleted_at IS NULL';

    if (search) {
        const like = `%${search}%`;
        where += ` AND (u.name LIKE ? OR u.last_name LIKE ? OR CONCAT(u.name, ' ', u.last_name) LIKE ? OR u.username LIKE ?)`;
        params.push(like, like, like, like);
    }

    const [rows] = await pool.query(
        `SELECT u.id, u.name, u.last_name, u.username,
                r.id AS role_id, r.name AS role_name, r.slug AS role_slug
         FROM users u
         LEFT JOIN (
             SELECT ur.user_id, MIN(ur.role_id) AS role_id
             FROM user_roles ur
             JOIN roles rr ON rr.id = ur.role_id AND rr.deleted_at IS NULL AND rr.status = 1
             WHERE ur.deleted_at IS NULL
             GROUP BY ur.user_id
         ) pr ON pr.user_id = u.id
         LEFT JOIN roles r ON r.id = pr.role_id
         ${where}
         ORDER BY u.name, u.last_name
         LIMIT 200`,
        params
    );

    res.json(rows.map((u) => ({ ...u, is_admin: u.role_slug === 'admin' })));
});

/** Carga el detalle de permisos de un usuario agrupado por módulo. */
async function loadUserPermissionMatrix(userId) {
    const [[user]] = await pool.query(
        `SELECT u.id, u.name, u.last_name, u.username
         FROM users u
         WHERE u.id = ? AND u.status = 1 AND u.deleted_at IS NULL`,
        [userId]
    );
    if (!user) return null;

    const [roles] = await pool.query(
        `SELECT r.id, r.name, r.slug
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id AND r.status = 1 AND r.deleted_at IS NULL
         WHERE ur.user_id = ? AND ur.deleted_at IS NULL
         ORDER BY r.id`,
        [userId]
    );
    const isAdmin = roles.some((r) => r.slug === 'admin');

    const [rows] = await pool.query(
        `SELECT m.id AS module_id, m.name AS module_name, m.slug AS module_slug, m.icon,
                p.id, p.name, p.slug, p.description, p.admin_only,
                EXISTS (
                    SELECT 1
                    FROM user_roles ur
                    JOIN roles r ON r.id = ur.role_id AND r.status = 1 AND r.deleted_at IS NULL
                    JOIN role_permissions rp ON rp.role_id = r.id AND rp.permission_id = p.id AND rp.deleted_at IS NULL
                    WHERE ur.user_id = ? AND ur.deleted_at IS NULL
                ) AS from_role,
                up.effect AS user_effect
         FROM modules m
         JOIN permissions p ON p.module_id = m.id AND p.status = 1 AND p.deleted_at IS NULL
         LEFT JOIN user_permissions up ON up.user_id = ? AND up.permission_id = p.id AND up.deleted_at IS NULL
         WHERE m.status = 1 AND m.deleted_at IS NULL
         ORDER BY m.sort_order, m.id, p.sort_order, p.id`,
        [userId, userId]
    );

    const modules = new Map();
    for (const row of rows) {
        if (!modules.has(row.module_id)) {
            modules.set(row.module_id, {
                id: row.module_id,
                name: row.module_name,
                slug: row.module_slug,
                icon: row.icon,
                permissions: [],
            });
        }
        const fromRole = Boolean(row.from_role);
        const adminOnly = Boolean(row.admin_only);
        const userEffect = row.user_effect || null;
        let effective;
        if (isAdmin) effective = true;
        else if (adminOnly) effective = false;
        else if (userEffect === 'revoke') effective = false;
        else effective = userEffect === 'grant' || fromRole;

        modules.get(row.module_id).permissions.push({
            id: row.id,
            name: row.name,
            slug: row.slug,
            description: row.description,
            admin_only: adminOnly,
            from_role: fromRole,
            user_effect: userEffect,
            effective,
        });
    }

    return {
        user: { ...user, roles, is_admin: isAdmin },
        modules: [...modules.values()],
    };
}

//? Matriz de permisos de un usuario - solo admin
router.get('/api/admin/users/:id/permissions', authenticate, requireAdmin, async (req, res) => {
    const userId = parseId(req.params.id);
    if (!userId) return res.status(400).json({ error: 'ID de usuario inválido' });

    const matrix = await loadUserPermissionMatrix(userId);
    if (!matrix) return res.status(404).json({ error: 'Usuario no encontrado o inactivo' });
    res.json(matrix);
});

//? Guardar cambios de permisos directos de un usuario - solo admin
router.put('/api/admin/users/:id/permissions', authenticate, requireAdmin, async (req, res) => {
    const userId = parseId(req.params.id);
    if (!userId) return res.status(400).json({ error: 'ID de usuario inválido' });

    if (userId === req.access.user.id) {
        return res.status(403).json({ error: 'No puede modificar sus propios permisos' });
    }

    const changes = req.body && req.body.changes;
    if (!Array.isArray(changes) || changes.length === 0) {
        return res.status(400).json({ error: 'Debe enviar al menos un cambio' });
    }
    if (changes.length > MAX_CHANGES) {
        return res.status(400).json({ error: `Máximo ${MAX_CHANGES} cambios por solicitud` });
    }

    // Validar formato y duplicados
    const normalized = new Map();
    for (const change of changes) {
        const permissionId = parseId(change && change.permission_id);
        const effect = change ? change.effect : undefined;
        if (!permissionId) return res.status(400).json({ error: 'permission_id inválido' });
        if (effect !== null && !VALID_EFFECTS.has(effect)) {
            return res.status(400).json({ error: "effect debe ser 'grant', 'revoke' o null" });
        }
        if (normalized.has(permissionId)) {
            return res.status(400).json({ error: `permission_id duplicado: ${permissionId}` });
        }
        normalized.set(permissionId, effect);
    }

    // Validar usuario objetivo
    const matrix = await loadUserPermissionMatrix(userId);
    if (!matrix) return res.status(404).json({ error: 'Usuario no encontrado o inactivo' });
    if (matrix.user.is_admin) {
        return res.status(403).json({ error: 'Los administradores ya tienen acceso total' });
    }

    // Validar permisos: existen, activos y no admin_only
    const ids = [...normalized.keys()];
    const [perms] = await pool.query(
        `SELECT p.id, p.admin_only
         FROM permissions p
         JOIN modules m ON m.id = p.module_id AND m.status = 1 AND m.deleted_at IS NULL
         WHERE p.id IN (?) AND p.status = 1 AND p.deleted_at IS NULL`,
        [ids]
    );
    if (perms.length !== ids.length) {
        return res.status(400).json({ error: 'Uno o más permisos no existen o están inactivos' });
    }
    if (perms.some((p) => p.admin_only)) {
        return res.status(400).json({ error: 'Hay permisos exclusivos del administrador que no se pueden conceder' });
    }

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const [current] = await conn.query(
            `SELECT id, permission_id, effect
             FROM user_permissions
             WHERE user_id = ? AND permission_id IN (?) AND deleted_at IS NULL
             FOR UPDATE`,
            [userId, ids]
        );
        const currentByPerm = new Map(current.map((row) => [row.permission_id, row]));

        let applied = 0;
        for (const [permissionId, effect] of normalized) {
            const existing = currentByPerm.get(permissionId);
            if (existing && existing.effect === effect) continue; // sin cambios
            if (!existing && effect === null) continue; // ya está "según rol"

            if (existing) {
                await conn.query('UPDATE user_permissions SET deleted_at = NOW() WHERE id = ?', [existing.id]);
            }
            if (effect !== null) {
                await conn.query(
                    'INSERT INTO user_permissions (user_id, permission_id, effect, granted_by) VALUES (?, ?, ?, ?)',
                    [userId, permissionId, effect, req.access.user.id]
                );
            }
            applied++;
        }

        await conn.commit();
        invalidate(userId);

        const updated = await loadUserPermissionMatrix(userId);
        res.json({ success: true, applied, ...updated });
    } catch (err) {
        await conn.rollback();
        console.error('Error al guardar permisos:', err);
        res.status(500).json({ error: 'Error al guardar los permisos' });
    } finally {
        conn.release();
    }
});

module.exports = router;
