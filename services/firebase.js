// services/firebase.js - Inicialización centralizada de Firebase
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

const firebaseApp = initializeApp({ projectId: 'mediclock-recordatorios' });
const db = getFirestore(firebaseApp);
const adminAuth = getAuth(firebaseApp);

module.exports = { db, adminAuth };
