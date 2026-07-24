// routes/generalRoutes.js
const express = require('express');
const path = require('path');
const router = express.Router();
const { verificarReloj } = require('../services/vigilante');

const APP_VERSION = 'v32';

router.get('/version', (req, res) => {
    res.json({ version: APP_VERSION, buildDate: '2026-07-19', forceUpdate: true });
});

router.get('/cron', async (req, res) => {
    try {
        await verificarReloj();
        res.status(200).send('Cron ejecutado correctamente');
    } catch (error) {
        console.error('[Cron Error]', error);
        res.status(500).send('Error en cron');
    }
});

module.exports = router;
