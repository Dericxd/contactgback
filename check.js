const mysql = require('mysql2');
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'qweasdzxc0*',
    database: 'newcontacts'
});
db.query("SELECT u.id, u.username, ur.role_id FROM users u LEFT JOIN user_roles ur ON u.id = ur.user_id", (err, results) => {
    console.log(results);
    db.end();
});
