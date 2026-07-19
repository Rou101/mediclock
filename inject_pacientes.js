const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const fsApp = initializeApp({ projectId: 'mediclock-recordatorios' });
const db = getFirestore(fsApp);

async function injectPacientes() {
    console.log('Fetching groups...');
    const grupos = await db.collection('grupos').get();
    
    const dummyPacientes = [
        { nombre: 'Papá', telefono: '+56911111111', condicion: 'Hipertensión' },
        { nombre: 'Mamá', telefono: '+56922222222', condicion: 'Diabetes' },
        { nombre: 'Abuelo', telefono: '', condicion: 'Colesterol' },
        { nombre: 'Hijo', telefono: '', condicion: 'Ninguna' }
    ];

    let count = 0;
    for (const grupo of grupos.docs) {
        const pacRef = db.collection('grupos').doc(grupo.id).collection('pacientes');
        
        // Check if there are already patients
        const existing = await pacRef.get();
        if (existing.empty) {
            console.log(`Injecting into group ${grupo.id}...`);
            for (const p of dummyPacientes) {
                await pacRef.add({ ...p, creadoEn: new Date().toISOString() });
            }
            count++;
        } else {
            console.log(`Group ${grupo.id} already has patients. Skipping.`);
        }
    }
    console.log(`Successfully injected into ${count} groups.`);
}

injectPacientes().catch(console.error);
