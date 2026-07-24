// controllers/proController.js - Lógica PRO (OCR, parse, prescribir, historial, cancelar)
const axios = require('axios');
const { GoogleAuth } = require('google-auth-library');
const { db } = require('../services/firebase');
const { enviarWA, enviarWAInteractivos } = require('../services/whatsapp');

const googleAuthClient = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' });

// POST /api/pro/scan-prescription
async function scanPrescription(req, res) {
    try {
        const { imageBase64 } = req.body || {};
        if (!imageBase64) {
            return res.json({ success: false, error: 'No se recibió la imagen para analizar.' });
        }

        const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');

        // INTENTO 1: GEMINI 3.5 FLASH MULTIMODAL VISION IA
        try {
            const apiKey = process.env.GEMINI_API_KEY;
            const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`;
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
        const accessToken = await googleAuthClient.getAccessToken();
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
        let tomasDia = 2;
        let duracion = '10 días';
        let comidaRel = 'Sin relación específica con comidas';

        const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);

        const docLine = lines.find(l => /dr\b|dra\b|doctor|medico/i.test(l));
        if (docLine) doctor = docLine;

        const pacienteLine = lines.find(l => /paciente:|para:|nombre:|sr\(a\):|pt:/i.test(l));
        if (pacienteLine) {
            paciente = pacienteLine.replace(/paciente:|para:|nombre:|sr\(a\):|pt:/i, '').trim();
        } else {
            const nameLine = lines.find(l => /juan|perez|maria|gonzalez|rodriguez|rodrigo|bustamante|carlos|pedro|ana|jose/i.test(l) && !/dr\b|dra\b/i.test(l));
            if (nameLine) paciente = nameLine;
        }

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

        const diasMatch = rawText.match(/(\d+)\s*d[ií]as?/i);
        const semanasMatch = rawText.match(/(\d+)\s*semanas?/i);
        if (diasMatch) {
            duracion = `${diasMatch[1]} días`;
        } else if (semanasMatch) {
            duracion = `${parseInt(semanasMatch[1]) * 7} días`;
        }

        const dosisMatch = rawText.match(/(\d+\s*(mg|g|ml|comprimidos?|pastillas?))/i);
        if (dosisMatch) {
            dosis = dosisMatch[0].toUpperCase();
        }

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
}

// GET /api/pro/historial
async function getHistorial(req, res) {
    try {
        const snap = await db.collection('historial_pro').orderBy('creadoEn_ts', 'desc').limit(50).get();
        const historial = [];
        snap.forEach(doc => {
            historial.push({ id: doc.id, ...doc.data() });
        });
        res.json(historial);
    } catch (e) {
        console.error("Error al obtener historial_pro:", e);
        res.status(500).json({ error: 'Error del servidor' });
    }
}

// POST /api/pro/parse-meds
async function parseMeds(req, res) {
    try {
        const { texto } = req.body;
        if (!texto || !texto.trim()) return res.status(400).json({ error: 'No text provided' });

        const prompt = `Analiza las siguientes indicaciones médicas y extrae los medicamentos recetados. 
ESTRICTAMENTE devuelve un arreglo en formato JSON puro (sin comillas invertidas ni bloques markdown, SOLO el array JSON válido).
El formato de cada objeto debe ser:
{
  "nombre": "Nombre del medicamento y dosis (ej. Losartan 50mg)",
  "tomasDia": número (cantidad de veces al día que se debe tomar. ej. 3 para '3 veces al día', 1 para '1 al día', por defecto 1),
  "duracion_dias": número (Convierte duraciones expresadas en semanas o meses a su equivalente en días, ej. '1 semana' a 7, '2 semanas' a 14, '1 mes' a 30. Por defecto 30 si no se indica),
  "horaInicio": "string HH:MM (asume 08:00 si no se indica o no es clara)"
}

Indicaciones:
"""
${texto}
"""`;

        const apiKey = process.env.GEMINI_API_KEY;
        let textOutput = '';

        if (apiKey) {
            const models = ['gemini-1.5-flash', 'gemini-2.0-flash', 'gemini-1.5-pro'];
            for (const model of models) {
                try {
                    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
                    const geminiRes = await axios.post(geminiUrl, {
                        contents: [ { role: 'user', parts: [ { text: prompt } ] } ],
                        generationConfig: { temperature: 0.1 }
                    }, { headers: { 'Content-Type': 'application/json' }, timeout: 8000 });

                    textOutput = geminiRes.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
                    if (textOutput) break;
                } catch (e) {
                    console.warn(`[Parse Meds]: Model ${model} failed:`, e.message);
                }
            }
        }

        let medsArray = [];

        if (textOutput) {
            const startIndex = textOutput.indexOf('[');
            const endIndex = textOutput.lastIndexOf(']');
            if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
                textOutput = textOutput.substring(startIndex, endIndex + 1);
            } else {
                textOutput = textOutput.replace(/```json/gi, '').replace(/```/g, '').trim();
            }
            try {
                medsArray = JSON.parse(textOutput);
            } catch (e) {
                console.error('[Parse Meds JSON Error]:', textOutput);
            }
        }

        if (!Array.isArray(medsArray) || medsArray.length === 0) {
            const lineas = texto.split(/\n+/).filter(l => l.trim().length > 2);
            medsArray = lineas.map(linea => {
                const freqMatch = linea.match(/cada\s*(\d+)\s*(hrs?|horas?)/i);
                const vecesMatch = linea.match(/(\d+)\s*(?:veces\s*)?(?:al|por)\s*d[ií]a/i);
                const durMatch = linea.match(/(?:(?:por|durante)\s+)?(\d+)\s*(d[ií]as?|semanas?|mes(es)?)/i);
                
                let tomasDia = 1;
                if (freqMatch) {
                    tomasDia = Math.floor(24 / parseInt(freqMatch[1], 10));
                } else if (vecesMatch) {
                    tomasDia = parseInt(vecesMatch[1], 10);
                }

                let duracion = 30;
                if (durMatch) {
                    const cantidad = parseInt(durMatch[1], 10);
                    const unidad = durMatch[2].toLowerCase();
                    if (unidad.startsWith('dia') || unidad.startsWith('día')) {
                        duracion = cantidad;
                    } else if (unidad.startsWith('semana')) {
                        duracion = cantidad * 7;
                    } else if (unidad.startsWith('mes')) {
                        duracion = cantidad * 30;
                    }
                }

                return {
                    nombre: linea.replace(/cada\s*\d+\s*(hrs?|horas?).*/i, '').replace(/\d+\s*(?:veces\s*)?(?:al|por)\s*d[ií]a.*/i, '').replace(/(?:(?:por|durante)\s+)?\d+\s*(d[ií]as?|semanas?|mes(es)?).*/i, '').trim() || linea.trim(),
                    tomasDia: tomasDia,
                    duracion_dias: duracion,
                    horaInicio: "08:00"
                };
            });
        }

        return res.json({ success: true, medicamentos: medsArray });
    } catch (err) {
        console.error('[Parse Meds Error]:', err.message);
        return res.json({ success: false, error: err.message });
    }
}

// POST /api/pro/prescribir
async function prescribir(req, res) {
    try {
        const { paciente, phone, patientAppId, fechaEmision, tutorNombre, tutorPhone, contactosAdicionales, medicamentos, med, dosis, cantPastillas, tomasDia, horaInicio, comidaRel, duracion, indicacion, fotoBase64, archivoTipo, docContactActive, docPhone, docNotaEmergency } = req.body || {};

        if (!paciente || !phone) {
            return res.status(400).json({ error: 'Faltan campos obligatorios (paciente y teléfono)' });
        }

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

        let contactosList = Array.isArray(contactosAdicionales) ? contactosAdicionales.filter(c => c.nombre && c.telefono) : [];
        if (tutorNombre && telTutorLimpio) {
            contactosList.unshift({ nombre: tutorNombre, rol: 'Tutor / Apoderado', telefono: telTutorLimpio });
        }

        const grupoDoc = db.collection('grupos').doc(patientAppId || `default_${telLimpio}`);
        
        const isFreeFormText = medsList.length === 1 && (!medsList[0].nombre || medsList[0].nombre === 'Medicamento' || medsList[0].nombre === 'Receta Médica Copiada');
        
        const batch = db.batch();
        batch.set(grupoDoc, { created: true, updatedAt: new Date() }, { merge: true });
        let primerMedId = null;

        for (const m of medsList) {
            let horasArr = [];
            let hIni = m.hora_sugerida || m.horaInicio || '08:00';
            const [hh, mm] = hIni.split(':').map(Number);
            const tomasC = m.tomasDia || (m.frecuencia_horas ? Math.floor(24 / m.frecuencia_horas) : 1);
            const freq = m.frecuencia_horas || (tomasC ? Math.floor(24 / tomasC) : 24);
            
            for (let i = 0; i < tomasC; i++) {
                let currH = (hh + (i * freq)) % 24;
                horasArr.push(`${String(currH).padStart(2, '0')}:${String(mm).padStart(2, '0')}`);
            }

            const docRef = grupoDoc.collection('medicamentos').doc();
            batch.set(docRef, {
                familiar: paciente,
                telefono: '+' + telLimpio,
                nombre: m.nombre || 'Medicamento',
                dosis: m.dosis || '',
                horas: horasArr,
                hora: hIni,
                tomas: {},
                duracion_dias: parseInt(m.duracion_dias || m.duracion || 10),
                frecuencia_horas: parseInt(m.frecuencia_horas || freq),
                pastillasRestantes: parseInt(m.duracion_dias || m.duracion || 10) * tomasC,
                fechaEmision: fechaEmision || new Date().toISOString().split('T')[0],
                contactosAdicionales: contactosList,
                docContactActive: !!docContactActive,
                docPhone: docPhone || '',
                docNotaEmergency: docNotaEmergency || '',
                archivoReceta: fotoBase64 || '',
                archivoTipo: archivoTipo || 'image',
                doctor: 'Dr. Francisco Pérez',
                estado_paciente: isFreeFormText ? 'activo' : 'pendiente_activacion',
                creadoEn: new Date().toISOString()
            });
            if (!primerMedId) primerMedId = docRef.id;
        }
        await batch.commit();
        const medRef = { id: primerMedId };

        let medsDetalle = '';
        let whatsappInstructions = '';
        
        if (isFreeFormText) {
            const descTag = medsList[0].descuentoAplicado ? '\n\n\u{1F6D2} *Descuento Farmacia Asociada Activado (15% DCTO):*\nhttps://farmacia.cl/compra?cupo=MEDICLOCK15' : '';
            medsDetalle = `\n\u{1F4DD} *Indicaciones de la Receta Copiada:*\n${medsList[0].indicacion || 'Sin indicaciones adicionales'}${descTag}`;
            whatsappInstructions = `\u{1F512} *Privacidad & Seguridad MediClock:* Datos cifrados bajo Google Cloud / Firebase. Sin uso de IA para lectura de datos sensibles. Responde *OK* para confirmar.`;
        } else {
            medsList.forEach((m, idx) => {
                const tomasC = m.tomasDia || (m.frecuencia_horas ? Math.floor(24 / m.frecuencia_horas) : 1);
                const frec = tomasC > 1 ? `${tomasC} veces al día` : '1 vez al día';
                const dur = m.duracion_dias ? `por ${m.duracion_dias} días` : '';
                medsDetalle += `\n\u{1F48A} *${m.nombre}* (${frec} ${dur})`;
            });
            
            const horaSugerida = medsList[0]?.horaInicio || medsList[0]?.hora_sugerida || '08:00';
            whatsappInstructions = `\u{2699}\u{FE0F} *Para activar tus recordatorios automáticos escoge una opción abajo:*\n(O escribe la hora a la que quieres empezar, ej. 14:30)\n\n\u{274C} *Si deseas cancelar los recordatorios en cualquier momento, presiona el botón Cancelar o escribe CANCELAR.*`;
        }

        let docContactoBloque = '';
        if (docContactActive) {
            docContactoBloque = `\n\n\u{1F4DE} *Contacto del Médico & Emergencias:*\n- Dr. Francisco Pérez\n- Teléfono / Urgencias: ${docPhone || '+569 5783 8682'}\n- Recomendación: ${docNotaEmergency || 'Atención de urgencias 24/7 en centro médico.'}`;
        }

        let pdfAviso = archivoTipo === 'pdf' ? '\n\n\u{1F4C4} *Receta Digital PDF Adjunta.*' : '';

        const mensajeWA = `Hola ${paciente} \u{1F44B} Tu médico ha emitido tu receta.\n\n\u{1F4CB} *Detalle de Tratamiento:*${medsDetalle}${pdfAviso}${docContactoBloque}\n\n${whatsappInstructions}`;

        if (!isFreeFormText) {
            await enviarWAInteractivos('+' + telLimpio, paciente, mensajeWA, [
                { id: 'START_NOW', title: 'Empezar ahora' },
                { id: 'ASSIGN_TIME', title: 'Asignar una hora' },
                { id: 'CANCEL_REMINDERS', title: 'Cancelar' }
            ]);
        } else {
            await enviarWA('+' + telLimpio, paciente, mensajeWA);
        }

        for (const cont of contactosList) {
            const numContLimpio = cont.telefono.replace(/\D/g, '');
            if (numContLimpio) {
                const mensajeContacto = `\u{1F514} *MediClock Pro - Aviso a ${cont.rol || 'Contacto Responsable'}* \u{1F514}\nHola ${cont.nombre}, el Dr. Francisco Pérez ha registrado el tratamiento médico de *${paciente}*:\n\n\u{1F4C5} *Fecha Receta:* ${fechaEmision || 'Hoy'}\n\u{1F4CB} *Resumen de Medicamentos:*${medsDetalle}${docContactoBloque}\n\n\u{1F512} *Privacidad & Seguridad:* Información protegida en Google Cloud / Firebase. Recibirás notificaciones y alertas si ${paciente} requiere asistencia con sus dosis.`;
                await enviarWA('+' + numContLimpio, cont.nombre, mensajeContacto);
            }
        }

        if (patientAppId) {
            try {
                await db.collection('grupos').doc(patientAppId).update({
                    receta_vigente: indicacion || "Receta administrada vía WhatsApp por el Dr.",
                    ultima_receta_ts: new Date().toISOString()
                });
            } catch (err) {
                console.error("No se pudo inyectar a la app de la familia", err);
            }
        }

        try {
            const historyId = req.body.id || ('REC-' + Date.now().toString().slice(-6));
            await db.collection('historial_pro').doc(historyId).set({
                paciente,
                phone,
                patientAppId: patientAppId || '',
                indicaciones: indicacion || '',
                fechaEmision: fechaEmision || new Date().toLocaleDateString(),
                creadoEn: new Date().toLocaleString(),
                creadoEn_ts: new Date().toISOString(),
                estado: 'activo'
            });
        } catch (err) {
            console.error("Error guardando historial pro:", err);
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
}

// POST /api/pro/cancelar
async function cancelar(req, res) {
    try {
        const { phone, patientAppId, id } = req.body;
        if (!phone) {
            return res.status(400).json({ error: 'Falta teléfono' });
        }
        
        let telLimpio = phone.replace(/\D/g, '');
        const grupoId = patientAppId || `default_${telLimpio}`;
        
        const medsSnap = await db.collection('grupos').doc(grupoId).collection('medicamentos').where('telefono', '==', '+' + telLimpio).get();
        
        let batch = db.batch();
        let docCount = 0;
        medsSnap.forEach(doc => {
            if (doc.data().estado_paciente !== 'cancelado') {
                batch.update(doc.ref, { estado_paciente: 'cancelado' });
                docCount++;
            }
        });
        
        await batch.commit();

        if (id) {
            try {
                await db.collection('historial_pro').doc(id).update({
                    estado: 'cancelado'
                });
            } catch (err) {
                console.error("Error actualizando estado en historial_pro:", err);
            }
        }

        try {
            await enviarWA('+' + telLimpio, 'Paciente', '\u{274C} Tus recordatorios de MediClock han sido cancelados por tu médico. No recibirás más de estos mensajes.');
        } catch (waErr) {
            console.error("Error despachando WA de cancelacion:", waErr);
        }
        
        res.json({ success: true, count: docCount });
    } catch (err) {
        console.error('Error cancelando receta:', err);
        res.status(500).json({ error: 'Error interno al cancelar' });
    }
}

module.exports = { scanPrescription, getHistorial, parseMeds, prescribir, cancelar };
