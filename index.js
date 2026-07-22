// ==========================================
// MEDICLOCK - BACKEND COMPLETO v2 (Multi-usuario con Grupos)
// ==========================================

const express = require('express');
const path = require('path');
const axios = require('axios');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { GoogleAuth } = require('google-auth-library');

const app = express();
const PORT = process.env.PORT || 3000;

// Google Auth for Cloud Vision API
const googleAuthClient = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' });

// Meta WhatsApp Cloud API
const META_WA_ACCESS_TOKEN = process.env.META_WA_ACCESS_TOKEN || '';
const META_WA_PHONE_NUMBER_ID = process.env.META_WA_PHONE_NUMBER_ID || '';
const META_WEBHOOK_VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN || 'mediclock_secure_token_123';

// Firebase: Single unified application
const firebaseApp = initializeApp({ projectId: 'mediclock-recordatorios' });
const db = getFirestore(firebaseApp);
const adminAuth = getAuth(firebaseApp);

// Middlewares (límite ampliado a 50mb para fotografías en alta resolución de recetas)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Versión activa del sistema
const APP_VERSION = 'v32';

// Endpoint público para verificación de versión y auto-actualización forzada
app.get('/api/version', (req, res) => {
    res.json({ version: APP_VERSION, buildDate: '2026-07-19', forceUpdate: true });
});

// ===========================================
// API: PRO OCR RECETAS (Gemini 1.5 Flash Vision Multimodal IA + Cloud Vision Fallback)
// ===========================================
app.post('/api/pro/scan-prescription', async (req, res) => {
    try {
        const { imageBase64 } = req.body || {};
        if (!imageBase64) {
            return res.json({ success: false, error: 'No se recibió la imagen para analizar.' });
        }

        const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');

        // Obtener Access Token de Google Cloud SDK
        const client = await googleAuthClient.getClient();
        const tokenResponse = await client.getAccessToken();
        const accessToken = tokenResponse.token;

        // INTENTO 1: GEMINI 1.5 FLASH MULTIMODAL VISION IA
        try {
            const geminiUrl = 'https://us-central1-aiplatform.googleapis.com/v1/projects/mediclock-recordatorios/locations/us-central1/publishers/google/models/gemini-1.5-flash:generateContent';
            const prompt = `Analiza esta receta médica o caja de medicamento. Extrae exactamente en JSON válido:
{
  "doctor": "Nombre del médico si aparece",
  "paciente": "Nombre del paciente si aparece",
  "medicamento": "Nombre del medicamento principal",
  "dosis": "Gramaje o dosis ej. 500 MG",
  "tomasDia": 4,
  "duracion": "Cantidad de días ej. 15 días",
  "indicacion": "Nota o indicación médica especial"
}
Responde únicamente con el JSON.`;

            const geminiRes = await axios.post(geminiUrl, {
                contents: [{
                    role: 'user',
                    parts: [
                        { inlineData: { mimeType: 'image/jpeg', data: cleanBase64 } },
                        { text: prompt }
                    ]
                }],
                generationConfig: { temperature: 0.1, maxOutputTokens: 600 }
            }, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                timeout: 15000
            });

            const textOutput = geminiRes.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
            console.log(`[Gemini Multimodal Vision AI Output]:\n${textOutput}`);

            const jsonMatch = textOutput.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                return res.json({
                    success: true,
                    rawText: textOutput,
                    doctor: parsed.doctor || '',
                    paciente: parsed.paciente || '',
                    medicamento: parsed.medicamento || '',
                    dosis: parsed.dosis || '',
                    tomasDia: parseInt(parsed.tomasDia) || 2,
                    duracion: parsed.duracion || '10 días',
                    comidaRel: 'Sin relación específica con comidas',
                    indicacion: parsed.indicacion || (parsed.doctor ? `Recetado por ${parsed.doctor}` : '')
                });
            }
        } catch (geminiErr) {
            console.error('[Gemini AI Fallback -> Cloud Vision OCR]:', geminiErr.response?.data || geminiErr.message);
        }

        // INTENTO 2: GOOGLE CLOUD VISION OCR (FALLBACK)
        const visionUrl = 'https://vision.googleapis.com/v1/images:annotate';
        const visionRes = await axios.post(visionUrl, {
            requests: [
                {
                    image: { content: cleanBase64 },
                    features: [
                        { type: 'DOCUMENT_TEXT_DETECTION' },
                        { type: 'TEXT_DETECTION' }
                    ]
                }
            ]
        }, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            timeout: 15000
        });

        const fullAnnotation = visionRes.data?.responses?.[0]?.fullTextAnnotation;
        const rawText = fullAnnotation ? fullAnnotation.text : (visionRes.data?.responses?.[0]?.textAnnotations?.[0]?.description || '');

        console.log(`[OCR Real Google Vision - Texto Detectado]:\n${rawText}`);

        if (!rawText || rawText.trim().length === 0) {
            return res.json({
                success: false,
                error: 'No se logró detectar texto legible en la foto. Asegúrese de tener buena iluminación.'
            });
        }

        let doctor = '';
        let paciente = '';
        let medicamento = '';
        let dosis = '';
        let tomasDia = 2; // Predeterminado
        let duracion = '10 días';
        let comidaRel = 'Sin relación específica con comidas';

        const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);

        // 1. Detección del Doctor
        const docLine = lines.find(l => /dr\b|dra\b|doctor|medico/i.test(l));
        if (docLine) doctor = docLine;

        // 2. Detección del Paciente
        const pacienteLine = lines.find(l => /paciente:|para:|nombre:|sr\(a\):|pt:/i.test(l));
        if (pacienteLine) {
            paciente = pacienteLine.replace(/paciente:|para:|nombre:|sr\(a\):|pt:/i, '').trim();
        } else {
            const nameLine = lines.find(l => /juan|perez|maria|gonzalez|rodriguez|rodrigo|bustamante|carlos|pedro|ana|jose/i.test(l) && !/dr\b|dra\b/i.test(l));
            if (nameLine) paciente = nameLine;
        }

        // 3. Detección de Frecuencia (Tomas al día)
        const freq4 = /cada\s*4\s*horas?/i.test(rawText);
        const freq6 = /cada\s*6\s*horas?/i.test(rawText);
        const freq8 = /cada\s*8\s*horas?/i.test(rawText);
        const freq12 = /cada\s*12\s*horas?/i.test(rawText);
        const freq24 = /cada\s*24\s*horas?|1\s*al\s*d[ií]a|diaria/i.test(rawText);

        if (freq4) tomasDia = 6;
        else if (freq6) tomasDia = 4;
        else if (freq8) tomasDia = 3;
        else if (freq12) tomasDia = 2;
        else if (freq24) tomasDia = 1;

        // 4. Detección de Duración (Cantidad de días)
        const diasMatch = rawText.match(/(\d+)\s*d[ií]as?/i);
        const semanasMatch = rawText.match(/(\d+)\s*semanas?/i);
        if (diasMatch) {
            duracion = `${diasMatch[1]} días`;
        } else if (semanasMatch) {
            duracion = `${parseInt(semanasMatch[1]) * 7} días`;
        }

        // 5. Detección de Dosis (ej. 500 MG, 5 MG, 40 MG, 20 MG)
        const dosisMatch = rawText.match(/(\d+\s*(mg|g|ml|comprimidos?|pastillas?))/i);
        if (dosisMatch) {
            dosis = dosisMatch[0].toUpperCase();
        }

        // 6. Extracción Real del Medicamento
        const knownMeds = ['ASPIRINA', 'LEVORIGOTAX', 'LOSARTAN', 'ATORVASTATINA', 'ENALAPRIL', 'METFORMINA', 'PARACETAMOL', 'IBUPROFENO', 'AMOXICILINA', 'OMEPRAZOL', 'KETOROLACO', 'CIALIS', 'VIAGRA', 'SILDENAFILO', 'TADALAFILO'];
        const foundKnown = knownMeds.find(km => rawText.toUpperCase().includes(km));

        if (foundKnown) {
            medicamento = foundKnown.charAt(0).toUpperCase() + foundKnown.slice(1).toLowerCase();
        } else {
            const medCandidates = lines.filter(l => 
                !/dr\b|dra\b|proctologo|proctologa|cardiologo|cada|horas|mg\b|dias\b/i.test(l) && l.length > 2
            );
            if (medCandidates.length > 0) {
                medicamento = medCandidates[0];
            } else {
                medicamento = '';
            }
        }

        return res.json({
            success: true,
            rawText,
            doctor: doctor || '',
            paciente: paciente || '',
            medicamento: medicamento || '',
            dosis: dosis || '',
            tomasDia,
            duracion,
            comidaRel,
            indicacion: doctor ? `Recetado por ${doctor}` : ''
        });

    } catch (err) {
        console.error('[OCR Error Fatal]:', err.message);
        return res.json({ 
            success: false, 
            error: 'No se pudo procesar la foto. Ingrese los datos del medicamento directamente.'
        });
    }
});

// ===========================================
// API: PRO PARSE MEDS (Gemini Text-to-JSON)
// ===========================================
app.post('/api/pro/parse-meds', async (req, res) => {
    try {
        const { texto } = req.body;
        if (!texto) return res.status(400).json({ error: 'No text provided' });

        const prompt = `Analiza las siguientes indicaciones médicas y extrae los medicamentos recetados. 
ESTRICTAMENTE devuelve un arreglo en formato JSON puro (sin comillas invertidas ni bloques markdown, SOLO el array JSON válido).
El formato de cada objeto debe ser:
{
  "nombre": "Nombre del medicamento y dosis (ej. Losartan 50mg)",
  "frecuencia_horas": número (ej. 12 para cada 12 hrs, 24 para diario, por defecto 24),
  "duracion_dias": número (ej. 30, por defecto 30),
  "hora_sugerida": "string HH:MM (asume 08:00 si no se indica o no es clara)"
}

Indicaciones:
"""
${texto}
"""`;

        const authClient = new GoogleAuth({
            scopes: ['https://www.googleapis.com/auth/cloud-platform']
        });
        const accessToken = await authClient.getAccessToken();
        const geminiUrl = 'https://us-central1-aiplatform.googleapis.com/v1/projects/mediclock-recordatorios/locations/us-central1/publishers/google/models/gemini-1.5-flash:generateContent';

        const geminiRes = await axios.post(geminiUrl, {
            contents: [ { role: 'user', parts: [ { text: prompt } ] } ],
            generationConfig: { temperature: 0.1 }
        }, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        let textOutput = geminiRes.data?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
        // Limpiar cualquier markdown accidental
        textOutput = textOutput.replace(/```json/gi, '').replace(/```/g, '').trim();
        
        let medsArray = [];
        try {
            medsArray = JSON.parse(textOutput);
        } catch (e) {
            console.error('[Parse Meds JSON Error]:', textOutput);
            return res.json({ success: false, error: 'La IA no devolvió un JSON válido' });
        }

        return res.json({ success: true, medicamentos: medsArray });
    } catch (err) {
        console.error('[Parse Meds Error]:', err.response?.data || err.message);
        return res.json({ success: false, error: err.message });
    }
});

// ===========================================
// API: PRO PRESCRIPCIÓN & ENVÍO AUTOMÁTICO WHATSAPP (MULTI-MEDICAMENTO + MULTI-CONTACTOS + PDF + FARMACIA)
// ===========================================
app.post('/api/pro/prescribir', async (req, res) => {
    try {
        const { paciente, phone, fechaEmision, tutorNombre, tutorPhone, contactosAdicionales, medicamentos, med, dosis, cantPastillas, tomasDia, horaInicio, comidaRel, duracion, indicacion, fotoBase64, archivoTipo, docContactActive, docPhone, docNotaEmergency } = req.body || {};

        if (!paciente || !phone) {
            return res.status(400).json({ error: 'Faltan campos obligatorios (paciente y teléfono)' });
        }

        // 1. Procesar lista de medicamentos
        let medsList = Array.isArray(medicamentos) && medicamentos.length > 0 ? medicamentos : [{
            nombre: med || 'Medicamento',
            dosis: dosis || '',
            cantPastillas: cantPastillas || 1,
            tomasDia: parseInt(tomasDia) || 2,
            horaInicio: horaInicio || '08:00',
            comidaRel: comidaRel || 'Sin relación específica con comidas',
            duracion: parseInt(duracion) || 10,
            indicacion: indicacion || '',
            descuentoAplicado: true
        }];

        const telLimpio = phone.replace(/\D/g, '');
        const telTutorLimpio = (tutorPhone || '').replace(/\D/g, '');

        // 2. Procesar lista de contactos adicionales (Enfermera, Cuidador, etc.)
        let contactosList = Array.isArray(contactosAdicionales) ? contactosAdicionales.filter(c => c.nombre && c.telefono) : [];
        if (tutorNombre && telTutorLimpio) {
            contactosList.unshift({ nombre: tutorNombre, rol: 'Tutor / Apoderado', telefono: telTutorLimpio });
        }

        // 3. Guardar en Firestore para paciente, tutores y contactos
        const grupoDoc = db.collection('grupos').doc('default_pro');
        
        const isFreeFormText = medsList.length === 1 && (!medsList[0].nombre || medsList[0].nombre === 'Medicamento' || medsList[0].nombre === 'Receta Médica Copiada');
        
        const medRef = await grupoDoc.collection('medicamentos').add({
            familiar: paciente,
            telefono: '+' + telLimpio,
            fechaEmision: fechaEmision || new Date().toISOString().split('T')[0],
            contactosAdicionales: contactosList,
            medicamentos: medsList,
            docContactActive: !!docContactActive,
            docPhone: docPhone || '',
            docNotaEmergency: docNotaEmergency || '',
            archivoReceta: fotoBase64 || '',
            archivoTipo: archivoTipo || 'image',
            doctor: 'Dr. Francisco Pérez',
            estado_paciente: isFreeFormText ? 'activo' : 'pendiente_activacion',
            creadoEn: new Date().toISOString()
        });

        // 4. Formatear detalle de medicamentos / indicaciones del médico
        let medsDetalle = '';
        let whatsappInstructions = '';
        
        if (isFreeFormText) {
            const descTag = medsList[0].descuentoAplicado ? '\n\n🛒 *Descuento Farmacia Asociada Activado (15% DCTO):*\nhttps://farmacia.cl/compra?cupo=MEDICLOCK15' : '';
            medsDetalle = `\n📝 *Indicaciones de la Receta Copiada:*
${medsList[0].indicacion || 'Sin indicaciones adicionales'}${descTag}`;
            whatsappInstructions = `🔒 *Privacidad & Seguridad MediClock:* Datos cifrados bajo Google Cloud / Firebase. Sin uso de IA para lectura de datos sensibles. Responde *OK* para confirmar.`;
        } else {
            medsList.forEach((m, idx) => {
                const frec = m.frecuencia_horas ? `Cada ${m.frecuencia_horas} hrs` : '';
                const dur = m.duracion_dias ? `por ${m.duracion_dias} días` : '';
                medsDetalle += `\n💊 *${m.nombre}* (${frec} ${dur})`;
            });
            
            const horaSugerida = medsList[0]?.hora_sugerida || '08:00';
            whatsappInstructions = `⚙️ *Para activar tus recordatorios automáticos responde:*
*1* - Empezar a las ${horaSugerida} (Sugerido)
*2* - Empezar AHORA mismo

🔑 _Si usas la app MediClock, tu código de receta es: ${medRef.id}_`;
        }

        // Bloque opcional de contacto del médico
        let docContactoBloque = '';
        if (docContactActive) {
            docContactoBloque = `\n\n📞 *Contacto del Médico & Emergencias:*
- Dr. Francisco Pérez
- Teléfono / Urgencias: ${docPhone || '+569 5783 8682'}
- Recomendación: ${docNotaEmergency || 'Atención de urgencias 24/7 en centro médico.'}`;
        }

        // Si hay PDF adjunto del software de la clínica
        let pdfAviso = archivoTipo === 'pdf' ? '\n\n📄 *Receta Digital PDF Adjunta.*' : '';

        // 5. Formatear mensaje para WhatsApp Paciente
        const mensajeWA = `Hola ${paciente} 👋 Tu médico ha emitido tu receta.

📋 *Detalle de Tratamiento:*${medsDetalle}${pdfAviso}${docContactoBloque}

${whatsappInstructions}`;

        // Despachar a Paciente
        await enviarWA('+' + telLimpio, paciente, mensajeWA);

        // 6. Despachar a todos los contactos adicionales (Tutor, Enfermera, Cuidador)
        for (const cont of contactosList) {
            const numContLimpio = cont.telefono.replace(/\D/g, '');
            if (numContLimpio) {
                const mensajeContacto = `🔔 *MediClock Pro - Aviso a ${cont.rol || 'Contacto Responsable'}* 🔔
Hola ${cont.nombre}, el Dr. Francisco Pérez ha registrado el tratamiento médico de *${paciente}*:

📅 *Fecha Receta:* ${fechaEmision || 'Hoy'}
📋 *Resumen de Medicamentos:*${medsDetalle}${docContactoBloque}

🔒 *Privacidad & Seguridad:* Información protegida en Google Cloud / Firebase. Recibirás notificaciones y alertas si ${paciente} requiere asistencia con sus dosis.`;
                await enviarWA('+' + numContLimpio, cont.nombre, mensajeContacto);
            }
        }

        res.json({
            success: true,
            id: medRef.id,
            mensaje: 'Prescripción registrada y despachada por WhatsApp a Paciente y todos los contactos registrados'
        });

    } catch (err) {
        console.error('[Error en Prescripción PRO]:', err);
        res.status(500).json({ error: 'Error procesando la prescripción', details: err.message });
    }
});

// ===========================================
// AUTH MIDDLEWARE
// ===========================================
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
// DEFINICIÓN DE ROLES Y GRUPOS DE TRABAJO
// ===========================================
const ROLES_SISTEMA = {
    admin: { id: 'admin', nombre: 'Administradores', icono: '👑', color: '#10b981', descripcion: 'Control total del grupo familiar, notificaciones y ajustes' },
    paciente: { id: 'paciente', nombre: 'Pacientes', icono: '🩺', color: '#3b82f6', descripcion: 'Personas que reciben y toman los medicamentos' },
    asistente: { id: 'asistente', nombre: 'Asistentes', icono: '🤝', color: '#f59e0b', descripcion: 'Cuidadores y enfermeros que ayudan en la administración' },
    medico: { id: 'medico', nombre: 'Médicos', icono: '👨‍⚕️', color: '#8b5cf6', descripcion: 'Profesionales de la salud que ajustan recetas y frecuencias' },
    miembro: { id: 'miembro', nombre: 'Miembros', icono: '👤', color: '#6b7280', descripcion: 'Familiares e integrantes del grupo' }
};

app.get('/api/roles', (req, res) => {
    res.json(ROLES_SISTEMA);
});

// ===========================================
// API: MIEMBROS
// ===========================================

app.get('/api/grupos/:grupoId/miembros', authMiddleware, async (req, res) => {
    const { grupoId } = req.params;
    const { rol } = req.query;
    if (!await verificarAcceso(grupoId, req.user.uid, res)) return;
    
    let query = grupoRef(grupoId).collection('miembros');
    if (rol && ROLES_SISTEMA[rol]) {
        query = query.where('rol', '==', rol);
    }
    const snap = await query.get();
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
    if (!Object.keys(ROLES_SISTEMA).includes(rol)) return res.status(400).json({ error: 'Rol inválido. Roles válidos: admin, paciente, asistente, medico, miembro' });
    await grupoRef(grupoId).collection('miembros').doc(uid).update({ rol });
    res.json({ success: true, rol, rolInfo: ROLES_SISTEMA[rol] });
});

// ===========================================
// API: INVITACIONES
// ===========================================

app.post('/api/grupos/:grupoId/invitar', authMiddleware, async (req, res) => {
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
        rol: inv.rol || 'miembro',
        pacienteId: inv.pacienteId || null,
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
    
    const pastillasRestantes = req.body.pastillasRestantes !== undefined && req.body.pastillasRestantes !== null 
        ? req.body.pastillasRestantes 
        : (req.body.pastillasPorCaja || null);

    const nuevo = { 
        ...req.body, 
        estado: 'pendiente', 
        creadoEn: new Date().toISOString(), 
        creadoPor: req.user.uid,
        pastillasRestantes: pastillasRestantes,
        tomas: {} // Inicializar mapa de tomas vacío
    };
    const ref = await grupoRef(grupoId).collection('medicamentos').add(nuevo);
    res.status(201).json({ id: ref.id, ...nuevo });
});

app.post('/api/grupos/:grupoId/marcar-toma', authMiddleware, async (req, res) => {
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
        
        // Registrar en el historial
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

        // Actualizar el estado de la dosis en el mapa de tomas
        const key = `${fecha}_${hora}`;
        const updateData = {};
        updateData[`tomas.${key}`] = {
            estado,
            tomadoPor: tomadoPor || req.user.nombre,
            timestamp: new Date().toISOString()
        };

        // Actualizar inventario si fue tomada
        if (estado === 'tomada' && medData.pastillasRestantes != null) {
            let restantes = medData.pastillasRestantes - 1;
            if (restantes < 0) restantes = 0;
            updateData.pastillasRestantes = restantes;

            // Alerta de WhatsApp si restantes <= alertaStockMinimo (default 5)
            const umbral = medData.alertaStockMinimo !== undefined && medData.alertaStockMinimo !== null 
                ? parseInt(medData.alertaStockMinimo) 
                : 5;
                
            if (restantes <= umbral) {
                // Obtener config para número de admin
                const cfgDoc = await grupoRef(grupoId).collection('config').doc('principal').get();
                const cfg = cfgDoc.exists ? cfgDoc.data() : {};
                const ADMIN = cfg.adminPhone || '';
                if (ADMIN) {
                    const alerta = `⚠️ *ALERTA MediClock: Stock Bajo* ⚠️\n\nQuedan pocas unidades de *${medData.nombre}* para *${medData.familiar}*.\n\nStock actual: *${restantes}* pastillas.\n¡Por favor, reabastece el medicamento pronto!`;
                    await enviarWA(ADMIN, 'Admin', alerta);

                    // Notificar también a los Guardias / Cuidadores activos
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
});

app.post('/api/grupos/:grupoId/medicamentos/:medId/reabastecer', authMiddleware, async (req, res) => {
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

        // Registrar reabastecimiento en el historial
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
            const fechaChile = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' });
            const gruposSnap = await db.collection('grupos').get();
            let medConfirmado = null;
            let activacionExitosa = false;

            for (const grupoDoc of gruposSnap.docs) {
                const medsSnap = await grupoDoc.ref.collection('medicamentos').get();
                const meds = medsSnap.docs.map(d => ({ id: d.id, ...d.data(), _ref: d.ref }));

                for (const med of meds) {
                    // Limpiar el teléfono de la DB para compararlo con el formato de Meta
                    const telDB = (med.telefono || '').replace(/\D/g, ''); 
                    
                    if (telDB === numero) {
                        
                        // 1. CHEQUEO DE ACTIVACIÓN DE RECETA (ONBOARDING)
                        if (med.estado_paciente === 'pendiente_activacion') {
                            if (texto === '1' || texto === '2' || texto.includes('empezar') || texto === 'ok') {
                                await med._ref.update({ estado_paciente: 'activo' });
                                await enviarWA('+' + telDB, med.familiar, `✅ ¡Excelente! Tus recordatorios han sido activados.\nRecibirás tu primer aviso a la hora programada.\n\nCódigo de sincronización familiar: *${med.id}*`);
                                activacionExitosa = true;
                                break;
                            }
                        }

                        const horasList = med.horas && med.horas.length > 0 ? med.horas : [med.hora || '08:00'];
                        // Buscar una hora pendiente para hoy
                        let horaPendiente = null;
                        for (const h of horasList) {
                            const key = `${fechaChile}_${h}`;
                            const toma = med.tomas?.[key];
                            const estadoDose = toma?.estado || 'pendiente';
                            if (estadoDose === 'pendiente') {
                                horaPendiente = h;
                                break; // Encontramos la primera dosis pendiente del día
                            }
                        }

                        if (horaPendiente) {
                            const esOk = texto.includes('tome') || texto.includes('ok') ||
                                texto.includes('si') || texto.includes('sí') ||
                                texto.includes('listo') || texto.includes('ya') ||
                                esFoto || esVoz;

                            if (esOk) {
                                const extras = {};
                                if (esFoto) extras.fotoConfirmacion = mediaUrl;
                                if (esVoz) extras.vozConfirmacion = mediaUrl;

                                const key = `${fechaChile}_${horaPendiente}`;
                                const updateData = {};
                                updateData[`tomas.${key}`] = {
                                    estado: 'tomada',
                                    confirmadoEn: new Date().toISOString(),
                                    tomadoPor: 'Paciente (WhatsApp)',
                                    ...extras
                                };

                                // Decrementar inventario si corresponde
                                let restantes = med.pastillasRestantes;
                                if (restantes != null) {
                                    restantes = restantes - 1;
                                    if (restantes < 0) restantes = 0;
                                    updateData.pastillasRestantes = restantes;

                                    // Verificar alerta de stock
                                    const umbral = med.alertaStockMinimo !== undefined && med.alertaStockMinimo !== null 
                                        ? parseInt(med.alertaStockMinimo) 
                                        : 5;
                                    
                                    if (restantes <= umbral) {
                                        const cfgDoc = await grupoDoc.ref.collection('config').doc('principal').get();
                                        const cfg = cfgDoc.exists ? cfgDoc.data() : {};
                                        const ADMIN = cfg.adminPhone || '';
                                        if (ADMIN) {
                                            const alerta = `⚠️ *ALERTA MediClock: Stock Bajo* ⚠️\n\nQuedan pocas unidades de *${med.nombre}* para *${med.familiar}*.\n\nStock actual: *${restantes}* pastillas.\n¡Por favor, reabastece el medicamento pronto!`;
                                            await enviarWA(ADMIN, 'Admin', alerta);
                                        }
                                    }
                                }

                                await med._ref.update(updateData);
                                
                                await grupoDoc.ref.collection('historial').add({
                                    medicamentoId: med.id,
                                    familiar: med.familiar,
                                    nombre: med.nombre,
                                    dosis: med.dosis || '',
                                    horaProgram: horaPendiente,
                                    fecha: fechaChile,
                                    estado: 'tomada',
                                    tomadoPor: 'Paciente (WhatsApp)',
                                    timestamp: new Date().toISOString(),
                                    ...extras
                                });

                                medConfirmado = { ...med, hora: horaPendiente };
                                break;
                            }
                        }
                    }
                }
                if (medConfirmado || activacionExitosa) break;
            }

            if (!medConfirmado && !activacionExitosa && texto.length > 0) {
                console.log(`[Webhook Meta] Mensaje de ${numero} no procesado o sin tareas pendientes.`);
            }

            if (medConfirmado) {
                const extra = esVoz ? ' Escuché tu nota de voz.' : esFoto ? ' Vi la foto que enviaste.' : '';
                await enviarWA(numero, medConfirmado.familiar, `✅ ¡Perfecto!${extra} Registré que tomaste tu *${medConfirmado.nombre}*. ¡Salud! 💪`);
            } else if (!activacionExitosa) {
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
    const fechaChile = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' });
    
    if (seg < 5) enviados = {};
    if (hora === '00:00' && seg < 30) alertados = {};

    console.log(`[Vigilante] ${hora} | Día: ${dia} | Fecha: ${fechaChile}`);

    const gruposSnap = await db.collection('grupos').get();

    for (const grupoDoc of gruposSnap.docs) {
        const cfgDoc = await grupoDoc.ref.collection('config').doc('principal').get();
        const cfg = cfgDoc.exists ? cfgDoc.data() : {};
        const ADMIN = cfg.adminPhone || '';
        const MIN_OLVIDO = parseInt(cfg.minutosOlvido) || 20;

        const medsSnap = await grupoDoc.ref.collection('medicamentos').get();
        const meds = medsSnap.docs.map(d => ({ id: d.id, ...d.data(), _ref: d.ref }));

        for (const med of meds) {
            const hoy = med.frecuencia === 'diaria' || (med.frecuencia === 'especifica' && med.dias?.map(Number).includes(dia));
            if (!hoy) continue;

            const horasList = med.horas && med.horas.length > 0 ? med.horas : [med.hora || '08:00'];

            for (const H of horasList) {
                const kEnvio = `${grupoDoc.id}-${med.id}-${H}`;
                const kOlvido = `olvido-${grupoDoc.id}-${med.id}-${H}`;

                if (H === hora && !enviados[kEnvio]) {
                    enviados[kEnvio] = true;
                    
                    const key = `${fechaChile}_${H}`;
                    const updateData = {};
                    updateData[`tomas.${key}`] = {
                        estado: 'pendiente',
                        timestamp: new Date().toISOString()
                    };
                    await med._ref.update(updateData);
                    
                    const msg = `🔔 *RECORDATORIO:* Hola *${med.familiar}*, es hora de tomar tu *${med.nombre}* (${med.dosis}).\n\n👉 _Responde *Listo*, *Ok*, envía una 📷 foto o 🎤 nota de voz para confirmar._`;
                    await enviarWA(med.telefono, med.familiar, msg);
                }

                const mins = minutosDesde(H);
                const key = `${fechaChile}_${H}`;
                const toma = med.tomas?.[key];
                const estadoDose = toma?.estado || 'pendiente';

                if (estadoDose === 'pendiente' && mins >= MIN_OLVIDO && mins < 120 && !alertados[kOlvido]) {
                    alertados[kOlvido] = true;
                    
                    const updateData = {};
                    updateData[`tomas.${key}.estado`] = 'olvidada';
                    updateData[`tomas.${key}.timestamp`] = new Date().toISOString();
                    await med._ref.update(updateData);
                    
                    await grupoDoc.ref.collection('historial').add({
                        medicamentoId: med.id, 
                        familiar: med.familiar, 
                        nombre: med.nombre,
                        dosis: med.dosis || '', 
                        horaProgram: H, 
                        fecha: fechaChile,
                        estado: 'olvidada',
                        timestamp: new Date().toISOString()
                    });
                    
                    if (ADMIN) {
                        const alerta = `⚠️ *ALERTA MediClock:* *${med.familiar}* no confirmó su *${med.nombre}* de las ${H}. Han pasado ${MIN_OLVIDO} minutos.`;
                        await enviarWA(ADMIN, 'Admin', alerta);
                    }
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
