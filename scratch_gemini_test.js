const { GoogleAuth } = require('google-auth-library');
const axios = require('axios');

async function test() {
    try {
        const texto = `Aspirina de 40 mg, 3 veces al dia, por 10 dias
Paracetamol 10 mg, 1 al dia por 15 dias
Omeprazon antes de las comidas por 1 semana`;
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
        console.log("Raw output:", textOutput);
        
        textOutput = textOutput.replace(/```json/gi, '').replace(/```/g, '').trim();
        
        let medsArray = JSON.parse(textOutput);
        console.log("Parsed JSON:", medsArray);
    } catch (e) {
        console.error("ERROR:", e.response?.data || e.message);
    }
}
test();
