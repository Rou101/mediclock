const admin = require('firebase-admin');
const serviceAccount = require('./.secrets/serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function check() {
    const grupos = await db.collection('grupos').get();
    for (const g of grupos.docs) {
        const meds = await g.ref.collection('medicamentos').where('telefono', '==', '+56957838682').get();
        meds.docs.forEach(m => console.log(m.id, m.data().estado_paciente, m.data().hora, m.data().nombre));
    }
}
check();
