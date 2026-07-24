// routes/webhookRoutes.js
const express = require('express');
const router = express.Router();
const webhook = require('../controllers/webhookController');

router.get('/meta-webhook', webhook.verify);
router.get('/test-meds', webhook.testMeds);
router.post('/meta-webhook', webhook.receive);

module.exports = router;
