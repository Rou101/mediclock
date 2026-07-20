# Reglas y Contexto del Proyecto: MediClock (ViejoAlarm)

Este archivo contiene las directrices del proyecto **MediClock** para que cualquier instancia de Antigravity (en esta o en cualquier otra PC) entienda automáticamente el contexto y la arquitectura de la aplicación al abrir el repositorio.

---

## 📌 Resumen del Proyecto

**MediClock** es una aplicación web progresiva (PWA) para la gestión y recordatorio colaborativo de medicamentos en grupos familiares y de cuidado.

- **Frontend:** Vanilla HTML, CSS3 puro (diseño neumórfico/oscuro con animaciones) y JavaScript Vanilla.
- **Backend:** Node.js con Express (`index.js`).
- **Base de Datos / Auth:** Firebase Firestore y Firebase Auth.
- **Despliegue:** Google Cloud Run (Docker / Serverless).

---

## 🛠️ Normas de Desarrollo

1. **Codificación de Archivos (UTF-8 obligatorio):**
   - Asegurarse de que todos los archivos `.js`, `.html` y `.css` se guarden con codificación **UTF-8 sin BOM**. Evitar errores de mojibake con caracteres o emojis.

2. **Arquitectura:**
   - Mantener la lógica modular. `index.js` gestiona los endpoints de Express.
   - El frontend principal habita en `public/`.
   - Las consultas a Firestore deben respetar el esquema de grupos familiares (`/api/grupos/:id/...`) y la separación por pacientes.

3. **Interfaz de Usuario (UI/UX):**
   - Estilo oscuro / neumórfico con paleta de colores cuidada y micro-animaciones en botones interactivos.
   - Soporte para PWA instalable en dispositivos móviles (iOS / Android).

---

## 🚀 Flujo de Trabajo y Sincronización en Múltiples Equipos

- Al realizar cambios o actualizar estas instrucciones, guarda y realiza `git push` al repositorio de GitHub.
- En cualquier otro equipo donde abras este proyecto en Antigravity, ejecuta `git pull` para actualizar el repositorio. Antigravity leerá automáticamente las instrucciones contenidas en `.agents/AGENTS.md`.
