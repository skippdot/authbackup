// Release archive for the Chrome Web Store: dist/authbackup-<version>.zip plus dist/SHA256SUMS.
// Checks run first (scripts/release-check.mjs); the archive is not built if any problem is found.
//   node scripts/build.mjs
//
// The archive is reproducible: the same commit gives a byte-identical zip on any machine, so anyone can rebuild a
// release and compare its sha256 with the published one. What would otherwise differ between machines is
// normalized: file order (sorted), timestamps (SOURCE_DATE_EPOCH, else the commit time, stored as UTC), permissions
// (0644), and extra fields (-X: no uid/gid or extended timestamps). Directory entries are omitted (-D).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
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

const epoch = Number(process.env.SOURCE_DATE_EPOCH
  || execFileSync('git', ['log', '-1', '--format=%ct'], { cwd: ROOT, encoding: 'utf8' }).trim());
if (!Number.isInteger(epoch) || epoch < 315532800) throw new Error(`bad timestamp for the archive: ${epoch}`); // zip dates start in 1980

/** Files under the extension folder, as zip paths ("/" separators), in a fixed order. */
const files = readdirSync(EXT, { recursive: true, withFileTypes: true })
  .filter((d) => d.isFile() && d.name !== '.DS_Store')
  .map((d) => relative(EXT, join(d.parentPath, d.name)).split(sep).join('/'))
  .sort();

// Stage a normalized copy, so the working tree's own timestamps and permissions never reach the archive.
const stage = mkdtempSync(join(tmpdir(), 'authbackup-build-'));
try {
  for (const f of files) {
    const to = join(stage, f);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(join(EXT, f), to);
    chmodSync(to, 0o644);
    utimesSync(to, epoch, epoch);
  }
  mkdirSync(join(ROOT, 'dist'), { recursive: true });
  const name = `authbackup-${version}.zip`;
  const zip = join(ROOT, 'dist', name);
  rmSync(zip, { force: true }); // our own artifact from a previous build of this version
  // -@: names from stdin, in our order; manifest.json ends up at the archive root, as the store requires.
  // TZ=UTC: zip stores local time, so the time zone must not depend on the machine.
  execFileSync('zip', ['-X', '-D', '-q', zip, '-@'], { cwd: stage, input: files.join('\n'), env: { ...process.env, TZ: 'UTC' } });

  const sha = createHash('sha256').update(readFileSync(zip)).digest('hex');
  writeFileSync(join(ROOT, 'dist', 'SHA256SUMS'), `${sha}  ${name}\n`);
  const at = new Date(epoch * 1000).toISOString();
  console.log(`${zip}\n  ${files.length} files, ${(statSync(zip).size / 1024).toFixed(1)} KB, timestamps ${at}\n  sha256 ${sha}`);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
