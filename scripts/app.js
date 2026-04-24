/**
 * Entry point: hash router, shell wiring, auth boundary, realtime toast.
 */
import * as api from './api.js';
import { $, on, toast, avatarHtml, esc } from './ui.js';
import * as views from './views.js';

/* =================================================================
   Route table
   ================================================================= */

const ROUTES = [
  { path: /^#\/login$/,                       view: 'login',            auth: false, shell: 'auth' },
  { path: /^#\/signup$/,                      view: 'signup',           auth: false, shell: 'auth' },
  { path: /^#\/discover$/,                    view: 'discover',         auth: true  },
  { path: /^#\/running$/,                     view: 'running',          auth: true  },
  { path: /^#\/community$/,                   view: 'community',        auth: true  },
  { path: /^#\/profile$/,                     view: 'profile',          auth: true  },
  { path: /^#\/profile\/edit$/,               view: 'editProfile',      auth: true  },
  { path: /^#\/stats$/,                       view: 'stats',            auth: true  },
  { path: /^#\/my-activities$/,               view: 'myActivities',     auth: true  },
  { path: /^#\/clubs$/,                       view: 'clubs',            auth: true  },
  { path: /^#\/activity\/([^/]+)\/dashboard$/,view: 'dataDashboard',    auth: true, params: ['activityId'] },
  { path: /^#\/activity\/([^/]+)$/,           view: 'activity',         auth: true, params: ['id'] },
  { path: /^#\/club\/([^/]+)\/manage$/,       view: 'manageClub',       auth: true, params: ['id'] },
  { path: /^#\/club\/([^/]+)\/publish$/,      view: 'publishActivity',  auth: true, params: ['clubId'] },
  { path: /^#\/organizer\/dashboard$/,        view: 'organizerDashboard', auth: true },
];

const VIEW_FN = {
  login: views.renderLogin,
  signup: views.renderSignup,
  discover: views.renderDiscover,
  running: views.renderRunning,
  community: views.renderCommunity,
  profile: views.renderProfile,
  editProfile: views.renderEditProfile,
  stats: views.renderStats,
  myActivities: views.renderMyActivities,
  clubs: views.renderClubs,
  activity: views.renderActivity,
  manageClub: views.renderManageClub,
  publishActivity: views.renderPublishActivity,
  dataDashboard: views.renderDataDashboard,
  organizerDashboard: views.renderOrganizerDashboard,
};

const BOTTOM_TABS = [
  { hash: '#/discover',  icon: 'fa-compass',        label: 'Discover' },
  { hash: '#/running',   icon: 'fa-person-running', label: 'Running'  },
  { hash: '#/community', icon: 'fa-people-group',   label: 'Community'},
  { hash: '#/profile',   icon: 'fa-user',           label: 'Profile'  },
];

/* =================================================================
   Router state
   ================================================================= */

let currentSession = null;
let realtimeUnsub = null;

export function navigate(hash) {
  if (location.hash === hash) {
    handleRoute();
  } else {
    location.hash = hash;
  }
}

export function setHeader({ title = 'RunLink', backTo = null } = {}) {
  const t = $('#app-header-title'); if (t) t.textContent = title;
  const dt = $('#desktop-page-title');
  if (dt) dt.textContent = title;
  const b = $('#back-btn');
  if (b) {
    b.hidden = !backTo;
    b.onclick = () => navigate(backTo);
  }
  const db = $('#desktop-back-btn');
  if (db) {
    db.hidden = !backTo;
    db.onclick = () => { if (backTo) navigate(backTo); };
  }
}

function matchRoute() {
  const hash = location.hash || '#/discover';
  for (const r of ROUTES) {
    const m = hash.match(r.path);
    if (m) {
      const params = {};
      (r.params || []).forEach((name, i) => { params[name] = decodeURIComponent(m[i + 1]); });
      return { ...r, params };
    }
  }
  return null;
}

/* =================================================================
   Shell rendering
   ================================================================= */

function renderBottomNav() {
  const nav = $('#bottom-nav');
  if (!nav) return;
  nav.innerHTML = BOTTOM_TABS.map(t => `
    <button class="tab" data-tab-hash="${t.hash}" aria-label="${t.label}">
      <i class="fa-solid ${t.icon}"></i>
      <span>${t.label}</span>
    </button>`).join('');
  on(nav, 'click', '[data-tab-hash]', (_ev, el) => navigate(el.dataset.tabHash));
}

function renderSideNav() {
  const list = $('.side-nav .nav-list');
  if (!list) return;
  list.innerHTML = BOTTOM_TABS.map(t => `
    <a href="${t.hash}" data-tab-hash="${t.hash}">
      <i class="fa-solid ${t.icon}"></i><span>${t.label}</span>
    </a>`).join('');
}

function markActiveTab() {
  const hash = location.hash || '#/discover';
  const top = '#/' + hash.split('/')[1];
  document.querySelectorAll('[data-tab-hash]').forEach(el => {
    el.classList.toggle('active', el.dataset.tabHash === top);
  });
}

/* =================================================================
   Route handling
   ================================================================= */

async function handleRoute() {
  const match = matchRoute();
  const signedIn = !!currentSession;

  // Guard: need auth
  if (match?.auth && !signedIn) return navigate('#/login');
  // Guard: already signed in → bump off auth pages
  if (match?.auth === false && signedIn) return navigate('#/discover');
  // Unknown route
  if (!match) return navigate(signedIn ? '#/discover' : '#/login');

  // Pick shell
  const appShell   = $('#app');
  const authShell  = $('#auth-shell');
  if (match.shell === 'auth' || !signedIn) {
    appShell.hidden = true;
    authShell.hidden = false;
  } else {
    authShell.hidden = true;
    appShell.hidden = false;
  }

  // Render — clone-replace container so previous delegated listeners are dropped.
  const oldContainer = (match.shell === 'auth' || !signedIn) ? $('#auth-view') : $('#view');
  const container = oldContainer.cloneNode(false);
  oldContainer.replaceWith(container);
  const fn = VIEW_FN[match.view];
  if (!fn) {
    container.innerHTML = `<div class="empty">Unknown route</div>`;
    return;
  }
  // Opt-in full-bleed layout for the Running view (dark map takeover).
  document.body.classList.toggle('run-fullscreen', match.view === 'running');
  // Hide the redundant mobile app-header on profile/edit-profile (hero banner acts as header).
  document.body.classList.toggle('profile-fullscreen',
    match.view === 'profile' || match.view === 'editProfile');

  try {
    await fn(container, match.params || {});
  } catch (err) {
    console.error(err);
    container.innerHTML = `<div class="empty">
      <i class="fa-solid fa-triangle-exclamation"></i>
      <h3>Something broke</h3>
      <p>${esc(err.message || 'Unknown error')}</p>
      <button class="btn ghost" onclick="location.reload()">Reload</button>
    </div>`;
  }
  markActiveTab();
  // Move focus for screen readers
  container.setAttribute('tabindex', '-1');
  container.focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
}

/* =================================================================
   Realtime: new-registration toasts
   ================================================================= */

async function setupRealtime() {
  if (realtimeUnsub) { realtimeUnsub(); realtimeUnsub = null; }
  if (!currentSession) return;
  const user = currentSession.user;
  realtimeUnsub = api.subscribeToNewRegistrations(async (reg) => {
    if (reg.user_id === user.id) return; // don't toast self
    try {
      const a = await api.getActivity(reg.activity_id);
      if (!a) return;
      toast(`🎉 Someone just joined "${a.title}"`, { kind: 'info' });
    } catch { /* RLS may block */ }
  });
}

/* =================================================================
   Auth wiring
   ================================================================= */

async function bootstrap() {
  // Initial session
  currentSession = await api.getSession();

  // Static shells
  renderBottomNav();
  renderSideNav();

  // Header actions
  $('#back-btn')?.addEventListener('click', () => history.back());
  $('#nav-logout')?.addEventListener('click', async () => {
    await api.signOut();
    toast('Logged out', { kind: 'info' });
  });

  // Listen for auth changes
  api.onAuthStateChange(async (event, session) => {
    currentSession = session;
    setupRealtime();
    // React to sign in / sign out
    if (event === 'SIGNED_IN') navigate('#/discover');
    else if (event === 'SIGNED_OUT') navigate('#/login');
    else handleRoute();
  });

  // Route listener
  window.addEventListener('hashchange', handleRoute);

  // First render
  setupRealtime();
  await handleRoute();

  // Hide boot splash
  const boot = $('#boot');
  if (boot) {
    boot.classList.add('hidden');
    setTimeout(() => boot.remove(), 400);
  }
}

bootstrap().catch(err => {
  console.error(err);
  document.body.innerHTML = `<div class="empty" style="margin:60px 20px">
    <i class="fa-solid fa-triangle-exclamation"></i>
    <h3>Failed to start</h3>
    <p>${esc(err.message || 'Unknown error')}</p>
  </div>`;
});
