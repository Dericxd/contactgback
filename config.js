/**
 * Configuración centralizada: carga variables desde .env y valida las críticas.
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const required = ['DB_HOST', 'DB_USER', 'DB_NAME', 'JWT_SECRET'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
    throw new Error(`Faltan variables de entorno requeridas: ${missing.join(', ')} (ver .env.example)`);
}
if (process.env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET debe tener al menos 32 caracteres');
}

module.exports = {
    port: Number(process.env.PORT) || 3000,
    corsOrigins: (process.env.CORS_ORIGIN || 'http://localhost:4200')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    db: {
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME,
    },
    jwtSecret: process.env.JWT_SECRET,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
};
