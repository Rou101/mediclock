const fs = require('fs');
let html = fs.readFileSync('public/index.html', 'utf8');

const navStart = html.indexOf('<nav class="bottom-nav">');
const navEnd = html.indexOf('</nav>', navStart) + 6;

const correctNav = `<nav class="bottom-nav">
        <button class="nav-btn active" data-tab="hoy">
            <span class="nav-icon">⏰</span>
            <span class="nav-label">Hoy</span>
        </button>
        <button class="nav-btn" data-tab="calendario">
            <span class="nav-icon">📅</span>
            <span class="nav-label">Semana</span>
        </button>
        <button class="nav-btn" data-tab="historial">
            <span class="nav-icon">🕒</span>
            <span class="nav-label">Historial</span>
        </button>
        <button class="nav-btn" data-tab="remedios">
            <span class="nav-icon">💊</span>
            <span class="nav-label">Remedios</span>
        </button>
        <button class="nav-btn" data-tab="pacientes">
            <span class="nav-icon">👤</span>
            <span class="nav-label">Pacientes</span>
        </button>
        <button class="nav-btn" data-tab="config">
            <span class="nav-icon">⚙️</span>
            <span class="nav-label">Config</span>
        </button>
    </nav>`;

html = html.slice(0, navStart) + correctNav + html.slice(navEnd);
html = html.replace('?v=12', '?v=13');

fs.writeFileSync('public/index.html', html, 'utf8');
console.log('Fixed!');
