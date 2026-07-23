const admin = require("firebase-admin");
const serviceAccount = require("./firebase-admin.json");
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
async function run() {
    const grupos = await db.collection("grupos").get();
    for (const g of grupos.docs) {
        const meds = await g.ref.collection("medicamentos").get();
        for (const m of meds.docs) {
            const data = m.data();
            if (data.telefono && data.telefono.includes("56957838682")) {
                console.log(`Med: ${data.nombre}, Estado: ${data.estado_paciente}`);
            }
        }
    }
}
run();
