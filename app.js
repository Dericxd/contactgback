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
    if (query) {
        const likeQuery = `%${query}%`;
        db.query(
            'SELECT * FROM users WHERE name LIKE ? OR last_name LIKE ? OR CONCAT(name, " ", last_name) LIKE ?',
            [likeQuery, likeQuery, likeQuery],
            (err, results) => {
                if (err) return res.status(500).send(err);
                res.json(results);
            }
        );
    } else {
        db.query('SELECT * FROM users', (err, results) => {
            if (err) return res.status(500).send(err);
            res.json(results);
        });
    }
});

//? endpoint buscar por nombre y apellido
app.get('/contacts/staff/search/:query', (req, res) => {
    const query = req.params.query;
    if (query) {
        const likeQuery = `%${query}%`;
        db.query(
            'SELECT * FROM users WHERE name LIKE ? OR last_name LIKE ? OR CONCAT(name, " ", last_name) LIKE ?',
            [likeQuery, likeQuery, likeQuery],
            (err, results) => {
                if (err) return res.status(500).send(err);
                res.json(results);
            }
        );
    } else {
        db.query('SELECT * FROM users', (err, results) => {
            if (err) return res.status(500).send(err);
            res.json(results);
        });
    }
});

//? endpoint para crear un usuario (soporta /contacts/create y /contacts/staff)
app.post(['/contacts/create', '/contacts/staff'], (req, res) => {
    const {name, last_name, ci, date_in } = req.body;
    db.query('INSERT INTO users (name, last_name, ci, date_in) VALUES (?,?,?,?)', [name, last_name, ci, date_in], (err, results) => {
        if (err) return res.status(500).send(err);
        res.json(results);
    });
});

//? endpoint para actualizar un usuario (soporta /contacts/update/:id y /contacts/staff/:id)
app.put(['/contacts/update/:id', '/contacts/staff/:id'], (req, res) => {
    const id = req.params.id;
    const {name, last_name, ci, date_in } = req.body;
    db.query('UPDATE users SET name = ?, last_name = ?, ci = ?, date_in = ? WHERE id = ?', [name,last_name,ci,date_in, id], (err, results) => {
        if (err) return res.status(500).send(err);
        res.json(results);
    });
});

//? endpoint para eliminar un usuario (soporta /contacts/delete/:id y /contacts/staff/:id)
app.delete(['/contacts/delete/:id', '/contacts/staff/:id'], (req, res) => {
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

//? endpoint para obtener el lugar
app.get('/places', (req, res) => {
    db.query('SELECT name FROM places;', (err,results) => {
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
            u.ci,
            u.date_in,
            p.local_phone AS telefono_local,
            p.ext AS extension,
            d.name AS departamento,
            pl.name AS lugar 
        FROM users u 
        INNER JOIN phone_numbers p ON u.id = p.user_id 
        INNER JOIN user_departments ud ON u.id = ud.user_id 
        INNER JOIN departments d ON ud.department_id = d.id 
        INNER JOIN places pl ON d.place_id = pl.id  
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

app.listen(3000, () => {
    console.log('listening on port 3000');
});