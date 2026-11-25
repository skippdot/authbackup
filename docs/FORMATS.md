# Interfaces and file formats

What AuthBackup accepts and what it produces. AuthBackup has no API and no command-line interface: its external
interface is the browser UI, the links and QR codes it reads, and the files it writes. The code named in each section
is the source of truth, and `tests/unit/` pins the behavior described here.

## Entry points

| Entry point | How to open it | What it does |
| --- | --- | --- |
| Popup | Toolbar icon, or `Alt+Shift+O` (change it at `chrome://extensions/shortcuts`) | Lists codes; a click copies a code. Scans the visible tab for a QR code. Accepts a pasted image or link. Shows the 2+1 copy status. |
| Manage page | "Keys…" in the popup | Import (images, links, manual entry), the registry, export, restore, password and auto-lock. |

Permissions: `storage`, `activeTab`, `scripting`, `clipboardWrite`, `alarms`. No host permissions. Extension pages
run under this CSP, so they cannot make network requests or run code that is not part of the extension:

```
default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'none';
object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
```

## Inputs

All input is untrusted. A link or backup that does not parse is rejected with an error message, and nothing from it is
saved.

A key is a duplicate of a saved one when the type, secret, issuer and account all match (issuer and account ignoring
case). Duplicates are reported and not added twice; a renamed key, or the same secret under another name, is added as
a new key.

### `otpauth://` links

The [Key URI Format](https://github.com/google/google-authenticator/wiki/Key-Uri-Format), parsed by
`extension/lib/otpauth.js`:

```
otpauth://TYPE/LABEL?secret=SECRET&issuer=ISSUER&algorithm=SHA1&digits=6&period=30
```

| Part | Accepted values | Default |
| --- | --- | --- |
| `TYPE` | `totp` or `hotp` (case-insensitive) | required |
| `LABEL` | `Issuer:account` or `account`, URL-encoded (`%3A` for the colon is accepted) | empty (no name) |
| `secret` | Base32 ([RFC 4648](https://www.rfc-editor.org/rfc/rfc4648)), case-insensitive; spaces, `-` and `=` padding are ignored; at least 2 characters | required |
| `issuer` | Any text; when present it wins over the issuer prefix of the label | the label prefix |
| `algorithm` | `SHA1`, `SHA256`, `SHA512` (`SHA-256` style is accepted too) | `SHA1` |
| `digits` | `6`, `7`, `8` | `6` |
| `period` | Positive integer, seconds; checked on HOTP links too, used only by TOTP | `30` |
| `counter` | Non-negative integer up to 2^53 - 1 (HOTP only) | `0` |

Other parameters are ignored. Leading and trailing spaces in the issuer and account are trimmed.

### `otpauth-migration://` (Google Authenticator export)

`otpauth-migration://offline?data=BASE64`, where `data` is a protobuf `MigrationPayload`. Decoded by a hand-written
parser in `extension/lib/migration.js` (the schema is at the top of that file).

- `data` is standard or URL-safe Base64, percent-encoded as in Google's own exports. A raw `+` is read as a space, so
  such a payload is rejected.
- Algorithms: SHA1, SHA256, SHA512. Entries with MD5 are skipped with a reason.
- Digits: 6 or 8. Period: always 30 seconds (the format does not store it).
- Entries with an empty secret, or an HOTP counter above 2^53 - 1, are skipped with a reason; the other entries of
  the same QR are still imported.
- Truncated or damaged data is rejected as a whole.
- Each QR of a multi-QR export (`batch_size` > 1) is imported on its own; keys already in the registry are reported as
  duplicates, not added twice.
- A key imported from this format counts as an `app` copy for the 2+1 rule.

### QR images

QR codes are read with jsQR from:

- the visible part of the current tab, when the popup opens or "Scan page" is clicked (`activeTab`);
- an image pasted with Cmd/Ctrl+V in the popup or on the Manage page;
- image files (`image/*`) dropped on or picked on the Manage page, several at once; other files are ignored.

The decoded text then goes through the `otpauth://` or `otpauth-migration://` parser.

### Manual entry

Manage page form: issuer, account, Base32 secret, algorithm (SHA1/SHA256/SHA512), digits (6/7/8), period. Manual
entry adds TOTP keys only.

### Restore from a file

The "Restore from file" button accepts:

- an encrypted backup (`*.encrypted.json`, see below); the file's password is asked for;
- a plain JSON backup (`version: 1`, see below) or a JSON array of account objects;
- a text file with `otpauth://` or `otpauth-migration://` links separated by line breaks or spaces (for example, an
  export from Aegis, 2FAS or Bitwarden).

A JSON backup is restored at once. Every entry is rebuilt as an `otpauth://` link and parsed again, so it is validated
like any other link. Only `secret` is required: a missing `type`, `algorithm`, `digits` or `period` becomes `totp`,
`SHA1`, `6` or `30`, and a missing `issuer` or `account` stays empty. One invalid entry rejects the whole file. Only the OTP fields are kept, and ids are assigned anew.
Every key of the file, new or duplicate, counts as a `file` copy for the 2+1 rule.

A text file is not restored directly: its links open the import preview, like pasted links, and are saved with "Add
selected". They do not count as a `file` copy.

## Outputs

### Account object

The OTP fields of one key, as used in the files below:

```json
{
  "type": "totp",
  "issuer": "Example",
  "account": "alice@example.com",
  "secret": "JBSWY3DPEHPK3PXP",
  "algorithm": "SHA1",
  "digits": 6,
  "period": 30,
  "counter": 0
}
```

`secret` is upper-case Base32 without padding. `counter` matters only for `hotp`, `period` only for `totp`. Both
backup files also carry bookkeeping fields (`id`, `source`, `addedAt`); restore ignores them.

### Plain JSON backup

`authbackup-<date>.json`. **Contains the secrets in plain text.**

```json
{ "app": "authbackup", "version": 1, "exportedAt": "2026-11-25T12:00:00.000Z", "accounts": [ /* account objects */ ] }
```

### Encrypted backup

`authbackup-<date>.encrypted.json`. The `encrypted` object is produced by `extension/lib/vault.js`. Without the password
only the outer fields (`app`, `version`, `exportedAt`, `count`) and the KDF parameters are readable.

```json
{
  "app": "authbackup",
  "version": 2,
  "exportedAt": "2026-11-25T12:00:00.000Z",
  "count": 3,
  "encrypted": {
    "v": 1,
    "kdf": { "name": "PBKDF2-SHA256", "iterations": 600000, "salt": "<base64, 16 bytes>" },
    "iv": "<base64, 12 bytes>",
    "ct": "<base64>"
  }
}
```

To decrypt without AuthBackup:

1. Derive a 256-bit key with PBKDF2-HMAC-SHA256 from the UTF-8 password, `salt` and `iterations`.
2. Decrypt `ct` with AES-256-GCM, using that key and `iv`. The last 16 bytes of `ct` are the GCM tag (the Web Crypto
   layout). A wrong password or a changed file fails the tag check.
3. The plaintext is UTF-8 JSON: `{ "accounts": [ /* account objects, with the bookkeeping fields */ ] }`.

The registry vault in `chrome.storage.local` (when a password is set) uses the same `{ v, kdf, iv, ct }` object.

### `otpauth.txt`

`authbackup-otpauth-<date>.txt`: one `otpauth://` link per line, in the format above, for import into other
authenticators. **Contains the secrets in plain text.** For TOTP the link has `secret`, `issuer` (when set), `algorithm`,
`digits` and `period`; for HOTP it has `counter` instead of `period`.

### Google Authenticator export QR

`otpauth-migration://offline?data=...` QR codes, shown on screen and downloadable as PNG.

- Up to 10 keys per QR, and at most 1200 characters per link so that phones can read it (a single key with a longer
  link still gets a QR of its own). Every QR carries `batch_size`, `batch_index` and a random `batch_id`, even when
  there is only one.
- Keys that the format cannot carry without loss are listed and left out: a TOTP period other than 30 seconds, or 7
  digits.
- SHA256 and SHA512 keys are included with a warning: some versions of Google Authenticator compute them as SHA1, so
  the code should be checked after the transfer.
- "Done" in the QR dialog marks the exported keys as an `app` copy for the 2+1 rule.

### Storage

`chrome.storage.local` of the browser profile (never synced):

- `accounts`: the account list in plain text, when no password is set;
- `vault`: the encrypted account list, when a password is set (then `accounts` is absent);
- `settings`: the auto-lock time, the 2+1 copy marks per key id (ids are random and not secret) and the date of the
  last backup file (`lastFileAt`).

After unlock, the raw AES key (`vaultKey`, Base64) and the auto-lock deadline (`unlockUntil`) are kept in
`chrome.storage.session` (memory only) until auto-lock or until Chrome closes. Auto-lock choices: 5, 15 (the default),
60 or 240 minutes, or when the browser closes.
