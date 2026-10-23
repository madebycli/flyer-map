// Writes dist-rs/sw.js from the template of the web crate: the list of the files of the build and a hash over their names and bytes (the name of the cache, so a
// new build never reads the old build's files). Called by scripts/rs-web-build.sh after everything else is in dist-rs.
//   node scripts/rs-web-sw.mjs <dist-dir> <template>
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const [dir, template] = process.argv.slice(2);
const files = [];
(function walk(d) {
  for (const name of readdirSync(d).sort()) {
    const path = join(d, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (name !== 'sw.js') files.push(relative(dir, path).split('\\').join('/'));
  }
})(dir);
const hash = createHash('sha256');
for (const f of files) hash.update(f).update(readFileSync(join(dir, f)));
const build = hash.digest('hex').slice(0, 12);
const text = readFileSync(template, 'utf8').replace('__BUILD__', build).replace('__FILES__', JSON.stringify(files));
writeFileSync(join(dir, 'sw.js'), text);
console.log(`sw.js: build ${build}, ${files.length} files`);
