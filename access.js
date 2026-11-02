/**
 * Autorización basada en permisos (fuente de verdad: la base de datos).
 *
 * Permiso efectivo = (permisos del rol ∪ user_permissions 'grant') − user_permissions 'revoke'
 *  - Solo cuentan permisos/módulos/roles activos y sin soft delete.
 *  - El rol con slug 'admin' tiene TODOS los permisos (las revocaciones no le aplican).
 *  - Los permisos admin_only solo los tiene el rol admin.
 */
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const config = require('./config');

const pool = mysql.createPool({
    ...config.db,
    waitForConnections: true,
    connectionLimit: 10,
    charset: 'utf8mb4',
});

const CACHE_TTL_MS = 30 * 1000;
const accessCache = new Map();

/** Convierte a entero positivo o devuelve null. */
const parseId = (value) => {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * Obtiene el contexto de acceso de un usuario desde la BD.
 * Devuelve null si el usuario no existe, está inactivo o eliminado.
 */
async function getAccess(userId) {
    const cached = accessCache.get(userId);
    if (cached && cached.expires > Date.now()) return cached.value;

    const [[user]] = await pool.query(
        `SELECT id, name, last_name, username
         FROM users
         WHERE id = ? AND status = 1 AND deleted_at IS NULL`,
        [userId]
    );

    let value = null;
    if (user) {
        const [roles] = await pool.query(
            `SELECT r.id, r.slug, r.name
             FROM user_roles ur
             JOIN roles r ON r.id = ur.role_id AND r.status = 1 AND r.deleted_at IS NULL
             WHERE ur.user_id = ? AND ur.deleted_at IS NULL
             ORDER BY r.id ASC`,
            [userId]
        );

        const isAdmin = roles.some((r) => r.slug === 'admin');
        let rows;

        if (isAdmin) {
            [rows] = await pool.query(
                `SELECT p.slug
                 FROM permissions p
                 JOIN modules m ON m.id = p.module_id AND m.status = 1 AND m.deleted_at IS NULL
                 WHERE p.status = 1 AND p.deleted_at IS NULL`
            );
        } else {
            [rows] = await pool.query(
                `SELECT p.slug
                 FROM permissions p
                 JOIN modules m ON m.id = p.module_id AND m.status = 1 AND m.deleted_at IS NULL
                 LEFT JOIN user_permissions up
                        ON up.user_id = ? AND up.permission_id = p.id AND up.deleted_at IS NULL
                 WHERE p.status = 1 AND p.deleted_at IS NULL AND p.admin_only = 0
                   AND (up.effect IS NULL OR up.effect <> 'revoke')
                   AND (
                         up.effect = 'grant'
                      OR EXISTS (
                            SELECT 1
                            FROM user_roles ur
                            JOIN roles r ON r.id = ur.role_id AND r.status = 1 AND r.deleted_at IS NULL
                            JOIN role_permissions rp
                                 ON rp.role_id = r.id AND rp.permission_id = p.id AND rp.deleted_at IS NULL
                            WHERE ur.user_id = ? AND ur.deleted_at IS NULL
                         )
                   )`,
                [userId, userId]
            );
        }

        value = {
            user,
            role: roles[0] || null, // rol principal = el de mayor jerarquía (id menor)
            isAdmin,
            permissions: new Set(rows.map((r) => r.slug)),
        };
    }

    accessCache.set(userId, { value, expires: Date.now() + CACHE_TTL_MS });
    return value;
}

/** Invalida la caché de un usuario (o de todos si no se indica). */
function invalidate(userId) {
    if (userId === undefined) accessCache.clear();
    else accessCache.delete(userId);
}

/** Verifica el JWT (401) y carga el acceso real desde la BD (401 si el usuario ya no es válido). */
async function authenticate(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Acceso denegado', code: 'UNAUTHENTICATED' });

    let payload;
    try {
        payload = jwt.verify(token, config.jwtSecret);
    } catch {
        return res.status(401).json({ error: 'Token inválido o vencido', code: 'UNAUTHENTICATED' });
    }

    const userId = parseId(payload.id);
    if (!userId) return res.status(401).json({ error: 'Token inválido', code: 'UNAUTHENTICATED' });

    const access = await getAccess(userId);
    if (!access) return res.status(401).json({ error: 'Usuario inactivo o inexistente', code: 'UNAUTHENTICATED' });

    req.user = payload;
    req.access = access;
    next();
}

/** Permite el paso si el usuario tiene AL MENOS uno de los permisos indicados. */
const requirePermission = (...slugs) => (req, res, next) => {
    const perms = req.access && req.access.permissions;
    if (perms && slugs.some((slug) => perms.has(slug))) return next();
    return res.status(403).json({ error: 'Acceso denegado: permisos insuficientes', code: 'FORBIDDEN' });
};

/** Solo el rol admin (leído de la BD, no del token). */
const requireAdmin = (req, res, next) => {
    if (req.access && req.access.isAdmin) return next();
    return res.status(403).json({ error: 'Acceso exclusivo del administrador', code: 'FORBIDDEN' });
};

/** Datos mínimos de un usuario objetivo + su rol de mayor jerarquía. */
async function getTargetUser(userId) {
    const [[row]] = await pool.query(
        `SELECT u.id, u.deleted_at, MIN(r.id) AS role_id
         FROM users u
         LEFT JOIN user_roles ur ON ur.user_id = u.id AND ur.deleted_at IS NULL
         LEFT JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
         WHERE u.id = ?
         GROUP BY u.id, u.deleted_at`,
        [userId]
    );
    return row || null;
}

/**
 * Jerarquía: un no-admin solo gestiona usuarios con rol igual o inferior al suyo
 * (id de rol >= al propio) o sin rol. Evita, p. ej., cambiar la contraseña de un admin.
 */
function canManageTarget(access, target) {
    if (access.isAdmin) return true;
    if (!access.role) return false;
    if (target.role_id === null || target.role_id === undefined) return true;
    return Number(target.role_id) >= Number(access.role.id);
}

/**
 * Valida qué rol puede asignar el usuario actual.
 * Devuelve { roleId } o { error, status }.
 */
async function resolveAssignableRole(access, requestedRoleId) {
    const roleId = parseId(requestedRoleId);
    if (!roleId) return { error: 'Rol inválido', status: 400 };

    const [[role]] = await pool.query(
        'SELECT id, slug FROM roles WHERE id = ? AND status = 1 AND deleted_at IS NULL',
        [roleId]
    );
    if (!role) return { error: 'El rol indicado no existe', status: 400 };

    if (!access.isAdmin) {
        if (role.slug === 'admin') return { error: 'Solo el administrador puede asignar ese rol', status: 403 };
        if (!access.role || role.id < access.role.id) {
            return { error: 'No puede asignar un rol superior al suyo', status: 403 };
        }
    }
    return { roleId: role.id };
}

/** Rol por defecto (Consulta) para usuarios creados sin permiso de asignar rol. */
async function getDefaultRoleId() {
    const [[role]] = await pool.query(
        "SELECT id FROM roles WHERE slug = 'viewer' AND status = 1 AND deleted_at IS NULL"
    );
    return role ? role.id : null;
}

/** Arma el menú: módulos visibles con las entradas (permisos con ruta) que el usuario posee. */
async function buildMenu(access) {
    const [rows] = await pool.query(
        `SELECT m.id AS module_id, m.slug AS module_slug, m.name AS module_name, m.icon,
                m.sort_order AS module_order,
                p.slug, p.menu_label, p.name AS permission_name, p.route, p.sort_order
         FROM modules m
         JOIN permissions p ON p.module_id = m.id AND p.status = 1 AND p.deleted_at IS NULL
                           AND p.route IS NOT NULL
         WHERE m.status = 1 AND m.deleted_at IS NULL AND m.show_in_menu = 1
         ORDER BY m.sort_order, m.id, p.sort_order, p.id`
    );

    const modules = new Map();
    for (const row of rows) {
        if (!access.permissions.has(row.slug)) continue;
        if (!modules.has(row.module_id)) {
            modules.set(row.module_id, {
                module: row.module_slug,
                name: row.module_name,
                icon: row.icon,
                items: [],
            });
        }
        modules.get(row.module_id).items.push({
            label: row.menu_label || row.permission_name,
            route: row.route,
            slug: row.slug,
        });
    }
    return [...modules.values()];
}

module.exports = {
    pool,
    parseId,
    getAccess,
    invalidate,
    authenticate,
    requirePermission,
    requireAdmin,
    getTargetUser,
    canManageTarget,
    resolveAssignableRole,
    getDefaultRoleId,
    buildMenu,
};
