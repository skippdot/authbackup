// Release notes for a GitHub release: the version's CHANGELOG.md section, then install and verify steps.
// Used by .github/workflows/release.yml:
//   node scripts/release-notes.mjs 0.3.1 > notes.md
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO = 'skippdot/authbackup';

/** The body of the "## <date>: <version> ..." section of the changelog. */
export function changelogSection(version, changelog) {
  const heading = new RegExp(`^## [^\\n]*: ${version.replace(/\./g, '\\.')}(?=[\\s,]|$)[^\\n]*\\n`, 'm');
  const m = heading.exec(changelog);
  if (!m) throw new Error(`CHANGELOG.md has no "## <date>: ${version} ..." section`);
  const rest = changelog.slice(m.index + m[0].length);
  const next = rest.search(/^## /m);
  return (next < 0 ? rest : rest.slice(0, next)).trim();
}

export function releaseNotes(version, changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')) {
  const zip = `authbackup-${version}.zip`;
  return `${changelogSection(version, changelog)}

**Install** (the Chrome Web Store listing is coming soon):
1. Download \`${zip}\` below and unzip it into a folder you will keep.
2. Open \`chrome://extensions\` and turn on Developer mode.
3. Click "Load unpacked" and pick the unzipped folder.

**Verify the download.** This release was built by GitHub Actions from the tag \`v${version}\`.
- Checksum: \`shasum -a 256 -c SHA256SUMS\`
- Signed build provenance (Sigstore): \`gh attestation verify ${zip} --repo ${REPO}\`
- Rebuild it yourself: \`git checkout v${version} && npm ci --ignore-scripts && npm run build\` gives a byte-identical
  zip (same sha256) on any machine.

See the [README](https://github.com/${REPO}#readme), [privacy policy](https://authbackup.com/privacy)
and [security policy](https://github.com/${REPO}/blob/main/SECURITY.md).
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('usage: node scripts/release-notes.mjs <version>');
  process.stdout.write(releaseNotes(process.argv[2]));
}
