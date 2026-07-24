// routes/proRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const pro = require('../controllers/proController');

router.post('/scan-prescription', authMiddleware, pro.scanPrescription);
router.get('/historial', authMiddleware, pro.getHistorial);
router.post('/parse-meds', authMiddleware, pro.parseMeds);
router.post('/prescribir', authMiddleware, pro.prescribir);
router.post('/cancelar', authMiddleware, pro.cancelar);

module.exports = router;
