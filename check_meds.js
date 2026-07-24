const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function run() {
    const grupos = await db.collection('grupos').get();
    for (const g of grupos.docs) {
        const meds = await g.ref.collection('medicamentos').where('telefono', '==', '+56957838682').get();
        meds.docs.forEach(m => console.log(`ID: ${m.id} | Estado: ${m.data().estado_paciente} | Nombre: ${m.data().nombre}`));
    }
}
run().then(() => process.exit(0));
