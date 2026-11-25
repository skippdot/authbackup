import qrcode from '/vendor/qrcode.mjs';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const api = async (path, body) => (await fetch(path, body ? { method: 'POST', body: JSON.stringify(body) } : {})).json();

function qrDataUrl(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createDataURL(5, 4);
}

let current = null;
const statuses = {}; // id -> {ok, text}

$('#enroll').onclick = async () => {
  current = await api('/api/enroll', {
    issuer: $('#issuer').value, account: $('#account').value,
    algorithm: $('#algorithm').value, digits: Number($('#digits').value), period: Number($('#period').value),
  });
  $('#enrollQr').src = qrDataUrl(current.uri);
  $('#enrollSecret').textContent = current.secret.replace(/(.{4})/g, '$1 ').trim();
  $('#enrollOut').hidden = false;
  $('#verifyOut').textContent = '';
  $('#code').value = '';
  $('#code').focus();
  refreshCodes();
};

async function verify(id, code) {
  const r = await api('/api/verify', { id, code });
  statuses[id] = r.ok
    ? { ok: true, text: `✓ accepted${r.step_offset ? ` (step ${r.step_offset > 0 ? '+' : ''}${r.step_offset})` : ''}` }
    : { ok: false, text: `✗ ${r.error}` };
  refreshCodes();
  return statuses[id];
}

$('#verify').onclick = async () => {
  const s = await verify(current.id, $('#code').value);
  $('#verifyOut').innerHTML = `<b class="${s.ok ? 'ok' : 'bad'}">${esc(s.ok ? `2FA enabled, code ${s.text.slice(2)}` : s.text)}</b>`;
};
$('#code').onkeydown = (e) => e.key === 'Enter' && $('#verify').click();

$('#migrate').onclick = async () => {
  const r = await api('/api/migration', {});
  $('#migrateQr').src = qrDataUrl(r.uri);
  $('#migrateOut').hidden = false;
  refreshCodes();
};

$('#downloadPng').onclick = () => {
  const img = $('#migrateQr');
  const c = Object.assign(document.createElement('canvas'), { width: img.naturalWidth * 2, height: img.naturalHeight * 2 });
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, c.width, c.height);
  Object.assign(document.createElement('a'), { href: c.toDataURL('image/png'), download: 'google-auth-export-bench.png' }).click();
};

async function refreshCodes() {
  const { items } = await api('/api/codes');
  $('#noCodes').hidden = items.length > 0;
  const tbody = $('#codes tbody');
  // Do not redraw rows whose input has focus, or typing would be disrupted.
  const focused = document.activeElement?.closest?.('tr')?.dataset.id;
  for (const it of items) {
    let tr = tbody.querySelector(`tr[data-id="${it.id}"]`);
    if (!tr) {
      tr = document.createElement('tr');
      tr.dataset.id = it.id;
      tr.innerHTML = `<td><b>${esc(it.issuer)}</b><div class="muted">${esc(it.account)}</div></td>
        <td class="code"></td><td class="left"></td>
        <td><input placeholder="code" inputmode="numeric"></td><td class="st"></td>`;
      tr.querySelector('input').onkeydown = (e) => {
        if (e.key === 'Enter') verify(it.id, e.target.value);
      };
      tbody.append(tr);
    }
    tr.querySelector('.code').textContent = it.code;
    tr.querySelector('.left').textContent = `${it.left} s`;
    const s = statuses[it.id];
    if (it.id !== focused || s) {
      tr.querySelector('.st').innerHTML = s ? `<span class="${s.ok ? 'ok' : 'bad'}">${esc(s.text)}</span>` : '<span class="muted">—</span>';
    }
  }
}

async function selftest() {
  const rows = await api('/api/selftest');
  const bad = rows.filter((r) => !r.ok);
  $('#selftest').innerHTML = bad.length
    ? `<b class="bad">Reference FAILED ${bad.length} vectors</b>`
    : `<span class="ok">✓ ${rows.length}/${rows.length} RFC 6238 vectors (SHA1/256/512, 8 digits): server reference is correct</span>`;
}

refreshCodes();
selftest();
setInterval(refreshCodes, 1000);
