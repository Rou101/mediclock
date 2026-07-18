// ============================================================
// MEDICLOCK - APP LOGIC v2 (DEV MOCK AUTH)
// ============================================================

// --- ESTADO GLOBAL ---
const state = {
    user: null,
    token: 'dummy-token-123',
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
        // Token expirado
        logout();
        throw new Error("Sesión expirada");
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
    state.user = null;
    state.token = null;
    state.activeGrupoId = null;
    localStorage.removeItem('mc_active_grupo_id');
    document.getElementById('app').classList.add('hidden');
    document.getElementById('group-screen').classList.add('hidden');
    document.getElementById('login-screen').classList.remove('hidden');
}

// ============================================================
// AUTHENTICATION FLOW (MOCKED)
// ============================================================

document.getElementById('btn-google-login').addEventListener('click', async () => {
    toast('Iniciando sesión de prueba...', 'info');
    
    // Simular login
    state.user = { uid: 'test-user-123', email: 'test@mediclock.com', name: 'Usuario Prueba' };
    state.token = 'dummy-token-123';
    
    document.getElementById('login-screen').classList.add('hidden');
    
    // Manejar link de invitación si existe en la URL actual
    const m = window.location.pathname.match(/\/unirse\/([A-Z0-9]+)/);
    if (m) {
        const codigo = m[1];
        await procesarInvitacion(codigo);
        return;
    }

    await inicializarGrupos();
});

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
    try {
        state.grupos = await api('GET', '/api/mis-grupos');
        
        // Entrar a la app siempre
        document.getElementById('app').classList.remove('hidden');

        if (state.grupos.length === 0) {
            // No tiene grupos -> Onboarding Premium
            state.activeGrupoId = null;
            document.getElementById('active-group-name').textContent = "Nueva Cuenta ";
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
        toast('Error al sincronizar grupos', 'error');
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
    const nombre = input.value.trim();
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
    }
    
    document.getElementById('active-group-name').textContent = `${state.activeGrupoNombre} `;
    
    await cargarDatosGrupo();
    renderCurrentTab();
}

document.getElementById('btn-switch-group').addEventListener('click', () => {
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
    } catch (e) {
        toast('Error cargando datos del grupo', 'error');
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
    document.getElementById('btn-export').addEventListener('click', exportarICS);
    document.getElementById('btn-refresh').addEventListener('click', async () => {
        toast('Sincronizando...', 'info');
        await cargarDatosGrupo();
        renderCurrentTab();
        toast('⭐ Sincronizado', 'success');
    });

    // Modal
    document.getElementById('modal-close').addEventListener('click', cerrarModal);
    document.getElementById('modal-overlay').addEventListener('click', e => {
        if (e.target === e.currentTarget) cerrarModal();
    });

    // Hoy
    document.getElementById('btn-add-hoy').addEventListener('click', () => abrirModalNuevo());

    // Calendario
    document.getElementById('cal-prev').addEventListener('click', () => { state.calOffset--; renderCalendario(); });
    document.getElementById('cal-next').addEventListener('click', () => { state.calOffset++; renderCalendario(); });

    // Biblioteca
    document.getElementById('btn-add-remedio').addEventListener('click', () => abrirModalNuevoRemedio());

    // Config
    document.getElementById('btn-guardar-config').addEventListener('click', guardarConfig);
    document.getElementById('btn-logout').addEventListener('click', logout);
    document.getElementById('btn-invitar-miembro').addEventListener('click', generarInvitacion);
    document.getElementById('btn-copy-invite').addEventListener('click', copiarLinkInvitacion);
}

function switchTab(tab) {
    state.activeTab = tab;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `panel-${tab}`));
    renderCurrentTab();
}

function renderCurrentTab() {
    if (!state.activeGrupoId && state.activeTab !== 'hoy') {
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
    container.innerHTML = `
        <div class="lock-state">
            <div class="lock-icon">x</div>
            <h3 class="lock-text">Crea tu grupo familiar primero</h3>
            <p style="color:var(--c-gray); font-size:14px; margin-top:8px;">Ve a la pestaña "Hoy" para comenzar.</p>
        </div>
    `;
}

// ============================================================
// RENDERS ESPECIFICOS
// ============================================================

function renderHoy() {
    const lista = document.getElementById('hoy-lista');
    
    if (!state.activeGrupoId) {
        // MODO ONBOARDING PREMIUM
        document.getElementById('hoy-fecha').textContent = "Bienvenido a MediClock";
        document.getElementById('hoy-resumen').textContent = "El centro de control de tu familia";
        document.getElementById('btn-add-hoy').style.display = 'none';

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
    document.getElementById('hoy-fecha').textContent =
        `${diasNombre[hoy.getDay()]}, ${hoy.getDate()} de ${meses[hoy.getMonth()]}`;

    const diaNum = hoy.getDay();
    const medHoy = state.medicamentos.filter(m =>
        m.frecuencia === 'diaria' ||
        (m.frecuencia === 'especifica' && m.dias?.map(Number).includes(diaNum))
    ).sort((a, b) => a.hora.localeCompare(b.hora));

    const tomadas = medHoy.filter(m => m.estado === 'tomada').length;
    const total = medHoy.length;
    document.getElementById('hoy-resumen').textContent =
        total > 0 ? `${tomadas} de ${total} confirmadas hoy` : 'Sin medicamentos programados para hoy';

    if (medHoy.length === 0) {
        lista.innerHTML = `<div class="empty-state">
            <div class="empty-state-icon">📅</div>
            <h3>Sin recordatorios hoy</h3>
            <p>Toca "+ Nuevo" para programar un medicamento.</p>
        </div>`;
        return;
    }

    const grupos = {};
    medHoy.forEach(m => {
        if (!grupos[m.familiar]) grupos[m.familiar] = [];
        grupos[m.familiar].push(m);
    });

    lista.innerHTML = Object.entries(grupos).map(([familiar, meds]) => `
        <div class="familiar-group">
            <div class="familiar-label">👤 ${familiar}</div>
            ${meds.map(m => `
                <div class="med-card ${m.estado || ''}" onclick="abrirModalEditar('${m.id}')">
                    <div class="med-time">${m.hora}<small>${frecLabel(m)}</small></div>
                    <div class="med-info">
                        <div class="med-name">💊 ${m.nombre}</div>
                        <div class="med-dose">${m.dosis || ''}</div>
                    </div>
                    <span class="med-status ${statusClass(m.estado)}">${estadoLabel(m.estado)}</span>
                </div>
            `).join('')}
        </div>
    `).join('');
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
    const m = { tomada: '⭐ Tomada', pendiente: '⏳ Pendiente', olvidada: '⭐ Olvidada' };
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
        `${mes[dias[0].getMonth()]} ${dias[0].getDate()}  ${dias[6].getDate()}`;

    const grid = document.getElementById('calendario-grid');
    grid.innerHTML = dias.map((dia, i) => {
        const esHoy = dia.toDateString() === hoyStr;
        const diaNum = numDia(dia);
        const meds = state.medicamentos
            .filter(m =>
                m.frecuencia === 'diaria' ||
                (m.frecuencia === 'especifica' && m.dias?.map(Number).includes(diaNum))
            )
            .sort((a, b) => a.hora.localeCompare(b.hora));

        const esHoyBool = dia.toDateString() === hoyStr;
        const medsHtml = meds.map(m => `
            <div class="cal-med ${esHoyBool ? (m.estado || 'sin-estado') : 'sin-estado'}"
                 onclick="abrirModalEditar('${m.id}')"
                 title="${m.nombre} ${m.hora}">
                ${m.hora}<br>${m.nombre.substring(0, 8)}
            </div>
        `).join('');

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

    document.getElementById('historial-stats').innerHTML = `
        <span class="stat-pill">⭐ ${tomadas} tomadas</span>
        <span class="stat-pill miss">⭐ ${olvidadas} olvidadas</span>
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

    grid.innerHTML = remediosHtml + `
        <div class="remedio-add-card" onclick="abrirModalNuevoRemedio()">
            <span style="font-size:24px">+</span>
            <span style="font-size:12px;font-weight:600">Agregar</span>
        </div>
    `;
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
    const cfg = state.config;
    document.getElementById('cfg-admin-phone').value = cfg.adminPhone || '';
    document.getElementById('cfg-minutos').value = cfg.minutosOlvido || 20;

    // Solo admin puede guardar config global y generar invitaciones
    const isAdmin = state.miRol === 'admin';
    document.getElementById('btn-guardar-config').disabled = !isAdmin;
    document.getElementById('btn-invitar-miembro').style.display = isAdmin ? 'block' : 'none';

    // Lista de miembros
    const container = document.getElementById('miembros-lista');
    container.innerHTML = state.miembros.map(m => `
        <div class="admin-card">
            <div style="display:flex; align-items:center; gap:12px;">
                <img src="${m.foto || '/icon-512.png'}" style="width:36px; height:36px; border-radius:50%; background:var(--c-surface);">
                <div class="admin-info">
                    <span class="admin-name">${m.nombre}</span>
                    <span style="font-size:11px; color:var(--c-gray);">${m.email}</span>
                </div>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
                <span class="admin-role ${m.rol === 'admin' ? 'admin' : 'member'}">${m.rol.toUpperCase()}</span>
                ${isAdmin && m.uid !== state.user.uid ? `
                    <button class="remedio-del" style="position:static; width:28px; height:28px;" onclick="eliminarMiembro('${m.uid}')">=</button>
                ` : ''}
            </div>
        </div>
    `).join('');
}

async function guardarConfig() {
    const datos = {
        adminPhone: document.getElementById('cfg-admin-phone').value.trim(),
        minutosOlvido: parseInt(document.getElementById('cfg-minutos').value) || 20,
    };
    try {
        await api('PUT', `/api/grupos/${state.activeGrupoId}/config`, datos);
        state.config = { ...state.config, ...datos };
        toast('⭐ Configuración guardada', 'success');
    } catch {
        toast('Error guardando configuración', 'error');
    }
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
    document.getElementById('modal-title').textContent = titulo;
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
    setTimeout(() => { overlay.classList.add('hidden'); state.editingId = null; }, 350);
}

function buildMedForm(data = {}) {
    const dias = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const diasCheck = dias.map((d, i) => `
        <label class="dia-label">
            <input type="checkbox" name="dias" value="${i}" ${data.dias?.map(Number).includes(i) ? 'checked' : ''}>
            <div class="dia-pill">${d}</div>
        </label>
    `).join('');

    return `
        <div class="form-group">
            <label>Familiar / Paciente</label>
            <select id="f-familiar" class="form-input">
                <option value="">Selecciona un paciente...</option>
                ${(state.pacientes || []).map(p => 
                    `<option value="${p.nombre}" ${data.familiar === p.nombre ? 'selected' : ''}>${p.nombre}</option>`
                ).join('')}
            </select>
        </div>
        <div class="form-group">
            <label>Medicamento</label>
            <input type="text" id="f-nombre" class="form-input" placeholder="Nombre del medicamento" value="${data.nombre || ''}">
        </div>
        <div class="form-row">
            <div class="form-group">
                <label>Dosis</label>
                <input type="text" id="f-dosis" class="form-input" placeholder="Ej: 1 de 500 mg" value="${data.dosis || ''}">
            </div>
            <div class="form-group">
                <label>Hora</label>
                <input type="time" id="f-hora" class="form-input" value="${data.hora || '08:00'}">
            </div>
        </div>
        <div class="form-group">
            <label>WhatsApp del paciente</label>
            <input type="tel" id="f-tel" class="form-input" placeholder="+56912345678" value="${data.telefono || ''}">
        </div>
        <div class="form-group">
            <label>Frecuencia</label>
            <select id="f-frec" class="form-input" onchange="toggleDias()">
                <option value="diaria" ${data.frecuencia === 'diaria' ? 'selected' : ''}>Todos los días</option>
                <option value="especifica" ${data.frecuencia === 'especifica' ? 'selected' : ''}>Días específicos</option>
            </select>
        </div>
        <div class="form-group" id="f-dias-group" style="display:${data.frecuencia === 'especifica' ? 'block' : 'none'}">
            <label>Días de la semana</label>
            <div class="dias-check">${diasCheck}</div>
        </div>
        <div class="modal-btn-row">
            <button class="btn-primary" onclick="guardarMedicamento()">x▾Guardar</button>
            ${state.editingId ? `<button class="btn-ghost btn-danger" onclick="eliminarMedicamento('${state.editingId}')">x Eliminar</button>` : ''}
        </div>
    `;
}

window.toggleDias = function() {
    const v = document.getElementById('f-frec').value;
    document.getElementById('f-dias-group').style.display = v === 'especifica' ? 'block' : 'none';
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
    const familiar = document.getElementById('f-familiar').value.trim();
    const nombre = document.getElementById('f-nombre').value.trim();
    const dosis = document.getElementById('f-dosis').value.trim();
    const hora = document.getElementById('f-hora').value;
    const telefono = document.getElementById('f-tel').value.trim();
    const frecuencia = document.getElementById('f-frec').value;
    const diasChecked = [...document.querySelectorAll('input[name="dias"]:checked')].map(c => c.value);

    if (!nombre || !hora) {
        toast('Por favor completa el nombre y la hora', 'error');
        return;
    }

    const datos = { familiar, nombre, dosis, hora, telefono, frecuencia, dias: diasChecked };

    try {
        const id = state.activeGrupoId;
        if (state.editingId) {
            await api('PUT', `/api/grupos/${id}/medicamentos/${state.editingId}`, datos);
            const idx = state.medicamentos.findIndex(m => m.id === state.editingId);
            if (idx >= 0) state.medicamentos[idx] = { ...state.medicamentos[idx], ...datos };
            toast('⭐ Guardado', 'success');
        } else {
            const nuevo = await api('POST', `/api/grupos/${id}/medicamentos`, datos);
            state.medicamentos.push(nuevo);
            toast('⭐ Creado', 'success');
        }
        cerrarModal();
        renderCurrentTab();
    } catch {
        toast('Error al guardar recordatorio', 'error');
    }
}
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
            <button class="btn-primary" onclick="guardarRemedio()">x▾Guardar</button>
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
        toast('⭐ Guardado en biblioteca', 'success');
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
    const a = document.createElement('a');
    // Pasar el token en query param para que el navegador pueda descargarlo (ICS no usa headers en tag <a>)
    a.href = `/api/grupos/${state.activeGrupoId}/export/ics?token=${state.token}`;
    // Usamos endpoint alternativo con token o lo redirigimos
    a.href = `/api/grupos/${state.activeGrupoId}/export/ics`;
    
    // Como la descarga directa de un endpoint con auth token requiere headers, hacemos un fetch blob:
    toast('Generando archivo de calendario...', 'info');
    fetch(a.href, {
        headers: { 'Authorization': `Bearer ${state.token}` }
    })
    .then(r => r.blob())
    .then(blob => {
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${state.activeGrupoNombre.toLowerCase().replace(/\s+/g, '_')}_calendario.ics`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        toast('x& Calendario descargado', 'success');
    })
    .catch(() => toast('Error al descargar calendario', 'error'));
}

// ============================================================
// AUTO-REFRESH E INICIO
// ============================================================

setInterval(async () => {
    if (state.activeGrupoId && state.token) {
        await cargarDatosGrupo();
        renderCurrentTab();
    }
}, 30000);

window.addEventListener('DOMContentLoaded', () => {
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
                    <div class="paciente-meta">${p.telefono ? '📞 ' + p.telefono : 'Sin teléfono'}</div>
                    ${p.condicion ? `<div class="paciente-meta">⚕️ ${p.condicion}</div>` : ''}
                </div>
            </div>
        `).join('');
    }
    lista.innerHTML += `<button class="btn-primary pulse-btn" style="width:100%; margin-top:16px" onclick="abrirModalNuevoPaciente()">+ Agregar Paciente</button>`;
}

window.abrirModalNuevoPaciente = function(id = null) {
    const p = state.pacientes?.find(x => x.id === id) || {};
    state.editingPacienteId = id;
    abrirModal(id ? 'Editar Paciente' : 'Nuevo Paciente', `
        <div class="form-group">
            <label>Nombre del Paciente</label>
            <input type="text" id="p-nombre" class="form-input" placeholder="Ej: Pap" value="${p.nombre || ''}">
        </div>
        <div class="form-group">
            <label>WhatsApp (Opcional)</label>
            <input type="tel" id="p-tel" class="form-input" placeholder="+56912345678" value="${p.telefono || ''}">
        </div>
        <div class="form-group">
            <label>Condición Médica (Opcional)</label>
            <input type="text" id="p-cond" class="form-input" placeholder="Ej: Hipertensin" value="${p.condicion || ''}">
        </div>
        <div class="modal-btn-row">
            <button type="button" class="btn-secondary" onclick="cerrarModal()">Cancelar</button>
            <button type="button" class="btn-primary" onclick="guardarPaciente()">${id ? 'Guardar' : 'Crear'}</button>
        </div>
        ${id ? `<button type="button" class="btn-secondary" style="width:100%; margin-top:8px; color:var(--c-red)" onclick="eliminarPaciente('${id}')">Eliminar Paciente</button>` : ''}
    `);
};

window.guardarPaciente = async function() {
    const nombre = document.getElementById('p-nombre').value.trim();
    const telefono = document.getElementById('p-tel').value.trim();
    const condicion = document.getElementById('p-cond').value.trim();
    if (!nombre) return toast('Ingresa el nombre', 'error');
    
    const datos = { nombre, telefono, condicion };
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

