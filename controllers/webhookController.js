// controllers/webhookController.js - Webhook conversacional Meta WhatsApp
const { db } = require('../services/firebase');
const { enviarWA } = require('../services/whatsapp');
const { horaChile } = require('../services/vigilante');

const META_WEBHOOK_VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN || 'mediclock_secure_token_123';

// GET /api/meta-webhook (Verificación)
function verify(req, res) {
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
}

// GET /api/test-meds
async function testMeds(req, res) {
    try {
        const grupoDoc = await db.collection('grupos').doc('default_pro').get();
        const medsSnap = await grupoDoc.ref.collection('medicamentos').where('telefono', '==', '+56957838682').get();
        const result = medsSnap.docs.map(d => ({ id: d.id, estado: d.data().estado_paciente, hora: d.data().hora, nombre: d.data().nombre, horas: d.data().horas, tomas: d.data().tomas }));
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

// POST /api/meta-webhook (Recepción de mensajes)
async function receive(req, res) {
    const body = req.body;

    if (body.object === 'whatsapp_business_account') {
        const entry = body.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;
        const messages = value?.messages;

        if (messages && messages[0]) {
            const message = messages[0];
            const numero = message.from;
            const messageType = message.type;
            
            let texto = '';
            let mediaUrl = null;
            let esVoz = false;
            let esFoto = false;

            if (messageType === 'text') {
                texto = message.text.body.trim().toLowerCase();
            } else if (messageType === 'interactive' && message.interactive.type === 'button_reply') {
                const btnId = message.interactive.button_reply.id;
                if (btnId === 'START_NOW') {
                    texto = '2';
                } else if (btnId === 'ASSIGN_TIME') {
                    texto = 'asignar_hora';
                } else if (btnId === 'CANCEL_REMINDERS') {
                    texto = 'cancelar';
                }
            } else if (messageType === 'audio') {
                esVoz = true;
                mediaUrl = message.audio.id;
            } else if (messageType === 'image') {
                esFoto = true;
                mediaUrl = message.image.id;
            }

            console.log(`[Webhook Meta] De ${numero}: "${texto}" (Tipo: ${messageType})`);

            const fechaChile = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' });
            const gruposSnap = await db.collection('grupos').get();
            const matchingMeds = [];
            for (const grupoDoc of gruposSnap.docs) {
                const medsSnap = await grupoDoc.ref.collection('medicamentos').get();
                medsSnap.forEach(d => {
                    const medData = d.data();
                    const telDB = (medData.telefono || '').replace(/\D/g, '');
                    if (telDB === numero) {
                        matchingMeds.push({
                            id: d.id,
                            ...medData,
                            _ref: d.ref,
                            _grupoDoc: grupoDoc
                        });
                    }
                });
            }

            if (matchingMeds.length === 0) {
                if (texto.length > 0) {
                    console.log(`[Webhook Meta] Mensaje de ${numero} sin medicamentos en la base de datos.`);
                }
                return res.sendStatus(200);
            }

            if (texto === 'cancelar' || texto === 'cancel') {
                for (const med of matchingMeds) {
                    await med._ref.update({ estado_paciente: 'cancelado' });
                }
                await enviarWA('+' + numero, 'Paciente', '\u{274C} Tus recordatorios de MediClock han sido cancelados. No recibir\u00e1s m\u00e1s mensajes para esta receta.');
                return res.sendStatus(200);
            }

            if (texto === 'asignar_hora' || texto === 'asignar una hora') {
                await enviarWA('+' + numero, 'Paciente', `\u{23F0} Por favor, escribe la hora exacta a la que deseas comenzar tus recordatorios.\n\n\u{1F447} *Ejemplo: 14:30 o 9 AM*`);
                return res.sendStatus(200);
            }

            const timeMatch = texto.match(/\b([01]?\d|2[0-3])[:.h]?([0-5]\d)?\b/i);
            const isButtonResponse = texto.trim() === '1' || texto.trim() === '2';
            const wantsCustomTime = !isButtonResponse && timeMatch;

            let pendingActivationMeds = matchingMeds.filter(m => m.estado_paciente === 'pendiente_activacion' || (m.estado_paciente === 'activo' && wantsCustomTime));
            let activacionExitosa = false;
            let medConfirmado = null;
            
            if (pendingActivationMeds.length > 0 && (isButtonResponse || wantsCustomTime)) {
                let newStartTime = null;
                if (texto === '2' || texto.includes('ahora')) {
                    const now = new Date();
                    newStartTime = new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
                } else if (wantsCustomTime) {
                    const hh = timeMatch[1].padStart(2, '0');
                    const mm = timeMatch[2] ? timeMatch[2].padStart(2, '0') : '00';
                    newStartTime = `${hh}:${mm}`;
                }

                const batchUpdate = db.batch();
                for (const med of pendingActivationMeds) {
                    let updateData = { estado_paciente: 'activo' };
                    if (newStartTime) {
                        const freq = med.frecuencia_horas || 24;
                        const tomasC = Math.floor(24 / freq) || 1;
                        const [hIni, mIni] = newStartTime.split(':').map(Number);
                        let newHoras = [];
                        for (let i = 0; i < tomasC; i++) {
                            let currH = (hIni + (i * freq)) % 24;
                            newHoras.push(`${String(currH).padStart(2, '0')}:${String(mIni).padStart(2, '0')}`);
                        }
                        updateData.hora = newStartTime;
                        updateData.horas = newHoras;
                    }
                    batchUpdate.update(med._ref, updateData);
                }
                await batchUpdate.commit();
                
                const firstMed = pendingActivationMeds[0];
                const msgHora = newStartTime ? ` a las ${newStartTime}` : ' a la hora programada';
                await enviarWA('+' + numero, firstMed.familiar, `\u{2705} \u{00A1}Excelente! Tus recordatorios han sido activados.\nRecibir\u00e1s tu primer aviso${msgHora}.\n\nC\u00f3digo de sincronizaci\u00f3n familiar: *${firstMed.familiar.toUpperCase().substring(0,3)}${firstMed.id.substring(0,4)}*`);
                activacionExitosa = true;
                return res.sendStatus(200);
            }

            const esOk = texto.includes('tome') || texto.includes('ok') ||
                         /\bs[i\u00ed]\b/i.test(texto) ||
                         texto.includes('listo') || texto.includes('ya') ||
                         esFoto || esVoz;

            if (esOk) {
                const pendingDoses = [];
                const currentChileTime = horaChile().hora;
                const toMinutes = (timeStr) => { 
                    const [h, m] = timeStr.split(':').map(Number); 
                    return h * 60 + m; 
                };
                const currentMin = toMinutes(currentChileTime);

                for (const med of matchingMeds) {
                    const horasList = med.horas && med.horas.length > 0 ? med.horas : [med.hora || '08:00'];
                    for (const h of horasList) {
                        const key = `${fechaChile}_${h}`;
                        const toma = med.tomas?.[key];
                        const estadoDose = toma?.estado || 'pendiente';
                        if (estadoDose === 'pendiente') {
                            const diff = Math.abs(currentMin - toMinutes(h));
                            pendingDoses.push({
                                med,
                                hora: h,
                                diff,
                                key
                            });
                        }
                    }
                }

                if (pendingDoses.length > 0) {
                    let targetDoses = pendingDoses;
                    const textoLimpio = texto.toLowerCase();
                    
                    const matchingNameDoses = pendingDoses.filter(d => {
                        const name = (d.med.nombre || '').toLowerCase();
                        return textoLimpio.includes(name) || name.split(' ').some(word => word.length > 3 && textoLimpio.includes(word));
                    });

                    if (matchingNameDoses.length > 0) {
                        targetDoses = matchingNameDoses;
                    }

                    targetDoses.sort((a, b) => a.diff - b.diff);

                    const chosen = targetDoses[0];
                    const chosenMed = chosen.med;
                    const chosenKey = chosen.key;

                    const extras = {};
                    if (esFoto) extras.fotoConfirmacion = mediaUrl;
                    if (esVoz) extras.vozConfirmacion = mediaUrl;

                    const updateData = {};
                    updateData[`tomas.${chosenKey}`] = {
                        estado: 'tomada',
                        confirmadoEn: new Date().toISOString(),
                        tomadoPor: 'Paciente (WhatsApp)',
                        ...extras
                    };

                    let restantes = chosenMed.pastillasRestantes;
                    if (restantes != null) {
                        restantes = restantes - 1;
                        if (restantes < 0) restantes = 0;
                        updateData.pastillasRestantes = restantes;

                        const umbral = chosenMed.alertaStockMinimo !== undefined && chosenMed.alertaStockMinimo !== null 
                            ? parseInt(chosenMed.alertaStockMinimo) 
                            : 5;
                        
                        if (restantes <= umbral) {
                            const cfgDoc = await chosenMed._grupoDoc.ref.collection('config').doc('principal').get();
                            const cfg = cfgDoc.exists ? cfgDoc.data() : {};
                            const ADMIN = cfg.adminPhone || '';
                            if (ADMIN) {
                                const alerta = `\u{26A0}\u{FE0F} *ALERTA MediClock: Stock Bajo* \u{26A0}\u{FE0F}\n\nQuedan pocas unidades de *${chosenMed.nombre}* para *${chosenMed.familiar}*.\n\nStock actual: *${restantes}* pastillas.\n\u{00A1}Por favor, reabastece el medicamento pronto!`;
                                await enviarWA(ADMIN, 'Admin', alerta);
                            }
                        }
                    }

                    await chosenMed._ref.update(updateData);

                    await chosenMed._grupoDoc.ref.collection('historial').add({
                        medicamentoId: chosenMed.id,
                        familiar: chosenMed.familiar,
                        nombre: chosenMed.nombre,
                        dosis: chosenMed.dosis || '',
                        horaProgram: chosen.hora,
                        fecha: fechaChile,
                        estado: 'tomada',
                        tomadoPor: 'Paciente (WhatsApp)',
                        timestamp: new Date().toISOString(),
                        ...extras
                    });

                    medConfirmado = { ...chosenMed, hora: chosen.hora };
                }
            }

            if (medConfirmado) {
                const extra = esVoz ? ' Escuch\u00e9 tu nota de voz.' : esFoto ? ' Vi la foto que enviaste.' : '';
                await enviarWA(numero, medConfirmado.familiar, `\u{2705} \u{00A1}Perfecto!${extra} Registr\u00e9 que tomaste tu *${medConfirmado.nombre}*. \u{00A1}Salud! \u{1F4AA}`);
            } else if (!activacionExitosa) {
                await enviarWA(numero, 'Usuario', `Responde *"Listo"*, *"Ok"*, o env\u00eda una \u{1F4F7} foto o \u{1F3A4} nota de voz para confirmar tu medicamento.`);
            }
        }
        res.sendStatus(200);
    } else {
        res.sendStatus(404);
    }
}

module.exports = { verify, testMeds, receive };
