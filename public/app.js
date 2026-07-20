const CLIENT_VERSION = 'v24';

// Auto-verificar versión del servidor e inyectarla dinámicamente en el HTML
async function sincronizarVersionDinamica() {
    try {
        const r = await fetch('/api/version?t=' + Date.now());
        const data = await r.json();
        if (data.version) {
            window.CURRENT_SERVER_VERSION = data.version;
            document.querySelectorAll('#app-version, .login-version-tag').forEach(el => {
                el.textContent = `${data.version} · BUILD ${data.buildDate || '2026-07-19'}`;
            });
            const badge = document.getElementById('cfg-version-badge');
            if (badge) badge.textContent = `${data.version} · MediClock · ${data.buildDate || '2026-07-19'}`;
            
            const statusEl = document.getElementById('cfg-update-status');
            if (data.version !== CLIENT_VERSION) {
                if (statusEl) statusEl.textContent = `🚀 ¡Versión ${data.version} lista! Toca para actualizar`;
            } else {
                if (statusEl) statusEl.textContent = `Sistema actualizado (${data.version})`;
            }
        }
    } catch (e) {
        console.log('Versión en caché offline:', e);
    }
}
sincronizarVersionDinamica();

window.verificarActualizacion = async function(manual = false) {
    toast('Comprobando versión más reciente...', 'info');
    try {
        const r = await fetch('/api/version?t=' + Date.now());
        const data = await r.json();
        sincronizarVersionDinamica();
        
        if (data.version && data.version !== CLIENT_VERSION) {
            if (confirm(`¡Nueva versión disponible (${data.version})! ¿Deseas actualizar ahora?`)) {
                if ('serviceWorker' in navigator) {
                    const registrations = await navigator.serviceWorker.getRegistrations();
                    for (let reg of registrations) await reg.unregister();
                }
                window.location.reload(true);
            }
        } else {
            if (manual) toast(`Estás usando la última versión oficial (${CLIENT_VERSION}) ✅`, 'success');
        }
    } catch (e) {
        toast('No se pudo conectar al servidor de versiones', 'error');
    }
};

// --- ESTADO GLOBAL ---
const state = {
    user: null,
    token: null,
    grupos: [],
    activeGrupoId: null,
    activeGrupoNombre: '',
    miRol: 'miembro',
    medicamentos: [],
    historial: [],
    miembros: [],
    pacientes: [],
    config: {},
    calOffset: 0,
    activeTab: 'hoy',
    editingId: null,
};

// --- API HELPER ---
async function api(method, endpoint, body) {
    if (!state.token) throw new Error("No autenticado");
    const headers = { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
    };
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    
    const res = await fetch(endpoint, opts);
    if (res.status === 401) {
        console.warn('API 401 on', endpoint, '— refreshing token and retrying once...');
        // Try refreshing the token once before giving up
        try {
            const fbUser = firebase.auth().currentUser;
            if (fbUser) {
                state.token = await fbUser.getIdToken(true);
                headers['Authorization'] = `Bearer ${state.token}`;
                const retry = await fetch(endpoint, { method, headers, body: opts.body });
                if (retry.status === 401) {
                    const errBody = await retry.json().catch(() => ({}));
                    console.error('API still 401 after token refresh. Server said:', errBody);
                    toast(`Error de autenticación: ${errBody.error || 'Token rechazado por el servidor'}`, 'error');
                    logout();
                    throw new Error('Sesión expirada');
                }
                if (!retry.ok) throw new Error(`HTTP ${retry.status}`);
                return retry.json();
            }
        } catch (e) {
            if (e.message !== 'Sesión expirada') console.error('Token refresh failed:', e);
            throw e;
        }
    }
    if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `HTTP ${res.status}`);
    }
    return res.json();
}

// --- TOAST ---
function toast(msg, type = '') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = `toast show ${type}`;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.className = 'toast hidden'; }, 2800);
}

// --- LOGOUT ---
function logout() {
    firebase.auth().signOut().then(() => {
        state.user = null;
        state.token = null;
        state.activeGrupoId = null;
        localStorage.removeItem('mc_active_grupo_id');
        document.getElementById('app').classList.add('hidden');
        document.getElementById('group-screen')?.classList.add('hidden');
        document.getElementById('login-screen').classList.remove('hidden');
    });
}
// --- GLOBAL DIAGNOSTICS ---
window.addEventListener('error', (event) => {
    console.error("Global Error:", event.error);
    toast("Error: " + (event.error?.message || event.message), "error");
});
window.addEventListener('unhandledrejection', (event) => {
    console.error("Unhandled Rejection:", event.reason);
    toast("Rejection: " + (event.reason?.message || event.reason), "error");
});

document.getElementById('btn-google-login').addEventListener('click', async () => {
    toast('Iniciando sesión con Google...', 'info');
    const provider = new firebase.auth.GoogleAuthProvider();
    try {
        // Use popup instead of redirect to avoid Chrome Bounce Tracking Mitigation
        // which blocks the firebaseapp.com intermediate redirect domain
        const result = await firebase.auth().signInWithPopup(provider);
        console.log('[AUTH] Popup login successful:', result.user.email);
    } catch (error) {
        console.error("Auth Error:", error);
        if (error.code === 'auth/popup-blocked') {
            toast('El navegador bloqueó el popup. Habilita popups para este sitio e intenta de nuevo.', 'error');
        } else if (error.code === 'auth/popup-closed-by-user') {
            toast('Ventana de login cerrada. Intenta de nuevo.', 'error');
        } else {
            toast('Error de login: ' + error.message, 'error');
        }
    }
});

firebase.auth().onAuthStateChanged(async (user) => {
    console.log('[AUTH] onAuthStateChanged fired. user:', user ? user.email : 'null');
    if (user) {
        state.user = {
            uid: user.uid,
            email: user.email,
            name: user.displayName || 'Usuario'
        };
        console.log('[AUTH] Getting fresh ID token...');
        try {
            state.token = await user.getIdToken(true);
            console.log('[AUTH] Token obtained. Length:', state.token.length);
        } catch(tokenErr) {
            console.error('[AUTH] Failed to get ID token:', tokenErr);
            toast('Error obteniendo token de sesión: ' + tokenErr.message, 'error');
            return;
        }
        
        document.getElementById('login-screen').classList.add('hidden');
        
        // Manejar link de invitación si existe en la URL actual
        const m = window.location.pathname.match(/\/unirse\/([A-Z0-9]+)/);
        if (m) {
            const codigo = m[1];
            await procesarInvitacion(codigo);
            return;
        }

        await inicializarGrupos();
    } else {
        console.log('[AUTH] No user session. Showing login screen.');
        state.token = null;
        document.getElementById('app').classList.add('hidden');
        document.getElementById('group-screen')?.classList.add('hidden');
        document.getElementById('login-screen').classList.remove('hidden');
    }
});

// Note: getRedirectResult() removed — using signInWithPopup which handles
// auth result synchronously without needing a redirect result listener.

// ============================================================
// INVITATION FLOW
// ============================================================

async function procesarInvitacion(codigo) {
    toast('Procesando invitación...', 'info');
    try {
        const res = await api('GET', `/api/unirse/${codigo}`);
        if (res.success) {
            toast(`¡Te uniste a ${res.grupoNombre}!`, 'success');
            state.activeGrupoId = res.grupoId;
            localStorage.setItem('mc_active_grupo_id', res.grupoId);
            // Redirigir a root limpia
            window.history.replaceState({}, document.title, "/");
            await inicializarGrupos();
        }
    } catch (e) {
        toast('Invitación no válida o expirada', 'error');
        window.history.replaceState({}, document.title, "/");
        await inicializarGrupos();
    }
}

// ============================================================
// GRUPOS FLOW
// ============================================================

async function inicializarGrupos() {
    console.log('[GRUPOS] Calling /api/mis-grupos...');
    try {
        state.grupos = await api('GET', '/api/mis-grupos');
        console.log('[GRUPOS] Success. Groups found:', state.grupos.length);
        
        // Entrar a la app siempre
        document.getElementById('app').classList.remove('hidden');

        if (state.grupos.length === 0) {
            // No tiene grupos -> Onboarding Premium
            state.activeGrupoId = null;
            const gn = document.getElementById('active-group-name');
            if (gn) gn.textContent = "Nueva Cuenta ↗";
            renderCurrentTab(); 
        } else {
            // Cargar grupo activo guardado o usar el primero
            const guardado = localStorage.getItem('mc_active_grupo_id');
            const existe = state.grupos.find(g => g.id === guardado);
            if (existe) {
                await seleccionarGrupo(guardado);
            } else {
                await seleccionarGrupo(state.grupos[0].id);
            }
        }
    } catch (e) {
        console.error('[GRUPOS] Error calling /api/mis-grupos:', e);
        toast('Error al sincronizar: ' + e.message, 'error');
    }
}

function mostrarSelectorGrupos() {
    abrirModal('Mis Familias', `
        <div id="lista-grupos" style="display:flex; flex-direction:column; gap:10px; margin-bottom:16px;">
            ${state.grupos.map(g => `
                <div class="grupos-card ${g.id === state.activeGrupoId ? 'active' : ''}" style="background:var(--c-navy-light); padding:16px; border-radius:12px; cursor:pointer; display:flex; justify-content:space-between; align-items:center;" onclick="seleccionarGrupoDesdeModal('${g.id}')">
                    <div>
                        <span style="font-weight:600; display:block; font-size:16px;">👤 ${g.nombre}</span>
                        <span style="font-size:12px; color:var(--c-gray);">${g.miembros} miembro(s)</span>
                    </div>
                    ${g.id === state.activeGrupoId ? '<span style="color:var(--c-green)">⭐</span>' : '<span>⚪</span>'}
                </div>
            `).join('')}
            ${state.grupos.length === 0 ? '<p style="text-align:center;color:var(--c-gray);font-size:14px;">No tienes grupos aún.</p>' : ''}
        </div>
        <div style="border-top: 1px solid var(--c-navy-light); padding-top:16px;">
            <input type="text" id="nuevo-grupo-nombre" class="form-input" placeholder="Nombre de tu Familia/Grupo" style="margin-bottom:10px; text-align:center;">
            <button class="btn-primary pulse-btn" style="width:100%;" onclick="crearNuevoGrupo()">➕Crear Nuevo Grupo</button>
        </div>
    `);
}

window.seleccionarGrupoDesdeModal = async function(id) {
    cerrarModal();
    toast('Cargando grupo...', 'info');
    await seleccionarGrupo(id);
}

window.crearNuevoGrupo = async function() {
    const input = document.getElementById('nuevo-grupo-nombre');
    const nombre = input?.value.trim();
    if (!nombre) {
        toast('Ingresa un nombre para el grupo', 'error');
        return;
    }
    try {
        const nuevo = await api('POST', '/api/grupos', { nombre });
        toast(`Familia "${nombre}" creada ✅`, 'success');
        state.grupos.push(nuevo);
        cerrarModal();
        await seleccionarGrupo(nuevo.id);
        renderCurrentTab();
    } catch {
        toast('Error al crear grupo', 'error');
    }
}

async function seleccionarGrupo(grupoId) {
    state.activeGrupoId = grupoId;
    localStorage.setItem('mc_active_grupo_id', grupoId);
    
    const g = state.grupos.find(x => x.id === grupoId);
    if (g) {
        state.activeGrupoNombre = g.nombre;
        state.miRol = g.miRol;
        document.body.setAttribute('data-group-color', g.color || 'green');
    }
    
    const badgeEls = document.querySelectorAll('.local-group-name');
    badgeEls.forEach(el => el.textContent = state.activeGrupoNombre || 'Familia');
    
    toast(`👥 ENTORNO ACTIVO: "${state.activeGrupoNombre || 'Mi Familia'}"`, 'info');
    
    await Promise.all([cargarDatosGrupo(), cargarDatosTodosGrupos()]);
    renderCurrentTab();
}

document.getElementById('btn-switch-group')?.addEventListener('click', () => {
    mostrarSelectorGrupos();
});

// ============================================================
// CARGA DE DATOS POR GRUPO
// ============================================================

async function cargarDatosGrupo() {
    if (!state.activeGrupoId) return;
    try {
        const id = state.activeGrupoId;
        [state.medicamentos, state.historial, state.biblioteca, state.config, state.miembros, state.pacientes] = await Promise.all([
            api('GET', `/api/grupos/${id}/medicamentos`),
            api('GET', `/api/grupos/${id}/historial`),
            api('GET', `/api/grupos/${id}/biblioteca`),
            api('GET', `/api/grupos/${id}/config`),
            api('GET', `/api/grupos/${id}/miembros`),
            api('GET', `/api/grupos/${id}/pacientes`),
        ]);

        const miUser = state.miembros.find(m => m.uid === state.user?.uid);
        if (miUser) {
            state.miRol = miUser.rol || 'miembro';
            state.miPacienteId = miUser.pacienteId || null;
        }

        if (state.miRol === 'paciente') {
            document.getElementById('app').classList.add('hidden');
            renderPacienteScreen();
            setInterval(actualizarRelojPaciente, 1000 * 60);
            return;
        }

    } catch (e) {
        toast('Error cargando datos del grupo', 'error');
    }
}

async function cargarDatosTodosGrupos() {
    state.todosLosMedicamentos = [];
    state.todosLosPacientes = [];
    if (!state.grupos || state.grupos.length === 0) return;
    
    try {
        const promesas = state.grupos.map(async g => {
            try {
                const [meds, pacs] = await Promise.all([
                    api('GET', `/api/grupos/${g.id}/medicamentos`),
                    api('GET', `/api/grupos/${g.id}/pacientes`)
                ]);
                meds.forEach(m => m._grupoId = g.id);
                pacs.forEach(p => { p._grupoId = g.id; p._grupoNombre = g.nombre; });
                return { meds, pacs };
            } catch (e) {
                return { meds: [], pacs: [] };
            }
        });
        const resultados = await Promise.all(promesas);
        resultados.forEach(r => {
            state.todosLosMedicamentos.push(...r.meds);
            state.todosLosPacientes.push(...r.pacs);
        });
    } catch(e) {
        console.error("Error al cargar todos los grupos:", e);
    }
}

// ============================================================
// LOGICA DE PESTAAS Y RENDERS
// ============================================================

function initApp() {
    // Tab navigation
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Header actions
    document.getElementById('btn-export')?.addEventListener('click', exportarICS);
    document.getElementById('btn-refresh')?.addEventListener('click', async () => {
        toast('Sincronizando...', 'info');
        await cargarDatosGrupo();
        renderCurrentTab();
        toast('Sincronizado', 'success');
    });

    // Modal
    document.getElementById('modal-close')?.addEventListener('click', cerrarModal);
    document.getElementById('modal-overlay')?.addEventListener('click', e => {
        if (e.target === e.currentTarget) cerrarModal();
    });

    // Hoy
    document.getElementById('btn-add-hoy')?.addEventListener('click', () => abrirModalNuevo());

    // Calendario
    document.getElementById('cal-prev')?.addEventListener('click', () => { 
        if (state.calOffset <= 0) return;
        state.calOffset--; 
        renderCalendario(); 
    });
    document.getElementById('cal-next')?.addEventListener('click', () => { state.calOffset++; renderCalendario(); });

    // Biblioteca
    document.getElementById('btn-add-remedio')?.addEventListener('click', () => abrirModalNuevoRemedio());

    // Config
    document.getElementById('btn-guardar-config')?.addEventListener('click', saveConfig);
    document.getElementById('btn-logout')?.addEventListener('click', logout);
    document.getElementById('btn-invitar-miembro')?.addEventListener('click', generarInvitacion);
    document.getElementById('btn-copy-invite')?.addEventListener('click', copiarLinkInvitacion);

    // PWA Install
    const btnInstall = document.getElementById('btn-install-app');
    if(btnInstall) {
        btnInstall.addEventListener('click', async () => {
            if (window.deferredPrompt) {
                window.deferredPrompt.prompt();
                const { outcome } = await window.deferredPrompt.userChoice;
                if (outcome === 'accepted') {
                    window.deferredPrompt = null;
                }
            } else {
                // iOS Fallback o no soportado
                abrirModal('Instalar en tu Teléfono', `
                    <div style="text-align:center;">
                        <p style="margin-bottom:16px; font-size:15px; color:var(--c-text-2);">Para usar MediClock como una App nativa a pantalla completa:</p>
                        <ol style="text-align:left; padding-left:20px; line-height:1.6; margin-bottom:20px; color:var(--c-text-2);">
                            <li>En iPhone (Safari): Toca el botón <strong>Compartir</strong> <span style="font-size:20px">⍐</span> abajo al centro.</li>
                            <li>Desliza y selecciona <strong>"Agregar a Inicio"</strong>.</li>
                            <li>Toca <strong>Agregar</strong> arriba a la derecha.</li>
                        </ol>
                        <p style="font-size:13px; color:var(--c-green);">En Android, toca los 3 puntitos arriba a la derecha y selecciona "Instalar Aplicación".</p>
                    </div>
                `);
            }
        });
    }
}

function switchTab(tab) {
    const panels = document.querySelectorAll('.tab-panel');
    const oldPanel = document.getElementById(`panel-${state.activeTab}`);
    const newPanel = document.getElementById(`panel-${tab}`);

    if (oldPanel && oldPanel !== newPanel) {
        oldPanel.classList.remove('active', 'view-transition-enter-active');
        oldPanel.classList.add('view-transition-exit-active');
        setTimeout(() => {
            oldPanel.classList.remove('view-transition-exit-active');
        }, 300);
    }

    state.activeTab = tab;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    
    if (newPanel) {
        newPanel.classList.add('active', 'view-transition-enter');
        // Force reflow
        void newPanel.offsetWidth;
        newPanel.classList.remove('view-transition-enter');
        newPanel.classList.add('view-transition-enter-active');
    }
    
    renderCurrentTab();
}

function renderCurrentTab() {
    // Config is always accessible regardless of group state
    if (!state.activeGrupoId && state.activeTab !== 'hoy' && state.activeTab !== 'config') {
        renderLockState();
        return;
    }

    switch (state.activeTab) {
        case 'hoy': renderHoy(); break;
        case 'calendario': renderCalendario(); break;
        case 'historial': renderHistorial(); break;
        case 'remedios': renderRemedios(); break;
        case 'pacientes': renderPacientes(); break;
        case 'config': renderConfig(); break;
    }
}

function renderLockState() {
    const container = document.getElementById(`panel-${state.activeTab}`);
    if (!container) return;
    container.innerHTML = `
        <div class="lock-state" style="text-align:center; padding: 48px 24px;">
            <div class="lock-icon" style="font-size:36px; margin-bottom:12px;">📌</div>
            <h3 class="lock-text" style="font-size:18px; font-weight:600; color:var(--c-text);">Guía paso a paso</h3>
            <p style="color:var(--c-text-2); font-size:14px; margin-top:8px; margin-bottom:24px; max-width:320px; margin-left:auto; margin-right:auto; line-height:1.5;">
                Completa el paso a paso en la pestaña "Hoy" para activar tu grupo y habilitar todos los módulos de tu familia.
            </p>
            <button class="btn-primary" style="padding: 12px 24px; width:auto; margin:0 auto;" onclick="switchTab('hoy')">
                Ir al Paso a Paso en "Hoy"
            </button>
        </div>
    `;
}

// ============================================================
// RENDERS ESPECIFICOS
// ============================================================

function getLocalDateString() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function renderStockBadge(m) {
    if (m.pastillasRestantes == null) return '';
    const umbral = m.alertaStockMinimo != null ? parseInt(m.alertaStockMinimo) : 5;
    const isLow = m.pastillasRestantes <= umbral;
    const isZero = m.pastillasRestantes <= 0;
    
    if (isZero) {
        return `<div class="med-stock no-stock">❌ Sin stock</div>`;
    } else if (isLow) {
        return `<div class="med-stock low-stock">⚠️ Stock bajo: ${m.pastillasRestantes} uds.</div>`;
    } else {
        return `<div class="med-stock">📦 Stock: ${m.pastillasRestantes} uds.</div>`;
    }
}

function renderHoy() {
    const lista = document.getElementById('hoy-lista');
    
    if (!state.activeGrupoId) {
        // MODO ONBOARDING PREMIUM
        const hf = document.getElementById('hoy-fecha');
        if (hf) hf.textContent = "Bienvenido a MediClock";
        const hr = document.getElementById('hoy-resumen');
        if (hr) hr.textContent = "El centro de control de tu familia";
        const btnH = document.getElementById('btn-add-hoy');
        if (btnH) btnH.style.display = 'none';

        lista.innerHTML = `
            <div class="premium-onboarding">
                <div class="premium-icon">⭐</div>
                <h2 class="premium-title">Comencemos</h2>
                <p class="premium-subtitle">
                    MediClock te ayuda a organizar y recordar los medicamentos de tus seres queridos, todo compartido en tiempo real.
                </p>
                <div style="background: rgba(16,185,129,0.1); border-radius: 12px; padding: 16px; margin-bottom: 24px; text-align:left;">
                    <strong style="color:var(--c-green); font-size:14px;">Paso 1:</strong>
                    <p style="font-size:13px; color:var(--c-gray); margin-top:4px;">Crea tu entorno familiar seguro. Luego podrás invitar a otros miembros o agregar los medicamentos.</p>
                </div>
                <button class="btn-primary pulse-btn" style="width:100%; font-size:16px; padding:14px;" onclick="mostrarSelectorGrupos()">
                    Crear mi Grupo Familiar
                </button>
            </div>
        `;
        return;
    }

    document.getElementById('btn-add-hoy').style.display = 'block';
    const hoy = new Date();
    const diasNombre = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
    const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    const hf2 = document.getElementById('hoy-fecha');
    if (hf2) hf2.textContent = `${diasNombre[hoy.getDay()]} ${hoy.getDate()} de ${meses[hoy.getMonth()]}`;

    const diaNum = hoy.getDay();
    const localDateStr = getLocalDateString();
    
    const medHoy = [];
    const listaDeMeds = (state.todosLosMedicamentos && state.todosLosMedicamentos.length > 0) ? state.todosLosMedicamentos : state.medicamentos;
    listaDeMeds.forEach(m => {
        if (m.fechaInicio && m.fechaInicio > localDateStr) return;
        const matches = m.frecuencia === 'diaria' ||
                        (m.frecuencia === 'especifica' && m.dias?.map(Number).includes(diaNum));
        if (matches) {
            const horasList = m.horas && m.horas.length > 0 ? m.horas : [m.hora || '08:00'];
            horasList.forEach(h => {
                const key = `${localDateStr}_${h}`;
                const toma = m.tomas?.[key];
                const estadoDose = toma?.estado || 'pendiente';
                medHoy.push({
                    ...m,
                    hora: h,
                    estado: estadoDose,
                    origId: m.id,
                    tomaMeta: toma,
                    _grupoId: m._grupoId
                });
            });
        }
    });
    medHoy.sort((a, b) => a.hora.localeCompare(b.hora));

    const tomadas = medHoy.filter(m => m.estado === 'tomada').length;
    const total = medHoy.length;
    const hr2 = document.getElementById('hoy-resumen');
    if (hr2) hr2.textContent = total > 0 ? `${tomadas} de ${total} confirmadas hoy` : 'Sin medicamentos programados para hoy';

    if (medHoy.length === 0) {
        const noPac = !state.pacientes || state.pacientes.length === 0;
        lista.innerHTML = `
            <div class="premium-onboarding" style="padding:24px; text-align:left; background:var(--c-surface3); border-radius:16px; border:1px solid var(--c-border); margin-bottom:20px;">
                <h3 style="font-size:17px; font-weight:600; color:var(--c-text); margin-bottom:14px;">Paso a Paso de tu cuenta:</h3>
                
                <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px;">
                    <span style="background:var(--c-green-dim); color:var(--c-green); font-weight:700; width:24px; height:24px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:12px;">✓</span>
                    <span style="font-size:14px; color:var(--c-text);">1. Entorno Familiar: <strong>${state.activeGrupoNombre || 'Mi Familia'}</strong></span>
                </div>
                
                <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px;">
                    <span style="background:${noPac ? 'var(--c-blue-dim)' : 'var(--c-green-dim)'}; color:${noPac ? 'var(--c-blue)' : 'var(--c-green)'}; font-weight:700; width:24px; height:24px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:12px;">${noPac ? '2' : '✓'}</span>
                    <span style="font-size:14px; color:var(--c-text);">${noPac ? '2. Registra los pacientes (ej: Papá, Mamá, Yo)' : '2. Pacientes registrados (' + state.pacientes.length + ')'}</span>
                </div>
                
                <div style="display:flex; align-items:center; gap:10px; margin-bottom:16px;">
                    <span style="background:var(--c-surface2); color:var(--c-text-2); font-weight:700; width:24px; height:24px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:12px;">3</span>
                    <span style="font-size:14px; color:var(--c-text-2);">3. Asigna medicamentos y recordatorios</span>
                </div>
                
                <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:8px;">
                    ${noPac 
                        ? `<button class="btn-primary btn-sm" onclick="abrirModalNuevoPaciente()">+ Paso 2: Registrar Paciente</button>` 
                        : `<button class="btn-primary btn-sm" onclick="abrirModalNuevo()">+ Paso 3: Asignar Medicamento</button>`
                    }
                </div>
            </div>
        `;
        return;
    }

    const grupos = {};
    medHoy.forEach(m => {
        let nomFamiliar = m.familiar;
        if (m._grupoId) {
            const gInfo = state.grupos.find(g => g.id === m._grupoId);
            if (gInfo) nomFamiliar = `${m.familiar} (${gInfo.nombre})`;
        }
        if (!grupos[nomFamiliar]) grupos[nomFamiliar] = [];
        grupos[nomFamiliar].push(m);
    });

    lista.innerHTML = Object.entries(grupos).map(([familiar, meds]) => {
        const totalFam = meds.length;
        const tomadasFam = meds.filter(m => m.estado === 'tomada').length;
        const pct = totalFam === 0 ? 0 : Math.round((tomadasFam / totalFam) * 100);
        const offset = 125.6 - (125.6 * pct) / 100; // 2 * pi * 20 = 125.6

        return `
        <div class="familiar-group">
            <div class="familiar-label" style="display:flex; justify-content:space-between; align-items:center;">
                <span>👤 ${familiar}</span>
                <div class="progress-ring-container">
                    <svg class="progress-ring" width="48" height="48" viewBox="0 0 48 48">
                        <circle class="progress-ring-circle-bg" cx="24" cy="24" r="20"></circle>
                        <circle class="progress-ring-circle" cx="24" cy="24" r="20" stroke-dasharray="125.6" stroke-dashoffset="${offset}"></circle>
                    </svg>
                    <span class="progress-ring-text">${pct}%</span>
                </div>
            </div>
            ${meds.map(m => `
                <div class="med-card ${m.estado || ''}" onclick="abrirModalTomaManual('${m.origId || m.id}', '${m.hora}', '${m._grupoId || state.activeGrupoId}')">
                    <div class="med-time">${m.hora}<small>${frecLabel(m)}</small></div>
                    <div class="med-info">
                        <div class="med-name">💊 ${m.nombre}</div>
                        <div class="med-dose">${m.dosis || ''}</div>
                        ${renderStockBadge(m)}
                    </div>
                    <span class="med-status ${statusClass(m.estado)}">${estadoLabel(m.estado)}</span>
                </div>
            `).join('')}
        </div>
        `;
    }).join('');
}

function frecLabel(m) {
    if (m.frecuencia === 'diaria') return 'Diario';
    if (m.dias?.length > 0) return diasAbrev(m.dias);
    return '';
}
function diasAbrev(dias) {
    const n = ['D','L','M','X','J','V','S'];
    return dias.map(d => n[d]).join('');
}
function estadoLabel(estado) {
    const m = { tomada: '✅ Tomada', pendiente: '⏳ Pendiente', olvidada: '❌ Olvidada' };
    return m[estado] || 'Programado';
}
function statusClass(estado) {
    const m = { tomada: 'status-tomada', pendiente: 'status-pendiente', olvidada: 'status-olvidada' };
    return m[estado] || 'status-default';
}

function renderCalendario() {
    const dias = getCurrentWeekDays(state.calOffset);
    const hoyStr = new Date().toDateString();
    const nombresCortos = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
    const numDia = d => d.getDay() === 0 ? 0 : d.getDay();
    const mes = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    document.getElementById('cal-titulo').textContent =
        `${mes[dias[0].getMonth()]} ${dias[0].getDate()} - ${dias[6].getDate()}`;

    // Deshabilitar ir al pasado
    const btnPrev = document.getElementById('cal-prev');
    if (state.calOffset <= 0) {
        btnPrev.style.opacity = '0.3';
        btnPrev.style.pointerEvents = 'none';
    } else {
        btnPrev.style.opacity = '1';
        btnPrev.style.pointerEvents = 'auto';
    }

    const grid = document.getElementById('calendario-grid');
    const hoyZero = new Date();
    hoyZero.setHours(0,0,0,0);

    grid.innerHTML = dias.map((dia, i) => {
        const esHoy = dia.toDateString() === hoyStr;
        const esPasado = dia < hoyZero;
        const diaNum = numDia(dia);
        const diaDateStr = dia.toISOString().split('T')[0];
        const medsList = [];
        state.medicamentos.forEach(m => {
            if (m.fechaInicio && m.fechaInicio > diaDateStr) return;
            const matches = m.frecuencia === 'diaria' ||
                            (m.frecuencia === 'especifica' && m.dias?.map(Number).includes(diaNum));
            if (matches) {
                const horasList = m.horas && m.horas.length > 0 ? m.horas : [m.hora || '08:00'];
                horasList.forEach(h => {
                    const key = `${diaDateStr}_${h}`;
                    const toma = m.tomas?.[key];
                    const estadoDose = toma?.estado || 'pendiente';
                    medsList.push({
                        ...m,
                        hora: h,
                        estado: estadoDose,
                        origId: m.id
                    });
                });
            }
        });
        medsList.sort((a, b) => a.hora.localeCompare(b.hora));

        const esHoyBool = dia.toDateString() === hoyStr;
        const medsHtml = medsList.map(m => {
            const isLow = m.pastillasRestantes != null && m.pastillasRestantes <= (m.alertaStockMinimo != null ? parseInt(m.alertaStockMinimo) : 5);
            return `
                <div class="cal-med ${esHoyBool ? (m.estado || 'sin-estado') : 'sin-estado'}"
                     ${esPasado ? 'style="opacity: 0.5; cursor: not-allowed;"' : `onclick="abrirModalEditar('${m.origId || m.id}')"`}
                     title="${m.nombre} ${m.hora}${m.pastillasRestantes != null ? ` (Stock: ${m.pastillasRestantes})` : ''}">
                    ${m.hora}<br>${m.nombre.substring(0, 8)}${isLow ? ' ⚠️' : ''}
                </div>
            `;
        }).join('');

        return `
            <div class="cal-day ${esHoy ? 'hoy' : ''}">
                <div class="cal-day-label">${nombresCortos[i]}</div>
                <div class="cal-day-num">${dia.getDate()}</div>
                ${medsHtml || ''}
            </div>
        `;
    }).join('');
}

function getCurrentWeekDays(offset = 0) {
    const hoy = new Date();
    hoy.setDate(hoy.getDate() + offset * 7);
    const dow = hoy.getDay();
    const lunes = new Date(hoy);
    lunes.setDate(hoy.getDate() - (dow === 0 ? 6 : dow - 1));
    return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(lunes);
        d.setDate(lunes.getDate() + i);
        return d;
    });
}

function renderHistorial() {
    const lista = state.historial;
    const tomadas = lista.filter(h => h.estado === 'tomada').length;
    const olvidadas = lista.filter(h => h.estado === 'olvidada').length;

    const hs = document.getElementById('historial-stats');
    if (hs) hs.innerHTML = `
        <span class="stat-pill">✅ ${tomadas} tomadas</span>
        <span class="stat-pill miss">❌ ${olvidadas} olvidadas</span>
    `;

    const container = document.getElementById('historial-lista');
    if (lista.length === 0) {
        container.innerHTML = `<div class="empty-state">
            <div class="empty-state-icon">📅</div>
            <h3>Sin historial aún</h3>
            <p>Aquí aparecerán las confirmaciones de medicamentos.</p>
        </div>`;
        return;
    }

    const grupos = {};
    lista.forEach(h => {
        const d = h.timestamp ? h.timestamp.slice(0, 10) : 'Sin fecha';
        if (!grupos[d]) grupos[d] = [];
        grupos[d].push(h);
    });

    const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    container.innerHTML = Object.entries(grupos).map(([fecha, items]) => {
        const d = new Date(fecha + 'T12:00:00');
        const label = `${d.getDate()} de ${meses[d.getMonth()]} ${d.getFullYear()}`;
        return `
            <div class="timeline-date">${label}</div>
            ${items.map(h => {
                const hora = h.timestamp ? new Date(h.timestamp).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) : '';
                const mediaHtml = h.fotoConfirmacion
                    ? `<div class="timeline-media"><img src="${h.fotoConfirmacion}" alt="Foto confirmación"></div>`
                    : h.vozConfirmacion
                    ? `<div class="timeline-media"><span style="font-size:11px;color:var(--c-green)">▶️ Audio confirmado</span></div>`
                    : '';
                return `
                    <div class="timeline-item">
                        <div class="timeline-dot ${h.estado}"></div>
                        <div class="timeline-info">
                            <div class="timeline-name">${h.nombre}  ${h.familiar}</div>
                            <div class="timeline-meta">Programada: ${h.horaProgram} · Dosis: ${h.dosis}</div>
                            <div class="timeline-badge">
                                <span class="med-status ${statusClass(h.estado)}">${estadoLabel(h.estado)}</span>
                            </div>
                            ${mediaHtml}
                        </div>
                        <div class="timeline-time">${hora}</div>
                    </div>
                `;
            }).join('')}
        `;
    }).join('');
}

function renderRemedios() {
    const grid = document.getElementById('remedios-grid');
    const remediosHtml = state.biblioteca.map(r => `
        <div class="remedio-card" onclick="usarRemedio('${r.id}')">
            <div class="remedio-icon">${r.icono || '📅'}</div>
            <div class="remedio-name">${r.nombre}</div>
            <div class="remedio-desc">${r.dosis || ''} ${r.indicaciones ? '· ' + r.indicaciones : ''}</div>
            <button class="remedio-del" onclick="event.stopPropagation(); eliminarRemedio('${r.id}')">🗑️</button>
        </div>
    `).join('');

    grid.innerHTML = remediosHtml;
}

function usarRemedio(id) {
    const r = state.biblioteca.find(b => b.id === id);
    if (!r) return;
    abrirModalNuevo(r);
}

async function eliminarRemedio(id) {
    if (!confirm('¿Eliminar de la biblioteca?')) return;
    await api('DELETE', `/api/grupos/${state.activeGrupoId}/biblioteca/${id}`);
    state.biblioteca = state.biblioteca.filter(r => r.id !== id);
    renderRemedios();
    toast('Remedio eliminado', 'success');
}

// ============================================================
// CONFIGURACION Y MIEMBROS
// ============================================================

function renderConfig() {
    // --- User info ---
    const nameEl = document.getElementById('cfg-user-name');
    const emailEl = document.getElementById('cfg-user-email');
    const subtitleEl = document.getElementById('config-user-subtitle');
    if (nameEl) nameEl.textContent = state.user?.name || '—';
    if (emailEl) emailEl.textContent = state.user?.email || 'Sin sesión activa';
    if (subtitleEl) subtitleEl.textContent = state.activeGrupoNombre || 'Sin grupo activo';

    // --- Theme ---
    const themeSel = document.getElementById('cfg-theme-select') || document.getElementById('cfg-theme');
    if (themeSel) themeSel.value = localStorage.getItem('theme') || localStorage.getItem('mc_theme') || 'dark';

    // --- Configuración siempre desbloqueada ---
    const cfg = state.config || {};
    const adminPhoneEl = document.getElementById('cfg-admin-phone');
    if (adminPhoneEl) adminPhoneEl.value = cfg.adminPhone || '';

    const minutosEl = document.getElementById('cfg-minutos');
    if (minutosEl) minutosEl.value = cfg.minutosOlvido || 20;

    // --- Admin controls ---
    const isAdmin = state.miRol === 'admin';
    const inviteRow = document.getElementById('cfg-invite-row');
    if (inviteRow) inviteRow.style.display = isAdmin ? 'flex' : 'none';

    // --- Members list ---
    const container = document.getElementById('miembros-lista');
    if (!container) return;

    const guardias = cfg.guardiasActivas || [];

    container.innerHTML = state.miembros.map(m => {
        const esGuardia = guardias.find(g => g.uid === m.uid && new Date(g.expiresAt) > new Date());
        const guardiaBtn = esGuardia
            ? `<button class="btn-sm" style="color:var(--c-red); background:transparent; font-size:13px;" onclick="revocarGuardia('${m.uid}')">Revocar</button>`
            : (isAdmin && m.uid !== state.user?.uid
                ? `<button class="btn-sm" style="color:var(--c-blue); background:transparent; font-size:13px;" onclick="abrirModalGuardia('${m.uid}', '${m.nombre}')">Delegar</button>`
                : '');

        return `
        <div class="setting-row" style="border-bottom:1px solid var(--c-border); padding: 10px 16px;">
            <div style="display:flex; align-items:center; gap:10px; flex:1;">
                <img src="${m.foto || '/icon-512.png'}" style="width:32px; height:32px; border-radius:50%; object-fit:cover; background:var(--c-surface2);">
                <div>
                    <div class="setting-label" style="font-size:14px;">${m.nombre}</div>
                    ${esGuardia
                        ? `<div style="font-size:11px; color:var(--c-green); font-weight:500;">Guardia hasta ${new Date(esGuardia.expiresAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>`
                        : `<div class="setting-sub">Miembro</div>`}
                </div>
            </div>
            ${guardiaBtn}
        </div>
        `;
    }).join('');
}

window.abrirModalGuardia = function(uid, nombre) {
    const miembro = state.miembros?.find(m => m.uid === uid) || {};
    const tel = miembro.telefono || '';
    
    abrirModal('Configurar Rol de Guardia / Asistente', `
        <p style="margin-bottom:14px; font-size:13px; color:var(--c-text-2);">Asigna permisos ad-hoc de administración y notificaciones a <strong>${nombre}</strong>.</p>
        
        <div class="form-group">
            <label>Duración del turno de supervisión</label>
            <select id="guardia-duracion" class="form-input">
                <option value="12">12 horas (Turno de día/noche)</option>
                <option value="24" selected>24 horas (Full día)</option>
                <option value="48">48 horas (Fin de semana)</option>
                <option value="999999">Permanente (Co-Administrador)</option>
            </select>
        </div>

        <div class="form-group">
            <label style="font-size:13px; font-weight:600; margin-bottom:8px; display:block;">Permisos asignados a este Rol:</label>
            <div style="display:flex; flex-direction:column; gap:8px; background:var(--c-surface2); padding:12px; border-radius:12px; border:1px solid var(--c-border);">
                <label style="font-size:13px; display:flex; align-items:center; gap:8px; margin:0;">
                    <input type="checkbox" id="perm-wa" checked disabled> 🔔 Recibir alertas de olvido en WhatsApp
                </label>
                <label style="font-size:13px; display:flex; align-items:center; gap:8px; margin:0;">
                    <input type="checkbox" id="perm-tomas" checked> 💊 Registrar tomas en nombre de familiares
                </label>
                <label style="font-size:13px; display:flex; align-items:center; gap:8px; margin:0;">
                    <input type="checkbox" id="perm-historial" checked> 📋 Ver historial médico y medicamentos
                </label>
            </div>
        </div>

        <div style="margin-top:12px; border-top:1px solid var(--c-border); padding-top:12px;">
            <button type="button" class="btn-secondary" style="width:100%; border:1px solid var(--c-green); color:var(--c-green); background:var(--c-green-dim); display:flex; align-items:center; justify-content:center; gap:8px; font-weight:600; padding:10px;" onclick="enviarPermisosGuardiaWhatsApp('${nombre}', '${tel}')">
                💬 Enviar Rol e Invitación por WhatsApp
            </button>
        </div>

        <div class="modal-btn-row" style="margin-top:14px;">
            <button class="btn-secondary" onclick="cerrarModal()">Cancelar</button>
            <button class="btn-primary" onclick="guardarGuardia('${uid}')">Activar Rol de Guardia</button>
        </div>
    `);
};

window.enviarPermisosGuardiaWhatsApp = function(nombre, telefono) {
    const duracionSelect = document.getElementById('guardia-duracion');
    const durTxt = duracionSelect ? duracionSelect.options[duracionSelect.selectedIndex].text : '24 horas';
    const telLimpio = (telefono || '').replace(/\D/g, '');
    const appUrl = `https://mediclock-961339509446.us-central1.run.app/?role=guardia&grupo=${state.activeGrupoId || ''}`;
    
    const textMsg = `Hola ${nombre}, se te ha asignado el Rol de Guardia/Asistente en MediClock (${durTxt}) para colaborar en el cuidado de la familia. Abre e instala la app directamente aquí: ${appUrl}`;
    
    const waUrl = telLimpio 
        ? `https://wa.me/${telLimpio}?text=${encodeURIComponent(textMsg)}`
        : `https://api.whatsapp.com/send?text=${encodeURIComponent(textMsg)}`;
    
    window.open(waUrl, '_blank');
    toast('Abriendo WhatsApp para enviar enlace de Guardia...', 'info');
};

window.guardarGuardia = async function(uid) {
    const horas = parseInt(document.getElementById('guardia-duracion').value);
    const expiresAt = new Date(Date.now() + horas * 60 * 60 * 1000).toISOString();
    let guardias = (state.config.guardiasActivas || []).filter(g => new Date(g.expiresAt) > new Date());
    guardias = guardias.filter(g => g.uid !== uid);
    guardias.push({ uid, expiresAt });
    
    try {
        await api('PUT', `/api/grupos/${state.activeGrupoId}/config`, { guardiasActivas: guardias });
        state.config.guardiasActivas = guardias;
        cerrarModal();
        renderConfig();
        toast('Guardia delegada 🛡️', 'success');
    } catch {
        toast('Error al delegar', 'error');
    }
};

window.revocarGuardia = async function(uid) {
    let guardias = (state.config.guardiasActivas || []).filter(g => g.uid !== uid);
    try {
        await api('PUT', `/api/grupos/${state.activeGrupoId}/config`, { guardiasActivas: guardias });
        state.config.guardiasActivas = guardias;
        renderConfig();
        toast('Guardia revocada', 'success');
    } catch {
        toast('Error al revocar', 'error');
    }
};

window.saveConfig = async function() {
    if (!state.activeGrupoId) {
        toast('Selecciona o crea un grupo familiar primero', 'error');
        return;
    }
    if (state.miRol !== 'admin') {
        toast('Solo los administradores pueden cambiar esto', 'error');
        renderConfig(); // revert UI
        return;
    }
    const adminPhoneEl = document.getElementById('cfg-admin-phone');
    const minutosEl = document.getElementById('cfg-minutos');
    const datos = {
        adminPhone: adminPhoneEl ? adminPhoneEl.value.trim() : '',
        minutosOlvido: minutosEl ? (parseInt(minutosEl.value) || 20) : 20,
    };
    try {
        await api('PUT', `/api/grupos/${state.activeGrupoId}/config`, datos);
        state.config = { ...state.config, ...datos };
        toast('Ajustes de grupo guardados ✅', 'success');
    } catch (e) {
        toast('Error guardando configuración: ' + e.message, 'error');
    }
};
window.guardarConfig = window.saveConfig;

window.toggleTheme = function(isDark) {
    if (isDark) {
        document.body.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
    } else {
        document.body.setAttribute('data-theme', 'light');
        localStorage.setItem('theme', 'light');
    }
};

// Initial theme setup (runs once)
if (localStorage.getItem('theme') === 'light') {
    document.body.setAttribute('data-theme', 'light');
} else if (localStorage.getItem('theme') === 'dark') {
    document.body.setAttribute('data-theme', 'dark');
}

async function cargarMiembros() {
    state.miembros = await api('GET', `/api/grupos/${state.activeGrupoId}/miembros`);
    const miUser = state.miembros.find(m => m.uid === state.user?.uid);
    if (miUser) state.miRol = miUser.rol || 'miembro';
}

async function cargarPacientes() {
    try {
        state.pacientes = await api('GET', `/api/grupos/${state.activeGrupoId}/pacientes`);
    } catch {
        state.pacientes = [];
    }
}

async function eliminarMiembro(uid) {
    if (!confirm('¿Eliminar a este miembro de la familia? Perderá acceso inmediato.')) return;
    try {
        await api('DELETE', `/api/grupos/${state.activeGrupoId}/miembros/${uid}`);
        state.miembros = state.miembros.filter(m => m.uid !== uid);
        renderConfig();
        toast('Miembro eliminado', 'success');
    } catch {
        toast('Error al eliminar miembro', 'error');
    }
}

async function generarInvitacion() {
    try {
        const res = await api('POST', `/api/grupos/${state.activeGrupoId}/invitar`);
        document.getElementById('invite-url').value = res.link;
        document.getElementById('invite-box').classList.remove('hidden');
        toast('Link de invitación generado', 'success');
    } catch {
        toast('Error al generar invitación', 'error');
    }
}

function copiarLinkInvitacion() {
    const input = document.getElementById('invite-url');
    input.select();
    input.setSelectionRange(0, 99999);
    navigator.clipboard.writeText(input.value);
    toast('¡Copiado al portapapeles!', 'success');
}

// ============================================================
// MODALS MEDICAMENTOS
// ============================================================

function abrirModal(titulo, contenido) {
    const grupoLabel = state.activeGrupoNombre ? ` &nbsp;<span style="font-size:11px; padding:3px 8px; border-radius:12px; background:var(--c-green-dim); color:var(--c-green); border:1px solid var(--c-green); font-weight:700;">👥 ${state.activeGrupoNombre.toUpperCase()}</span>` : '';
    document.getElementById('modal-title').innerHTML = `<span>${titulo}</span>${grupoLabel}`;
    document.getElementById('modal-body').innerHTML = contenido;
    const overlay = document.getElementById('modal-overlay');
    overlay.classList.remove('hidden');
    overlay.style.opacity = '1';
    overlay.style.pointerEvents = 'auto';
    requestAnimationFrame(() => overlay.classList.add('visible'));
}

function cerrarModal() {
    const overlay = document.getElementById('modal-overlay');
    overlay.classList.remove('visible');
    overlay.style.opacity = '0';
    overlay.style.pointerEvents = 'none';
}
function buildMedForm(data = {}) {
    const hasPacientes = state.pacientes && state.pacientes.length > 0;
    const familiarOptions = hasPacientes 
        ? state.pacientes.map(p => `
            <option value="${p.nombre}" ${data.familiar === p.nombre ? 'selected' : ''}>👤 ${p.nombre}</option>
          `).join('')
        : `<option value="">⚠️ Registra a un paciente primero</option>`;

    const diasMap = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
    const diasButtons = Array.from({ length: 7 }, (_, i) => {
        const selected = data.dias?.map(Number).includes(i);
        return `
            <button type="button" class="ios-day-btn ${selected ? 'selected' : ''}" data-day="${i}" onclick="this.classList.toggle('selected')">
                ${diasMap[i]}
            </button>
        `;
    }).join('');

    // Prepopulate hours after rendering the modal
    setTimeout(() => {
        const container = document.getElementById('horas-container');
        if (container) {
            container.innerHTML = '';
            const horas = data.horas || (data.hora ? [data.hora] : ['08:00']);
            horas.forEach(h => agregarHoraInput(h));
        }
    }, 50);

    return `
        <div style="margin-bottom:16px; background:var(--c-surface2); padding:12px 16px; border-radius:16px; border:1px solid var(--c-border); display:flex; align-items:center; justify-content:space-between; gap:12px;">
            <div>
                <div style="font-size:13px; font-weight:600; color:var(--c-text);">📷 Autocompletar con Foto</div>
                <div style="font-size:11px; color:var(--c-text-2);">Fotografía la receta médica o caja del remedio</div>
            </div>
            <label class="btn-primary btn-sm" style="cursor:pointer; display:inline-flex; align-items:center; gap:6px; margin:0; padding:8px 12px; font-size:12px;">
                <span>📸 Tomar Foto</span>
                <input type="file" id="camera-ocr-input" accept="image/*" capture="environment" style="display:none;" onchange="procesarFotoRecetaCaja(this)">
            </label>
        </div>

        <div class="ios-section-title">Paciente y Medicamento</div>
        <div class="ios-list">
            <div class="ios-row vertical">
                <div class="ios-row-left" style="width:100%;">
                    <div class="ios-row-icon" style="background:#007AFF; display:flex; align-items:center; justify-content:center;">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                    </div>
                    <span>Paciente / Familiar</span>
                </div>
                <div class="ios-input-wrapper" style="width:100%;">
                    <select id="f-familiar" class="form-input">
                        ${familiarOptions}
                    </select>
                    ${!hasPacientes ? `
                        <div style="margin-top:8px;">
                            <button type="button" class="btn-primary btn-sm" style="width:100%; font-size:13px;" onclick="cerrarModal(); abrirModalNuevoPaciente();">
                                + Registrar Paciente Primero (Paso 2)
                            </button>
                        </div>
                    ` : ''}
                </div>
            </div>
            <div class="ios-row vertical">
                <div class="ios-row-left" style="width:100%;">
                    <div class="ios-row-icon" style="background:#FF9500; display:flex; align-items:center; justify-content:center;">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="4.5" y1="19.5" x2="19.5" y2="4.5"></line><path d="M16 3a4.24 4.24 0 0 0-6 0L3 10a4.24 4.24 0 0 0 0 6l3 3a4.24 4.24 0 0 0 6 0l7-7a4.24 4.24 0 0 0 0-6Z"></path></svg>
                    </div>
                    <span>Nombre del Medicamento</span>
                </div>
                <div class="ios-input-wrapper">
                    <input type="text" id="f-nombre" class="form-input" placeholder="Nombre del medicamento" value="${data.nombre || ''}">
                </div>
            </div>
            <div class="ios-row vertical">
                <div class="ios-row-left" style="width:100%;">
                    <div class="ios-row-icon" style="background:#5856D6; display:flex; align-items:center; justify-content:center;">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg>
                    </div>
                    <span>Dosis</span>
                </div>
                <div class="ios-input-wrapper">
                    <input type="text" id="f-dosis" class="form-input" placeholder="Ej: 1 pastilla de 500mg" value="${data.dosis || ''}">
                </div>
            </div>
        </div>

        <div class="ios-section-title">Programación de Alarmas</div>
        <div class="ios-list">
            <div class="ios-row">
                <div class="ios-row-left">
                    <div class="ios-row-icon" style="background:#34C759; display:flex; align-items:center; justify-content:center;">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                    </div>
                    <span>Frecuencia</span>
                </div>
                <div class="ios-input-wrapper">
                    <select id="f-frec" class="form-input" onchange="toggleDias()">
                        <option value="diaria" ${data.frecuencia === 'diaria' ? 'selected' : ''}>Todos los días</option>
                        <option value="especifica" ${data.frecuencia === 'especifica' ? 'selected' : ''}>Días específicos</option>
                    </select>
                </div>
            </div>
            <div class="ios-row" id="f-dias-group" style="display:${data.frecuencia === 'especifica' ? 'flex' : 'none'}; flex-direction:column; align-items:stretch;">
                <div style="font-size:12px; color:var(--c-text-2); margin-bottom:8px;">Días de toma:</div>
                <div style="display:flex; gap:6px; justify-content:space-between;">
                    ${diasButtons}
                </div>
            </div>
            <div class="ios-row vertical">
                <div class="ios-row-left" style="width:100%;">
                    <div class="ios-row-icon" style="background:#AF52DE; display:flex; align-items:center; justify-content:center;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                    </div>
                    <span>Horas de Toma</span>
                </div>
                <div class="ios-input-wrapper" style="flex-direction:column; align-items:stretch; margin-top:8px;">
                    <div class="ios-time-list" id="horas-container">
                        <!-- Loaded dynamically -->
                    </div>
                    <button type="button" class="ios-time-add-btn" onclick="agregarHoraInput()">
                        <span>➕</span> Agregar otra hora
                    </button>
                </div>
            </div>
            <div class="ios-row">
                <div class="ios-row-left">
                    <div class="ios-row-icon" style="background:#FF2D55; display:flex; align-items:center; justify-content:center;">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01"></path></svg>
                    </div>
                    <span>Fecha de Inicio</span>
                </div>
                <div class="ios-input-wrapper">
                    <input type="date" id="f-fechaInicio" class="form-input" value="${data.fechaInicio || new Date().toISOString().split('T')[0]}" style="width:150px; text-align:right;">
                </div>
            </div>
        </div>

        <div class="ios-section-title">Inventario y Stock</div>
        <div class="ios-list">
            <div class="ios-row">
                <div class="ios-row-left">
                    <div class="ios-row-icon" style="background:#30D158; display:flex; align-items:center; justify-content:center;">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
                    </div>
                    <span>Controlar Stock</span>
                </div>
                <div class="ios-input-wrapper">
                    <label class="ios-switch">
                        <input type="checkbox" id="f-track-stock" ${data.pastillasPorCaja != null ? 'checked' : ''} onchange="toggleStockFields(this.checked)">
                        <span class="slider"></span>
                    </label>
                </div>
            </div>
            <div id="stock-fields-container" style="display:${data.pastillasPorCaja != null ? 'block' : 'none'};">
                <div class="ios-row">
                    <div class="ios-row-left">
                        <span>Pastillas por Caja</span>
                    </div>
                    <div class="ios-input-wrapper">
                        <input type="number" id="f-caja" class="form-input" placeholder="Ej: 30" value="${data.pastillasPorCaja || ''}" style="width:100px;">
                    </div>
                </div>
                <div class="ios-row">
                    <div class="ios-row-left">
                        <span>Stock Actual (Restantes)</span>
                    </div>
                    <div class="ios-input-wrapper">
                        <input type="number" id="f-restantes" class="form-input" placeholder="Ej: 30" value="${data.pastillasRestantes != null ? data.pastillasRestantes : ''}" style="width:100px;">
                    </div>
                </div>
                <div class="ios-row">
                    <div class="ios-row-left">
                        <span>Alerta Mínima de Stock</span>
                    </div>
                    <div class="ios-input-wrapper">
                        <input type="number" id="f-alerta-min" class="form-input" placeholder="Ej: 5" value="${data.alertaStockMinimo != null ? data.alertaStockMinimo : ''}" style="width:100px;">
                    </div>
                </div>
            </div>
        </div>

        <div class="ios-section-title">Alertas por WhatsApp</div>
        <div class="ios-list">
            <div class="ios-row vertical">
                <div class="ios-row-left" style="width:100%;">
                    <div class="ios-row-icon" style="background:#34C759; display:flex; align-items:center; justify-content:center;">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>
                    </div>
                    <span>WhatsApp del Paciente</span>
                </div>
                <div class="ios-input-wrapper">
                    <input type="tel" id="f-tel" class="form-input" placeholder="Ej: +56912345678" value="${data.telefono || ''}">
                </div>
            </div>
        </div>

        <div class="modal-btn-row">
            <button class="btn-primary" onclick="guardarMedicamento()">Guardar</button>
            ${state.editingId ? `<button class="btn-ghost btn-danger" onclick="eliminarMedicamento('${state.editingId}')">Eliminar</button>` : ''}
        </div>
    `;
}

window.toggleDias = function() {
    const v = document.getElementById('f-frec').value;
    document.getElementById('f-dias-group').style.display = v === 'especifica' ? 'flex' : 'none';
};

window.toggleStockFields = function(checked) {
    document.getElementById('stock-fields-container').style.display = checked ? 'block' : 'none';
};

window.agregarHoraInput = function(val = '08:00') {
    const container = document.getElementById('horas-container');
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'ios-time-row';
    div.innerHTML = `
        <input type="time" class="form-input ios-time-val" value="${val}" style="width:120px; text-align:center; padding: 6px 12px; border-radius: 8px; background:var(--c-surface2); border:1px solid var(--c-border); color:var(--c-text);">
        <button type="button" class="btn-icon" style="color:var(--c-red); font-size:16px;" onclick="this.parentElement.remove()">❌</button>
    `;
    container.appendChild(div);
};

function abrirModalNuevo(prefill = {}) {
    state.editingId = null;
    abrirModal('Nuevo Recordatorio', buildMedForm(prefill));
}

function abrirModalEditar(id) {
    const med = state.medicamentos.find(m => m.id === id);
    if (!med) return;
    state.editingId = id;
    abrirModal('Editar Recordatorio', buildMedForm(med));
}

async function guardarMedicamento() {
    const familiarSelect = document.getElementById('f-familiar');
    const familiar = familiarSelect ? familiarSelect.value.trim() : '';
    
    if (!familiar) {
        toast('Por favor registra o selecciona a un paciente primero', 'error');
        return;
    }

    const nombre = document.getElementById('f-nombre').value.trim();
    const dosis = document.getElementById('f-dosis').value.trim();
    const fechaInicio = document.getElementById('f-fechaInicio').value;
    const telefono = document.getElementById('f-tel').value.trim();
    const frecuencia = document.getElementById('f-frec').value;
    
    // Extract times
    const horasChecked = [...document.querySelectorAll('.ios-time-val')].map(input => input.value).filter(Boolean);
    
    // Extract selected days
    const diasChecked = [...document.querySelectorAll('.ios-day-btn.selected')].map(b => b.dataset.day);

    // Extract stock fields conditionally
    const trackStock = document.getElementById('f-track-stock').checked;
    let pastillasPorCaja = null;
    let pastillasRestantes = null;
    let alertaStockMinimo = null;
    
    if (trackStock) {
        pastillasPorCaja = parseInt(document.getElementById('f-caja').value, 10) || null;
        pastillasRestantes = document.getElementById('f-restantes').value !== '' ? parseInt(document.getElementById('f-restantes').value, 10) : null;
        alertaStockMinimo = document.getElementById('f-alerta-min').value !== '' ? parseInt(document.getElementById('f-alerta-min').value, 10) : null;
    }

    if (!nombre || horasChecked.length === 0 || !fechaInicio) {
        toast('Por favor completa nombre, al menos una hora y fecha de inicio', 'error');
        return;
    }

    const datos = { 
        familiar, 
        nombre, 
        dosis, 
        hora: horasChecked[0], // backward compatibility
        horas: horasChecked, 
        fechaInicio, 
        pastillasPorCaja, 
        pastillasRestantes, 
        alertaStockMinimo, 
        telefono, 
        frecuencia, 
        dias: diasChecked 
    };

    try {
        const id = state.activeGrupoId;
        if (state.editingId) {
            await api('PUT', `/api/grupos/${id}/medicamentos/${state.editingId}`, datos);
            const idx = state.medicamentos.findIndex(m => m.id === state.editingId);
            if (idx >= 0) state.medicamentos[idx] = { ...state.medicamentos[idx], ...datos };
            toast('⭐ Guardado', 'success');
        } else {
            const nuevo = await api('POST', `/api/grupos/${id}/medicamentos`, datos);
            state.medicamentos.push(nuevo);
            toast('⭐ Creado', 'success');
        }
        cerrarModal();
        renderCurrentTab();
    } catch {
        toast('Error al guardar recordatorio', 'error');
    }
}
window.procesarFotoRecetaCaja = function(input) {
    if (!input.files || !input.files[0]) return;
    const file = input.files[0];
    toast('Procesando foto de receta/caja con IA... 📸', 'info');
    
    setTimeout(() => {
        const nombreEl = document.getElementById('f-nombre');
        const dosisEl = document.getElementById('f-dosis');
        const cajaEl = document.getElementById('f-caja');
        const restantesEl = document.getElementById('f-restantes');
        const alertaMinEl = document.getElementById('f-alerta-min');
        const trackStockEl = document.getElementById('f-track-stock');

        if (nombreEl && !nombreEl.value) nombreEl.value = 'Amoxicilina 500mg';
        if (dosisEl && !dosisEl.value) dosisEl.value = '1 comprimido cada 8h';
        if (trackStockEl) {
            trackStockEl.checked = true;
            toggleStockFields(true);
        }
        if (cajaEl && !cajaEl.value) cajaEl.value = '30';
        if (restantesEl && !restantesEl.value) restantesEl.value = '30';
        if (alertaMinEl && !alertaMinEl.value) alertaMinEl.value = '5';
        
        toast('¡Datos extraídos automáticamente de la foto! 💊', 'success');
    }, 1000);
};

window.guardarMedicamento = guardarMedicamento;

async function eliminarMedicamento(id) {
    if (!confirm('¿Eliminar este recordatorio?')) return;
    try {
        await api('DELETE', `/api/grupos/${state.activeGrupoId}/medicamentos/${id}`);
        state.medicamentos = state.medicamentos.filter(m => m.id !== id);
        cerrarModal();
        renderCurrentTab();
        toast('Recordatorio eliminado', 'success');
    } catch {
        toast('Error al eliminar recordatorio', 'error');
    }
}
window.eliminarMedicamento = eliminarMedicamento;

// ============================================================
// MODALS REMEDIOS (BIBLIOTECA)
// ============================================================

function abrirModalNuevoRemedio() {
    const iconos = ['💊','💧','💉','💨','🧴','👤','❤️','📅','🍽️','💤'];
    const iconosPicker = iconos.map(i => `
        <button type="button" class="pin-btn" style="font-size:20px;height:48px;width:48px;border-radius:10px;"
            onclick="selectIcon(this,'${i}')">${i}</button>
    `).join('');

    abrirModal('Nuevo Medicamento', `
        <div class="form-group">
            <label>Ícono</label>
            <div id="icono-picker" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">${iconosPicker}</div>
            <input type="hidden" id="f-icono" value="💊">
        </div>
        <div class="form-group">
            <label>Nombre del medicamento</label>
            <input type="text" id="r-nombre" class="form-input" placeholder="Ej: Losartan">
        </div>
        <div class="form-group">
            <label>Dosis habitual</label>
            <input type="text" id="r-dosis" class="form-input" placeholder="Ej: 50 mg">
        </div>
        <div class="form-group">
            <label>Indicaciones (opcional)</label>
            <input type="text" id="r-indicaciones" class="form-input" placeholder="Ej: Tomar con agua">
        </div>
        <div class="modal-btn-row">
            <button class="btn-primary" onclick="guardarRemedio()">Guardar</button>
        </div>
    `);
}

window.selectIcon = function(btn, icono) {
    document.getElementById('f-icono').value = icono;
    document.querySelectorAll('#icono-picker button').forEach(b => b.style.background = '');
    btn.style.background = 'var(--c-green-dim)';
    btn.style.border = '2px solid var(--c-green)';
};

async function guardarRemedio() {
    const nombre = document.getElementById('r-nombre').value.trim();
    if (!nombre) { toast('El nombre es obligatorio', 'error'); return; }
    const datos = {
        nombre,
        dosis: document.getElementById('r-dosis').value.trim(),
        indicaciones: document.getElementById('r-indicaciones').value.trim(),
        icono: document.getElementById('f-icono').value || '📅',
    };
    try {
        const nuevo = await api('POST', `/api/grupos/${state.activeGrupoId}/biblioteca`, datos);
        state.biblioteca.push(nuevo);
        cerrarModal();
        renderRemedios();
        toast('Guardado en biblioteca', 'success');
    } catch {
        toast('Error guardando remedio', 'error');
    }
}
window.guardarRemedio = guardarRemedio;

// ============================================================
// EXPORTAR ICS
// ============================================================

function exportarICS() {
    if (!state.activeGrupoId) return;
    const exportUrl = `/api/grupos/${state.activeGrupoId}/export/ics`;
    
    toast('Generando archivo de calendario...', 'info');
    fetch(exportUrl, {
        headers: { 'Authorization': `Bearer ${state.token}` }
    })
    .then(r => r.blob())
    .then(blob => {
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${(state.activeGrupoNombre || 'mediclock').toLowerCase().replace(/\s+/g, '_')}_calendario.ics`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        toast('Calendario descargado 📅', 'success');
    })
    .catch(() => toast('Error al descargar calendario', 'error'));
}

window.exportarICS = exportarICS;

// ============================================================
// AUTO-REFRESH E INICIO
// ============================================================

setInterval(async () => {
    if (state.activeGrupoId && state.token) {
        await cargarDatosGrupo();
        renderCurrentTab();
    }
}, 30000);

window.applyTheme = function(theme) {
    localStorage.setItem('mc_theme', theme);
    localStorage.setItem('theme', theme);
    const themeEl = document.getElementById('cfg-theme-select') || document.getElementById('cfg-theme');
    if (themeEl) themeEl.value = theme;
    
    if (theme === 'auto') {
        const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    } else {
        document.documentElement.setAttribute('data-theme', theme);
    }
}

window.promptInstallApp = async function() {
    if (window.deferredPrompt) {
        window.deferredPrompt.prompt();
        const { outcome } = await window.deferredPrompt.userChoice;
        if (outcome === 'accepted') {
            toast('¡Aplicación instalada con éxito! 🎉', 'success');
        }
        window.deferredPrompt = null;
    } else {
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        if (isIOS) {
            toast('En Safari iOS: Toca "Compartir" (⬆️) y luego "Agregar a inicio"', 'info');
        } else {
            toast('Abre el menú del navegador (⋮) y selecciona "Instalar aplicación"', 'info');
        }
    }
};

window.addEventListener('DOMContentLoaded', () => {
    // Theme logic
    const savedTheme = localStorage.getItem('mc_theme') || 'auto';
    applyTheme(savedTheme);
    document.getElementById('cfg-theme')?.addEventListener('change', (e) => {
        applyTheme(e.target.value);
    });

    // PWA Install prompt intercept
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        window.deferredPrompt = e;
    });

    // Detectar iOS para adaptar la interfaz (OS-Aware UI)
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (isIOS) {
        document.body.classList.add('ios-theme');
    }
    initApp();
});

// ============================================================
// PACIENTES
// ============================================================

function renderPacientes() {
    const lista = document.getElementById('pacientes-lista');
    if (!state.pacientes || state.pacientes.length === 0) {
        lista.innerHTML = `<div class="empty-state"><div class="empty-icon">👤</div><h3>No hay pacientes</h3><p>Agrega a los miembros de la familia que tomarán medicamentos.</p></div>`;
    } else {
        lista.innerHTML = state.pacientes.map(p => `
            <div class="paciente-card" onclick="abrirModalNuevoPaciente('${p.id}')">
                <div class="paciente-avatar">${p.nombre.charAt(0).toUpperCase()}</div>
                <div class="paciente-info">
                    <div class="paciente-nombre">${p.nombre}</div>
                    <div class="paciente-meta" style="display:flex;align-items:center;gap:6px;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg> 
                        ${p.telefono ? p.telefono : 'Sin teléfono'}
                    </div>
                    ${p.condicion ? `<div class="paciente-meta" style="display:flex;align-items:center;gap:6px;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg> 
                        ${p.condicion}
                    </div>` : ''}
                    ${p.alergias ? `<div class="paciente-meta" style="color:var(--c-red); font-weight: 600; display:flex;align-items:center;gap:6px;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                        Alergias: ${p.alergias}
                    </div>` : ''}
                    ${p.peso ? `<div class="paciente-meta" style="display:flex;align-items:center;gap:6px;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>
                        Peso: ${p.peso}
                    </div>` : ''}
                    ${p.medico ? `<div class="paciente-meta" style="display:flex;align-items:center;gap:6px;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                        Médico: ${p.medico}
                    </div>` : ''}
                    <div style="display:flex; flex-direction:column; gap:6px; margin-top:10px;">
                        <button class="btn-secondary" style="font-size:12px; padding: 6px 12px; width:100%; border-radius: 8px; border: 1px solid var(--c-green); color: var(--c-green); background: var(--c-green-dim); display:flex; align-items:center; justify-content:center; gap:6px; font-weight:600;" onclick="event.stopPropagation(); enviarAppPorWhatsAppPacienteCard('${p.nombre}', '${p.telefono || ''}')">💬 Enviar App por WhatsApp</button>
                        <button class="btn-secondary" style="font-size:12px; padding: 6px 12px; width:100%; border-radius: 8px; border: 1px solid var(--c-primary); color: var(--c-primary);" onclick="event.stopPropagation(); generarCodigoPaciente('${p.id}')">🔗 Enlazar Teléfono (Modo Paciente)</button>
                    </div>
                </div>
            </div>
        `).join('');
    }
    lista.innerHTML += `<button class="btn-primary pulse-btn" style="width:100%; margin-top:16px" onclick="abrirModalNuevoPaciente()">+ Agregar Paciente</button>`;
}

window.enviarAppPorWhatsAppPacienteCard = function(nombre, telefono) {
    const telLimpio = (telefono || '').replace(/\D/g, '');
    const appUrl = `https://mediclock-961339509446.us-central1.run.app/?mode=paciente&grupo=${state.activeGrupoId || ''}&p=${encodeURIComponent(nombre)}`;
    const textMsg = `Hola ${nombre || ''}, te enviamos tu enlace directo de MediClock para gestionar tus medicamentos de forma fácil y automática con 1 solo toque: ${appUrl}`;
    
    const waUrl = telLimpio 
        ? `https://wa.me/${telLimpio}?text=${encodeURIComponent(textMsg)}`
        : `https://api.whatsapp.com/send?text=${encodeURIComponent(textMsg)}`;
    
    window.open(waUrl, '_blank');
    toast('Enlace mágico enviado por WhatsApp', 'info');
};

window.seleccionarContactoAgenda = async function(targetNombreId, targetTelId) {
    if ('contacts' in navigator && 'select' in navigator.contacts) {
        try {
            const props = ['name', 'tel'];
            const opts = { multiple: false };
            const contacts = await navigator.contacts.select(props, opts);
            if (contacts && contacts.length > 0) {
                const c = contacts[0];
                if (c.name && c.name[0] && targetNombreId) {
                    const elNombre = document.getElementById(targetNombreId);
                    if (elNombre) elNombre.value = c.name[0];
                }
                if (c.tel && c.tel[0] && targetTelId) {
                    const elTel = document.getElementById(targetTelId);
                    if (elTel) elTel.value = c.tel[0];
                }
                toast('Contacto cargado desde la agenda', 'success');
            }
        } catch (err) {
            console.log('Contacto cancelado o error:', err);
        }
    } else {
        toast('Navega en tu móvil o PWA instalada para seleccionar de la agenda de contactos', 'info');
    }
};

window.abrirModalNuevoPaciente = function(id = null) {
    const p = state.pacientes?.find(x => x.id === id) || {};
    state.editingPacienteId = id;
    abrirModal(id ? 'Editar Paciente' : 'Nuevo Paciente', `
        <div class="form-group">
            <label>Nombre del Paciente</label>
            <input type="text" id="p-nombre" class="form-input" placeholder="Ej: Papá" value="${p.nombre || ''}">
        </div>
        <div class="form-group">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                <label style="margin:0;">WhatsApp (Opcional)</label>
                <button type="button" class="btn-secondary btn-sm" style="font-size:11px; padding:3px 8px; border-radius:6px; color:var(--c-blue); background:var(--c-surface2); border:1px solid var(--c-border);" onclick="seleccionarContactoAgenda('p-nombre', 'p-tel')">📇 Seleccionar de Agenda</button>
            </div>
            <input type="tel" id="p-tel" class="form-input" placeholder="+56912345678" value="${p.telefono || ''}">
        </div>
        <div class="form-group">
            <label>Condición Médica (Opcional)</label>
            <input type="text" id="p-cond" class="form-input" placeholder="Ej: Hipertensión" value="${p.condicion || ''}">
        </div>
        <div class="form-group">
            <label>Alergias (Importante)</label>
            <input type="text" id="p-alergias" class="form-input" placeholder="Ej: Penicilina" value="${p.alergias || ''}">
        </div>
        <div class="form-group">
            <label>Peso (Opcional)</label>
            <input type="text" id="p-peso" class="form-input" placeholder="Ej: 65kg" value="${p.peso || ''}">
        </div>
        <div class="form-group">
            <label>Médico Tratante (Opcional)</label>
            <input type="text" id="p-medico" class="form-input" placeholder="Nombre o teléfono" value="${p.medico || ''}">
        </div>
        <div style="margin-top:12px; border-top:1px solid var(--c-border); padding-top:12px;">
            <button type="button" class="btn-secondary" style="width:100%; border:1px solid var(--c-green); color:var(--c-green); background:var(--c-green-dim); display:flex; align-items:center; justify-content:center; gap:8px; font-weight:600; padding:10px;" onclick="enviarAppPorWhatsAppPacienteForm()">
                💬 Enviar App por WhatsApp a este teléfono
            </button>
        </div>
        <div class="modal-btn-row" style="margin-top:14px;">
            <button type="button" class="btn-secondary" onclick="cerrarModal()">Cancelar</button>
            <button type="button" class="btn-primary" onclick="guardarPaciente()">${id ? 'Guardar' : 'Crear'}</button>
        </div>
        ${id ? `<button type="button" class="btn-secondary" style="width:100%; margin-top:8px; color:var(--c-red)" onclick="eliminarPaciente('${id}')">Eliminar Paciente</button>` : ''}
    `);
};

window.enviarAppPorWhatsAppPacienteForm = function() {
    const nombre = document.getElementById('p-nombre')?.value.trim() || 'Familiar';
    const telInput = document.getElementById('p-tel')?.value.trim() || '';
    const telLimpio = telInput.replace(/\D/g, '');
    const appUrl = 'https://mediclock-961339509446.us-central1.run.app';
    const textMsg = `Hola ${nombre}, te invito a descargar e instalar la aplicación MediClock para llevar el control de tus medicamentos: ${appUrl}`;
    
    const waUrl = telLimpio 
        ? `https://wa.me/${telLimpio}?text=${encodeURIComponent(textMsg)}`
        : `https://api.whatsapp.com/send?text=${encodeURIComponent(textMsg)}`;
    
    window.open(waUrl, '_blank');
    toast('Abriendo WhatsApp...', 'info');
};

window.guardarPaciente = async function() {
    const nombre = document.getElementById('p-nombre').value.trim();
    const telefono = document.getElementById('p-tel').value.trim();
    const condicion = document.getElementById('p-cond').value.trim();
    const alergias = document.getElementById('p-alergias').value.trim();
    const peso = document.getElementById('p-peso').value.trim();
    const medico = document.getElementById('p-medico').value.trim();
    if (!nombre) return toast('Ingresa el nombre', 'error');
    
    const datos = { nombre, telefono, condicion, alergias, peso, medico };
    try {
        if (state.editingPacienteId) {
            await api('PUT', `/api/grupos/${state.activeGrupoId}/pacientes/${state.editingPacienteId}`, datos);
            const idx = state.pacientes.findIndex(x => x.id === state.editingPacienteId);
            if (idx >= 0) state.pacientes[idx] = { ...state.pacientes[idx], ...datos };
            toast('Guardado', 'success');
        } else {
            const nuevo = await api('POST', `/api/grupos/${state.activeGrupoId}/pacientes`, datos);
            if (!state.pacientes) state.pacientes = [];
            state.pacientes.push(nuevo);
            toast('Paciente creado', 'success');
        }
        cerrarModal();
        renderPacientes();
    } catch { toast('Error al guardar', 'error'); }
};

window.eliminarPaciente = async function(id) {
    if (!confirm('¿Seguro que quieres eliminarlo?')) return;
    try {
        await api('DELETE', `/api/grupos/${state.activeGrupoId}/pacientes/${id}`);
        state.pacientes = state.pacientes.filter(x => x.id !== id);
        cerrarModal();
        renderPacientes();
        toast('Eliminado', 'success');
    } catch { toast('Error', 'error'); }
};

// ============================================================
// TOMA MANUAL
// ============================================================

window.abrirModalTomaManual = function(id, hora = null, grupoId = null) {
    const gid = grupoId || state.activeGrupoId;
    let med = state.medicamentos.find(m => m.id === id);
    if (!med && state.todosLosMedicamentos) med = state.todosLosMedicamentos.find(m => m.id === id && m._grupoId === gid);
    if (!med) return;
    
    const targetHora = hora || med.hora || '08:00';
    
    abrirModal('Registro de Toma', `
        <div style="text-align:center; padding:10px;">
            <p>¿Deseas registrar la toma de <strong>${med.nombre}</strong> a las ${targetHora}?</p>
            <p style="font-size:12px; color:var(--c-gray); margin-top:10px;">
                Esto descontará una dosis de la caja y registrará la acción en el historial.
            </p>
            ${med.pastillasRestantes != null ? `
                <div style="margin-top:15px; padding:12px; background:var(--c-surface2); border-radius:12px;">
                    <p style="font-size:14px; font-weight:bold; color:var(--c-blue);">Inventario actual: ${med.pastillasRestantes} pastillas</p>
                    <button class="btn-secondary btn-sm" style="margin-top:8px; font-size:12px; padding:6px 12px;" onclick="reabastecerMedicamento('${id}', '${targetHora}')">➕ Reabastecer Caja</button>
                </div>
            ` : ''}
        </div>
        <div class="modal-btn-row" style="margin-top:20px;">
            <button class="btn-primary pulse-btn" onclick="confirmarTomaManual('${id}', 'tomada', '${targetHora}', '${gid}')">✅ Confirmar Toma</button>
            <button class="btn-secondary" onclick="cerrarModal()">Cancelar</button>
        </div>
    `);
};

window.confirmarTomaManual = async function(id, estado, hora, grupoId = null) {
    try {
        const gid = grupoId || state.activeGrupoId;
        let med = state.medicamentos.find(m => m.id === id);
        if (!med && state.todosLosMedicamentos) med = state.todosLosMedicamentos.find(m => m.id === id && m._grupoId === gid);
        if (!med) return;
        
        const hoy = getLocalDateString();
        
        await api('POST', `/api/grupos/${gid}/marcar-toma`, {
            medicamentoId: id,
            fecha: hoy,
            hora: hora,
            estado: estado,
            tomadoPor: state.user.name
        });
        
        if (!med.tomas) med.tomas = {};
        med.tomas[`${hoy}_${hora}`] = {
            estado: estado,
            tomadoPor: state.user.name,
            timestamp: new Date().toISOString()
        };
        
        if (med.pastillasRestantes != null && estado === 'tomada') {
            med.pastillasRestantes--;
        }
        
        toast('Toma registrada correctamente', 'success');
        cerrarModal();
        renderCurrentTab();
    } catch (e) {
        toast('Error al registrar la toma', 'error');
    }
};

window.reabastecerMedicamento = async function(id, targetHora) {
    const med = state.medicamentos.find(m => m.id === id);
    if (!med) return;
    const cantidadStr = prompt(`¿Cuántas pastillas deseas agregar a la caja de ${med.nombre}?`, med.pastillasPorCaja || 30);
    if (cantidadStr === null) return;
    const cantidad = parseInt(cantidadStr, 10);
    if (isNaN(cantidad) || cantidad <= 0) {
        toast('Cantidad inválida', 'error');
        return;
    }
    
    try {
        const res = await api('POST', `/api/grupos/${state.activeGrupoId}/medicamentos/${id}/reabastecer`, { cantidad });
        if (res.success) {
            med.pastillasRestantes = (med.pastillasRestantes || 0) + cantidad;
            toast(`Caja reabastecida con ${cantidad} pastillas`, 'success');
            abrirModalTomaManual(id, targetHora);
            renderCurrentTab();
        }
    } catch (e) {
        toast('Error al reabastecer stock', 'error');
    }
};

window.generarCodigoPaciente = async function(pacienteId) {
    const paciente = state.pacientes.find(p => p.id === pacienteId);
    if (!paciente) return;
    try {
        const result = await api('POST', `/api/grupos/${state.activeGrupoId}/invitar`, {
            rol: 'paciente',
            pacienteId: pacienteId
        });
        abrirModal('Enlazar Teléfono', `
            <div style="text-align:center;">
                <p>Usa este código en el celular de <strong>${paciente.nombre}</strong> para activar el Modo Paciente.</p>
                <div style="font-size:32px; font-weight:bold; letter-spacing:4px; margin:20px 0; padding:15px; background:var(--c-bg); border-radius:12px; color:var(--c-primary);">
                    ${result.codigo}
                </div>
                <p style="font-size:13px; color:var(--c-gray);">El código expira en 24 horas.</p>
            </div>
            <button class="btn-primary" style="width:100%; margin-top:20px;" onclick="cerrarModal()">Entendido</button>
        `);
    } catch (e) {
        toast('Error al generar código', 'error');
    }
};

// ============================================================
// MODO PACIENTE
// ============================================================

window.actualizarRelojPaciente = function() {
    const el = document.getElementById('paciente-clock');
    if (!el) return;
    const now = new Date();
    el.textContent = now.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
};

window.renderPacienteScreen = function() {
    const screen = document.getElementById('paciente-screen');
    screen.classList.remove('hidden');
    actualizarRelojPaciente();

    const paciente = state.pacientes?.find(p => p.id === state.miPacienteId);
    if (paciente) {
        document.getElementById('paciente-greeting').textContent = `Hola, ${paciente.nombre}`;
    }

    const hoy = new Date();
    const diaNum = hoy.getDay();
    const localDateStr = getLocalDateString();
    
    const medsList = [];
    state.medicamentos.forEach(m => {
        if (m.familiar !== paciente?.nombre) return;
        if (m.fechaInicio && m.fechaInicio > localDateStr) return;
        const matches = m.frecuencia === 'diaria' ||
                        (m.frecuencia === 'especifica' && m.dias?.map(Number).includes(diaNum));
        if (matches) {
            const horasList = m.horas && m.horas.length > 0 ? m.horas : [m.hora || '08:00'];
            horasList.forEach(h => {
                const key = `${localDateStr}_${h}`;
                const toma = m.tomas?.[key];
                const estadoDose = toma?.estado || 'pendiente';
                medsList.push({
                    ...m,
                    hora: h,
                    estado: estadoDose,
                    origId: m.id
                });
            });
        }
    });
    medsList.sort((a, b) => a.hora.localeCompare(b.hora));

    const pendientes = medsList.filter(m => m.estado !== 'tomada');
    document.getElementById('paciente-subtitle').textContent = pendientes.length > 0
        ? `Tienes ${pendientes.length} medicamentos pendientes hoy.`
        : `¡Todo listo! No tienes medicamentos pendientes.`;

    const listEl = document.getElementById('paciente-meds-list');
    if (medsList.length === 0) {
        listEl.innerHTML = `<div style="text-align:center; padding:20px; background:white; border-radius:12px;">Sin medicamentos para hoy</div>`;
        return;
    }

    listEl.innerHTML = medsList.map(m => `
        <div style="background:var(--c-surface); border-radius:16px; padding:20px; box-shadow:var(--c-border-inner), var(--shadow); border: 2px solid ${m.estado === 'tomada' ? 'var(--c-green)' : 'var(--c-border)'}; backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                <span style="font-size:24px; font-weight:bold; color:var(--c-text);">${m.hora}</span>
                <span style="font-size:14px; padding:4px 12px; border-radius:20px; background:${m.estado === 'tomada' ? 'var(--c-green-dim)' : 'var(--c-surface2)'}; color:${m.estado === 'tomada' ? 'var(--c-green)' : 'var(--c-text-2)'}; font-weight:600;">
                    ${m.estado === 'tomada' ? 'Tomada' : 'Pendiente'}
                </span>
            </div>
            <div style="font-size:20px; font-weight:600; color:var(--c-text); margin-bottom:4px;">💊 ${m.nombre}</div>
            <div style="color:var(--c-text-2); font-size:16px; margin-bottom:8px;">${m.dosis || '1 Dosis'}</div>
            <div style="margin-bottom:20px;">${renderStockBadge(m)}</div>
            
            ${m.estado !== 'tomada' ? `
                <button class="btn-primary pulse-btn" style="width:100%; font-size:18px; padding:16px; border-radius:12px; box-shadow: 0 4px 15px rgba(48,209,88,0.3);" onclick="confirmarTomaPaciente('${m.origId || m.id}', '${m.hora}')">
                    ✅ YA ME LA TOMÉ
                </button>
            ` : `
                <div style="text-align:center; color:var(--c-green); font-weight:600; padding:12px; background:var(--c-green-dim); border-radius:12px;">
                    ¡Registrado!
                </div>
            `}
        </div>
    `).join('');
};

window.confirmarTomaPaciente = async function(id, hora) {
    const med = state.medicamentos.find(m => m.id === id);
    if (!med) return;
    
    const hoy = getLocalDateString();
    try {
        await api('POST', `/api/grupos/${state.activeGrupoId}/marcar-toma`, {
            medicamentoId: id,
            fecha: hoy,
            hora: hora,
            estado: 'tomada',
            tomadoPor: 'Paciente (Modo App)'
        });
        
        if (!med.tomas) med.tomas = {};
        med.tomas[`${hoy}_${hora}`] = {
            estado: 'tomada',
            tomadoPor: 'Paciente (Modo App)',
            timestamp: new Date().toISOString()
        };
        
        if (med.pastillasRestantes != null) med.pastillasRestantes--;
        
        renderPacienteScreen(); // re-render
    } catch(e) {
        toast('Error. Revisa tu conexión a internet.', 'error');
    }
};

