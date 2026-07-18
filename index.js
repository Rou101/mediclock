// ==========================================
// MEDICLOCK - BACKEND COMPLETO v2 (Multi-usuario con Grupos)
// ==========================================

const express = require('express');
const path = require('path');
const axios = require('axios');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Meta WhatsApp Cloud API
const META_WA_ACCESS_TOKEN = process.env.META_WA_ACCESS_TOKEN || '';
const META_WA_PHONE_NUMBER_ID = process.env.META_WA_PHONE_NUMBER_ID || '';
const META_WEBHOOK_VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN || 'mediclock_secure_token_123';

// Firebase: dos apps
// 1. Firestore → proyecto GCP original
const fsApp = initializeApp({ projectId: 'viejoalarm-app-2026' }, 'fsApp');
const db = getFirestore(fsApp);

// 2. Auth → proyecto Firebase creado por el usuario
//    verifyIdToken solo usa claves públicas de Google, no necesita credenciales del proyecto
const authApp = initializeApp({ projectId: 'viejoalarm-app-2026-74b04' }, 'authApp');
const adminAuth = getAuth(authApp);

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ===========================================
// AUTH MIDDLEWARE
// ===========================================
// Middleware de Auth (MOCKED DEV MODE)
async function authMiddleware(req, res, next) {
    req.user = {
        uid: 'test-user-123',
        email: 'test@mediclock.com',
        nombre: 'Usuario Prueba',
        foto: ''
    };
    next();
}

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
// API: GRUPOS
// ===========================================

// Mis grupos (todos los grupos donde participo)
app.get('/api/mis-grupos', authMiddleware, async (req, res) => {
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
});

// Crear nuevo grupo
app.post('/api/grupos', authMiddleware, async (req, res) => {
    const { nombre } = req.body;
    if (!nombre?.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });

    const grupoData = {
        nombre: nombre.trim(),
        creadoPor: req.user.uid,
        creadoEn: new Date().toISOString()
    };
    const ref = await db.collection('grupos').add(grupoData);

    // El creador es admin automáticamente
    await ref.collection('miembros').doc(req.user.uid).set({
        uid: req.user.uid,
        email: req.user.email,
        nombre: req.user.nombre,
        foto: req.user.foto,
        rol: 'admin',
        unidoEn: new Date().toISOString()
    });

    // Migrar medicamentos existentes (colección raíz → nuevo grupo)
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
});

// Obtener info de un grupo
app.get('/api/grupos/:grupoId', authMiddleware, async (req, res) => {
    const { grupoId } = req.params;
    const miembro = await verificarAcceso(grupoId, req.user.uid, res);
    if (!miembro) return;
    const doc = await grupoRef(grupoId).get();
    if (!doc.exists) return res.status(404).json({ error: 'Grupo no encontrado' });
    res.json({ id: doc.id, ...doc.data(), miRol: miembro.rol });
});

// ===========================================
// API: PACIENTES
// ===========================================

app.get('/api/grupos/:grupoId/pacientes', authMiddleware, async (req, res) => {
    const { grupoId } = req.params;
    if (!await verificarAcceso(grupoId, req.user.uid, res)) return;
    const snap = await grupoRef(grupoId).collection('pacientes').get();
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
});

app.post('/api/grupos/:grupoId/pacientes', authMiddleware, async (req, res) => {
    const { grupoId } = req.params;
    if (!await verificarAcceso(grupoId, req.user.uid, res)) return;
    const ref = await grupoRef(grupoId).collection('pacientes').add({ ...req.body, creadoEn: new Date().toISOString() });
    res.status(201).json({ id: ref.id, ...req.body });
});

app.put('/api/grupos/:grupoId/pacientes/:pacienteId', authMiddleware, async (req, res) => {
    const { grupoId, pacienteId } = req.params;
    if (!await verificarAcceso(grupoId, req.user.uid, res)) return;
    await grupoRef(grupoId).collection('pacientes').doc(pacienteId).update(req.body);
    res.json({ success: true });
});

app.delete('/api/grupos/:grupoId/pacientes/:pacienteId', authMiddleware, async (req, res) => {
    const { grupoId, pacienteId } = req.params;
    if (!await esAdmin(grupoId, req.user.uid)) return res.status(403).json({ error: 'Solo admin puede eliminar pacientes' });
    await grupoRef(grupoId).collection('pacientes').doc(pacienteId).delete();
    res.json({ success: true });
});

// ===========================================
// API: MIEMBROS
// ===========================================

app.get('/api/grupos/:grupoId/miembros', authMiddleware, async (req, res) => {
    const { grupoId } = req.params;
    if (!await verificarAcceso(grupoId, req.user.uid, res)) return;
    const snap = await grupoRef(grupoId).collection('miembros').get();
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
});

app.delete('/api/grupos/:grupoId/miembros/:uid', authMiddleware, async (req, res) => {
    const { grupoId, uid } = req.params;
    if (!await esAdmin(grupoId, req.user.uid)) {
        return res.status(403).json({ error: 'Solo el admin puede eliminar miembros' });
    }
    if (uid === req.user.uid) return res.status(400).json({ error: 'No puedes eliminarte a ti mismo' });
    await grupoRef(grupoId).collection('miembros').doc(uid).delete();
    res.json({ success: true });
});

app.put('/api/grupos/:grupoId/miembros/:uid/rol', authMiddleware, async (req, res) => {
    const { grupoId, uid } = req.params;
    const { rol } = req.body;
    if (!await esAdmin(grupoId, req.user.uid)) return res.status(403).json({ error: 'Solo el admin puede cambiar roles' });
    if (!['admin', 'miembro'].includes(rol)) return res.status(400).json({ error: 'Rol inválido' });
    await grupoRef(grupoId).collection('miembros').doc(uid).update({ rol });
    res.json({ success: true });
});

// ===========================================
// API: INVITACIONES
// ===========================================

app.post('/api/grupos/:grupoId/invitar', authMiddleware, async (req, res) => {
    const { grupoId } = req.params;
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
        estado: 'pendiente'
    });

    const baseUrl = req.headers.origin || `https://mediclock-973418999022.us-central1.run.app`;
    res.json({ codigo, link: `${baseUrl}/unirse/${codigo}`, expiresAt });
});

app.get('/api/unirse/:codigo', authMiddleware, async (req, res) => {
    const invDoc = await db.collection('invitaciones').doc(req.params.codigo).get();
    if (!invDoc.exists) return res.status(404).json({ error: 'Invitación no válida' });

    const inv = invDoc.data();
    if (inv.estado !== 'pendiente') return res.status(400).json({ error: 'Esta invitación ya fue usada' });
    if (new Date(inv.expiresAt) < new Date()) return res.status(400).json({ error: 'Esta invitación expiró' });

    // Unirse al grupo
    await grupoRef(inv.grupoId).collection('miembros').doc(req.user.uid).set({
        uid: req.user.uid,
        email: req.user.email,
        nombre: req.user.nombre,
        foto: req.user.foto,
        rol: 'miembro',
        unidoEn: new Date().toISOString()
    });

    await invDoc.ref.update({ estado: 'aceptada', aceptadoPor: req.user.uid });
    res.json({ success: true, grupoId: inv.grupoId, grupoNombre: inv.grupoNombre });
});

// ===========================================
// API: MEDICAMENTOS (scoped al grupo)
// ===========================================

app.get('/api/grupos/:grupoId/medicamentos', authMiddleware, async (req, res) => {
    const { grupoId } = req.params;
    if (!await verificarAcceso(grupoId, req.user.uid, res)) return;
    const snap = await grupoRef(grupoId).collection('medicamentos').get();
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
});

app.post('/api/grupos/:grupoId/medicamentos', authMiddleware, async (req, res) => {
    const { grupoId } = req.params;
    if (!await verificarAcceso(grupoId, req.user.uid, res)) return;
    const nuevo = { ...req.body, estado: 'pendiente', creadoEn: new Date().toISOString(), creadoPor: req.user.uid };
    const ref = await grupoRef(grupoId).collection('medicamentos').add(nuevo);
    res.status(201).json({ id: ref.id, ...nuevo });
});

app.put('/api/grupos/:grupoId/medicamentos/:medId', authMiddleware, async (req, res) => {
    const { grupoId, medId } = req.params;
    if (!await verificarAcceso(grupoId, req.user.uid, res)) return;
    await grupoRef(grupoId).collection('medicamentos').doc(medId).update(req.body);
    res.json({ success: true });
});

app.delete('/api/grupos/:grupoId/medicamentos/:medId', authMiddleware, async (req, res) => {
    const { grupoId, medId } = req.params;
    if (!await verificarAcceso(grupoId, req.user.uid, res)) return;
    await grupoRef(grupoId).collection('medicamentos').doc(medId).delete();
    res.json({ success: true });
});

// ===========================================
// SEED ENDPOINT (DEV ONLY)
// ===========================================
app.get('/api/seed', authMiddleware, async (req, res) => {
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
        { familiar: 'Papá', nombre: 'Losartán 50mg', hora: '08:00', frecuencia: 'diaria', icono: '💊', dias: [0,1,2,3,4,5,6], estado: 'tomada' },
        { familiar: 'Papá', nombre: 'Metformina', hora: '08:30', frecuencia: 'diaria', icono: '💊', dias: [0,1,2,3,4,5,6], estado: 'tomada' },
        { familiar: 'Mamá', nombre: 'Vitamina D', hora: '12:00', frecuencia: 'especifica', icono: '☀️', dias: [0, 1, 2, 3, 4, 5, 6], estado: 'pendiente' },
        { familiar: 'Hijo', nombre: 'Ibuprofeno', hora: '14:00', frecuencia: 'solo_hoy', icono: '🤕', dias: [], estado: 'omitida' },
        { familiar: 'Abuelo', nombre: 'Omega 3', hora: '20:00', frecuencia: 'diaria', icono: '🐟', dias: [0,1,2,3,4,5,6], estado: 'pendiente' },
        { familiar: 'Abuelo', nombre: 'Atorvastatina', hora: '22:00', frecuencia: 'diaria', icono: '🌙', dias: [0,1,2,3,4,5,6], estado: 'pendiente' }
    ];

    for (const med of dummyMeds) {
        await medRef.add({ ...med, creadoEn: new Date().toISOString(), creadoPor: req.user.uid });
    }

    const bibRef = grupoRef(grupoId).collection('biblioteca');
    const oldBib = await bibRef.get();
    for (const doc of oldBib.docs) await doc.ref.delete();

    const dummyBib = [
        { nombre: 'Losartán 50mg', dosis: '50mg', indicaciones: 'Tomar con agua', icono: '💊' },
        { nombre: 'Metformina', dosis: '850mg', indicaciones: 'Con el desayuno', icono: '💊' },
        { nombre: 'Vitamina D', dosis: '1 perla', indicaciones: 'Después de almuerzo', icono: '☀️' },
        { nombre: 'Ibuprofeno', dosis: '400mg', indicaciones: 'Solo si hay dolor', icono: '🤕' },
        { nombre: 'Omega 3', dosis: '1 cápsula', indicaciones: 'Para el corazón', icono: '🐟' },
        { nombre: 'Atorvastatina', dosis: '20mg', indicaciones: 'En la noche', icono: '🌙' }
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
});

// ===========================================
// API: HISTORIAL
// ===========================================

app.get('/api/grupos/:grupoId/historial', authMiddleware, async (req, res) => {
    const { grupoId } = req.params;
    if (!await verificarAcceso(grupoId, req.user.uid, res)) return;
    const snap = await grupoRef(grupoId).collection('historial').get();
    const lista = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    lista.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    res.json(lista.slice(0, 200));
});

// ===========================================
// API: BIBLIOTECA
// ===========================================

app.get('/api/grupos/:grupoId/biblioteca', authMiddleware, async (req, res) => {
    const { grupoId } = req.params;
    if (!await verificarAcceso(grupoId, req.user.uid, res)) return;
    const snap = await grupoRef(grupoId).collection('biblioteca').get();
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
});

app.post('/api/grupos/:grupoId/biblioteca', authMiddleware, async (req, res) => {
    const { grupoId } = req.params;
    if (!await verificarAcceso(grupoId, req.user.uid, res)) return;
    const ref = await grupoRef(grupoId).collection('biblioteca').add({ ...req.body, creadoEn: new Date().toISOString() });
    res.status(201).json({ id: ref.id, ...req.body });
});

app.delete('/api/grupos/:grupoId/biblioteca/:id', authMiddleware, async (req, res) => {
    const { grupoId, id } = req.params;
    if (!await verificarAcceso(grupoId, req.user.uid, res)) return;
    await grupoRef(grupoId).collection('biblioteca').doc(id).delete();
    res.json({ success: true });
});

// ===========================================
// API: CONFIGURACION
// ===========================================

app.get('/api/grupos/:grupoId/config', authMiddleware, async (req, res) => {
    const { grupoId } = req.params;
    if (!await verificarAcceso(grupoId, req.user.uid, res)) return;
    const doc = await grupoRef(grupoId).collection('config').doc('principal').get();
    res.json(doc.exists ? doc.data() : { adminPhone: '', minutosOlvido: 20 });
});

app.put('/api/grupos/:grupoId/config', authMiddleware, async (req, res) => {
    const { grupoId } = req.params;
    if (!await esAdmin(grupoId, req.user.uid)) return res.status(403).json({ error: 'Solo admin puede editar config' });
    await grupoRef(grupoId).collection('config').doc('principal').set(req.body, { merge: true });
    res.json({ success: true });
});

// ===========================================
// API: EXPORTAR ICS
// ===========================================

app.get('/api/grupos/:grupoId/export/ics', authMiddleware, async (req, res) => {
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
        ics += `BEGIN:VEVENT\r\nUID:${med.id}@mediclock.app\r\nDTSTART:${fmt(hoy)}T${h}${m}00\r\nDURATION:PT15M\r\nRRULE:${rrule}\r\nSUMMARY:⏰ ${med.nombre} (${med.familiar})\r\nDESCRIPTION:Dosis: ${med.dosis}\\nCelular: ${med.telefono}\r\nEND:VEVENT\r\n`;
    });
    ics += 'END:VCALENDAR';

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=mediclock.ics');
    res.send(ics);
});

// ===========================================
// WEBHOOK META WHATSAPP CLOUD API
// ===========================================

// 1. Verificación del Webhook (GET)
app.get('/api/meta-webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === META_WEBHOOK_VERIFY_TOKEN) {
            console.log('WEBHOOK_VERIFIED');
            res.status(200).send(challenge);
        } else {
            res.sendStatus(403);
        }
    } else {
        res.sendStatus(400);
    }
});

// 2. Recepción de mensajes (POST)
app.post('/api/meta-webhook', async (req, res) => {
    const body = req.body;

    if (body.object === 'whatsapp_business_account') {
        const entry = body.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;
        const messages = value?.messages;

        if (messages && messages[0]) {
            const message = messages[0];
            const numero = message.from; // Número con código de país, sin el '+'
            const messageType = message.type;
            
            let texto = '';
            let mediaUrl = null;
            let esVoz = false;
            let esFoto = false;

            if (messageType === 'text') {
                texto = message.text.body.trim().toLowerCase();
            } else if (messageType === 'audio') {
                esVoz = true;
                mediaUrl = message.audio.id; // En Meta, los adjuntos se descargan vía un ID
            } else if (messageType === 'image') {
                esFoto = true;
                mediaUrl = message.image.id;
            }

            console.log(`[Webhook Meta] De ${numero}: "${texto}" (Tipo: ${messageType})`);

            // Buscar en todos los grupos
            const gruposSnap = await db.collection('grupos').get();
            let medConfirmado = null;

            for (const grupoDoc of gruposSnap.docs) {
                const medsSnap = await grupoDoc.ref.collection('medicamentos').get();
                const meds = medsSnap.docs.map(d => ({ id: d.id, ...d.data(), _ref: d.ref }));

                for (const med of meds) {
                    // Limpiar el teléfono de la DB para compararlo con el formato de Meta
                    const telDB = (med.telefono || '').replace(/\D/g, ''); 
                    
                    if (telDB === numero && med.estado === 'pendiente') {
                        const esOk = texto.includes('tome') || texto.includes('ok') ||
                            texto.includes('si') || texto.includes('sí') ||
                            texto.includes('listo') || texto.includes('ya') ||
                            esFoto || esVoz;

                        if (esOk) {
                            const extras = {};
                            if (esFoto) extras.fotoConfirmacion = mediaUrl;
                            if (esVoz) extras.vozConfirmacion = mediaUrl;

                            await med._ref.update({ estado: 'tomada', confirmadoEn: new Date().toISOString(), ...extras });
                            await grupoDoc.ref.collection('historial').add({
                                medicamentoId: med.id,
                                familiar: med.familiar,
                                nombre: med.nombre,
                                dosis: med.dosis || '',
                                horaProgram: med.hora,
                                estado: 'tomada',
                                timestamp: new Date().toISOString(),
                                ...extras
                            });
                            medConfirmado = med;
                            break;
                        }
                    }
                }
                if (medConfirmado) break;
            }

            if (medConfirmado) {
                const extra = esVoz ? ' Escuché tu nota de voz.' : esFoto ? ' Vi la foto que enviaste.' : '';
                await enviarWA(numero, medConfirmado.familiar, `✅ ¡Perfecto!${extra} Registré que tomaste tu *${medConfirmado.nombre}*. ¡Salud! 💪`);
            } else {
                await enviarWA(numero, 'Usuario', `Responde *"Listo"*, *"Ok"*, o envía una 📷 foto o 🎤 nota de voz para confirmar tu medicamento.`);
            }
        }
        res.sendStatus(200);
    } else {
        res.sendStatus(404);
    }
});

// Ruta de invitación (SPA)
app.get('/unirse/:codigo', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ===========================================
// MOTOR DEL VIGILANTE (todos los grupos)
// ===========================================

let enviados = {};
let alertados = {};

function horaChile() {
    const ahora = new Date();
    const hora = ahora.toLocaleTimeString('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hour12: false });
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Santiago', weekday: 'short' });
    const diasMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const dia = diasMap[fmt.format(ahora)];
    const hms = ahora.toLocaleTimeString('es-CL', { timeZone: 'America/Santiago', hour12: false });
    const seg = parseInt(hms.split(':')[2]) || 0;
    return { hora, dia, seg };
}

function minutosDesde(horaStr) {
    const { hora } = horaChile();
    const [hA, mA] = hora.split(':').map(Number);
    const [hP, mP] = horaStr.split(':').map(Number);
    return (hA * 60 + mA) - (hP * 60 + mP);
}

async function enviarWA(telefono, familiar, mensaje) {
    if (!META_WA_ACCESS_TOKEN) {
        console.log(`[SIMULADO WA Meta] Para ${familiar} (${telefono}): ${mensaje}`);
        return;
    }

    const telLimpio = (telefono || '').replace(/\D/g, ''); // Limpiar '+' o espacios
    const url = `https://graph.facebook.com/v20.0/${META_WA_PHONE_NUMBER_ID}/messages`;
    
    try {
        const response = await axios.post(url, {
            messaging_product: 'whatsapp',
            to: telLimpio,
            type: 'text',
            text: { body: mensaje }
        }, {
            headers: {
                'Authorization': `Bearer ${META_WA_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        console.log(`[OK] WA Meta → ${familiar} (${telLimpio}). MsgID: ${response.data.messages[0].id}`);
    } catch (e) {
        console.error(`[ERROR] WA Meta:`, e.response?.data || e.message);
    }
}

async function verificarReloj() {
    const { hora, dia, seg } = horaChile();
    if (seg < 5) enviados = {};
    if (hora === '00:00' && seg < 30) alertados = {};

    console.log(`[Vigilante] ${hora} | Día: ${dia}`);

    const gruposSnap = await db.collection('grupos').get();

    for (const grupoDoc of gruposSnap.docs) {
        const cfgDoc = await grupoDoc.ref.collection('config').doc('principal').get();
        const cfg = cfgDoc.exists ? cfgDoc.data() : {};
        const ADMIN = cfg.adminPhone || '';
        const MIN_OLVIDO = parseInt(cfg.minutosOlvido) || 20;

        const medsSnap = await grupoDoc.ref.collection('medicamentos').get();
        const meds = medsSnap.docs.map(d => ({ id: d.id, ...d.data(), _ref: d.ref }));

        for (const med of meds) {
            const kEnvio = `${grupoDoc.id}-${med.id}-${hora}`;
            const kOlvido = `olvido-${grupoDoc.id}-${med.id}-${med.hora}`;
            const hoy = med.frecuencia === 'diaria' || (med.frecuencia === 'especifica' && med.dias?.map(Number).includes(dia));

            if (med.hora === hora && hoy && !enviados[kEnvio]) {
                enviados[kEnvio] = true;
                await med._ref.update({ estado: 'pendiente', confirmadoEn: null, fotoConfirmacion: null });
                const msg = `🔔 *RECORDATORIO:* Hola *${med.familiar}*, es hora de tomar tu *${med.nombre}* (${med.dosis}).\n\n👉 _Responde *Listo*, *Ok*, envía una 📷 foto o 🎤 nota de voz para confirmar._`;
                await enviarWA(med.telefono, med.familiar, msg);
            }

            const mins = minutosDesde(med.hora);
            if (med.estado === 'pendiente' && mins >= MIN_OLVIDO && mins < 120 && !alertados[kOlvido]) {
                alertados[kOlvido] = true;
                await med._ref.update({ estado: 'olvidada' });
                await grupoDoc.ref.collection('historial').add({
                    medicamentoId: med.id, familiar: med.familiar, nombre: med.nombre,
                    dosis: med.dosis || '', horaProgram: med.hora, estado: 'olvidada',
                    timestamp: new Date().toISOString()
                });
                if (ADMIN) {
                    const alerta = `⚠️ *ALERTA MediClock:* *${med.familiar}* no confirmó su *${med.nombre}* de las ${med.hora}. Han pasado ${MIN_OLVIDO} minutos.`;
                    await enviarWA(ADMIN, 'Admin', alerta);
                }
            }
        }
    }
}

app.listen(PORT, () => {
    console.log(`=========================================`);
    console.log(`¡MediClock en marcha! Puerto: ${PORT}`);
    console.log(`=========================================`);
});

setInterval(verificarReloj, 30000);
verificarReloj();
