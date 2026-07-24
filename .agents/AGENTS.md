# Reglas y Contexto del Proyecto: MediClock (ViejoAlarm)

Este archivo contiene las directrices del proyecto **MediClock** para que cualquier instancia de Antigravity (en esta o en cualquier otra PC) entienda automáticamente el contexto y la arquitectura de la aplicación al abrir el repositorio.

---

## 📌 Resumen del Proyecto

**MediClock** es una aplicación web progresiva (PWA) para la gestión y recordatorio colaborativo de medicamentos en grupos familiares y de cuidado.

- **Frontend:** Vanilla HTML, CSS3 puro (diseño neumórfico/oscuro con animaciones) y JavaScript Vanilla.
- **Backend:** Node.js con Express (index.js).
- **Base de Datos / Auth:** Firebase Firestore y Firebase Auth.
- **Despliegue:** Google Cloud Run (Docker / Serverless).

---

## 🛠️ Normas de Desarrollo

1. **Codificación de Archivos (UTF-8 obligatorio):**
   - Asegurarse de que todos los archivos .js, .html y .css se guarden con codificación **UTF-8 sin BOM**. Evitar errores de mojibake con caracteres o emojis.

2. **Arquitectura:**
   - Mantener la lógica modular. index.js gestiona los endpoints de Express.
   - El frontend principal habita en public/.
   - Las consultas a Firestore deben respetar el esquema de grupos familiares (/api/grupos/:id/...) y la separación por pacientes.

3. **Interfaz de Usuario (UI/UX):**
   - Estilo oscuro / neumórfico con paleta de colores cuidada y micro-animaciones en botones interactivos.
   - Soporte para PWA instalable en dispositivos móviles (iOS / Android).

---

## 🚀 Flujo de Trabajo y Sincronización en Múltiples Equipos

- Al realizar cambios o actualizar estas instrucciones, guarda y realiza git push al repositorio de GitHub.
- En cualquier otro equipo donde abras este proyecto en Antigravity, ejecuta git pull para actualizar el repositorio. Antigravity leerá automáticamente las instrucciones contenidas en .agents/AGENTS.md.

---

### 📝 Estado de la Sesión Actual (MediClock Pro v30.0.0)

- **Hitos Alcanzados (Fase 1 Completada):**
  - **Historial en la Nube Real:** La interfaz PRO ya lee y graba directo en Firestore (`historial_pro`), superando las limitaciones y desincronizaciones de localStorage.
  - **Resolución de Bugs en UI (DOM Purge):** El modal de éxito ahora limpia completamente el DOM (medicamentos y contactos adicionales) y soluciona un error de Javascript (`r-fecha` nulo) que congelaba la consola al cargar la página.
  - **Conversión Inteligente de Días:** Si el usuario ingresa semanas o meses en el transcriptor (ej: "1 semana" o "1 mes"), el servidor convierte automáticamente los tiempos a días (7 o 30 respectivamente) tanto por IA como por regex de respaldo.
  - **Endpoint de Cancelación:** Creado `/api/pro/cancelar` que marca las alarmas inactivas en el grupo familiar del paciente y le envía una confirmación inmediata por WhatsApp.
  - **Webhook de WhatsApp:** Corregido bug de referencia (`med.ref` vs `med._ref`) que provocaba que el bot de Meta diera error 500 al recibir cancelaciones por chat.

- **Webhook "Asignar hora" (Fase 2 Completada):**
  - Ya está implementada y funcionando la regla exacta `/\bs[ií]\b/i.test(texto)` para el trigger de confirmación en `index.js`, resolviendo la colisión con la sílaba "si" de la palabra "asignar".

- **BACKLOG / PRÓXIMO PASO URGENTE (Fase 3):**
  - **Seguridad / Autenticación Pro:** Crear una página de inicio con Login (Firebase Auth) para MediClock Pro. Proteger la ruta `/pro.html` y los endpoints del API `/api/pro/*` con un middleware que valide los tokens de Firebase Admin.
