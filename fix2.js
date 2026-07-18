const fs = require('fs');
let js = fs.readFileSync('public/app.js', 'utf8');

js = js.replace(/x\x18▾/g, '👤 ');
js = js.replace(/<div class="med-dose">\$\{m\.dosis\}<\/div>/g, '<div class="med-dose">${m.dosis || \'\'}</div>');
js = js.replace(/<div class="cal-med-dose">\$\{m\.dosis\}<\/div>/g, '<div class="cal-med-dose">${m.dosis || \'\'}</div>');

fs.writeFileSync('public/app.js', js, 'utf8');
console.log('Fixed');
