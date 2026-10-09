import fs from 'node:fs'; import path from 'node:path';
const root = process.cwd();
const exts = ['.ts', '.tsx', '.css', '.js', '.mjs', '.json'];
const resolve = (from, spec) => {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(from), spec);
  const cands = [base, ...exts.map((e) => base + e), ...exts.map((e) => path.join(base, 'index' + e)), base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.tsx')];
  return cands.find((c) => fs.existsSync(c) && fs.statSync(c).isFile()) ?? null;
};
const importRe = /(?:import|export)\s+(?:[^'"]*?from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url/g;
const cssRe = /@import\s+(?:url\()?['"]([^'"]+)['"]/g;
const seen = new Set();
const visit = (file) => {
  if (seen.has(file)) return; seen.add(file);
  if (!/\.(ts|tsx|css|html|mjs|js)$/.test(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  const re = file.endsWith('.css') ? cssRe : importRe;
  for (const m of text.matchAll(re)) { const spec = m[1] ?? m[2] ?? m[3]; const r = spec && resolve(file, spec); if (r) visit(r); }
  if (file.endsWith('.html')) for (const m of text.matchAll(/(?:src|href)=["']\/?([^"']+\.(?:tsx?|css))["']/g)) { const r = resolve(file, './' + m[1]); if (r) visit(r); }
};
for (const entry of ['index.html', 'v5.html', 'worker/indexOrganizer.ts']) visit(path.join(root, entry));
const all = [];
const walk = (d) => { for (const n of fs.readdirSync(d)) { const p = path.join(d, n); if (n === 'node_modules' || n.startsWith('.')) continue; const s = fs.statSync(p); if (s.isDirectory()) walk(p); else if (/\.(ts|tsx|css)$/.test(n)) all.push(p); } };
walk(path.join(root, 'src')); walk(path.join(root, 'worker'));
const lines = (f) => fs.readFileSync(f, 'utf8').split('\n').length;
const dead = all.filter((f) => !seen.has(f) && !/\.test\.tsx?$/.test(f));
const by = {};
for (const f of dead) { const k = path.relative(root, f).split('/').slice(0, 2).join('/'); by[k] = (by[k] ?? 0) + lines(f); }
const total = all.reduce((s, f) => s + lines(f), 0), deadTotal = dead.reduce((s, f) => s + lines(f), 0);
console.log(`Dateien src+worker: ${all.length}, Zeilen: ${total}`);
console.log(`Von index.html / v5.html / indexOrganizer.ts NICHT erreichbar: ${dead.length} Dateien, ${deadTotal} Zeilen`);
for (const [k, v] of Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(String(v).padStart(6), k);
fs.writeFileSync(process.argv[2] ?? '/dev/null', dead.map((f) => path.relative(root, f)).join('\n'));
