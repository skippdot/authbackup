// Cross-check: the extension's JS implementation against the independent Python implementation in the bench (bench/otp_ref.py).
// 1) N random keys x algorithm x digits x period x timestamp: the codes must match.
// 2) A Google Authenticator export built by the Python encoder must be parsed by the JS decoder.
import { execFileSync } from 'node:child_process';
import { randomBytes, randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { base32Encode } from '../extension/lib/base32.js';
import { totp } from '../extension/lib/totp.js';
import { parseMigrationUri } from '../extension/lib/migration.js';

const N = Number(process.argv[2] || 2000);
const benchDir = fileURLToPath(new URL('../bench/', import.meta.url));
// node:crypto rather than Math.random: these values reach the HMAC, and CodeQL flags insecure randomness there.
const pick = (arr) => arr[randomInt(arr.length)];

const cases = [];
for (let i = 0; i < N; i++) {
  cases.push({
    secret: base32Encode(randomBytes(pick([10, 16, 20, 32, 64]))),
    algorithm: pick(['SHA1', 'SHA256', 'SHA512']),
    digits: pick([6, 7, 8]),
    period: pick([15, 30, 60]),
    at: randomInt(4e9), // up to year 2096, including > 2^31
  });
}
for (const c of cases) c.js = await totp(c, c.at * 1000);

const py = `
import json, sys
sys.path.insert(0, ${JSON.stringify(benchDir)})
from otp_ref import totp
cases = json.load(sys.stdin)
print(json.dumps([totp(c["secret"], at=c["at"], digits=c["digits"], algorithm=c["algorithm"], period=c["period"]) for c in cases]))
`;
const pyCodes = JSON.parse(execFileSync('python3', ['-I', '-c', py], { input: JSON.stringify(cases) }));
const mismatches = cases.filter((c, i) => c.js !== pyCodes[i]).map((c, i) => ({ ...c, py: pyCodes[i] }));

const accounts = cases.slice(0, 3).map((c, i) => ({
  issuer: `Issuer${i}`, account: `user${i}@example.com`, secret: c.secret, algorithm: c.algorithm, digits: c.digits === 7 ? 6 : c.digits,
}));
const migPy = `
import json, sys
sys.path.insert(0, ${JSON.stringify(benchDir)})
from otp_ref import migration_uri
print(migration_uri(json.load(sys.stdin)))
`;
const migUri = execFileSync('python3', ['-I', '-c', migPy], { input: JSON.stringify(accounts) }).toString().trim();
const decoded = parseMigrationUri(migUri).accounts;
const migOk = decoded.length === 3 && decoded.every((d, i) =>
  d.secret === accounts[i].secret && d.issuer === accounts[i].issuer && d.account === accounts[i].account &&
  d.algorithm === accounts[i].algorithm && d.digits === accounts[i].digits);

console.log(`TOTP: ${N - mismatches.length}/${N} matched Python`);
console.log(`GA export (Python -> JS): ${migOk ? 'OK' : 'MISMATCH'}`);
if (mismatches.length) console.log(mismatches.slice(0, 5));
if (!migOk) console.log({ accounts, decoded });
process.exit(mismatches.length || !migOk ? 1 : 0);
