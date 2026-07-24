// controllers/grupoController.js - Lógica de Grupos Familiares, Pacientes, Miembros, Invitaciones, Medicamentos, Historial, Biblioteca, Config, Export
const path = require('path');
const { db } = require('../services/firebase');
const { enviarWA } = require('../services/whatsapp');

// ===========================================
// HELPERS DE GRUPOS
// ===========================================

function grupoRef(grupoId) {
    return db.collection('grupos').doc(grupoId);
}

async function getMiembro(grupoId, uid) {
    const doc = await grupoRef(grupoId).collection('miembros').doc(uid).get();
    return doc.exists ? doc.data() : null;
}

async function esAdmin(grupoId, uid) {
    const m = await getMiembro(grupoId, uid);
    return m?.rol === 'admin';
}

async function verificarAcceso(grupoId, uid, res) {
    const miembro = await getMiembro(grupoId, uid);
    if (!miembro) {
        res.status(403).json({ error: 'Sin acceso a este grupo' });
        return null;
    }
    return miembro;
}

// ===========================================
// DEFINICIÓN DE ROLES
// ===========================================
const ROLES_SISTEMA = {
    admin: { id: 'admin', nombre: 'Administradores', icono: '\u{1F451}', color: '#10b981', descripcion: 'Control total del grupo familiar, notificaciones y ajustes' },
    paciente: { id: 'paciente', nombre: 'Pacientes', icono: '\u{1FA7A}', color: '#3b82f6', descripcion: 'Personas que reciben y toman los medicamentos' },
    asistente: { id: 'asistente', nombre: 'Asistentes', icono: '\u{1F91D}', color: '#f59e0b', descripcion: 'Cuidadores y enfermeros que ayudan en la administración' },
    medico: { id: 'medico', nombre: 'Médicos', icono: '\u{1F468}\u200D\u2695\uFE0F', color: '#8b5cf6', descripcion: 'Profesionales de la salud que ajustan recetas y frecuencias' },
    miembro: { id: 'miembro', nombre: 'Miembros', icono: '\u{1F464}', color: '#6b7280', descripcion: 'Familiares e integrantes del grupo' }
};

// ===========================================
// GRUPOS
// ===========================================

async function misGrupos(req, res) {
    const snap = await db.collection('grupos').get();
    const misGrupos = [];
    for (const doc of snap.docs) {
        const miembro = await doc.ref.collection('miembros').doc(req.user.uid).get();
        if (miembro.exists) {
            const miembrosSnap = await doc.ref.collection('miembros').get();
            misGrupos.push({
                id: doc.id,
                ...doc.data(),
                miembros: miembrosSnap.size,
                miRol: miembro.data().rol
            });
        }
    }
    res.json(misGrupos);
}

async function crearGrupo(req, res) {
    const { nombre } = req.body;
    if (!nombre?.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });

    const grupoData = {
        nombre: nombre.trim(),
        creadoPor: req.user.uid,
        creadoEn: new Date().toISOString()
    };
    const ref = await db.collection('grupos').add(grupoData);

    await ref.collection('miembros').doc(req.user.uid).set({
        uid: req.user.uid,
        email: req.user.email,
        nombre: req.user.nombre,
        foto: req.user.foto,
        rol: 'admin',
        unidoEn: new Date().toISOString()
    });

    const viejosSnap = await db.collection('medicamentos').get();
    if (!viejosSnap.empty) {
        const batch = db.batch();
        viejosSnap.docs.forEach(d => {
            batch.set(ref.collection('medicamentos').doc(d.id), d.data());
            batch.delete(d.ref);
        });
        await batch.commit();
        console.log(`[Migración] ${viejosSnap.size} medicamentos migrados al grupo ${ref.id}`);
    }

    res.status(201).json({ id: ref.id, ...grupoData, miRol: 'admin' });
}

async function obtenerGrupo(req, res) {
    const { grupoId } = req.params;
    const miembro = await verificarAcceso(grupoId, req.user.uid, res);
    if (!miembro) return;
    const doc = await grupoRef(grupoId).get();
    if (!doc.exists) return res.status(404).json({ error: 'Grupo no encontrado' });
    res.json({ id: doc.id, ...doc.data(), miRol: miembro.rol });
}

// ===========================================
// PACIENTES
// ===========================================

async function listarPacientes(req, res) {
    const { grupoId } = req.params;
    if (!await verificarAcceso(grupoId, req.user.uid, res)) return;
    const snap = await grupoRef(grupoId).collection('pacientes').get();
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
}

async function crearPaciente(req, res) {
    const { grupoId } = req.params;
    if (!await verificarAcceso(grupoId, req.user.uid, res)) return;
    const ref = await grupoRef(grupoId).collection('pacientes').add({ ...req.body, creadoEn: new Date().toISOString() });
    res.status(201).json({ id: ref.id, ...req.body });
}

async function actualizarPaciente(req, res) {
    const { grupoId, pacienteId } = req.params;
    if (!await verificarAcceso(grupoId, req.user.uid, res)) return;
    await grupoRef(grupoId).collection('pacientes').doc(pacienteId).update(req.body);
    res.json({ success: true });
}

async function eliminarPaciente(req, res) {
    const { grupoId, pacienteId } = req.params;
    if (!await esAdmin(grupoId, req.user.uid)) return res.status(403).json({ error: 'Solo admin puede eliminar pacientes' });
    await grupoRef(grupoId).collection('pacientes').doc(pacienteId).delete();
    res.json({ success: true });
}

// ===========================================
// ROLES
// ===========================================

function getRoles(req, res) {
    res.json(ROLES_SISTEMA);
}

// ===========================================
// MIEMBROS
// ===========================================

async function listarMiembros(req, res) {
    const { grupoId } = req.params;
    const { rol } = req.query;
    if (!await verificarAcceso(grupoId, req.user.uid, res)) return;
    
    let query = grupoRef(grupoId).collection('miembros');
    if (rol && ROLES_SISTEMA[rol]) {
        query = query.where('rol', '==', rol);
    }
    const snap = await query.get();
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
}

async function eliminarMiembro(req, res) {
    const { grupoId, uid } = req.params;
    if (!await esAdmin(grupoId, req.user.uid)) {
        return res.status(403).json({ error: 'Solo el admin puede eliminar miembros' });
    }
    if (uid === req.user.uid) return res.status(400).json({ error: 'No puedes eliminarte a ti mismo' });
    await grupoRef(grupoId).collection('miembros').doc(uid).delete();
    res.json({ success: true });
}

async function cambiarRol(req, res) {
    const { grupoId, uid } = req.params;
    const { rol } = req.body;
    if (!await esAdmin(grupoId, req.user.uid)) return res.status(403).json({ error: 'Solo el admin puede cambiar roles' });
    if (!Object.keys(ROLES_SISTEMA).includes(rol)) return res.status(400).json({ error: 'Rol inválido. Roles válidos: admin, paciente, asistente, medico, miembro' });
    await grupoRef(grupoId).collection('miembros').doc(uid).update({ rol });
    res.json({ success: true, rol, rolInfo: ROLES_SISTEMA[rol] });
}

// ===========================================
// INVITACIONES
// ===========================================

async function invitar(req, res) {
    const { grupoId } = req.params;
    const { rol = 'miembro', pacienteId = null } = req.body || {};

    if (!await esAdmin(grupoId, req.user.uid)) {
        return res.status(403).json({ error: 'Solo el admin puede invitar' });
    }
    const grupoDoc = await grupoRef(grupoId).get();
    if (!grupoDoc.exists) return res.status(404).json({ error: 'Grupo no encontrado' });

    const codigo = Math.random().toString(36).substring(2, 10).toUpperCase();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    await db.collection('invitaciones').doc(codigo).set({
        grupoId,
        grupoNombre: grupoDoc.data().nombre,
        invitadoPor: req.user.uid,
        invitadoPorNombre: req.user.nombre,
        creadoEn: new Date().toISOString(),
        expiresAt,
        estado: 'pendiente',
        rol: rol,
        pacienteId: pacienteId
    });

    const baseUrl = req.headers.origin || `https://mediclock-961339509446.us-central1.run.app`;
    res.json({ codigo, link: `${baseUrl}/unirse/${codigo}`, expiresAt });
}

async function unirse(req, res) {
    const invDoc = await db.collection('invitaciones').doc(req.params.codigo).get();
    if (!invDoc.exists) return res.status(404).json({ error: 'Invitación no válida' });

    const inv = invDoc.data();
    if (inv.estado !== 'pendiente') return res.status(400).json({ error: 'Esta invitación ya fue usada' });
    if (new Date(inv.expiresAt) < new Date()) return res.status(400).json({ error: 'Esta invitación expiró' });

    await grupoRef(inv.grupoId).collection('miembros').doc(req.user.uid).set({
        uid: req.user.uid,
        email: req.user.email,
        nombre: req.user.nombre,
        foto: req.user.foto,
        rol: inv.rol || 'miembro',
        pacienteId: inv.pacienteId || null,
        unidoEn: new Date().toISOString()
    });

    await invDoc.ref.update({ estado: 'aceptada', aceptadoPor: req.user.uid });
    res.json({ success: true, grupoId: inv.grupoId, grupoNombre: inv.grupoNombre });
}

// ===========================================
// MEDICAMENTOS
// ===========================================

async function listarMedicamentos(req, res) {
    const { grupoId } = req.params;
    if (!await verificarAcceso(grupoId, req.user.uid, res)) return;
    const snap = await grupoRef(grupoId).collection('medicamentos').get();
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
}

async function crearMedicamento(req, res) {
    const { grupoId } = req.params;
    if (!await verificarAcceso(grupoId, req.user.uid, res)) return;
    
    const pastillasRestantes = req.body.pastillasRestantes !== undefined && req.body.pastillasRestantes !== null 
        ? req.body.pastillasRestantes 
        : (req.body.pastillasPorCaja || null);

    const nuevo = { 
        ...req.body, 
        estado: 'pendiente', 
        creadoEn: new Date().toISOString(), 
        creadoPor: req.user.uid,
        pastillasRestantes: pastillasRestantes,
        tomas: {}
    };
    const ref = await grupoRef(grupoId).collection('medicamentos').add(nuevo);
    res.status(201).json({ id: ref.id, ...nuevo });
}

async function marcarToma(req, res) {
    const { grupoId } = req.params;
    const { medicamentoId, fecha, hora, estado, tomadoPor } = req.body;
    if (!await verificarAcceso(grupoId, req.user.uid, res)) return;

    try {
        const medRef = grupoRef(grupoId).collection('medicamentos').doc(medicamentoId);
        const med = await medRef.get();
        
        if (!med.exists) {
            return res.status(404).json({ error: 'Medicamento no encontrado' });
        }

        const medData = med.data();
        
        const registro = {
            medicamentoId,
            nombre: medData.nombre,
            familiar: medData.familiar || 'Desconocido',
            fecha,
            hora,
            estado,
            tomadoPor: tomadoPor || req.user.nombre,
            timestamp: new Date().toISOString()
        };
        await grupoRef(grupoId).collection('historial').add(registro);

        const key = `${fecha}_${hora}`;
        const updateData = {};
        updateData[`tomas.${key}`] = {
            estado,
            tomadoPor: tomadoPor || req.user.nombre,
            timestamp: new Date().toISOString()
        };

        if (estado === 'tomada' && medData.pastillasRestantes != null) {
            let restantes = medData.pastillasRestantes - 1;
            if (restantes < 0) restantes = 0;
            updateData.pastillasRestantes = restantes;

            const umbral = medData.alertaStockMinimo !== undefined && medData.alertaStockMinimo !== null 
                ? parseInt(medData.alertaStockMinimo) 
                : 5;
                
            if (restantes <= umbral) {
                const cfgDoc = await grupoRef(grupoId).collection('config').doc('principal').get();
                const cfg = cfgDoc.exists ? cfgDoc.data() : {};
                const ADMIN = cfg.adminPhone || '';
                if (ADMIN) {
                    const alerta = `\u{26A0}\u{FE0F} *ALERTA MediClock: Stock Bajo* \u{26A0}\u{FE0F}\n\nQuedan pocas unidades de *${medData.nombre}* para *${medData.familiar}*.\n\nStock actual: *${restantes}* pastillas.\n\u{00A1}Por favor, reabastece el medicamento pronto!`;
                    await enviarWA(ADMIN, 'Admin', alerta);

                    const guardias = cfg.guardiasActivas || [];
                    for (const g of guardias) {
                        if (new Date(g.expiresAt) > new Date() && g.telefono) {
                            await enviarWA(g.telefono, 'Guardia', alerta);
                        }
                    }
                }
            }
        }

        await medRef.update(updateData);
        res.json({ success: true });
    } catch (error) {
        console.error('Error marcando toma:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
}

async function reabastecerMedicamento(req, res) {
    const { grupoId, medId } = req.params;
    const { cantidad } = req.body;
    if (!await verificarAcceso(grupoId, req.user.uid, res)) return;

    if (cantidad === undefined || cantidad === null || isNaN(cantidad) || cantidad <= 0) {
        return res.status(400).json({ error: 'Cantidad inválida para reabastecer' });
    }

    try {
        const medRef = grupoRef(grupoId).collection('medicamentos').doc(medId);
        const med = await medRef.get();
        if (!med.exists) {
            return res.status(404).json({ error: 'Medicamento no encontrado' });
        }

        const medData = med.data();
        let actuales = medData.pastillasRestantes != null ? medData.pastillasRestantes : 0;
        let nuevasRestantes = actuales + parseInt(cantidad, 10);

        await medRef.update({ pastillasRestantes: nuevasRestantes });

        await grupoRef(grupoId).collection('historial').add({
            medicamentoId: medId,
            nombre: medData.nombre,
            familiar: medData.familiar || 'Desconocido',
            estado: 'reabastecido',
            tomadoPor: req.user.nombre,
            timestamp: new Date().toISOString(),
            detalle: `Reabasteció ${cantidad} pastillas (Stock total: ${nuevasRestantes})`
        });

        res.json({ success: true, pastillasRestantes: nuevasRestantes });
    } catch (error) {
        console.error('Error reabasteciendo medicamento:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
}

async function actualizarMedicamento(req, res) {
    const { grupoId, medId } = req.params;
    if (!await verificarAcceso(grupoId, req.user.uid, res)) return;
    await grupoRef(grupoId).collection('medicamentos').doc(medId).update(req.body);
    res.json({ success: true });
}

async function eliminarMedicamento(req, res) {
    const { grupoId, medId } = req.params;
    if (!await verificarAcceso(grupoId, req.user.uid, res)) return;
    await grupoRef(grupoId).collection('medicamentos').doc(medId).delete();
    res.json({ success: true });
}

// ===========================================
// HISTORIAL
// ===========================================

async function listarHistorial(req, res) {
    const { grupoId } = req.params;
    if (!await verificarAcceso(grupoId, req.user.uid, res)) return;
    const snap = await grupoRef(grupoId).collection('historial').get();
    const lista = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    lista.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    res.json(lista.slice(0, 200));
}

// ===========================================
// BIBLIOTECA
// ===========================================

async function listarBiblioteca(req, res) {
    const { grupoId } = req.params;
    if (!await verificarAcceso(grupoId, req.user.uid, res)) return;
    const snap = await grupoRef(grupoId).collection('biblioteca').get();
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
}

async function crearBiblioteca(req, res) {
    const { grupoId } = req.params;
    if (!await verificarAcceso(grupoId, req.user.uid, res)) return;
    const ref = await grupoRef(grupoId).collection('biblioteca').add({ ...req.body, creadoEn: new Date().toISOString() });
    res.status(201).json({ id: ref.id, ...req.body });
}

async function eliminarBiblioteca(req, res) {
    const { grupoId, id } = req.params;
    if (!await verificarAcceso(grupoId, req.user.uid, res)) return;
    await grupoRef(grupoId).collection('biblioteca').doc(id).delete();
    res.json({ success: true });
}

// ===========================================
// CONFIGURACIÓN
// ===========================================

async function getConfig(req, res) {
    const { grupoId } = req.params;
    if (!await verificarAcceso(grupoId, req.user.uid, res)) return;
    const doc = await grupoRef(grupoId).collection('config').doc('principal').get();
    res.json(doc.exists ? doc.data() : { adminPhone: '', minutosOlvido: 20 });
}

async function updateConfig(req, res) {
    const { grupoId } = req.params;
    if (!await esAdmin(grupoId, req.user.uid)) return res.status(403).json({ error: 'Solo admin puede editar config' });
    await grupoRef(grupoId).collection('config').doc('principal').set(req.body, { merge: true });
    res.json({ success: true });
}

// ===========================================
// EXPORTAR ICS
// ===========================================

async function exportICS(req, res) {
    const { grupoId } = req.params;
    if (!await verificarAcceso(grupoId, req.user.uid, res)) return;
    const snap = await grupoRef(grupoId).collection('medicamentos').get();
    const lista = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const diasMap = ['SU','MO','TU','WE','TH','FR','SA'];
    const hoy = new Date();
    const fmt = d => `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;

    let ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//MediClock//ES\r\nCALSCALE:GREGORIAN\r\n`;
    lista.forEach(med => {
        const [h, m] = med.hora.split(':');
        let rrule = 'FREQ=DAILY';
        if (med.frecuencia === 'especifica' && med.dias?.length > 0) {
            rrule = `FREQ=WEEKLY;BYDAY=${med.dias.map(d => diasMap[d]).join(',')}`;
        }
        ics += `BEGIN:VEVENT\r\nUID:${med.id}@mediclock.app\r\nDTSTART:${fmt(hoy)}T${h}${m}00\r\nDURATION:PT15M\r\nRRULE:${rrule}\r\nSUMMARY:\u{23F0} ${med.nombre} (${med.familiar})\r\nDESCRIPTION:Dosis: ${med.dosis}\\nCelular: ${med.telefono}\r\nEND:VEVENT\r\n`;
    });
    ics += 'END:VCALENDAR';

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=mediclock.ics');
    res.send(ics);
}

// ===========================================
// SEED (DEV ONLY)
// ===========================================

async function seed(req, res) {
    const snap = await db.collection('grupos').get();
    let grupoId = null;
    for (const doc of snap.docs) {
        const miembro = await doc.ref.collection('miembros').doc(req.user.uid).get();
        if (miembro.exists) { grupoId = doc.id; break; }
    }
    
    if (!grupoId) return res.status(400).json({ error: 'Primero debes crear un grupo' });
    
    const medRef = grupoRef(grupoId).collection('medicamentos');
    const oldMeds = await medRef.get();
    for (const doc of oldMeds.docs) await doc.ref.delete();

    const dummyMeds = [
        { familiar: 'Papá', nombre: 'Losartán 50mg', hora: '08:00', frecuencia: 'diaria', icono: '\u{1F48A}', dias: [0,1,2,3,4,5,6], estado: 'tomada' },
        { familiar: 'Papá', nombre: 'Metformina', hora: '08:30', frecuencia: 'diaria', icono: '\u{1F48A}', dias: [0,1,2,3,4,5,6], estado: 'tomada' },
        { familiar: 'Mamá', nombre: 'Vitamina D', hora: '12:00', frecuencia: 'especifica', icono: '\u{2600}\u{FE0F}', dias: [0, 1, 2, 3, 4, 5, 6], estado: 'pendiente' },
        { familiar: 'Hijo', nombre: 'Ibuprofeno', hora: '14:00', frecuencia: 'solo_hoy', icono: '\u{1F915}', dias: [], estado: 'omitida' },
        { familiar: 'Abuelo', nombre: 'Omega 3', hora: '20:00', frecuencia: 'diaria', icono: '\u{1F41F}', dias: [0,1,2,3,4,5,6], estado: 'pendiente' },
        { familiar: 'Abuelo', nombre: 'Atorvastatina', hora: '22:00', frecuencia: 'diaria', icono: '\u{1F319}', dias: [0,1,2,3,4,5,6], estado: 'pendiente' }
    ];

    for (const med of dummyMeds) {
        await medRef.add({ ...med, creadoEn: new Date().toISOString(), creadoPor: req.user.uid });
    }

    const bibRef = grupoRef(grupoId).collection('biblioteca');
    const oldBib = await bibRef.get();
    for (const doc of oldBib.docs) await doc.ref.delete();

    const dummyBib = [
        { nombre: 'Losartán 50mg', dosis: '50mg', indicaciones: 'Tomar con agua', icono: '\u{1F48A}' },
        { nombre: 'Metformina', dosis: '850mg', indicaciones: 'Con el desayuno', icono: '\u{1F48A}' },
        { nombre: 'Vitamina D', dosis: '1 perla', indicaciones: 'Después de almuerzo', icono: '\u{2600}\u{FE0F}' },
        { nombre: 'Ibuprofeno', dosis: '400mg', indicaciones: 'Solo si hay dolor', icono: '\u{1F915}' },
        { nombre: 'Omega 3', dosis: '1 cápsula', indicaciones: 'Para el corazón', icono: '\u{1F41F}' },
        { nombre: 'Atorvastatina', dosis: '20mg', indicaciones: 'En la noche', icono: '\u{1F319}' }
    ];

    for (const b of dummyBib) {
        await bibRef.add({ ...b, creadoEn: new Date().toISOString() });
    }

    const pacRef = grupoRef(grupoId).collection('pacientes');
    const oldPac = await pacRef.get();
    for (const doc of oldPac.docs) await doc.ref.delete();

    const dummyPacientes = [
        { nombre: 'Papá', telefono: '+56911111111', condicion: 'Hipertensión' },
        { nombre: 'Mamá', telefono: '+56922222222', condicion: 'Diabetes' },
        { nombre: 'Abuelo', telefono: '', condicion: 'Colesterol' },
        { nombre: 'Hijo', telefono: '', condicion: 'Ninguna' }
    ];

    for (const p of dummyPacientes) {
        await pacRef.add({ ...p, creadoEn: new Date().toISOString() });
    }

    res.json({ success: true, message: 'Datos inyectados correctamente en el grupo ' + grupoId });
}

module.exports = {
    misGrupos, crearGrupo, obtenerGrupo,
    listarPacientes, crearPaciente, actualizarPaciente, eliminarPaciente,
    getRoles,
    listarMiembros, eliminarMiembro, cambiarRol,
    invitar, unirse,
    listarMedicamentos, crearMedicamento, marcarToma, reabastecerMedicamento, actualizarMedicamento, eliminarMedicamento,
    listarHistorial,
    listarBiblioteca, crearBiblioteca, eliminarBiblioteca,
    getConfig, updateConfig,
    exportICS,
    seed
};
