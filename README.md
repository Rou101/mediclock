# ⏰ MediClock (ViejoAlarm) - Bitácora de Desarrollo

**MediClock** es una aplicación web (PWA) diseñada para ayudar a las familias a gestionar y compartir la responsabilidad de los medicamentos de sus adultos mayores (u otros pacientes). Centraliza recordatorios, historial clínico básico y un sistema de notificaciones colaborativo para que ningún paciente se quede sin su dosis.

## 💡 Idea Principal
El problema original que aborda MediClock es el "síndrome del cuidador principal". En muchas familias, una sola persona se lleva toda la carga mental de recordar, administrar y comprar los medicamentos del abuelo o de los hijos. 

**Solución:** Un panel de control familiar donde todos los miembros ("Hijos", "Cuidadores", "Enfermeros") pueden ver qué remedio toca, a qué hora, y marcarlo como "Tomado". Si nadie lo marca, la aplicación escala alertas automáticas vía WhatsApp al cuidador principal (Administrador).

## 🚀 Avances y Características Actuales

### 1. Sistema de Autenticación y Grupos Familiares
- **Login Seguro:** Integración con Google (Firebase Auth).
- **Grupos Familiares:** Al entrar, los usuarios crean o se unen a un "Grupo Familiar" mediante un código de invitación seguro.
- **Roles:** El creador del grupo es `ADMIN`, los invitados son `MEMBER`. Los administradores pueden gestionar miembros (expulsarlos).

### 2. Gestión de Pacientes (Nuevo!)
- **Perfiles Multiusuario:** En un mismo grupo familiar se pueden agregar varios pacientes (ej: Papá, Mamá, Abuelo).
- **CRUD Completo:** Creación, edición y eliminación de pacientes desde una pestaña dedicada (`/api/grupos/:id/pacientes`).
- **Asignación Inteligente:** Al crear un recordatorio de medicamento, un menú desplegable permite asociarlo dinámicamente a uno de los pacientes registrados.

### 3. Motor de Calendario y Recordatorios
- **Pestaña Hoy:** Muestra una línea de tiempo cronológica con los medicamentos que deben tomarse el día actual, basados en frecuencias complejas (`Diario`, `Días específicos`, `Solo Hoy`).
- **Estados Interactivos:** Los usuarios pueden marcar remedios como `✅ Tomada`, `⏳ Pendiente` o `❌ Olvidada`. El estado se sincroniza en tiempo real con la nube (Firebase Firestore).
- **Inventario (Biblioteca):** Un "botiquín virtual" que guarda los nombres, dosis, indicaciones y el ícono de cada pastilla para programarlos rápidamente sin escribir de nuevo.

### 4. Arquitectura y Despliegue
- **Frontend:** PWA (Progressive Web App) instalable en iOS y Android. Construida en HTML5, CSS3 puro (estilo Neumórfico/Dark Mode) y JavaScript Vanilla para máxima velocidad.
- **Backend:** Node.js con Express, desplegado serverless en Google Cloud Run.
- **Base de Datos:** Firebase Firestore (NoSQL).
- **Notificaciones (En progreso):** Integración con Twilio para bots de WhatsApp.

## 🛠️ Cambios y Resoluciones Recientes
- **Refactorización de la UI:** Transición de un diseño básico a una interfaz de "Tarjetas Neumórficas" con paleta oscura, bordes redondeados, y animaciones de latido en los botones principales.
- **Hotfix de Codificación:** Se resolvió un error crítico de mojibake (corrupción de UTF-8) inducido por la terminal de Windows que destruía la renderización de Emojis y rompía la sintaxis de JavaScript en `app.js`.
- **Estructuración de Base de Datos:** Los medicamentos ahora se vinculan lógicamente al ID del paciente mediante Firestore en lugar de campos de texto libre, sentando las bases para el control de inventario/dosis.

---

### Futuros Pasos (Backlog)
- [ ] **La opción Moderna: React Native o Flutter:** Reescribir la capa visual (Frontend) utilizando un framework cruzado para obtener el máximo rendimiento nativo y empaquetar aplicaciones reales para las tiendas (App Store y Google Play).
- [ ] **Adaptación Nativa de Interfaz (OS-Aware UI):** Detectar si la PWA corre en iOS o Android y adaptar dinámicamente iconos, colores y elementos de interfaz (Ej: Tabs de Cupertino vs Material Design) para que se sienta 100% intuitiva según el sistema operativo del usuario.
- [ ] **Control de Existencias (Inventario Math):** Restar la dosis del stock cada vez que se marca "Tomada" y alertar cuando queden pocas pastillas.
- [ ] **Mensajes y Multimedia:** Grabar audios o subir fotos del remedio por parte del médico o familiar, para que se reproduzcan en parlantes inteligentes.
- [ ] **Integración B2B (Monetización):** Escaneo de recetas médicas y convenios de comisión directa con farmacias locales al solicitar refill automático.

---
*Bitácora generada por Antigravity (AI Assistant) - 18 de Julio de 2026*
