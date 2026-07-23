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

### 📝 Estado de la Sesión Actual (MediClock Pro)

- **Maquetación UI (public/pro.html)**:
  - Todo el layout principal fue estabilizado. Se corrigió un bug grave en CSS Grid (un </div> huérfano) que rompía la simetría de las columnas.
  - Se implementó la limpieza forzosa (orm.reset() y alue = '') al cerrar la ventana de éxito para evitar datos "fantasmas" de pacientes anteriores.
  - Se agregó el campo opcional "ID de App MediClock" en la ficha del paciente.
  - El modal de confirmación ahora formatea visualmente los números chilenos a +56 9 XXXX XXXX para evitar errores.
- **Backend (index.js) & Transcripción IA**:
  - Expresiones Regulares (Regex) reforzadas para atrapar formatos como "12 veces al día" cuando la IA de Gemini falla o no está activa.
  - Interacciones WhatsApp Meta: El webhook procesa correctamente botones interactivos. Usamos la API de Graph para forzar la suscripción al entorno de desarrollo sin necesitar "Publicar" la app en Meta.
  - El webhook está activo y recibe mensajes, pero requiere un pequeño ajuste de Regex.

- **BACKLOG / PRÓXIMOS PASOS (URGENTE)**:
  1. **Bugfix Webhook "Asignar hora"**: Arreglar el bug donde el texto "asignar una hora" acciona el trigger de confirmación de pastilla por contener la sílaba "si". Requerido: Mejorar la regex a \bs[ií]\b y capturar correctamente la intención del botón de hora.
  2. **Bugfix UI Recetas**: Al cerrar el modal de éxito, la *lista visual de medicamentos* sigue sin vaciarse y los remedios quedan "mirando por la ventana". Se debe purgar el DOM de esos elementos al reiniciar el formulario.
  3. **Integración con MediClock App (Familia)**: Todo lo recetado en la interfaz PRO debe inyectarse a la App Familiar si el Doctor incluyó el "ID de App". El paciente y sus cuidadores deben poder ver las alarmas, la receta y el estado desde la app móvil.
  4. **Seguridad / Autenticación Pro**: Crear una página de inicio con Login (Firebase Auth) para MediClock Pro. No podemos dejar la interfaz pública en Cloud Run; cualquiera podría hacerse pasar por doctor y emitir recetas.
  5. **Auditoría de Seguridad y Ley de Datos (HIPAA/Chile)**:
     - Evaluar la implementación de encriptación de extremo a extremo para datos médicos (PII) en Firestore.
     - Implementar Términos y Condiciones / Consentimiento informado.
     - Cerrar vulnerabilidades de spam en la API con Rate Limiting y Auth Tokens.
  6. **Firestore (Historial en Nube)**: Reemplazar el almacenamiento local (LocalStorage) en el Frontend por Firebase real, para que el historial sea cruzado en todos los dispositivos del médico.
  7. **Botón Cancelar (Historial)**: Ligar el botón cancelar en UI con el endpoint del Backend (/api/pro/cancelar) para borrar recetas reales y detener el Vigilante (cronjob).

