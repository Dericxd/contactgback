const express = require('express')
const mysql = require('mysql2');
const cors = require('cors');
const port = 3000;

const app = express();
app.use(cors());
app.use(express.json());

const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'qweasdzxc0*',
    database: 'newcontacts'
});

//? endpoint para obtener datos (con soporte de búsqueda por nombre y apellido)
app.get('/contacts/staff', (req, res) => {
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
            pl.name AS lugar
        FROM users u
        LEFT JOIN phone_numbers p ON u.id = p.user_id
        LEFT JOIN user_departments ud ON u.id = ud.user_id
        LEFT JOIN departments d ON ud.department_id = d.id
        LEFT JOIN places pl ON d.place_id = pl.id
        LEFT JOIN user_assigned_lines ual ON u.id = ual.user_id AND ual.return_date IS NULL
        LEFT JOIN company_lines cl ON ual.line_id = cl.id
    `;

    if (query) {
        const likeQuery = `%${query}%`;
        db.query(
            `${selectQuery} WHERE u.name LIKE ? OR u.last_name LIKE ? OR CONCAT(u.name, " ", u.last_name) LIKE ?`,
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
app.get('/contacts/staff/search/:query', (req, res) => {
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
            pl.name AS lugar
        FROM users u
        LEFT JOIN phone_numbers p ON u.id = p.user_id
        LEFT JOIN user_departments ud ON u.id = ud.user_id
        LEFT JOIN departments d ON ud.department_id = d.id
        LEFT JOIN places pl ON d.place_id = pl.id
        LEFT JOIN user_assigned_lines ual ON u.id = ual.user_id AND ual.return_date IS NULL
        LEFT JOIN company_lines cl ON ual.line_id = cl.id
    `;

    if (query) {
        const likeQuery = `%${query}%`;
        db.query(
            `${selectQuery} WHERE u.name LIKE ? OR u.last_name LIKE ? OR CONCAT(u.name, " ", u.last_name) LIKE ?`,
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
app.post(['/contacts/create', '/contacts/staff'], (req, res) => {
    const {name, last_name, document_type, document_number, email, username, password, date_in, status } = req.body;
    db.query('INSERT INTO users (name, last_name, document_type, document_number, email, username, password, date_in, status) VALUES (?,?,?,?,?,?,?,?,?)', [name, last_name, document_type, document_number, email, username, password, date_in, status], (err, results) => {
        if (err) return res.status(500).send(err);
        res.json(results);
    });
});

//? endpoint para actualizar un usuario (soporta /contacts/update/:id y /contacts/staff/:id)
app.put(['/contacts/update/:id', '/contacts/staff/:id'], (req, res) => {
    const id = req.params.id;
    const {name, last_name, document_type, document_number, email, username, password, date_in, status } = req.body;
    db.query('UPDATE users SET name = ?, last_name = ?, document_type = ?, document_number = ?, email = ?, username = ?, password = ?, date_in = ?, status = ? WHERE id = ?', [name,last_name,document_type,document_number,email,username,password,date_in,status, id], (err, results) => {
        if (err) return res.status(500).send(err);
        res.json(results);
    });
});

//? endpoint para eliminar un usuario (soporta /contacts/delete/:id, /contacts/staff/:id y /contacts/:id)
app.delete(['/contacts/delete/:id', '/contacts/staff/:id', '/contacts/:id'], (req, res) => {
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

//? endpoint para obtener el lugar (incluye id y name)
app.get('/places', (req, res) => {
    db.query('SELECT id, name FROM places;', (err,results) => {
        if (err) return res.status(500).send(err);
        res.json(results);
    })
});

//? endpoint para buscar por lugar
/* app.get('/contacts/places/:name',(req,results) => {
    db.query("SELECT u.name AS usuario_nombre, u.last_name AS usuario_apellido,p.local_phone AS telefono_local,p.ext AS extension,d.name AS departamento,pl.name AS lugar FROM users u INNER JOIN phone_numbers p ON u.id = p.user_id INNER JOIN user_departments ud ON u.id = ud.user_id INNER JOIN departments d ON ud.department_id = d.id INNER JOIN places pl ON d.place_id = pl.id  WHERE pl.name = ?", [name],(err, results)=> {
        if (err) return res.status(500).send(err);
        res.json(results);
    })
}) */
app.get('/contacts/places/:name', (req, res) => {
    // 1. Extraer la variable 'name' desde los parámetros de la URL
    const { name } = req.params; 

    const query = `
        SELECT 
            u.id,
            u.name,
            u.name AS usuario_nombre,
            u.last_name,
            u.last_name AS usuario_apellido,
            u.document_type,
            u.document_number,
            CONCAT(u.document_type, u.document_number) AS ci,
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
            pl.name AS lugar 
        FROM users u 
        INNER JOIN phone_numbers p ON u.id = p.user_id 
        INNER JOIN user_departments ud ON u.id = ud.user_id 
        INNER JOIN departments d ON ud.department_id = d.id 
        INNER JOIN places pl ON d.place_id = pl.id  
        LEFT JOIN user_assigned_lines ual ON u.id = ual.user_id AND ual.return_date IS NULL
        LEFT JOIN company_lines cl ON ual.line_id = cl.id
        WHERE pl.name = ?
    `;

    // 2. Usar la variable 'name' y cambiar el nombre del segundo parámetro del callback a 'rows' o 'data'
    db.query(query, [name], (err, rows) => {
        if (err) {
            console.error(err); // Es buena práctica imprimir el error en consola para debugging
            return res.status(500).json({ error: "Error en la base de datos", details: err });
        }
        res.json(rows);
    });
});

//? endpoint para crear un contacto completo (users, phone_numbers, user_departments)
app.post('/contacts/create-full', (req, res) => {
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
        position
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

        // 1. Insert into users
        const userQuery = 'INSERT INTO users (name, last_name, document_type, document_number, date_in) VALUES (?, ?, ?, ?, ?)';
        db.query(userQuery, [name, last_name, doc_type, doc_number || null, date_in || null], (err, userResult) => {
            if (err) {
                console.error("Failed to insert user:", err);
                return db.rollback(() => {
                    res.status(500).json({ error: "Failed to insert user", details: err });
                });
            }

            const userId = userResult.insertId;

            // 2. Insert into phone_numbers
            const phoneQuery = 'INSERT INTO phone_numbers (user_id, local_phone) VALUES (?, ?)';
            db.query(phoneQuery, [userId, local_phone || null], (err) => {
                if (err) {
                    console.error("Failed to insert phone numbers:", err);
                    return db.rollback(() => {
                        res.status(500).json({ error: "Failed to insert phone numbers", details: err });
                    });
                }

                // 3. Insert into user_departments
                const deptQuery = 'INSERT INTO user_departments (user_id, department_id, position) VALUES (?, ?, ?)';
                db.query(deptQuery, [userId, department_id || null, position || ''], (err) => {
                    if (err) {
                        console.error("Failed to insert user department:", err);
                        return db.rollback(() => {
                            res.status(500).json({ error: "Failed to insert user department", details: err });
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

//? endpoint para actualizar un contacto completo (users, phone_numbers, user_departments)
app.put('/contacts/update-full/:id', (req, res) => {
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
        position
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
        const userQuery = 'UPDATE users SET name = ?, last_name = ?, document_type = ?, document_number = ?, date_in = ? WHERE id = ?';
        db.query(userQuery, [name, last_name, doc_type, doc_number || null, date_in || null, id], (err) => {
            if (err) {
                console.error("Failed to update user:", err);
                return db.rollback(() => {
                    res.status(500).json({ error: "Failed to update user", details: err });
                });
            }

            // 2. Update phone_numbers table
            const phoneQuery = `
                INSERT INTO phone_numbers (user_id, local_phone) 
                VALUES (?, ?)
                ON DUPLICATE KEY UPDATE 
                    local_phone = VALUES(local_phone)
            `;
            db.query(phoneQuery, [id, local_phone || null], (err) => {
                if (err) {
                    console.error("Failed to update phone numbers:", err);
                    return db.rollback(() => {
                        res.status(500).json({ error: "Failed to update phone numbers", details: err });
                    });
                }

                // 3. Update user_departments table
                const deleteDeptQuery = 'DELETE FROM user_departments WHERE user_id = ?';
                db.query(deleteDeptQuery, [id], (err) => {
                    if (err) {
                        console.error("Failed to clear user departments:", err);
                        return db.rollback(() => {
                            res.status(500).json({ error: "Failed to clear user departments", details: err });
                        });
                    }

                    const insertDeptQuery = 'INSERT INTO user_departments (user_id, department_id, position) VALUES (?, ?, ?)';
                    db.query(insertDeptQuery, [id, department_id || null, position || ''], (err) => {
                        if (err) {
                            console.error("Failed to insert user department:", err);
                            return db.rollback(() => {
                                res.status(500).json({ error: "Failed to insert user department", details: err });
                            });
                        }

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

//? endpoint ver las lista de las lineas de compañia disponibles
app.get('/contacts/company-lines/available', (req, res) => {
    db.query("SELECT id, phone_number, operator FROM company_lines WHERE status = 'disponible' AND active_status = 'activa'", (err, results) => {
        if (err) return res.status(500).send(err);
        res.json(results);
    });
});

app.listen(3000, () => {
    console.log('listening on port 3000');
});