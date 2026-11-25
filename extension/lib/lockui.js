// Registry unlock form, shared by the popup and the manage page.
import { unlock } from './store.js';
import { t } from './i18n.js';

export function wireUnlockForm(form) {
  const input = form.querySelector('input[type=password]');
  const err = form.querySelector('.err');
  const btn = form.querySelector('button[type=submit]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    btn.disabled = true;
    err.textContent = t('checking'); // PBKDF2 with 600,000 iterations takes a noticeable fraction of a second
    try {
      await unlock(input.value);
      input.value = '';
      err.textContent = ''; // after that the UI is redrawn by the onStoreChange subscription
    } catch (x) {
      err.textContent = x.name === 'WrongPasswordError' ? t('wrongPassword') : x.message;
      input.select();
    } finally {
      btn.disabled = false;
    }
  });
}
