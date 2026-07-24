// ==========================================
// MEDICLOCK - BACKEND MODULAR (Entry Point)
// ==========================================

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares (límite ampliado a 50mb para fotografías en alta resolución de recetas)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Importar rutas modulares
const proRoutes = require('./routes/proRoutes');
const grupoRoutes = require('./routes/grupoRoutes');
const webhookRoutes = require('./routes/webhookRoutes');
const generalRoutes = require('./routes/generalRoutes');

// Montar rutas
app.use('/api/pro', proRoutes);
app.use('/api', grupoRoutes);
app.use('/api', webhookRoutes);
app.use('/api', generalRoutes);

// Ruta de invitación (SPA)
app.get('/unirse/:codigo', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Arrancar el servidor
app.listen(PORT, () => {
    console.log(`=========================================`);
    console.log(`🚀 MediClock en marcha! Puerto: ${PORT}`);
    console.log(`=========================================`);
});
