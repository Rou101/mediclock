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

2. **Arquitectura (Modular desde Fase 4):**
   - `index.js` es solo el entry point (~42 líneas): Express, middlewares globales y montaje de rutas.
   - `services/` contiene la lógica reutilizable: Firebase, WhatsApp, Motor Vigilante.
   - `middleware/` contiene la autenticación JWT.
   - `controllers/` contiene la lógica de negocio por dominio (PRO, Grupos, Webhook).
   - `routes/` define los endpoints Express agrupados por dominio.
   - El frontend principal habita en `public/`.
   - Las consultas a Firestore deben respetar el esquema de grupos familiares (/api/grupos/:id/...) y la separación por pacientes.

3. **Interfaz de Usuario (UI/UX):**
   - Estilo oscuro / neumórfico con paleta de colores cuidada y micro-animaciones en botones interactivos.
   - Soporte para PWA instalable en dispositivos móviles (iOS / Android).

---

## 🚀 Flujo de Trabajo y Sincronización en Múltiples Equipos

- Al realizar cambios o actualizar estas instrucciones, guarda y realiza git push al repositorio de GitHub.
- En cualquier otro equipo donde abras este proyecto en Antigravity, ejecuta git pull para actualizar el repositorio. Antigravity leerá automáticamente las instrucciones contenidas en .agents/AGENTS.md.

---

### 📝 Estado de la Sesión Actual (MediClock Pro v32.0.0)

- **Hitos Alcanzados (Fase 1 y Fase 2 Completadas):**
  - **Historial en la Nube Real (Fase 1):** La interfaz PRO ya lee y graba directo en Firestore (`historial_pro`), superando las limitaciones y desincronizaciones de localStorage.
  - **Resolución de Bugs en UI (Fase 1):** El modal de éxito ahora limpia completamente el DOM (medicamentos y contactos adicionales) y soluciona un error de Javascript (`r-fecha` nulo) que congelaba la consola al cargar la página.
  - **Conversión Inteligente de Días (Fase 1):** Conversión automática de semanas/meses a días en el transcriptor.
  - **Endpoint de Cancelación (Fase 1):** Endpoint `/api/pro/cancelar` con confirmación por WhatsApp.
  - **Webhook de WhatsApp (Fase 1):** Corregido bug de referencia (`med.ref` vs `med._ref`).
  - **Webhook "Asignar hora" (Fase 2):** Implementada la regla exacta `/\bs[ií]\b/i` para el trigger de confirmación en `index.js`.

- **Hitos Alcanzados (Fase 3 Completada):**
  - **Seguridad / Autenticación Pro:** Creada la página `/login.html` conectada a Firebase Auth y protegido el acceso a `/pro.html` redirigiendo a usuarios sin sesión activa.
  - **Blindaje Backend:** Asegurados todos los endpoints médicos `/api/pro/*` con un middleware de servidor que valida los tokens JWT enviados en las cabeceras HTTP `Authorization: Bearer <TOKEN>`.
  - **Resolución Colisiones Multi-Medicamento:** El bot ya no confirma medicamentos erróneos. Ahora calcula la diferencia en minutos entre la hora actual y las dosis del paciente, auto-confirmando el más cercano.
  - **Remoción de Paréntesis Vacíos:** Se oculta el formato `()` en los recordatorios cuando no hay dosis definida.

- **Hitos Alcanzados (Fase 4 Completada):**
  - **Refactorización Modular:** `index.js` reducido de 1661 a 42 líneas. Lógica desacoplada en:
    - `services/` (firebase.js, whatsapp.js, vigilante.js)
    - `middleware/` (authMiddleware.js)
    - `controllers/` (proController.js, grupoController.js, webhookController.js)
    - `routes/` (proRoutes.js, grupoRoutes.js, webhookRoutes.js, generalRoutes.js)

- **BACKLOG / PRÓXIMO PASO:**
  - Desplegar la nueva arquitectura modular en Cloud Run y validar en producción.
