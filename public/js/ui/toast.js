let host;

function ensureHost() {
  if (host) return host;
  host = document.getElementById('toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toast-host';
    host.className = 'toast-host';
    document.body.appendChild(host);
  }
  return host;
}

export function toast(message, { error = false, ms = 2400 } = {}) {
  const el = document.createElement('div');
  el.className = 'toast' + (error ? ' error' : '');
  el.textContent = String(message || '');
  ensureHost().appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 220);
  }, ms);
}

toast.error = (message, opts) => toast(message, { ...opts, error: true });