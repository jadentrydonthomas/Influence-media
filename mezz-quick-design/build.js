// Assemble the single self-contained tool: mezz-quick-design/index.html
// usage: node build.js   (needs pdfjs-dist@3.11.174: `npm install` here, or PDFJS_DIST=/path/to/pdfjs-dist)
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'src');
const PDFJS = process.env.PDFJS_DIST || path.join(__dirname, 'node_modules', 'pdfjs-dist');
const resolve = name => (/^pdf(\.worker)?\.min\.js$/.test(name) ? path.join(PDFJS, 'build', name) : path.join(SRC, name));

// Keep inlined code from closing the <script> element or opening an HTML comment.
const safe = js => js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

let html = fs.readFileSync(path.join(SRC, 'app.html'), 'utf8');
html = html.replace(/\/\*@INLINE_CSS ([\w.-]+)\*\//g, (_, n) => fs.readFileSync(resolve(n), 'utf8'));
html = html.replace(/<script>\/\*@INLINE_JS ([\w.-]+)\*\/<\/script>/g, (_, n) => {
  const code = fs.readFileSync(resolve(n), 'utf8');
  return `<script>\n/* ---- ${n} ---- */\n${safe(code)}\n</script>`;
});
const pkg = JSON.parse(fs.readFileSync(path.join(PDFJS, 'package.json'), 'utf8'));
if (pkg.version !== '3.11.174') console.warn(`warning: expected pdfjs-dist 3.11.174, found ${pkg.version}`);
const stamp = new Date().toISOString().slice(0, 10);
html = html.replace('</title>', `</title>\n<meta name="generator" content="mezz-quick-design build ${stamp}; pdf.js ${pkg.version}">`);
const out = path.join(__dirname, 'index.html');
fs.writeFileSync(out, html);
console.log(`wrote ${path.relative(process.cwd(), out)} (${(html.length / 1024).toFixed(0)} KB)`);
