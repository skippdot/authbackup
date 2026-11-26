// The bench prints its banner only once it listens. tests/e2e.mjs starts the run when it sees the banner, so a banner
// printed before a failed bind sent the whole e2e run to whatever other server held the port.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const SERVER = fileURLToPath(new URL('../../bench/server.py', import.meta.url));

/** Starts the bench on `port`; resolves when it prints the banner or when it exits, whichever comes first. */
function startBench(port) {
  const proc = spawn('python3', [SERVER], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
  });
  let stdout = '';
  let stderr = '';
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`bench neither printed the banner nor exited within 10 s: ${stderr}`));
    }, 10000);
    const done = (code) => {
      clearTimeout(timer);
      resolve({ proc, stdout, stderr, code, banner: stdout.includes('TOTP bench') });
    };
    proc.stdout.on('data', (d) => {
      stdout += d;
      if (stdout.includes('TOTP bench')) done(null);
    });
    proc.stderr.on('data', (d) => (stderr += d));
    proc.on('close', (code) => done(code));
  });
}

test('bench: exits with an error and no banner when the port is taken', async () => {
  const blocker = createServer();
  await new Promise((res) => blocker.listen(0, '127.0.0.1', res));
  const { port } = blocker.address();
  try {
    const r = await startBench(port);
    assert.equal(r.banner, false, `printed the banner although ${port} is taken: ${r.stdout}`);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, new RegExp(`127\\.0\\.0\\.1:${port}`));
  } finally {
    blocker.close();
  }
});

test('bench: the banner names the port it listens on, and the server answers', async () => {
  const r = await startBench(0); // 0: the OS picks a free port, so the banner is the only way to learn it
  try {
    assert.equal(r.banner, true, `no banner: ${r.stderr}`);
    const port = Number(/:(\d+)\s/.exec(r.stdout)?.[1]);
    assert.ok(port > 0, `no port in the banner: ${r.stdout}`);
    assert.equal(await (await fetch(`http://127.0.0.1:${port}/healthz`)).text(), 'ok');
  } finally {
    r.proc.kill();
  }
});
