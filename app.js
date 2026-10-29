const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const port = 3000;

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_key_123';

const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'qweasdzxc0*',
    database: 'newcontacts'
});

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) return res.status(401).json({ error: 'Acceso denegado' });
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Token inválido' });
        req.user = user;
        next();
    });
};

const requireRole = (allowedRoles) => {
    return (req, res, next) => {
        const userRole = req.user && req.user.role_id ? Number(req.user.role_id) : null;
        if (!userRole || !allowedRoles.includes(userRole)) {
            return res.status(403).json({ error: 'Acceso denegado: permisos insuficientes' });
        }
        next();
    };
};


//? endpoint para obtener datos (con soporte de búsqueda por nombre y apellido)
app.get('/contacts/staff', authenticateToken, (req, res) => {
    const query = req.query.query;
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
        FROM users u
        LEFT JOIN user_roles ur ON u.id = ur.user_id
        LEFT JOIN user_departments ud ON u.id = ud.user_id
          LEFT JOIN phone_numbers p ON ud.id = p.user_department_id
        LEFT JOIN departments d ON ud.department_id = d.id
        LEFT JOIN places pl ON d.place_id = pl.id
        LEFT JOIN user_assigned_lines ual ON u.id = ual.user_id AND ual.return_date IS NULL
        LEFT JOIN company_lines cl ON ual.line_id = cl.id`;

    if (query) {
        const likeQuery = '%' + query + '%';
        db.query(
            selectQuery + ' WHERE u.name LIKE ? OR u.last_name LIKE ? OR CONCAT(u.name, " ", u.last_name) LIKE ?',
            [likeQuery, likeQuery, likeQuery],
            (err, results) => {
                if (err) return res.status(500).send(err);
                res.json(results);
            }
        );
    } else {
        db.query(selectQuery, (err, results) => {
            if (err) return res.status(500).send(err);
            res.json(results);
        });
    }
});

//? endpoint buscar por nombre y apellido
app.get('/contacts/staff/search/:query', authenticateToken, (req, res) => {
    const query = req.params.query;
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
        FROM users u
        LEFT JOIN user_roles ur ON u.id = ur.user_id
        LEFT JOIN user_departments ud ON u.id = ud.user_id
          LEFT JOIN phone_numbers p ON ud.id = p.user_department_id
        LEFT JOIN departments d ON ud.department_id = d.id
        LEFT JOIN places pl ON d.place_id = pl.id
        LEFT JOIN user_assigned_lines ual ON u.id = ual.user_id AND ual.return_date IS NULL
        LEFT JOIN company_lines cl ON ual.line_id = cl.id`;

    if (query) {
        const likeQuery = '%' + query + '%';
        db.query(
            selectQuery + ' WHERE u.name LIKE ? OR u.last_name LIKE ? OR CONCAT(u.name, " ", u.last_name) LIKE ?',
            [likeQuery, likeQuery, likeQuery],
            (err, results) => {
                if (err) return res.status(500).send(err);
                res.json(results);
            }
        );
    } else {
        db.query(selectQuery, (err, results) => {
            if (err) return res.status(500).send(err);
            res.json(results);
        });
    }
});

//? endpoint para crear un usuario (soporta /contacts/create y /contacts/staff)
app.post(['/contacts/create', '/contacts/staff'], authenticateToken, (req, res) => {
    const {name, last_name, document_type, document_number, email, username, password, date_in, status } = req.body;
    const hashedPassword = password ? bcrypt.hashSync(password, 10) : null;
    db.query('INSERT INTO users (name, last_name, document_type, document_number, email, username, password, date_in, status) VALUES (?,?,?,?,?,?,?,?,?)', [name, last_name, document_type, document_number, email, username, hashedPassword, date_in, status], (err, results) => {
        if (err) return res.status(500).send(err);
        res.json(results);
    });
});

//? endpoint para actualizar un usuario (soporta /contacts/update/:id y /contacts/staff/:id)
app.put(['/contacts/update/:id', '/contacts/staff/:id'], authenticateToken, (req, res) => {
    const id = req.params.id;
    const {name, last_name, document_type, document_number, email, username, password, date_in, status } = req.body;
    db.query('UPDATE users SET name = ?, last_name = ?, document_type = ?, document_number = ?, email = ?, username = ?, password = ?, date_in = ?, status = ? WHERE id = ?', [name,last_name,document_type,document_number,email,username,password,date_in,status, id], (err, results) => {
        if (err) return res.status(500).send(err);
        res.json(results);
    });
});

//? endpoint para eliminar un usuario (soporta /contacts/delete/:id, /contacts/staff/:id y /contacts/:id)
app.delete(['/contacts/delete/:id', '/contacts/staff/:id', '/contacts/:id'], authenticateToken, (req, res) => {
    const { id } = req.params;
    db.query('DELETE FROM users WHERE id = ?', [id], (err, results) => {
        if (err) return res.status(500).send(err);
        res.json(results);
    });
});

//? endpoint para obtener los departamentos 
app.get('/departments', (req, res) => {
    db.query('SELECT * FROM departments', (err, results) => {
        if (err) return res.status(500).send(err);
        res.json(results);
    });
});

//? endpoint para obtener la lista de departamentos activos (status = 1) con nombre de lugar (roles 1, 2, 3) (soporta paginación)
app.get('/contacts/departments', authenticateToken, requireRole([1, 2, 3]), (req, res) => {
    const { page, limit, search, place_id } = req.query;

    let whereClause = 'WHERE d.status = 1';
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

    // Si no se pide paginación, devolver el listado completo (compatibilidad)
    if (!page) {
        const query = `
            SELECT d.id, d.name, d.place_id, pl.name AS place_name, d.status, d.created_at, d.updated_at 
            FROM departments d 
            INNER JOIN places pl ON d.place_id = pl.id 
            ${whereClause} 
            ORDER BY d.name ASC
        `;
        db.query(query, params, (err, results) => {
            if (err) return res.status(500).json({ error: 'Error al consultar departamentos', details: err });
            res.json(results);
        });
        return;
    }

    // Modo paginado
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));
    const offset = (pageNum - 1) * limitNum;

    const countQuery = `
        SELECT COUNT(*) AS total 
        FROM departments d 
        INNER JOIN places pl ON d.place_id = pl.id 
        ${whereClause}
    `;

    db.query(countQuery, params, (countErr, countResults) => {
        if (countErr) return res.status(500).json({ error: 'Error al contar departamentos', details: countErr });

        const total = countResults[0].total;
        const totalPages = Math.ceil(total / limitNum);

        const dataQuery = `
            SELECT d.id, d.name, d.place_id, pl.name AS place_name, d.status, d.created_at, d.updated_at 
            FROM departments d 
            INNER JOIN places pl ON d.place_id = pl.id 
            ${whereClause} 
            ORDER BY d.name ASC 
            LIMIT ? OFFSET ?
        `;

        db.query(dataQuery, [...params, limitNum, offset], (dataErr, rows) => {
            if (dataErr) return res.status(500).json({ error: 'Error al obtener departamentos', details: dataErr });
            res.json({
                data: rows,
                total,
                page: pageNum,
                limit: limitNum,
                totalPages
            });
        });
    });
});

//? endpoint para crear un departamento (roles 1, 2, 3)
app.post('/contacts/departments', authenticateToken, requireRole([1, 2, 3]), (req, res) => {
    const { name, place_id, status } = req.body;
    if (!name || !place_id) {
        return res.status(400).json({ error: 'El nombre y el lugar son requeridos' });
    }

    const deptStatus = status !== undefined ? Number(status) : 1;

    db.query(
        'INSERT INTO departments (name, place_id, status) VALUES (?, ?, ?)',
        [name.trim(), Number(place_id), deptStatus],
        (err, results) => {
            if (err) {
                if (err.code === 'ER_DUP_ENTRY') {
                    return res.status(409).json({ error: 'Ya existe un departamento con ese nombre en esta sede/lugar' });
                }
                return res.status(500).json({ error: 'Error al crear departamento', details: err });
            }
            res.status(201).json({ success: true, insertId: results.insertId, message: 'Departamento creado con éxito' });
        }
    );
});

//? endpoint para actualizar/modificar un departamento (roles 1, 2, 3)
app.put('/contacts/departments/:id', authenticateToken, requireRole([1, 2, 3]), (req, res) => {
    const id = Number(req.params.id);
    const { name, place_id, status } = req.body;

    if (!id || !name || !place_id) {
        return res.status(400).json({ error: 'ID, nombre y lugar son requeridos' });
    }

    const deptStatus = status !== undefined ? Number(status) : 1;

    db.query(
        'UPDATE departments SET name = ?, place_id = ?, status = ? WHERE id = ?',
        [name.trim(), Number(place_id), deptStatus, id],
        (err, results) => {
            if (err) {
                if (err.code === 'ER_DUP_ENTRY') {
                    return res.status(409).json({ error: 'Ya existe un departamento con ese nombre en esta sede/lugar' });
                }
                return res.status(500).json({ error: 'Error al actualizar departamento', details: err });
            }
            if (results.affectedRows === 0) {
                return res.status(404).json({ error: 'Departamento no encontrado' });
            }
            res.json({ success: true, message: 'Departamento actualizado con éxito' });
        }
    );
});

//? endpoint para obtener el lugar (incluye id y name)
app.get('/places', (req, res) => {
    db.query('SELECT id, name FROM places;', (err,results) => {
        if (err) return res.status(500).send(err);
        res.json(results);
    });
});

//? endpoint para buscar por lugar (soporta paginación y búsqueda)
app.get('/contacts/places/:name', authenticateToken, (req, res) => {
    const { name } = req.params;
    const { page, limit, search } = req.query;

    const baseFrom = `
        FROM users u
        LEFT JOIN user_roles ur ON u.id = ur.user_id
        INNER JOIN user_departments ud ON u.id = ud.user_id
        INNER JOIN phone_numbers p ON ud.id = p.user_department_id 
        INNER JOIN departments d ON ud.department_id = d.id 
        INNER JOIN places pl ON d.place_id = pl.id  
        LEFT JOIN user_assigned_lines ual ON u.id = ual.user_id AND ual.return_date IS NULL
        LEFT JOIN company_lines cl ON ual.line_id = cl.id
    `;

    let whereClause = 'WHERE pl.name = ?';
    const params = [name];

    if (search && search.trim()) {
        const like = '%' + search.trim() + '%';
        whereClause += ' AND (u.name LIKE ? OR u.last_name LIKE ? OR CONCAT(u.name, " ", u.last_name) LIKE ? OR d.name LIKE ? OR ud.position LIKE ? OR p.local_phone LIKE ? OR cl.phone_number LIKE ?)';
        params.push(like, like, like, like, like, like, like);
    }

    // Si no se pide paginación, devolver el listado completo (compatibilidad)
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

        db.query(selectQuery, params, (err, rows) => {
            if (err) {
                console.error(err);
                return res.status(500).json({ error: "Error en la base de datos", details: err });
            }
            res.json(rows);
        });
        return;
    }

    // Modo paginado
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));
    const offset = (pageNum - 1) * limitNum;

    const countQuery = `SELECT COUNT(*) AS total ${baseFrom} ${whereClause}`;

    db.query(countQuery, params, (countErr, countResults) => {
        if (countErr) {
            console.error(countErr);
            return res.status(500).json({ error: "Error al contar personal", details: countErr });
        }

        const total = countResults[0].total;
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

        db.query(dataQuery, [...params, limitNum, offset], (dataErr, rows) => {
            if (dataErr) {
                console.error(dataErr);
                return res.status(500).json({ error: "Error al obtener personal", details: dataErr });
            }
            res.json({
                data: rows,
                total,
                page: pageNum,
                limit: limitNum,
                totalPages
            });
        });
    });
});

//? endpoint para crear un contacto completo (users, phone_numbers, user_departments)
app.post('/contacts/create-full', authenticateToken, (req, res) => {
    const {
        name,
        last_name,
        ci,
        document_type,
        document_number,
        date_in,
        local_phone,
        cell_phone,
        ext,
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

    const hashedPassword = password ? bcrypt.hashSync(password, 10) : null;

    db.beginTransaction((err) => {
        if (err) {
            console.error("Failed to begin transaction:", err);
            return res.status(500).json({ error: "Failed to begin transaction", details: err });
        }

        // 1. Insert into users
        const userQuery = 'INSERT INTO users (name, last_name, document_type, document_number, email, username, password, date_in) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
        db.query(userQuery, [name, last_name, doc_type, doc_number || null, email || null, username || null, hashedPassword, date_in || null], (err, userResult) => {
            if (err) {
                console.error("Failed to insert user:", err);
                return db.rollback(() => {
                    res.status(500).json({ error: "Failed to insert user", details: err });
                });
            }

            const userId = userResult.insertId;

            // 2. Insert into user_departments
            const deptQuery = 'INSERT INTO user_departments (user_id, department_id, position) VALUES (?, ?, ?)';
            db.query(deptQuery, [userId, department_id || null, position || ''], (err, deptRes) => {
                if (err) {
                    console.error("Failed to insert user department:", err);
                    return db.rollback(() => {
                        res.status(500).json({ error: "Failed to insert user department", details: err });
                    });
                }
                
                const userDeptId = deptRes.insertId;

                // 3. Insert into phone_numbers
                const phoneQuery = 'INSERT INTO phone_numbers (user_department_id, local_phone) VALUES (?, ?)';
                db.query(phoneQuery, [userDeptId, local_phone || null], (err) => {
                    if (err) {
                        console.error("Failed to insert phone numbers:", err);
                        return db.rollback(() => {
                            res.status(500).json({ error: "Failed to insert phone numbers", details: err });
                        });
                    }

                    // 4. Insert into user_roles
                    const roleQuery = 'INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)';
                    db.query(roleQuery, [userId, role_id || 4], (err) => {
                        if (err) {
                            console.error("Failed to insert user roles:", err);
                            return db.rollback(() => {
                                res.status(500).json({ error: "Failed to insert user roles", details: err });
                            });
                        }

                        const assignLine = () => {
                            if (!cell_phone) return commitTx();
                            
                            const assignQuery = 'INSERT INTO user_assigned_lines (user_id, line_id, assigned_date) VALUES (?, ?, CURDATE())';
                            db.query(assignQuery, [userId, cell_phone], (err) => {
                                if (err) {
                                    console.error("Failed to assign company line:", err);
                                    return db.rollback(() => res.status(500).json({ error: "Failed to assign line", details: err }));
                                }

                                const updateLineQuery = "UPDATE company_lines SET status = 'asignado' WHERE id = ?";
                                db.query(updateLineQuery, [cell_phone], (err) => {
                                    if (err) {
                                        console.error("Failed to update company line status:", err);
                                        return db.rollback(() => res.status(500).json({ error: "Failed to update line status", details: err }));
                                    }
                                    commitTx();
                                });
                            });
                        };

                        const commitTx = () => {
                            db.commit((err) => {
                                if (err) {
                                    console.error("Failed to commit transaction:", err);
                                    return db.rollback(() => res.status(500).json({ error: "Failed to commit transaction", details: err }));
                                }
                                res.status(201).json({ success: true, userId });
                            });
                        };

                        assignLine();
                    });
                });
            });
        });
    });
});

//? endpoint para actualizar un contacto completo (users, phone_numbers, user_departments)
app.put('/contacts/update-full/:id', authenticateToken, (req, res) => {
    const id = req.params.id;
    const {
        name,
        last_name,
        ci,
        document_type,
        document_number,
        date_in,
        local_phone,
        cell_phone,
        ext,
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

    db.beginTransaction((err) => {
        if (err) {
            console.error("Failed to begin transaction:", err);
            return res.status(500).json({ error: "Failed to begin transaction", details: err });
        }

        // 1. Update users table
        let userQuery = 'UPDATE users SET name = ?, last_name = ?, document_type = ?, document_number = ?, date_in = ?';
        let queryParams = [name, last_name, doc_type, doc_number || null, date_in || null];
        
        if (email !== undefined) {
            userQuery += ', email = ?';
            queryParams.push(email || null);
        }
        if (username !== undefined) {
            userQuery += ', username = ?';
            queryParams.push(username || null);
        }
        if (password) {
            userQuery += ', password = ?';
            queryParams.push(bcrypt.hashSync(password, 10));
        }
        
        userQuery += ' WHERE id = ?';
        queryParams.push(id);

        db.query(userQuery, queryParams, (err) => {
            if (err) {
                console.error("Failed to update user:", err);
                return db.rollback(() => {
                    res.status(500).json({ error: "Failed to update user", details: err });
                });
            }

            // 2. Clear old user departments (this cascades to phone_numbers)
            const deleteDeptQuery = 'DELETE FROM user_departments WHERE user_id = ?';
            db.query(deleteDeptQuery, [id], (err) => {
                if (err) {
                    console.error("Failed to clear user departments:", err);
                    return db.rollback(() => {
                        res.status(500).json({ error: "Failed to clear user departments", details: err });
                    });
                }

                // 3. Insert new user department
                const insertDeptQuery = 'INSERT INTO user_departments (user_id, department_id, position) VALUES (?, ?, ?)';
                db.query(insertDeptQuery, [id, department_id || null, position || ''], (err, deptRes) => {
                    if (err) {
                        console.error("Failed to insert user department:", err);
                        return db.rollback(() => {
                            res.status(500).json({ error: "Failed to insert user department", details: err });
                        });
                    }

                    const userDeptId = deptRes.insertId;

                    // 4. Insert new phone number
                    const phoneQuery = 'INSERT INTO phone_numbers (user_department_id, local_phone) VALUES (?, ?)';
                    db.query(phoneQuery, [userDeptId, local_phone || null], (err) => {
                        if (err) {
                            console.error("Failed to insert phone numbers:", err);
                            return db.rollback(() => {
                                res.status(500).json({ error: "Failed to insert phone numbers", details: err });
                            });
                        }

                        // 5. Update user roles (assuming one role per user for now, or updating the primary role)
                        // Wait, update-full doesn't receive role_id in req.body currently. Let's extract it if provided.
                        const role_id = req.body.role_id;
                        const updateRole = (callback) => {
                            if (role_id) {
                                db.query('DELETE FROM user_roles WHERE user_id = ?', [id], (err) => {
                                    if (err) return db.rollback(() => res.status(500).json({ error: "Failed to clear user roles", details: err }));
                                    db.query('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [id, role_id], (err) => {
                                        if (err) return db.rollback(() => res.status(500).json({ error: "Failed to insert user role", details: err }));
                                        callback();
                                    });
                                });
                            } else {
                                callback();
                            }
                        };

                        updateRole(() => {
                            const updateLineAssignment = () => {
                            // Check current active line
                            db.query('SELECT id, line_id FROM user_assigned_lines WHERE user_id = ? AND return_date IS NULL', [id], (err, currentLineRes) => {
                                if (err) {
                                    return db.rollback(() => res.status(500).json({ error: "Failed to check current line", details: err }));
                                }
                                
                                const currentAssigned = currentLineRes[0];
                                const newLineId = cell_phone ? Number(cell_phone) : null;
                                
                                // Step A: If there's an existing line and it's different from the new one, return it
                                const releaseOldLine = (callback) => {
                                    if (currentAssigned && currentAssigned.line_id !== newLineId) {
                                        db.query('UPDATE user_assigned_lines SET return_date = CURDATE() WHERE id = ?', [currentAssigned.id], (err) => {
                                            if (err) return db.rollback(() => res.status(500).json({ error: "Failed to release old line assignment", details: err }));
                                            
                                            db.query("UPDATE company_lines SET status = 'disponible' WHERE id = ?", [currentAssigned.line_id], (err) => {
                                                if (err) return db.rollback(() => res.status(500).json({ error: "Failed to update old line status", details: err }));
                                                callback();
                                            });
                                        });
                                    } else {
                                        callback();
                                    }
                                };
                                
                                // Step B: If there's a new line and it's different from the current one, assign it
                                const assignNewLine = (callback) => {
                                    if (newLineId && (!currentAssigned || currentAssigned.line_id !== newLineId)) {
                                        db.query('INSERT INTO user_assigned_lines (user_id, line_id, assigned_date) VALUES (?, ?, CURDATE())', [id, newLineId], (err) => {
                                            if (err) return db.rollback(() => res.status(500).json({ error: "Failed to assign new line", details: err }));
                                            
                                            db.query("UPDATE company_lines SET status = 'asignado' WHERE id = ?", [newLineId], (err) => {
                                                if (err) return db.rollback(() => res.status(500).json({ error: "Failed to update new line status", details: err }));
                                                callback();
                                            });
                                        });
                                    } else {
                                        callback();
                                    }
                                };
                                
                                releaseOldLine(() => {
                                    assignNewLine(() => {
                                        commitTx();
                                    });
                                });
                            });
                        };

                        const commitTx = () => {
                            db.commit((err) => {
                                if (err) {
                                    console.error("Failed to commit transaction:", err);
                                    return db.rollback(() => res.status(500).json({ error: "Failed to commit transaction", details: err }));
                                }
                                res.status(200).json({ success: true });
                            });
                        };
                        
                        updateLineAssignment();
                    });
                });
            });
        });
    });
});
});

//? endpoint ver las lista de las lineas de compañia disponibles
app.get('/contacts/company-lines/available', authenticateToken, (req, res) => {
    db.query("SELECT id, phone_number, operator FROM company_lines WHERE status = 'disponible' AND active_status = 'activa'", (err, results) => {
        if (err) return res.status(500).send(err);
        res.json(results);
    });
});

//? endpoint para obtener todas las líneas de compañía con usuario asignado (soporta paginación)
app.get('/company-lines', authenticateToken, (req, res) => {
    const { page, limit, operator, search } = req.query;

    const baseFrom = `
        FROM company_lines cl
        LEFT JOIN user_assigned_lines ual ON cl.id = ual.line_id AND ual.return_date IS NULL
        LEFT JOIN users u ON ual.user_id = u.id
    `;

    const whereClauses = [];
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

    const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // Si no se pide paginación, devolver el listado completo (compatibilidad)
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
        db.query(query, params, (err, results) => {
            if (err) return res.status(500).json({ error: 'Error al consultar líneas', details: err });
            res.json(results);
        });
        return;
    }

    // Modo paginado
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));
    const offset = (pageNum - 1) * limitNum;

    const countQuery = `SELECT COUNT(*) AS total ${baseFrom} ${whereSQL}`;

    db.query(countQuery, params, (countErr, countResults) => {
        if (countErr) return res.status(500).json({ error: 'Error al contar líneas', details: countErr });

        const total = countResults[0].total;
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

        db.query(dataQuery, [...params, limitNum, offset], (dataErr, rows) => {
            if (dataErr) return res.status(500).json({ error: 'Error al obtener líneas', details: dataErr });
            res.json({
                data: rows,
                total,
                page: pageNum,
                limit: limitNum,
                totalPages
            });
        });
    });
});

//? endpoint para crear una nueva línea (roles 1, 2, 3)
app.post('/company-lines/create-line', authenticateToken, requireRole([1, 2, 3]), (req, res) => {
    const { serial, phone_number, status, active_status, operator } = req.body;
    db.query(
        'INSERT INTO company_lines (serial, phone_number, status, active_status, operator) VALUES (?, ?, ?, ?, ?)',
        [serial, phone_number, status || 'disponible', active_status || 'activa', operator],
        (err, results) => {
            if (err) {
                if (err.code === 'ER_DUP_ENTRY') {
                    return res.status(409).json({ error: 'Ya existe una línea con ese serial o número telefónico' });
                }
                return res.status(500).json({ error: 'Error al crear la línea', details: err });
            }
            res.status(201).json({ success: true, insertId: results.insertId });
        }
    );
});

//? endpoint para actualizar/modificar una línea (roles 1, 2, 3)
app.put('/company-lines/:id', authenticateToken, requireRole([1, 2, 3]), (req, res) => {
    const id = Number(req.params.id);
    const { serial, phone_number, status, active_status, operator } = req.body;

    if (!id || !serial || !phone_number || !operator) {
        return res.status(400).json({ error: 'ID, serial, número y operador son requeridos' });
    }

    db.query(
        'UPDATE company_lines SET serial = ?, phone_number = ?, status = ?, active_status = ?, operator = ? WHERE id = ?',
        [serial.trim(), phone_number.trim(), status || 'disponible', active_status || 'activa', operator, id],
        (err, results) => {
            if (err) {
                if (err.code === 'ER_DUP_ENTRY') {
                    return res.status(409).json({ error: 'Ya existe una línea con ese serial o número telefónico' });
                }
                return res.status(500).json({ error: 'Error al actualizar la línea', details: err });
            }
            if (results.affectedRows === 0) {
                return res.status(404).json({ error: 'Línea corporativa no encontrada' });
            }
            res.json({ success: true, message: 'Línea corporativa actualizada con éxito' });
        }
    );
});

//? endpoint de login
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
    }

    db.query(`
        SELECT u.*, ur.role_id 
        FROM users u 
        LEFT JOIN user_roles ur ON u.id = ur.user_id 
        WHERE u.username = ?
    `, [username], (err, results) => {
        if (err) return res.status(500).json({ error: 'Error en la base de datos' });
        
        if (results.length === 0) {
            return res.status(401).json({ error: 'Usuario no encontrado' });
        }

        const user = results[0];

        if (!user.password) {
            return res.status(401).json({ error: 'Usuario no tiene contraseña configurada' });
        }

        const validPassword = bcrypt.compareSync(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Contraseña incorrecta' });
        }

        const token = jwt.sign(
            { id: user.id, username: user.username, role_id: user.role_id }, 
            JWT_SECRET, 
            { expiresIn: '8h' }
        );

        res.json({ success: true, token, user: { id: user.id, name: user.name, username: user.username, role_id: user.role_id } });
    });
});

app.listen(3000, () => {
    console.log('listening on port 3000');
});