// Turns tools/email-builder.html into lib/email-builder.js, which the admin API serves.
// Runs before every build (npm run build). Edit the HTML file, not the generated one.
import { readFileSync, writeFileSync } from 'node:fs';
const html = readFileSync(new URL('./email-builder.html', import.meta.url), 'utf8');
writeFileSync(new URL('../lib/email-builder.js', import.meta.url),
  `// Generated from tools/email-builder.html by tools/build-email-builder.mjs. Do not edit by hand.\nexport default ${JSON.stringify(html)};\n`);
console.log('email builder: lib/email-builder.js written');
