// routes/grupoRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const grupo = require('../controllers/grupoController');

// Grupos
router.get('/mis-grupos', authMiddleware, grupo.misGrupos);
router.post('/grupos', authMiddleware, grupo.crearGrupo);
router.get('/grupos/:grupoId', authMiddleware, grupo.obtenerGrupo);

// Pacientes
router.get('/grupos/:grupoId/pacientes', authMiddleware, grupo.listarPacientes);
router.post('/grupos/:grupoId/pacientes', authMiddleware, grupo.crearPaciente);
router.put('/grupos/:grupoId/pacientes/:pacienteId', authMiddleware, grupo.actualizarPaciente);
router.delete('/grupos/:grupoId/pacientes/:pacienteId', authMiddleware, grupo.eliminarPaciente);

// Roles
router.get('/roles', grupo.getRoles);

// Miembros
router.get('/grupos/:grupoId/miembros', authMiddleware, grupo.listarMiembros);
router.delete('/grupos/:grupoId/miembros/:uid', authMiddleware, grupo.eliminarMiembro);
router.put('/grupos/:grupoId/miembros/:uid/rol', authMiddleware, grupo.cambiarRol);

// Invitaciones
router.post('/grupos/:grupoId/invitar', authMiddleware, grupo.invitar);
router.get('/unirse/:codigo', authMiddleware, grupo.unirse);

// Medicamentos
router.get('/grupos/:grupoId/medicamentos', authMiddleware, grupo.listarMedicamentos);
router.post('/grupos/:grupoId/medicamentos', authMiddleware, grupo.crearMedicamento);
router.post('/grupos/:grupoId/marcar-toma', authMiddleware, grupo.marcarToma);
router.post('/grupos/:grupoId/medicamentos/:medId/reabastecer', authMiddleware, grupo.reabastecerMedicamento);
router.put('/grupos/:grupoId/medicamentos/:medId', authMiddleware, grupo.actualizarMedicamento);
router.delete('/grupos/:grupoId/medicamentos/:medId', authMiddleware, grupo.eliminarMedicamento);

// Historial
router.get('/grupos/:grupoId/historial', authMiddleware, grupo.listarHistorial);

// Biblioteca
router.get('/grupos/:grupoId/biblioteca', authMiddleware, grupo.listarBiblioteca);
router.post('/grupos/:grupoId/biblioteca', authMiddleware, grupo.crearBiblioteca);
router.delete('/grupos/:grupoId/biblioteca/:id', authMiddleware, grupo.eliminarBiblioteca);

// Config
router.get('/grupos/:grupoId/config', authMiddleware, grupo.getConfig);
router.put('/grupos/:grupoId/config', authMiddleware, grupo.updateConfig);

// Export ICS
router.get('/grupos/:grupoId/export/ics', authMiddleware, grupo.exportICS);

// Seed
router.get('/seed', authMiddleware, grupo.seed);

module.exports = router;
