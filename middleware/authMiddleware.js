// middleware/authMiddleware.js - Verificación de tokens JWT Firebase
const { adminAuth } = require('../services/firebase');

async function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided' });
    }
    const token = authHeader.split('Bearer ')[1];
    try {
        const decoded = await adminAuth.verifyIdToken(token);
        req.user = {
            uid: decoded.uid,
            email: decoded.email,
            nombre: decoded.name || 'Usuario',
            foto: decoded.picture || ''
        };
        next();
    } catch (error) {
        console.error('Error verificando token:', error);
        return res.status(401).json({ error: 'Invalid token' });
    }
}

module.exports = authMiddleware;
