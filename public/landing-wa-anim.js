/* ========================================
   MEDICLOCK PRO - ANIMACIÓN EN VIVO WHATSAPP & MODAL SEGURIDAD
   ======================================== */

document.addEventListener('DOMContentLoaded', () => {
    initLiveWhatsAppFeed();
    initSecurityModal();
});

// 1. MODAL DE SEGURIDAD & CERTIFICACIONES B2B
function initSecurityModal() {
    // Vincular clic a las píldoras tecnológicas y al bloque de seguridad
    const pills = document.querySelectorAll('.desktop-partner-pill, .desktop-security-card');
    pills.forEach(pill => {
        pill.style.cursor = 'pointer';
        pill.addEventListener('click', abrirModalSeguridad);
    });
}

function abrirModalSeguridad(e) {
    if (e) e.stopPropagation();
    const modal = document.getElementById('security-modal');
    if (modal) {
        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }
}

function cerrarModalSeguridad() {
    const modal = document.getElementById('security-modal');
    if (modal) {
        modal.classList.add('hidden');
        document.body.style.overflow = '';
    }
}

// Cerrar al presionar la tecla ESC
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') cerrarModalSeguridad();
});


// 2. ALIMENTADOR ANIMADO EN VIVO DE CHAT WHATSAPP
function initLiveWhatsAppFeed() {
    const chatBody = document.querySelector('.wa-full-chat-body');
    const subTitle = document.querySelector('.wa-full-sub');
    if (!chatBody) return;

    // Mensajes a simular en secuencia dinámica
    const secuencias = [
        // Paso 1: Respuesta del Paciente
        {
            sub: 'en línea • Respuesta Paciente',
            delay: 4000,
            action: () => {
                mostrarTyping('Juan Pérez está escribiendo...');
            },
            nextMsg: {
                tipo: 'sent',
                text: 'SI',
                time: '08:02 AM'
            }
        },
        // Paso 2: Respuesta del Bot confirmando dosis
        {
            sub: 'en línea • Registrando toma...',
            delay: 4500,
            action: () => {
                mostrarTyping('MediClock Bot está escribiendo...');
            },
            nextMsg: {
                tipo: 'received',
                badge: '🟢 DOSIS CONFIRMADA',
                doc: 'Notificado a Dr. F. Pérez',
                title: '¡Excelente Juan! 👍',
                desc: 'Has confirmado la dosis de <strong>Aspirina 100mg</strong> de las 08:00 AM. Tu médico tratante ha recibido el registro de adherencia en tiempo real.',
                time: '08:02 AM',
                ticks: '✓✓'
            }
        },
        // Paso 3: Modificación / Cancelación de Remedio por el Médico
        {
            sub: 'Dr. F. Pérez actualizando pauta...',
            delay: 5500,
            action: () => {
                mostrarTyping('Dr. Francisco Pérez está escribiendo...');
            },
            nextMsg: {
                tipo: 'received',
                badge: '⚠️ MODIFICACIÓN DE TRATAMIENTO',
                doc: 'Dr. Francisco Pérez',
                title: 'Aviso de Cambio en Receta #MC-84920',
                desc: 'El <strong>Dr. Francisco Pérez</strong> ha <u>suspendido</u> la dosis de <strong>Losartán 50mg</strong> de las 20:00 PM para hoy. No debes tomar este comprimido.',
                time: '08:15 AM',
                ticks: '✓✓'
            }
        },
        // Paso 4: Alerta Automática de Próxima Toma
        {
            sub: 'en línea • Alerta de Alarma',
            delay: 5000,
            action: () => {
                mostrarTyping('MediClock Bot notificando...');
            },
            nextMsg: {
                tipo: 'received',
                badge: '⏰ RECORDATORIO DE DOSIS',
                doc: 'Indicación Médica',
                title: 'Omeprazol 20mg (Protector Gástrico)',
                desc: 'Tomar 1 cápsula antes del desayuno con abundante agua.',
                time: '08:30 AM',
                ticks: '✓✓',
                replyBtn: '✅ Responder "SI" para confirmar'
            }
        }
    ];

    let currentStep = 0;

    function ejecutarPaso() {
        const paso = secuencias[currentStep];
        if (subTitle) subTitle.textContent = paso.sub;

        setTimeout(() => {
            paso.action();

            setTimeout(() => {
                removerTyping();
                insertarMensaje(paso.nextMsg);
                currentStep = (currentStep + 1) % secuencias.length;
                
                // Si llegamos al final del loop, reiniciar suavemente
                if (currentStep === 0) {
                    setTimeout(reiniciarFeed, 6000);
                } else {
                    ejecutarPaso();
                }
            }, 1800);
        }, paso.delay);
    }

    function mostrarTyping(texto) {
        removerTyping();
        const typingEl = document.createElement('div');
        typingEl.className = 'wa-typing-pill';
        typingEl.id = 'wa-typing-indicator';
        typingEl.innerHTML = `
            <span>${texto}</span>
            <div class="wa-typing-dots">
                <span></span><span></span><span></span>
            </div>
        `;
        chatBody.appendChild(typingEl);
        scrollBottom();
    }

    function removerTyping() {
        const typingEl = document.getElementById('wa-typing-indicator');
        if (typingEl) typingEl.remove();
    }

    function insertarMensaje(msg) {
        const msgWrapper = document.createElement('div');
        msgWrapper.className = `wa-bubble-wrapper ${msg.tipo === 'sent' ? 'wa-sent-wrapper' : ''}`;
        
        if (msg.tipo === 'sent') {
            msgWrapper.innerHTML = `
                <div class="wa-sent-msg">
                    <div class="wa-sent-text">${msg.text}</div>
                    <div class="wa-msg-footer-info">
                        <span class="wa-time-stamp">${msg.time}</span>
                        <span class="wa-blue-ticks">✓✓</span>
                    </div>
                </div>
            `;
        } else {
            let buttonHtml = '';
            if (msg.replyBtn) {
                buttonHtml = `
                    <div class="wa-reply-box">
                        <button class="wa-reply-btn">
                            <span>${msg.replyBtn}</span>
                        </button>
                    </div>
                `;
            }

            msgWrapper.innerHTML = `
                <div class="wa-full-msg wa-msg-anim">
                    <div class="wa-msg-header-bar">
                        <span class="wa-msg-badge-med">${msg.badge}</span>
                        <span class="wa-msg-doc-name">${msg.doc}</span>
                    </div>
                    <div class="wa-msg-greeting">
                        <strong>${msg.title}</strong>
                    </div>
                    <div class="wa-msg-intro">
                        ${msg.desc}
                    </div>
                    <div class="wa-msg-footer-info">
                        <span class="wa-time-stamp">${msg.time}</span>
                        <span class="wa-blue-ticks">${msg.ticks}</span>
                    </div>
                    ${buttonHtml}
                </div>
            `;
        }

        chatBody.appendChild(msgWrapper);
        scrollBottom();
    }

    function scrollBottom() {
        chatBody.scrollTo({
            top: chatBody.scrollHeight,
            behavior: 'smooth'
        });
    }

    function reiniciarFeed() {
        if (subTitle) subTitle.textContent = 'en línea • Despacho Dr. F. Pérez';
        // Mantener el divisor HOY y el primer mensaje
        const msgs = chatBody.querySelectorAll('.wa-bubble-wrapper');
        msgs.forEach((m, idx) => {
            if (idx > 0) m.remove();
        });
        scrollBottom();
        setTimeout(ejecutarPaso, 3000);
    }

    // Iniciar loop tras 3 segundos
    setTimeout(ejecutarPaso, 3000);
}
