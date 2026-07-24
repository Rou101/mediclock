// services/whatsapp.js - Funciones de envío WhatsApp Cloud API
const axios = require('axios');

const META_WA_ACCESS_TOKEN = process.env.META_WA_ACCESS_TOKEN || '';
const META_WA_PHONE_NUMBER_ID = process.env.META_WA_PHONE_NUMBER_ID || '';

async function enviarWA(telefono, familiar, mensaje) {
    if (!META_WA_ACCESS_TOKEN) {
        console.log(`[SIMULADO WA Meta] Para ${familiar} (${telefono}): ${mensaje}`);
        return;
    }

    const telLimpio = (telefono || '').replace(/\D/g, '');
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

async function enviarWAInteractivos(telefono, familiar, mensaje, botones) {
    if (!META_WA_ACCESS_TOKEN) {
        console.log(`[SIMULADO WA Meta] (Interactivos) Para ${familiar} (${telefono}): ${mensaje} | Botones:`, botones.map(b => b.title));
        return;
    }

    const telLimpio = (telefono || '').replace(/\D/g, ''); 
    const url = `https://graph.facebook.com/v20.0/${META_WA_PHONE_NUMBER_ID}/messages`;
    
    try {
        const payloadBotones = botones.map(b => ({
            type: 'reply',
            reply: {
                id: b.id,
                title: b.title.substring(0, 20) // max 20 chars allowed by WhatsApp
            }
        }));

        const response = await axios.post(url, {
            messaging_product: 'whatsapp',
            to: telLimpio,
            type: 'interactive',
            interactive: {
                type: 'button',
                body: { text: mensaje },
                action: {
                    buttons: payloadBotones
                }
            }
        }, {
            headers: {
                'Authorization': `Bearer ${META_WA_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        console.log(`[OK] WA Meta Interactivos → ${familiar} (${telLimpio}). MsgID: ${response.data.messages[0].id}`);
    } catch (e) {
        console.error(`[ERROR] WA Meta Interactivos:`, e.response?.data || e.message);
    }
}

module.exports = { enviarWA, enviarWAInteractivos };
