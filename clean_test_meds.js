const admin = require('firebase-admin');

// Ensure you run: gcloud auth application-default login
admin.initializeApp({
  projectId: "mediclock-recordatorios"
});
const db = admin.firestore();

async function clean() {
    try {
        const grupoDoc = await db.collection('grupos').doc('default_pro').get();
        const medsSnap = await grupoDoc.ref.collection('medicamentos').where('telefono', '==', '+56957838682').get();
        
        console.log(`Borrando ${medsSnap.docs.length} medicamentos de prueba...`);
        const batch = db.batch();
        medsSnap.docs.forEach(d => {
            batch.delete(d.ref);
        });
        
        await batch.commit();
        console.log(`Borrados exitosamente.`);
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}
clean();
