const axios = require('axios');

async function sendTestTutorWA() {
    const payload = {
        paciente: "Juan Carlos Pérez",
        phone: "56957838682",
        fechaEmision: "2026-07-21",
        tutorNombre: "Rodrigo (Tutor / Cuidador Responsable)",
        tutorPhone: "56957838682",
        med: "Aspirina",
        dosis: "500 MG",
        cantPastillas: "1 pastilla",
        tomasDia: 4,
        horaInicio: "08:00 AM",
        comidaRel: "Junto con las comidas",
        duracion: "15 días",
        indicacion: "Tomar con abundante agua"
    };

    try {
        console.log("Enviando petición a backend Cloud Run /api/pro/prescribir...");
        const res = await axios.post('https://mediclock-961339509446.us-central1.run.app/api/pro/prescribir', payload);
        console.log("Respuesta del Servidor:", res.data);
    } catch (err) {
        console.error("Error al enviar mensaje:", err.response?.data || err.message);
    }
}

sendTestTutorWA();
