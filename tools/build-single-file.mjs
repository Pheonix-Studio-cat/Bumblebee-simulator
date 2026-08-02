/* Bumblebee Simulator - bundle the whole game into one HTML file.
 *
 * The game normally loads a stylesheet and thirteen scripts from disk. That is
 * the right structure to work in, but sometimes you want a single file you can
 * email, drop on a USB stick, or paste into a host that only accepts one
 * document. This inlines everything, in the exact order index.html declares,
 * and changes nothing else.
 *
 * Run:  node tools/build-single-file.mjs [outfile]
 * Default output: dist/bumblebee-simulator.html
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = process.argv[2]
  ? resolve(process.argv[2])
  : join(root, 'dist', 'bumblebee-simulator.html');

const read = (p) => readFileSync(join(root, p), 'utf8');

let html = read('index.html');

/* Inline the stylesheet. */
const cssHref = /<link\s+rel="stylesheet"\s+href="([^"]+)"\s*>/;
const cssMatch = html.match(cssHref);
if (!cssMatch) throw new Error('no stylesheet link found in index.html');
html = html.replace(cssHref, '<style>\n' + read(cssMatch[1]).trim() + '\n</style>');

/* Inline every script, keeping the declared order - that order is the
   dependency graph, so it must survive the bundling exactly. */
const scriptTag = /<script\s+src="([^"]+)"\s*><\/script>/g;
const inlined = [];
html = html.replace(scriptTag, (_, src) => {
  const code = read(src);
  if (code.includes('</script')) {
    throw new Error(src + ' contains a closing script tag and cannot be inlined');
  }
  inlined.push(src);
  return '<script>\n/* ===== ' + src + ' ===== */\n' + code.trim() + '\n</script>';
});

if (!inlined.length) throw new Error('no scripts were inlined - has index.html changed?');
if (/\ssrc="/.test(html)) throw new Error('a external reference survived bundling');

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, html, 'utf8');

const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(0);
console.log('bundled ' + inlined.length + ' scripts + 1 stylesheet -> ' + outPath +
  '  (' + kb + ' kB)');
