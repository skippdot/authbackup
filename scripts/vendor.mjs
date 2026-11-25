// Turns the UMD builds of jsQR and qrcode-generator into ES modules for extension/vendor.
// MV3 forbids remote code, so the libraries ship inside the extension.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const out = new URL('../extension/vendor/', import.meta.url);
mkdirSync(out, { recursive: true });

const jsqr = readFileSync(new URL('../node_modules/jsqr/dist/jsQR.js', import.meta.url), 'utf8');
writeFileSync(new URL('jsqr.mjs', out),
  `// jsQR 1.4.0 (Apache-2.0) https://github.com/cozmo/jsQR — ESM wrapper\n` +
  `const module = { exports: {} }; const exports = module.exports;\n${jsqr}\n` +
  `export default module.exports;\n`);

const qr = readFileSync(new URL('../node_modules/qrcode-generator/qrcode.js', import.meta.url), 'utf8');
writeFileSync(new URL('qrcode.mjs', out),
  `// qrcode-generator 1.4.4 (MIT) https://github.com/kazuhikoarase/qrcode-generator — ESM wrapper\n` +
  `${qr.replace(/\(function \(factory\) \{[\s\S]*$/, '')}\nexport default qrcode;\n`);

const MIT = (who) => `Copyright (c) ${who}

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

// License texts ship with the libraries (Apache-2.0 requires including the license when distributing).
const qrHeader = qr.match(/^\/\/-+\n[\s\S]*?\/\/-+\n/)[0];
writeFileSync(new URL('THIRD_PARTY_LICENSES.txt', out),
  `AuthBackup bundles two third-party libraries.\n\n` +
  `=== jsQR 1.4.0 — https://github.com/cozmo/jsQR — Apache License 2.0 ===\n\n` +
  `${readFileSync(new URL('../node_modules/jsqr/LICENSE', import.meta.url), 'utf8').trim()}\n\n` +
  `=== qrcode-generator 1.4.4 — https://github.com/kazuhikoarase/qrcode-generator — MIT License ===\n\n` +
  `${qrHeader.replace(/^\/\/ ?/gm, '').trim()}\n\n${MIT('2009 Kazuhiko Arase')}\n`);

console.log('vendor ok');
