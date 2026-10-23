const fs = require('fs');
let content = fs.readFileSync('app.js', 'utf8');

// The field list to replace
const oldSelect = `
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
        LEFT JOIN user_departments ud ON u.id = ud.user_id
`;

const newSelect = `
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
`;

// There are three queries with minor variations in spaces, so we'll use a regex for the SELECT block
const regex1 = /SELECT[\s\S]*?FROM users u\s+LEFT JOIN user_departments ud ON u\.id = ud\.user_id/g;

content = content.replace(regex1, newSelect.trim());

// For the third query (places), it uses INNER JOIN instead of LEFT JOIN!
const regex2 = /SELECT[\s\S]*?FROM users u\s+INNER JOIN user_departments ud ON u\.id = ud\.user_id/g;
const newSelect2 = `SELECT 
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
        INNER JOIN user_departments ud ON u.id = ud.user_id`;

content = content.replace(regex2, newSelect2);

fs.writeFileSync('app.js', content, 'utf8');
console.log('Replaced');
