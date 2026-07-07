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
    password: '',
    database: 'contactgenia'
});

//? endpoint para obtener datos
app.get('/contacts/staff', (req, res) => {
    db.query('SELECT * FROM users', (err, results) => {
        if (err) return res.status(500).send(err);
        res.json(results);
    });
});

//? endpoint para crear un usuario
app.post('/contacts/create', (req, res) => {
    const {name, last_name, card, ci, ceco, date_in } = req.body;
    db.query('INSERT INTO users (name, last_name, card, ci, ceco, date_in) VALUES (?,?,?,?,?)', (err, results) => {
        if (err) return res.status(err);
        res.json(results);
    });
});

app.put('/contacts/update/:id', (req, res) => {
    const id = req.params.id;
    const {name, last_name, card, ci, ceco, date_in } = req.body;
    db.query('UPDATE users SET name = ?, last_name = ?, card = ?, ci = ?, ceco = ?, date_in = ? WHERE id = ?', [name,last_name,card,ci,ceco,date_in, id], (err, results) => {
        if (err) return res.json(err);
        res.json(result);
    });
});

app.delete('/contacts/delete/:id', (req, res) => {
    const { id } = req.params;
    db.query('DELETE FROM users WHERE id = ?', [id], (err, results) => {
        if (err) return res.json(err);
        res.json(results);
    });
});

app.listen(3000, () => {
    console.log('listening on port 3000');
});