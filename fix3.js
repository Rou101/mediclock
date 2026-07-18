const fs = require('fs');
let lines = fs.readFileSync('public/app.js', 'utf8').split('\n');

// Fix estadoLabel
lines[394] = `    const m = { tomada: '✅ Tomada', pendiente: '⏳ Pendiente', olvidada: '❌ Olvidada' };`;

// Fix historial stats (search for the lines to be safe)
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('tomadas</span>')) {
        lines[i] = `        <span class="stat-pill">✅ \${tomadas} tomadas</span>`;
    }
    if (lines[i].includes('olvidadas</span>')) {
        lines[i] = `        <span class="stat-pill miss">❌ \${olvidadas} olvidadas</span>`;
    }
}

fs.writeFileSync('public/app.js', lines.join('\n'), 'utf8');
console.log('Fixed lines via Node');
