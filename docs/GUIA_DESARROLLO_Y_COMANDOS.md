# 🚀 Guía de Comandos y Manual de Configuración - MediClock

Este documento sirve como **manual técnico de operaciones, comandos esenciales y guía de configuración** para el desarrollo, despliegue y escalamiento comercial de **MediClock**.

---

## 📌 1. Flujo de Git y Sincronización en Múltiples Equipos

### A. Subir cambios y reglas de Antigravity a GitHub
Utiliza estos comandos cada vez que realices cambios en el código o actualices la carpeta de reglas `.agents/`:

```bash
# 1. Preparar todos los cambios (o un archivo en específico)
git add .

# 2. Guardar punto de control con un mensaje descriptivo
git commit -m "Descripción de los cambios realizados"

# 3. Subir a la rama principal en GitHub
git push origin main
```

> **Ejemplo específico para actualizar reglas de Antigravity:**
> ```bash
> git add .agents/AGENTS.md
> git commit -m "Actualizar reglas y contexto del proyecto"
> git push origin main
> ```

### B. Descargar cambios en tu otro PC (Ej: PC de Escritorio)
Al abrir Antigravity en otro equipo, ejecuta esto antes de empezar a trabajar para sincronizar el código y las reglas automáticamente:

```bash
git pull origin main
```

---

## 💻 2. Ejecución y Desarrollo Local

### A. Iniciar el servidor backend localmente
```bash
# Iniciar servidor Express
node index.js
```
El servidor estará corriendo en: `http://localhost:3000`

### B. Verificar codificación UTF-8 en Windows (Evitar Mojibake)
Si trabajas en Windows PowerShell o CMD, ejecuta esto si ves caracteres raros en la terminal:
```powershell
# Forzar codificación UTF-8 en la consola actual de PowerShell
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
```

---

## ⚙️ 3. Configuración de Variables de Entorno y Producción

Para evitar improvisaciones y errores de versión a nivel masivo, el sistema utiliza variables de entorno estandarizadas.

### Lista de Variables de Entorno

| Variable | Descripción | Valor por Defecto / Ejemplo | Entorno |
| :--- | :--- | :--- | :--- |
| `PORT` | Puerto donde escucha Express | `3000` (Local) / Auto por Cloud Run | Producción / Dev |
| `META_WA_ACCESS_TOKEN` | Token de acceso para WhatsApp Cloud API | String de acceso de Meta Developer | Producción |
| `META_WA_PHONE_NUMBER_ID` | ID de teléfono emisor en WhatsApp | ID numérico de Meta | Producción |
| `META_WEBHOOK_VERIFY_TOKEN` | Token secreto de verificación de Webhook | `mediclock_secure_token_123` | Producción |
| `GOOGLE_APPLICATION_CREDENTIALS` | Ruta al JSON de credenciales de Firebase Admin | `/app/firebase-key.json` | Producción / Dev |

---

## 🐳 4. Despliegue en la Nube (Docker & Google Cloud Run)

### A. Probar construcción del Contenedor Docker Localmente
```bash
# Construir la imagen Docker de producción
docker build -t mediclock-app .

# Ejecutar el contenedor localmente en puerto 3000
docker run -p 3000:3000 mediclock-app
```

### B. Desplegar a Google Cloud Run
```bash
# 1. Autenticar con Google Cloud CLI
gcloud auth login

# 2. Seleccionar el proyecto oficial
gcloud config set project mediclock-recordatorios

# 3. Desplegar el servicio Serverless
gcloud run deploy mediclock-service `
  --image gcr.io/mediclock-recordatorios/mediclock-app:latest `
  --platform managed `
  --region us-central1 `
  --allow-unauthenticated
```

---

## 📋 5. Protocolo para Lanzamiento Comercial Masivo (SaaS)

Cuando el software esté operando con clientes o instituciones comerciales, sigue este protocolo estricto:

1. **Incrementar la versión del sistema:**
   En `index.js`, actualiza la constante `APP_VERSION`:
   ```javascript
   const APP_VERSION = 'v33'; // Incrementar versión
   ```
2. **Revisión de Seguridad e Historial:**
   Verificar que no existan llaves de Firebase o tokens en duro dentro de los archivos visibles de `/public/`.
3. **Backup de Firestore:**
   Exportar respaldos periódicos de la base de datos de grupos y medicamentos antes de cambios mayores en el esquema NoSQL.

---

## 📑 Resumen Rápido de Referencia

- **Sincronizar cambios:** `git add .` ➡️ `git commit -m "..."` ➡️ `git push origin main`
- **Descargar en otra PC:** `git pull origin main`
- **Probar en local:** `node index.js`
- **Reglas de Antigravity:** [.agents/AGENTS.md](file:///c:/Users/rou10/Documents/Proyectos/Mediclock/.agents/AGENTS.md)
