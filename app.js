const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const config = require('./config');
const {
    pool,
    parseId,
    invalidate,
    authenticate,
    requirePermission,
    requireAdmin,
    getTargetUser,
    canManageTarget,
    resolveAssignableRole,
    getDefaultRoleId
} = require('./access');
const permissionsRoutes = require('./permissions.routes');

const app = express();

// Seguridad HTTP con Helmet
app.use(helmet());

// CORS restrictivo a orígenes configurados
app.use(cors({
    origin: (origin, callback) => {
        // Permitir solicitudes sin origen (como Postman o scripts locales de test) o si está en la lista blanca
        if (!origin || config.corsOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('No permitido por la política CORS'));
        }
    },
    credentials: true
}));

app.use(express.json());

// Rate limit para inicio de sesión (15 intentos por ventana de 15 minutos)
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 15,
    message: { error: 'Demasiados intentos de inicio de sesión. Por favor, intente de nuevo más tarde.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Registrar rutas de permisos
app.use(permissionsRoutes);

//? -------------------------------------------------------------
//? ENDPOINT DE AUTENTICACIÓN (LOGIN)
//? -------------------------------------------------------------
app.post('/api/auth/login', loginLimiter, async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
    }

    try {
        const [results] = await pool.query(`
            SELECT u.*, ur.role_id, r.slug AS role_slug, r.name AS role_name
            FROM users u
            LEFT JOIN user_roles ur ON u.id = ur.user_id AND ur.deleted_at IS NULL
            LEFT JOIN roles r ON ur.role_id = r.id AND r.status = 1 AND r.deleted_at IS NULL
            WHERE u.username = ? AND u.status = 1 AND u.deleted_at IS NULL
        `, [username.trim()]);

        if (results.length === 0) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        const user = results[0];

        if (!user.password) {
            return res.status(401).json({ error: 'Usuario no tiene contraseña configurada' });
        }

        const validPassword = bcrypt.compareSync(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        const token = jwt.sign(
            { id: user.id, username: user.username, role_id: user.role_id },
            config.jwtSecret,
            { expiresIn: config.jwtExpiresIn }
        );

        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                name: user.name,
                username: user.username,
                role_id: user.role_id,
                role_name: user.role_name,
                role_slug: user.role_slug
            }
        });
    } catch (err) {
        console.error('Error en login:', err);
        res.status(500).json({ error: 'Error interno en la autenticación' });
    }
});

//? -------------------------------------------------------------
//? CONTACTOS / PERSONAL (STAFF)
//? -------------------------------------------------------------

// Base SELECT para personal
const getStaffBaseQuery = (includeDeleted = false) => `
    SELECT 
        u.id, 
        u.name, 
        u.name AS usuario_nombre,
        u.last_name, 
        u.last_name AS usuario_apellido,
        u.document_type,
        u.document_number,
        CONCAT(u.document_type, u.document_number) AS ci, 
        u.email,
        u.username,
        u.date_in,
        u.deleted_at,
        p.local_phone,
        p.local_phone AS telefono_local,
        cl.id AS line_id,
        cl.phone_number AS cell_phone,
        cl.phone_number AS telefono_personal,
        p.ext,
        p.ext AS extension,
        d.name AS department,
        d.name AS departamento,
        ud.position,
        ud.position AS cargo,
        ud.position AS posicion,
        pl.name AS place,
        pl.name AS lugar,
        ur.role_id
    FROM users u
    LEFT JOIN user_roles ur ON u.id = ur.user_id AND ur.deleted_at IS NULL
    LEFT JOIN user_departments ud ON u.id = ud.user_id AND ud.deleted_at IS NULL
    LEFT JOIN phone_numbers p ON ud.id = p.user_department_id AND p.deleted_at IS NULL
    LEFT JOIN departments d ON ud.department_id = d.id AND d.deleted_at IS NULL
    LEFT JOIN places pl ON d.place_id = pl.id AND pl.deleted_at IS NULL
    LEFT JOIN user_assigned_lines ual ON u.id = ual.user_id AND ual.return_date IS NULL AND ual.deleted_at IS NULL
    LEFT JOIN company_lines cl ON ual.line_id = cl.id AND cl.deleted_at IS NULL
    ${includeDeleted ? '' : 'WHERE u.deleted_at IS NULL'}
`;

// Obtener datos del personal
app.get('/contacts/staff', authenticate, requirePermission('agenda.view'), async (req, res) => {
    try {
        const query = req.query.query;
        const canSeeDeleted = req.access.permissions.has('employees.restore') && req.query.include_deleted === 'true';
        let selectQuery = getStaffBaseQuery(canSeeDeleted);

        if (query && query.trim()) {
            const likeQuery = '%' + query.trim() + '%';
            const connector = canSeeDeleted ? 'WHERE' : 'AND';
            selectQuery += ` ${connector} (u.name LIKE ? OR u.last_name LIKE ? OR CONCAT(u.name, " ", u.last_name) LIKE ?)`;
            const [results] = await pool.query(selectQuery, [likeQuery, likeQuery, likeQuery]);
            return res.json(results);
        }

        const [results] = await pool.query(selectQuery);
        res.json(results);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al obtener personal', details: err });
    }
});

// Buscar personal por término
app.get('/contacts/staff/search/:query', authenticate, requirePermission('agenda.view'), async (req, res) => {
    try {
        const query = req.params.query;
        const canSeeDeleted = req.access.permissions.has('employees.restore') && req.query.include_deleted === 'true';
        let selectQuery = getStaffBaseQuery(canSeeDeleted);

        if (query && query.trim()) {
            const likeQuery = '%' + query.trim() + '%';
            const connector = canSeeDeleted ? 'WHERE' : 'AND';
            selectQuery += ` ${connector} (u.name LIKE ? OR u.last_name LIKE ? OR CONCAT(u.name, " ", u.last_name) LIKE ?)`;
            const [results] = await pool.query(selectQuery, [likeQuery, likeQuery, likeQuery]);
            return res.json(results);
        }

        const [results] = await pool.query(selectQuery);
        res.json(results);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al buscar personal', details: err });
    }
});

//? Crear contacto completo (users, phone_numbers, user_departments, user_roles)
app.post('/contacts/create-full', authenticate, requirePermission('employees.create'), async (req, res) => {
    const {
        name,
        last_name,
        ci,
        document_type,
        document_number,
        date_in,
        local_phone,
        cell_phone,
        department_id,
        position,
        email,
        username,
        password,
        role_id
    } = req.body;

    let doc_type = document_type || 'V';
    let doc_number = document_number || ci;
    
    if (ci && !document_number) {
        if (ci.toUpperCase().startsWith('V') || ci.toUpperCase().startsWith('E')) {
            doc_type = ci.toUpperCase().charAt(0);
            doc_number = ci.substring(1).replace(/[^0-9]/g, '');
        }
    }

    // Resolver rol a asignar según permisos
    let targetRoleId;
    if (req.access.permissions.has('employees.assign-role') && role_id) {
        const resolved = await resolveAssignableRole(req.access, role_id);
        if (resolved.error) {
            return res.status(resolved.status).json({ error: resolved.error });
        }
        targetRoleId = resolved.roleId;
    } else {
        // Rol 3 (Operador) o sin permiso: asignar rol por defecto (Consulta = 4)
        targetRoleId = await getDefaultRoleId() || 4;
    }

    const hashedPassword = password && password.trim() ? bcrypt.hashSync(password, 10) : null;
    const conn = await pool.getConnection();

    try {
        await conn.beginTransaction();

        // 1. Insert into users
        const userQuery = 'INSERT INTO users (name, last_name, document_type, document_number, email, username, password, date_in) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
        const [userResult] = await conn.query(userQuery, [
            name.trim(),
            last_name.trim(),
            doc_type,
            doc_number ? doc_number.trim() : null,
            email ? email.trim() : null,
            username ? username.trim() : null,
            hashedPassword,
            date_in || null
        ]);

        const userId = userResult.insertId;

        // 2. Insert into user_departments
        const deptQuery = 'INSERT INTO user_departments (user_id, department_id, position) VALUES (?, ?, ?)';
        const [deptRes] = await conn.query(deptQuery, [userId, department_id ? Number(department_id) : null, position ? position.trim() : '']);
        const userDeptId = deptRes.insertId;

        // 3. Insert into phone_numbers
        const phoneQuery = 'INSERT INTO phone_numbers (user_department_id, local_phone) VALUES (?, ?)';
        await conn.query(phoneQuery, [userDeptId, local_phone ? local_phone.trim() : null]);

        // 4. Insert into user_roles
        const roleQuery = 'INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)';
        await conn.query(roleQuery, [userId, targetRoleId]);

        // 5. Asignar línea corporativa si se especificó
        if (cell_phone) {
            const lineId = Number(cell_phone);
            const assignQuery = 'INSERT INTO user_assigned_lines (user_id, line_id, assigned_date) VALUES (?, ?, CURDATE())';
            await conn.query(assignQuery, [userId, lineId]);

            const updateLineQuery = "UPDATE company_lines SET status = 'asignado' WHERE id = ?";
            await conn.query(updateLineQuery, [lineId]);
        }

        await conn.commit();
        res.status(201).json({ success: true, userId });
    } catch (err) {
        await conn.rollback();
        console.error("Error al crear contacto completo:", err);
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'Ya existe un usuario con ese documento, email o nombre de usuario', details: err });
        }
        res.status(500).json({ error: 'Error al registrar contacto', details: err });
    } finally {
        conn.release();
    }
});

//? Actualizar contacto completo
app.put('/contacts/update-full/:id', authenticate, requirePermission('employees.update'), async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID de usuario inválido' });

    const targetUser = await getTargetUser(id);
    if (!targetUser) return res.status(404).json({ error: 'Usuario no encontrado' });

    // Si ya está eliminado por soft-delete, solo admin con employees.restore puede tocarlo
    if (targetUser.deleted_at && !req.access.permissions.has('employees.restore')) {
        return res.status(403).json({ error: 'No puede modificar un usuario eliminado' });
    }

    // Regla de jerarquía: no puede editar usuarios con rol superior al propio
    if (!canManageTarget(req.access, targetUser)) {
        return res.status(403).json({ error: 'No tiene permisos para modificar a un usuario de nivel superior' });
    }

    const {
        name,
        last_name,
        ci,
        document_type,
        document_number,
        date_in,
        local_phone,
        cell_phone,
        department_id,
        position,
        email,
        username,
        password,
        role_id
    } = req.body;

    let doc_type = document_type || 'V';
    let doc_number = document_number || ci;
    
    if (ci && !document_number) {
        if (ci.toUpperCase().startsWith('V') || ci.toUpperCase().startsWith('E')) {
            doc_type = ci.toUpperCase().charAt(0);
            doc_number = ci.substring(1).replace(/[^0-9]/g, '');
        }
    }

    const conn = await pool.getConnection();

    try {
        await conn.beginTransaction();

        // 1. Update users
        let userQuery = 'UPDATE users SET name = ?, last_name = ?, document_type = ?, document_number = ?, date_in = ?';
        let queryParams = [name.trim(), last_name.trim(), doc_type, doc_number ? doc_number.trim() : null, date_in || null];

        if (email !== undefined) {
            userQuery += ', email = ?';
            queryParams.push(email ? email.trim() : null);
        }
        if (username !== undefined) {
            userQuery += ', username = ?';
            queryParams.push(username ? username.trim() : null);
        }
        if (password && password.trim()) {
            userQuery += ', password = ?';
            queryParams.push(bcrypt.hashSync(password, 10));
        }

        userQuery += ' WHERE id = ?';
        queryParams.push(id);

        await conn.query(userQuery, queryParams);

        // 2. Limpiar departamentos asignados previos
        await conn.query('DELETE FROM user_departments WHERE user_id = ?', [id]);

        // 3. Insertar nuevo departamento
        const insertDeptQuery = 'INSERT INTO user_departments (user_id, department_id, position) VALUES (?, ?, ?)';
        const [deptRes] = await conn.query(insertDeptQuery, [id, department_id ? Number(department_id) : null, position ? position.trim() : '']);
        const userDeptId = deptRes.insertId;

        // 4. Insertar nuevo teléfono local
        const phoneQuery = 'INSERT INTO phone_numbers (user_department_id, local_phone) VALUES (?, ?)';
        await conn.query(phoneQuery, [userDeptId, local_phone ? local_phone.trim() : null]);

        // 5. Actualizar rol solo si tiene permiso `employees.assign-role`
        if (req.access.permissions.has('employees.assign-role') && role_id) {
            const resolved = await resolveAssignableRole(req.access, role_id);
            if (resolved.error) {
                await conn.rollback();
                return res.status(resolved.status).json({ error: resolved.error });
            }
            await conn.query('DELETE FROM user_roles WHERE user_id = ?', [id]);
            await conn.query('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [id, resolved.roleId]);
            invalidate(id);
        }

        // 6. Gestionar asignación de línea corporativa
        const [currentLineRes] = await conn.query(
            'SELECT id, line_id FROM user_assigned_lines WHERE user_id = ? AND return_date IS NULL',
            [id]
        );
        const currentAssigned = currentLineRes[0];
        const newLineId = cell_phone ? Number(cell_phone) : null;

        if (currentAssigned && currentAssigned.line_id !== newLineId) {
            await conn.query('UPDATE user_assigned_lines SET return_date = CURDATE() WHERE id = ?', [currentAssigned.id]);
            await conn.query("UPDATE company_lines SET status = 'disponible' WHERE id = ?", [currentAssigned.line_id]);
        }

        if (newLineId && (!currentAssigned || currentAssigned.line_id !== newLineId)) {
            await conn.query('INSERT INTO user_assigned_lines (user_id, line_id, assigned_date) VALUES (?, ?, CURDATE())', [id, newLineId]);
            await conn.query("UPDATE company_lines SET status = 'asignado' WHERE id = ?", [newLineId]);
        }

        await conn.commit();
        res.json({ success: true, message: 'Contacto actualizado exitosamente' });
    } catch (err) {
        await conn.rollback();
        console.error("Error al actualizar contacto:", err);
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'Ya existe un usuario con ese documento, email o nombre de usuario', details: err });
        }
        res.status(500).json({ error: 'Error al actualizar contacto', details: err });
    } finally {
        conn.release();
    }
});

//? Soft-Delete de usuario (Personal)
app.delete(['/contacts/delete/:id', '/contacts/staff/:id', '/contacts/:id'], authenticate, requirePermission('employees.delete'), async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID de usuario inválido' });

    const targetUser = await getTargetUser(id);
    if (!targetUser) return res.status(404).json({ error: 'Usuario no encontrado' });

    if (targetUser.deleted_at) {
        return res.status(400).json({ error: 'El usuario ya ha sido eliminado previamente' });
    }

    if (!canManageTarget(req.access, targetUser)) {
        return res.status(403).json({ error: 'No tiene permisos para eliminar a un usuario de nivel superior o igual al suyo' });
    }

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        // 1. Soft delete en users
        await conn.query('UPDATE users SET deleted_at = NOW(), status = 0 WHERE id = ?', [id]);

        // 2. Liberar líneas asignadas activas
        const [lines] = await conn.query('SELECT line_id FROM user_assigned_lines WHERE user_id = ? AND return_date IS NULL', [id]);
        if (lines.length > 0) {
            await conn.query('UPDATE user_assigned_lines SET return_date = CURDATE() WHERE user_id = ? AND return_date IS NULL', [id]);
            const lineIds = lines.map(l => l.line_id);
            await conn.query("UPDATE company_lines SET status = 'disponible' WHERE id IN (?)", [lineIds]);
        }

        await conn.commit();
        invalidate(id);
        res.json({ success: true, message: 'Usuario eliminado correctamente (soft-delete)' });
    } catch (err) {
        await conn.rollback();
        console.error('Error al eliminar usuario:', err);
        res.status(500).json({ error: 'Error al eliminar usuario', details: err });
    } finally {
        conn.release();
    }
});

//? Restaurar usuario (soft delete reverse - solo con permiso employees.restore, ej. Admin)
app.post('/contacts/restore/:id', authenticate, requirePermission('employees.restore'), async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID de usuario inválido' });

    try {
        const [result] = await pool.query(
            'UPDATE users SET deleted_at = NULL, status = 1 WHERE id = ? AND deleted_at IS NOT NULL',
            [id]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado o no está eliminado' });
        }
        invalidate(id);
        res.json({ success: true, message: 'Usuario restaurado exitosamente' });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'No se puede restaurar: el documento, email o username ya está en uso por otro usuario activo' });
        }
        res.status(500).json({ error: 'Error al restaurar usuario', details: err });
    }
});

//? -------------------------------------------------------------
//? DEPARTAMENTOS
//? -------------------------------------------------------------

// Público (usado en Home)
app.get('/departments', async (req, res) => {
    try {
        const [results] = await pool.query('SELECT * FROM departments WHERE deleted_at IS NULL AND status = 1');
        res.json(results);
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener departamentos' });
    }
});

// Protegido con permisos y paginación
app.get('/contacts/departments', authenticate, requirePermission('departments.view', 'employees.create', 'employees.update'), async (req, res) => {
    const { page, limit, search, place_id } = req.query;

    let whereClause = 'WHERE d.status = 1 AND d.deleted_at IS NULL';
    const params = [];

    if (place_id && place_id !== 'todos') {
        whereClause += ' AND d.place_id = ?';
        params.push(Number(place_id));
    }

    if (search && search.trim()) {
        const like = '%' + search.trim() + '%';
        whereClause += ' AND (d.name LIKE ? OR pl.name LIKE ?)';
        params.push(like, like);
    }

    try {
        if (!page) {
            const query = `
                SELECT d.id, d.name, d.place_id, pl.name AS place_name, d.status, d.created_at, d.updated_at 
                FROM departments d 
                INNER JOIN places pl ON d.place_id = pl.id 
                ${whereClause} 
                ORDER BY d.name ASC
            `;
            const [results] = await pool.query(query, params);
            return res.json(results);
        }

        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));
        const offset = (pageNum - 1) * limitNum;

        const countQuery = `
            SELECT COUNT(*) AS total 
            FROM departments d 
            INNER JOIN places pl ON d.place_id = pl.id 
            ${whereClause}
        `;
        const [[countResult]] = await pool.query(countQuery, params);
        const total = countResult.total;
        const totalPages = Math.ceil(total / limitNum);

        const dataQuery = `
            SELECT d.id, d.name, d.place_id, pl.name AS place_name, d.status, d.created_at, d.updated_at 
            FROM departments d 
            INNER JOIN places pl ON d.place_id = pl.id 
            ${whereClause} 
            ORDER BY d.name ASC 
            LIMIT ? OFFSET ?
        `;
        const [rows] = await pool.query(dataQuery, [...params, limitNum, offset]);
        res.json({
            data: rows,
            total,
            page: pageNum,
            limit: limitNum,
            totalPages
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al consultar departamentos', details: err });
    }
});

// Crear departamento
app.post('/contacts/departments', authenticate, requirePermission('departments.create'), async (req, res) => {
    const { name, place_id, status } = req.body;
    if (!name || !place_id) {
        return res.status(400).json({ error: 'El nombre y el lugar son requeridos' });
    }

    const deptStatus = status !== undefined ? Number(status) : 1;
    try {
        const [results] = await pool.query(
            'INSERT INTO departments (name, place_id, status) VALUES (?, ?, ?)',
            [name.trim(), Number(place_id), deptStatus]
        );
        res.status(201).json({ success: true, insertId: results.insertId, message: 'Departamento creado con éxito' });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'Ya existe un departamento con ese nombre en esta sede/lugar' });
        }
        res.status(500).json({ error: 'Error al crear departamento', details: err });
    }
});

// Modificar departamento
app.put('/contacts/departments/:id', authenticate, requirePermission('departments.update'), async (req, res) => {
    const id = parseId(req.params.id);
    const { name, place_id, status } = req.body;

    if (!id || !name || !place_id) {
        return res.status(400).json({ error: 'ID, nombre y lugar son requeridos' });
    }

    const deptStatus = status !== undefined ? Number(status) : 1;
    try {
        const [results] = await pool.query(
            'UPDATE departments SET name = ?, place_id = ?, status = ? WHERE id = ?',
            [name.trim(), Number(place_id), deptStatus, id]
        );
        if (results.affectedRows === 0) {
            return res.status(404).json({ error: 'Departamento no encontrado' });
        }
        res.json({ success: true, message: 'Departamento actualizado con éxito' });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'Ya existe un departamento con ese nombre en esta sede/lugar' });
        }
        res.status(500).json({ error: 'Error al actualizar departamento', details: err });
    }
});

//? -------------------------------------------------------------
//? LUGARES / SEDES (PLACES)
//? -------------------------------------------------------------

// Público (usado en Home y filtros)
app.get('/places', async (req, res) => {
    try {
        const [results] = await pool.query('SELECT id, name FROM places WHERE status = 1 AND deleted_at IS NULL');
        res.json(results);
    } catch (err) {
        res.status(500).json({ error: 'Error al consultar lugares' });
    }
});

// Buscar personal por sede/lugar
app.get('/contacts/places/:name', authenticate, requirePermission('agenda.by-place', 'agenda.view'), async (req, res) => {
    const { name } = req.params;
    const { page, limit, search } = req.query;

    const baseFrom = `
        FROM users u
        LEFT JOIN user_roles ur ON u.id = ur.user_id AND ur.deleted_at IS NULL
        INNER JOIN user_departments ud ON u.id = ud.user_id AND ud.deleted_at IS NULL
        INNER JOIN phone_numbers p ON ud.id = p.user_department_id AND p.deleted_at IS NULL
        INNER JOIN departments d ON ud.department_id = d.id AND d.deleted_at IS NULL
        INNER JOIN places pl ON d.place_id = pl.id AND pl.deleted_at IS NULL
        LEFT JOIN user_assigned_lines ual ON u.id = ual.user_id AND ual.return_date IS NULL AND ual.deleted_at IS NULL
        LEFT JOIN company_lines cl ON ual.line_id = cl.id AND cl.deleted_at IS NULL
    `;

    let whereClause = 'WHERE pl.name = ? AND u.deleted_at IS NULL';
    const params = [name];

    if (search && search.trim()) {
        const like = '%' + search.trim() + '%';
        whereClause += ' AND (u.name LIKE ? OR u.last_name LIKE ? OR CONCAT(u.name, " ", u.last_name) LIKE ? OR d.name LIKE ? OR ud.position LIKE ? OR p.local_phone LIKE ? OR cl.phone_number LIKE ?)';
        params.push(like, like, like, like, like, like, like);
    }

    try {
        if (!page) {
            const selectQuery = `
                SELECT 
                    u.id, 
                    u.name, 
                    u.name AS usuario_nombre,
                    u.last_name, 
                    u.last_name AS usuario_apellido,
                    u.document_type,
                    u.document_number,
                    CONCAT(u.document_type, u.document_number) AS ci, 
                    u.email,
                    u.username,
                    u.date_in,
                    p.local_phone,
                    p.local_phone AS telefono_local,
                    cl.id AS line_id,
                    cl.phone_number AS cell_phone,
                    cl.phone_number AS telefono_personal,
                    p.ext,
                    p.ext AS extension,
                    d.name AS department,
                    d.name AS departamento,
                    ud.position,
                    ud.position AS cargo,
                    ud.position AS posicion,
                    pl.name AS place,
                    pl.name AS lugar,
                    ur.role_id
                ${baseFrom}
                ${whereClause}
                ORDER BY u.name ASC
            `;
            const [rows] = await pool.query(selectQuery, params);
            return res.json(rows);
        }

        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));
        const offset = (pageNum - 1) * limitNum;

        const countQuery = `SELECT COUNT(*) AS total ${baseFrom} ${whereClause}`;
        const [[countResult]] = await pool.query(countQuery, params);
        const total = countResult.total;
        const totalPages = Math.ceil(total / limitNum);

        const dataQuery = `
            SELECT 
                u.id, 
                u.name, 
                u.name AS usuario_nombre,
                u.last_name, 
                u.last_name AS usuario_apellido,
                u.document_type,
                u.document_number,
                CONCAT(u.document_type, u.document_number) AS ci, 
                u.email,
                u.username,
                u.date_in,
                p.local_phone,
                p.local_phone AS telefono_local,
                cl.id AS line_id,
                cl.phone_number AS cell_phone,
                cl.phone_number AS telefono_personal,
                p.ext,
                p.ext AS extension,
                d.name AS department,
                d.name AS departamento,
                ud.position,
                ud.position AS cargo,
                ud.position AS posicion,
                pl.name AS place,
                pl.name AS lugar,
                ur.role_id
            ${baseFrom}
            ${whereClause}
            ORDER BY u.name ASC
            LIMIT ? OFFSET ?
        `;
        const [rows] = await pool.query(dataQuery, [...params, limitNum, offset]);
        res.json({
            data: rows,
            total,
            page: pageNum,
            limit: limitNum,
            totalPages
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al consultar personal por sede', details: err });
    }
});

//? -------------------------------------------------------------
//? LÍNEAS CORPORATIVAS
//? -------------------------------------------------------------

// Ver líneas disponibles
app.get('/contacts/company-lines/available', authenticate, requirePermission('phone-lines.view', 'employees.create', 'employees.update'), async (req, res) => {
    try {
        const [results] = await pool.query(
            "SELECT id, phone_number, operator FROM company_lines WHERE status = 'disponible' AND active_status = 'activa' AND deleted_at IS NULL"
        );
        res.json(results);
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener líneas disponibles' });
    }
});

// Ver todas las líneas con paginación
app.get('/company-lines', authenticate, requirePermission('phone-lines.view'), async (req, res) => {
    const { page, limit, operator, search } = req.query;

    const baseFrom = `
        FROM company_lines cl
        LEFT JOIN user_assigned_lines ual ON cl.id = ual.line_id AND ual.return_date IS NULL AND ual.deleted_at IS NULL
        LEFT JOIN users u ON ual.user_id = u.id AND u.deleted_at IS NULL
    `;

    const whereClauses = ['cl.deleted_at IS NULL'];
    const params = [];

    if (operator && operator.toLowerCase() !== 'todos') {
        whereClauses.push('LOWER(cl.operator) = LOWER(?)');
        params.push(operator.trim());
    }

    if (search && search.trim()) {
        const like = '%' + search.trim() + '%';
        whereClauses.push('(cl.phone_number LIKE ? OR cl.serial LIKE ? OR cl.operator LIKE ? OR cl.status LIKE ? OR cl.active_status LIKE ? OR u.name LIKE ? OR u.last_name LIKE ? OR CONCAT(u.name, " ", u.last_name) LIKE ?)');
        params.push(like, like, like, like, like, like, like, like);
    }

    const whereSQL = `WHERE ${whereClauses.join(' AND ')}`;

    try {
        if (!page) {
            const query = `
                SELECT 
                    cl.id,
                    cl.serial,
                    cl.phone_number,
                    cl.status,
                    cl.active_status,
                    cl.operator,
                    cl.created_at,
                    cl.updated_at,
                    ual.user_id,
                    u.name AS user_name,
                    u.last_name AS user_last_name,
                    CONCAT(u.name, ' ', u.last_name) AS assigned_user,
                    ual.assigned_date
                ${baseFrom}
                ${whereSQL}
                ORDER BY cl.id DESC
            `;
            const [results] = await pool.query(query, params);
            return res.json(results);
        }

        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));
        const offset = (pageNum - 1) * limitNum;

        const countQuery = `SELECT COUNT(*) AS total ${baseFrom} ${whereSQL}`;
        const [[countResult]] = await pool.query(countQuery, params);
        const total = countResult.total;
        const totalPages = Math.ceil(total / limitNum);

        const dataQuery = `
            SELECT 
                cl.id,
                cl.serial,
                cl.phone_number,
                cl.status,
                cl.active_status,
                cl.operator,
                cl.created_at,
                cl.updated_at,
                ual.user_id,
                u.name AS user_name,
                u.last_name AS user_last_name,
                CONCAT(u.name, ' ', u.last_name) AS assigned_user,
                ual.assigned_date
            ${baseFrom}
            ${whereSQL}
            ORDER BY cl.id DESC
            LIMIT ? OFFSET ?
        `;
        const [rows] = await pool.query(dataQuery, [...params, limitNum, offset]);
        res.json({
            data: rows,
            total,
            page: pageNum,
            limit: limitNum,
            totalPages
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al consultar líneas corporativas', details: err });
    }
});

// Crear nueva línea corporativa
app.post('/company-lines/create-line', authenticate, requirePermission('phone-lines.create'), async (req, res) => {
    const { serial, phone_number, status, active_status, operator } = req.body;
    try {
        const [results] = await pool.query(
            'INSERT INTO company_lines (serial, phone_number, status, active_status, operator) VALUES (?, ?, ?, ?, ?)',
            [serial.trim(), phone_number.trim(), status || 'disponible', active_status || 'activa', operator]
        );
        res.status(201).json({ success: true, insertId: results.insertId });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'Ya existe una línea con ese serial o número telefónico' });
        }
        res.status(500).json({ error: 'Error al crear la línea', details: err });
    }
});

// Actualizar línea corporativa
app.put('/company-lines/:id', authenticate, requirePermission('phone-lines.update'), async (req, res) => {
    const id = parseId(req.params.id);
    const { serial, phone_number, status, active_status, operator } = req.body;

    if (!id || !serial || !phone_number || !operator) {
        return res.status(400).json({ error: 'ID, serial, número y operador son requeridos' });
    }

    try {
        const [results] = await pool.query(
            'UPDATE company_lines SET serial = ?, phone_number = ?, status = ?, active_status = ?, operator = ? WHERE id = ?',
            [serial.trim(), phone_number.trim(), status || 'disponible', active_status || 'activa', operator, id]
        );
        if (results.affectedRows === 0) {
            return res.status(404).json({ error: 'Línea corporativa no encontrada' });
        }
        res.json({ success: true, message: 'Línea corporativa actualizada con éxito' });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'Ya existe una línea con ese serial o número telefónico' });
        }
        res.status(500).json({ error: 'Error al actualizar la línea', details: err });
    }
});

// Iniciar servidor
app.listen(config.port, () => {
    console.log(`Backend de contactos ejecutándose en el puerto ${config.port}`);
});
