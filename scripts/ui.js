/**
 * Tiny UI utilities: toasts, modals, formatters, DOM helpers.
 * No framework, vanilla ES modules only.
 */

/* =========================================================== DOM */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Safely escape a string for direct interpolation into innerHTML. */
export function esc(v) {
  if (v == null) return '';
  return String(v)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Delegate — bind one listener to a root, match events inside by selector. */
export function on(root, event, selector, handler) {
  root.addEventListener(event, (ev) => {
    const target = ev.target.closest(selector);
    if (target && root.contains(target)) handler(ev, target);
  });
}

/* =========================================================== Toast */

let toastRoot;
function ensureToastRoot() {
  toastRoot ??= document.getElementById('toast-root');
  return toastRoot;
}

export function toast(message, { kind = 'info', duration = 2600, icon } = {}) {
  const root = ensureToastRoot();
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  const iconMap = {
    success: 'fa-circle-check',
    error:   'fa-triangle-exclamation',
    info:    'fa-circle-info',
    warn:    'fa-bell',
  };
  const ic = icon ?? iconMap[kind] ?? 'fa-circle-info';
  el.innerHTML = `<i class="fa-solid ${ic}"></i><span>${esc(message)}</span>`;
  root.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
    el.style.opacity = '0';
    el.style.transform = 'translateY(-4px)';
    setTimeout(() => el.remove(), 220);
  }, duration);
}

/* =========================================================== Modal */

/**
 * Open a modal. `render(closer)` should return an HTMLElement or a
 * string of HTML. The returned Promise resolves with whatever the
 * closer was called with (default undefined).
 */
export function openModal(render) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    root.hidden = false;
    root.innerHTML = '';
    const modal = document.createElement('div');
    modal.className = 'modal';
    const close = (value) => {
      root.hidden = true;
      root.innerHTML = '';
      resolve(value);
    };
    const content = render(close);
    if (typeof content === 'string') modal.innerHTML = content;
    else modal.appendChild(content);
    root.appendChild(modal);

    // Backdrop close
    root.addEventListener('click', (ev) => {
      if (ev.target === root) close(undefined);
    }, { once: true });

    // Escape to close
    const onKey = (ev) => {
      if (ev.key === 'Escape') { close(undefined); document.removeEventListener('keydown', onKey); }
    };
    document.addEventListener('keydown', onKey);
  });
}

/** Confirm dialog — resolves true/false. */
export function confirmDialog({ title, message, confirmText = 'Confirm', cancelText = 'Cancel', danger = false }) {
  return openModal((close) => {
    const el = document.createElement('div');
    el.innerHTML = `
      <h3>${esc(title)}</h3>
      <p>${esc(message)}</p>
      <div class="actions">
        <button class="btn ghost" data-act="cancel">${esc(cancelText)}</button>
        <button class="btn ${danger ? 'danger' : ''}" data-act="ok">${esc(confirmText)}</button>
      </div>`;
    el.querySelector('[data-act="cancel"]').addEventListener('click', () => close(false));
    el.querySelector('[data-act="ok"]').addEventListener('click', () => close(true));
    return el;
  });
}

/* ====================================================== Formatters */

const MS_MIN = 60_000;
const MS_HOUR = 3_600_000;
const MS_DAY = 86_400_000;

export function timeUntil(iso) {
  if (!iso) return '';
  const delta = new Date(iso).getTime() - Date.now();
  if (delta < 0) return 'started';
  const abs = Math.abs(delta);
  if (abs < MS_HOUR)  return `in ${Math.max(1, Math.round(abs / MS_MIN))} min`;
  if (abs < MS_DAY)   return `in ${Math.round(abs / MS_HOUR)} h`;
  const d = Math.round(abs / MS_DAY);
  return `in ${d} day${d === 1 ? '' : 's'}`;
}

export function fmtDate(iso, { withTime = true } = {}) {
  if (!iso) return '';
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  if (!withTime) return date;
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${date} · ${time}`;
}

export function fmtTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function fmtDistance(m) {
  if (m == null) return '—';
  if (m >= 1000) return (m / 1000).toFixed(m % 1000 === 0 ? 0 : 2) + ' km';
  return `${Math.round(m)} m`;
}

export function fmtDuration(sec) {
  if (sec == null) return '—';
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h) return `${h}h ${m.toString().padStart(2,'0')}m`;
  return `${m}:${r.toString().padStart(2,'0')}`;
}

export function fmtPace(sPerKm) {
  if (sPerKm == null) return '—';
  const m = Math.floor(sPerKm / 60);
  const s = Math.round(sPerKm % 60);
  return `${m}:${s.toString().padStart(2,'0')} /km`;
}

/* ============================================================ Misc */

export function initials(name) {
  if (!name) return 'R';
  return name.split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

export function avatarHtml(profile, { size = 'md' } = {}) {
  const sz = size === 'sm' ? 'sm' : size === 'lg' ? 'lg' : '';
  if (profile?.avatar_url) {
    return `<img class="avatar ${sz}" src="${esc(profile.avatar_url)}" alt="${esc(profile.display_name || '')}" />`;
  }
  return `<span class="avatar ${sz}">${esc(initials(profile?.display_name))}</span>`;
}

export function tier(totalMeters) {
  const km = (totalMeters || 0) / 1000;
  if (km >= 50)  return { name: 'Platinum', emoji: '🏆' };
  if (km >= 30)  return { name: 'Gold',     emoji: '🥇' };
  if (km >= 15)  return { name: 'Silver',   emoji: '🥈' };
  if (km >= 5)   return { name: 'Bronze',   emoji: '🥉' };
  return { name: 'Rookie', emoji: '👟' };
}

export function showLoading(container, n = 3) {
  container.innerHTML = Array.from({ length: n }).map(() =>
    `<div class="card"><div class="skeleton" style="height:72px;border-radius:10px"></div></div>`
  ).join('');
}
