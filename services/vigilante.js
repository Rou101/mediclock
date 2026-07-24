// services/vigilante.js - Motor del Vigilante (recordatorios automáticos)
const { db } = require('./firebase');
const { enviarWA } = require('./whatsapp');

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
            if (med.telefono === '+56957838682') {
                console.log(`[DEBUG] Check Med: ${med.nombre} | Frec: ${med.frecuencia} | Horas: ${JSON.stringify(med.horas)} | HoraChile: ${hora}`);
            }
            
            const hoy = !med.frecuencia || med.frecuencia === 'diaria' || (med.frecuencia === 'especifica' && med.dias?.map(Number).includes(dia));
            if (!hoy) {
                if (med.telefono === '+56957838682') console.log(`[DEBUG] Skipped ${med.nombre} due to !hoy`);
                continue;
            }

            const horasList = med.horas && med.horas.length > 0 ? med.horas : [med.hora || '08:00'];

            for (const H of horasList) {
                if (med.telefono === '+56957838682') {
                    console.log(`[DEBUG] H: ${H} | hora: ${hora} | enviados: ${!!enviados[`${grupoDoc.id}-${med.id}-${H}`]}`);
                }
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
                    
                    const dosisInfo = med.dosis ? ` (${med.dosis})` : '';
                    const msg = `\u{1F514} *RECORDATORIO:* Hola *${med.familiar}*, es hora de tomar tu *${med.nombre}*${dosisInfo}.\n\n\u{1F449} _Responde *Listo*, *Ok*, envía una \u{1F4F7} foto o \u{1F3A4} nota de voz para confirmar._`;
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
                        const alerta = `\u{26A0}\u{FE0F} *ALERTA MediClock:* *${med.familiar}* no confirmó su *${med.nombre}* de las ${H}. Han pasado ${MIN_OLVIDO} minutos.`;
                        await enviarWA(ADMIN, 'Admin', alerta);
                    }
                }
            }
        }
    }
}

module.exports = { horaChile, minutosDesde, verificarReloj };
