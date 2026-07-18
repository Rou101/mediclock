const fs = require('fs');
let js = fs.readFileSync('public/app.js', 'utf8');

const replacements = [
    [/x ▾\$\{g\.nombre\}/g, '👥 ${g.nombre}'],
    [/<span style="color:var\(--c-green\)">⭐ <\/span>/g, '<span style="color:var(--c-green)">✅ </span>'],
    [/creada ⭐/g, 'creada ✅'],
    [/⭐  Sincronizado/g, '✅ Sincronizado'],
    [/x ▾\$\{familiar\}/g, '👤 ${familiar}'],
    [/'⭐  Tomada'/g, "'✅ Tomada'"],
    [/'⭐  Olvidada'/g, "'❌ Olvidada'"],
    [/⭐  \$\{tomadas\}/g, '✅ ${tomadas}'],
    [/⭐  \$\{olvidadas\}/g, '❌ ${olvidadas}'],
    [/▶️▾Audio confirmado/g, '▶️ Audio confirmado'],
    [/⭐"/g, '🗑️'],
    [/⭐  Configuración guardada/g, '✅ Configuración guardada'],
    [/x ▾Guardar/g, '💾 Guardar'],
    [/⭐  Guardado/g, '✅ Guardado'],
    [/⭐  Creado/g, '✅ Creado'],
    [/tomarómedicamentos/g, 'tomarán medicamentos'],
    [/=▾'\ \+\ p\.telefono/g, "📞 ' + p.telefono"],
    [/<▾\$\{p\.condicion\}/g, '⚕️ ${p.condicion}'],
    [/CondicióMdica/g, 'Condición Médica'],
    [/⭐eguro/g, '¿Seguro'],
    [/Sin telfono/g, 'Sin teléfono'],
    [/\$\{dias\[0\]\.getDate\(\)\}\s+\$\{dias\[6\]\.getDate\(\)\}/g, '${dias[0].getDate()} - ${dias[6].getDate()}'],
    [/<div class="empty-icon">dY` <\/div>/g, '<div class="empty-icon">👤</div>'],
    [/-\?eguro/g, '¿Seguro'],
    [/=-_'\ \+\ p\.telefono/g, "📞 ' + p.telefono"],
    [/<-_\$\{p\.condicion\}/g, '⚕️ ${p.condicion}'],
];

for (let [pattern, replacement] of replacements) {
    js = js.replace(pattern, replacement);
}

// Ensure cargarPacientes() is called in sincronizarDatos
if (!js.includes('await cargarPacientes();')) {
    js = js.replace('await cargarMiembros();', 'await cargarMiembros();\n        await cargarPacientes();');
}

fs.writeFileSync('public/app.js', js, 'utf8');
console.log('Fixed app.js');
