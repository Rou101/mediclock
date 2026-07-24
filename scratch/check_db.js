const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const serviceAccount = require('../serviceAccountKey.json');

const firebaseApp = initializeApp({
    credential: cert(serviceAccount)
});
const db = getFirestore(firebaseApp);

async function check() {
    console.log("Checking DB...");
    const groupsSnap = await db.collection('grupos').get();
    console.log("Total groups:", groupsSnap.size);
    for (const doc of groupsSnap.docs) {
        const medsSnap = await doc.ref.collection('medicamentos').get();
        if (medsSnap.size > 0) {
            console.log(`Group: ${doc.id} has ${medsSnap.size} meds:`);
            medsSnap.forEach(m => {
                const data = m.data();
                console.log(`  - Med ID: ${m.id}, Nombre: ${data.nombre}, Tel: ${data.telefono}, Estado: ${data.estado_paciente}`);
            });
        }
    }
}
check().catch(console.error);
