const admin = require("firebase-admin");
const serviceAccount = require("./firebase-admin.json");
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
async function check() {
  const q = await db.collection("grupos").doc("default_pro").collection("medicamentos").get();
  q.docs.forEach(d => console.log(d.data().telefono, d.data().estado_paciente, !!d.data().medicamentos));
}
check();
