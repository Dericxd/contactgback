const fs = require('fs');

const currentApp = fs.readFileSync('app.js', 'utf8');
const oldApp = fs.readFileSync('app_old.js', 'utf8');

const selectQueryTemplate = `
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
`;

const fromJoinsLeft = `
        LEFT JOIN phone_numbers p ON u.id = p.user_id
        LEFT JOIN user_departments ud ON u.id = ud.user_id
        LEFT JOIN departments d ON ud.department_id = d.id
        LEFT JOIN places pl ON d.place_id = pl.id
        LEFT JOIN user_assigned_lines ual ON u.id = ual.user_id AND ual.return_date IS NULL
        LEFT JOIN company_lines cl ON ual.line_id = cl.id
`;

const fromJoinsInner = `
        INNER JOIN phone_numbers p ON u.id = p.user_id 
        INNER JOIN user_departments ud ON u.id = ud.user_id 
        INNER JOIN departments d ON ud.department_id = d.id 
        INNER JOIN places pl ON d.place_id = pl.id  
        LEFT JOIN user_assigned_lines ual ON u.id = ual.user_id AND ual.return_date IS NULL
        LEFT JOIN company_lines cl ON ual.line_id = cl.id
`;

const extractBlock = (source, startRegex, endRegex) => {
    const match = source.match(new RegExp(startRegex + '[\\\\s\\\\S]*?' + endRegex));
    return match ? match[0] : '';
};

const topPart = oldApp.split('//? endpoint para obtener datos')[0];
const authMiddleware = extractBlock(currentApp, 'const authenticateToken', '};');

const createFull = extractBlock(currentApp, '//\\\\? endpoint para crear un contacto completo', '}\\);\\\\n\\}\\);\\\\n');
const updateFull = extractBlock(currentApp, '//\\\\? endpoint para actualizar un contacto completo', '}\\);\\\\n\\}\\);\\\\n');
const companyLines = extractBlock(currentApp, '//\\\\? endpoint ver las lista de las lineas de compañia', '\\}\\);\\\\n\\}\\);\\\\n');
const loginEndpoint = extractBlock(currentApp, '//\\\\? endpoint de login', '}\\);\\\\n\\}\\);\\\\n');

// Actually, extracting manually might be error-prone. Let's just generate the new endpoints exactly.
const createFullStr = currentApp.substring(currentApp.indexOf('//? endpoint para crear un contacto completo'), currentApp.indexOf('//? endpoint ver las lista de las lineas'));
const companyLinesStr = currentApp.substring(currentApp.indexOf('//? endpoint ver las lista de las lineas'), currentApp.indexOf('//? endpoint de login'));
const loginStr = currentApp.substring(currentApp.indexOf('//? endpoint de login'), currentApp.indexOf('app.listen('));
const authMiddlewareStr = currentApp.substring(currentApp.indexOf('const authenticateToken'), currentApp.indexOf('//? endpoint para obtener datos'));

let finalContent = topPart + authMiddlewareStr + \`

//? endpoint para obtener datos (con soporte de búsqueda por nombre y apellido)
app.get('/contacts/staff', (req, res) => {
    const query = req.query.query;
    const selectQuery = \\\`\${selectQueryTemplate}\${fromJoinsLeft}\\\`;

    if (query) {
        const likeQuery = \\\`%\\\${query}%\\\`;
        db.query(
            \\\`\\\${selectQuery} WHERE u.name LIKE ? OR u.last_name LIKE ? OR CONCAT(u.name, " ", u.last_name) LIKE ?\\\`,
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
    const selectQuery = \\\`\${selectQueryTemplate}\${fromJoinsLeft}\\\`;

    if (query) {
        const likeQuery = \\\`%\\\${query}%\\\`;
        db.query(
            \\\`\\\${selectQuery} WHERE u.name LIKE ? OR u.last_name LIKE ? OR CONCAT(u.name, " ", u.last_name) LIKE ?\\\`,
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

//? endpoint para obtener el lugar (incluye id y name)
app.get('/places', (req, res) => {
    db.query('SELECT id, name FROM places;', (err,results) => {
        if (err) return res.status(500).send(err);
        res.json(results);
    })
});

//? endpoint para buscar por lugar
app.get('/contacts/places/:name', (req, res) => {
    const { name } = req.params; 
    const query = \\\`\${selectQueryTemplate}\${fromJoinsInner} WHERE pl.name = ?\\\`;

    db.query(query, [name], (err, rows) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: "Error en la base de datos", details: err });
        }
        res.json(rows);
    });
});

\` + createFullStr + companyLinesStr + loginStr + \`
app.listen(3000, () => {
    console.log('listening on port 3000');
});
\`;

fs.writeFileSync('app_new.js', finalContent);
