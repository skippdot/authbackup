// Release archive for the Chrome Web Store: dist/authbackup-<version>.zip.
// Checks run first (scripts/release-check.mjs); the archive is not built if any problem is found.
//   node scripts/build.mjs
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRelease, EXT } from './release-check.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const problems = checkRelease();
if (problems.length) {
  console.error(`Build aborted:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}

const { version } = JSON.parse(readFileSync(join(EXT, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
if (pkg.version !== version) {
  console.error(`Version mismatch: manifest ${version}, package.json ${pkg.version}`);
  process.exit(1);
}

mkdirSync(join(ROOT, 'dist'), { recursive: true });
const zip = join(ROOT, 'dist', `authbackup-${version}.zip`);
rmSync(zip, { force: true }); // our own artifact from a previous build of this version
// -X: no extra macOS attributes; manifest.json ends up at the archive root, as the store requires
execFileSync('zip', ['-r', '-X', '-q', zip, '.', '-x', '*.DS_Store'], { cwd: EXT });

const sha = createHash('sha256').update(readFileSync(zip)).digest('hex');
const files = execFileSync('zipinfo', ['-1', zip], { encoding: 'utf8' }).trim().split('\n');
console.log(`${zip}\n  ${files.length} files, ${(statSync(zip).size / 1024).toFixed(1)} KB, sha256 ${sha}`);
