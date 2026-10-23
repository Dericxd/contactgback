const fs = require('fs');
const file = 'app.js';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(/LEFT JOIN phone_numbers p ON u\.id = p\.user_id\s*LEFT JOIN user_departments ud ON u\.id = ud\.user_id/g, 
  'LEFT JOIN user_departments ud ON u.id = ud.user_id\n          LEFT JOIN phone_numbers p ON ud.id = p.user_department_id');

content = content.replace(/INNER JOIN phone_numbers p ON u\.id = p\.user_id\s*INNER JOIN user_departments ud ON u\.id = ud\.user_id/g, 
  'INNER JOIN user_departments ud ON u.id = ud.user_id\n          INNER JOIN phone_numbers p ON ud.id = p.user_department_id');

fs.writeFileSync(file, content);
console.log('Fixed joins!');
