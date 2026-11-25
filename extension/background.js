// Service worker: tab scan (so it does not depend on the popup's lifetime) and registry auto-lock.
import { scanTab } from './lib/scan.js';
import { markKnown, lock } from './lib/store.js';

async function scanAndMark(args) {
  const res = await scanTab(args);
  res.accounts = await markKnown(res.accounts);
  return res;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'scan') return false;
  scanAndMark(msg)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((e) => sendResponse({ ok: false, error: e.message }));
  return true; // the response is asynchronous
});

// The alarm is set by store.touch(); every registry access pushes it forward.
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== 'autolock') return;
  const { unlockUntil } = await chrome.storage.session.get('unlockUntil');
  if (!unlockUntil || Date.now() >= unlockUntil - 1000) await lock(); // the deadline may have been extended while the alarm was in flight
});
