# Security policy

## Supported versions

Only the latest release of AuthBackup (the version published in the Chrome Web Store and the current `main` branch)
receives security fixes.

## Reporting a vulnerability

Please report vulnerabilities privately. Do not open a public issue.

1. Go to the [Security tab](https://github.com/skippdot/authbackup/security) of this repository.
2. Click **Report a vulnerability** (GitHub private vulnerability reporting).
3. Describe the problem, the affected version, and steps to reproduce.

## Scope

In scope:

- The browser extension (`extension/`): key storage and encryption (password lock, encrypted backups), TOTP and
  Google Authenticator export handling, QR scanning, the content Security Policy, permissions, anything that could leak
  or corrupt secrets, or make a network request.
- The website [authbackup.com](https://authbackup.com) (`site/`) and the build and CI configuration in this repository
  (for example, a way to inject code into a release).

Out of scope:

- Attacks that need an already compromised device or browser profile (malware, a malicious extension with broader
  permissions, physical access to an unlocked browser).
- Weak user-chosen passwords, or secrets that a user exported in plain text on purpose.
- Findings about the local test bench (`bench/`), which is a development tool bound to localhost.

## What to expect

- Acknowledgement within 7 days.
- A first assessment within 14 days, then updates until the issue is fixed or closed.
- A fix released as soon as it is ready, with credit in the changelog if you want it.

This is a free, volunteer-run project, so these are targets, not guarantees.
