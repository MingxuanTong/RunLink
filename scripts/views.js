/**
 * All view renderers. Each function takes the container element it
 * should populate; it is responsible for fetching data, writing HTML,
 * and wiring up its own event listeners.
 *
 * Light iOS-style UI that matches ../runapp-prototype/styles/common.css.
 */
import * as api from './api.js';
import {
  $, $$, on, esc, toast, openModal, confirmDialog,
  timeUntil, fmtDate, fmtTime, fmtDistance, fmtDuration, fmtPace,
  avatarHtml, tier, showLoading, initials,
} from './ui.js';
import { validateCheckin, getCurrentPosition, haversineMeters } from './geofence.js';
import { meetupPicker, runRecorder, createMap, whenLeafletReady, addRouteGeoJson } from './map.js';
import { navigate, setHeader } from './app.js';

/* =================================================================
   Shared constants — keep in sync with the PRD
   ================================================================= */

/** PRD §3.2 — system-fixed geofence radius. */
const CHECK_IN_RADIUS_M = 50;

/** PRD §3.4a — fixed 7-emoji reaction preset. */
const EMOJI_PRESET = ['💪', '🔥', '😎', '😅', '🎉', '👍', '❤️'];
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const DEFAULT_PROFILE_COVER_URL = 'https://images.unsplash.com/photo-1502810190503-8303352d0dd1?w=900&h=500&fit=crop';

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`Could not read ${file?.name || 'file'}`));
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`Could not read ${file?.name || 'file'}`));
    reader.readAsText(file);
  });
}

function normalizeRouteGeoJson(raw) {
  if (!raw) throw new Error('Route file is empty');

  if (raw.type === 'FeatureCollection') return raw;
  if (raw.type === 'Feature') return { type: 'FeatureCollection', features: [raw] };
  if (raw.type === 'LineString' || raw.type === 'MultiLineString') {
    return {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: raw }],
    };
  }
  throw new Error('Route file must contain a GeoJSON LineString, MultiLineString, Feature, or FeatureCollection');
}

function parseGpxToGeoJson(text) {
  const xml = new DOMParser().parseFromString(text, 'application/xml');
  if (xml.querySelector('parsererror')) throw new Error('Invalid GPX file');

  const readPoints = (selector) => [...xml.querySelectorAll(selector)]
    .map((pt) => [Number(pt.getAttribute('lon')), Number(pt.getAttribute('lat'))])
    .filter(([lng, lat]) => Number.isFinite(lat) && Number.isFinite(lng));

  const trackSegments = [...xml.querySelectorAll('trkseg')]
    .map((seg) => readPoints('trkseg trkpt'))
    .filter((coords) => coords.length >= 2);

  if (trackSegments.length > 1) {
    return {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { source: 'gpx' },
        geometry: { type: 'MultiLineString', coordinates: trackSegments },
      }],
    };
  }

  if (trackSegments.length === 1) {
    return {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { source: 'gpx' },
        geometry: { type: 'LineString', coordinates: trackSegments[0] },
      }],
    };
  }

  const routePoints = readPoints('rte rtept');
  if (routePoints.length >= 2) {
    return {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { source: 'gpx' },
        geometry: { type: 'LineString', coordinates: routePoints },
      }],
    };
  }

  throw new Error('GPX file does not contain a route or track with at least 2 points');
}

async function parseRouteFile(file) {
  const lower = (file?.name || '').toLowerCase();
  const mime = file?.type || '';
  if (/\.gpx$/.test(lower) || mime === 'application/gpx+xml' || mime === 'application/xml' || mime === 'text/xml') {
    return {
      kind: 'gpx',
      geojson: parseGpxToGeoJson(await readFileAsText(file)),
    };
  }
  if (/\.geojson$|\.json$/.test(lower) || mime === 'application/geo+json' || mime === 'application/json') {
    return {
      kind: 'geojson',
      geojson: normalizeRouteGeoJson(JSON.parse(await readFileAsText(file))),
    };
  }
  return { kind: 'image', geojson: null };
}

/* =================================================================
   Activity card — used on Discover, My activities, Community
   ================================================================= */

/** Returns a status that the card should visualise for the viewer. */
function registrationStatus(reg, activity) {
  if (!reg) return null;
  if (reg.status === 'cancelled') return 'cancelled';
  const now = new Date();
  const past = new Date(activity.end_at) < now;
  const checkedIn = reg.status === 'checked_in' || reg.status === 'late';
  if (past && checkedIn) return 'completed_maybe';
  if (past && !checkedIn) return 'missed';
  if (checkedIn) return reg.status === 'late' ? 'late' : 'checked_in';
  // window-based states
  const winStart = reg.activity?.checkin_window_start ? new Date(activity.checkin_window_start) : null;
  const winEnd   = reg.activity?.checkin_window_end   ? new Date(activity.checkin_window_end)   : null;
  if (winStart && winEnd && now >= winStart && now <= winEnd) return 'checkin_open';
  if (new Date(activity.start_at) <= now) return 'live';
  return 'upcoming';
}

function activityCard(a, { wide = false, badge, fullChip } = {}) {
  if (!a) return '';
  const ends = new Date(a.end_at);
  const starts = new Date(a.start_at);
  const isPast = ends < new Date();
  const timeLabel = isPast
    ? fmtDate(a.end_at, { withTime: false })
    : `${starts.toLocaleDateString(undefined,{month:'short',day:'numeric'})} · ${fmtTime(a.start_at)} → ${fmtTime(a.end_at)}`;
  const until = !isPast && starts > new Date()
    ? `<span class="chip brand">${esc(timeUntil(a.start_at))}</span>` : '';
  const statusChip =
    a.status === 'cancelled' ? `<span class="chip danger">Cancelled</span>` :
    '';
  const coverStyle = a.cover_url
    ? `style="background-image:url('${esc(a.cover_url)}');background-size:cover;background-position:center;"`
    : '';
  return `
    <article class="card activity-card ${wide ? 'wide' : ''} interactive" data-activity="${esc(a.id)}" role="link" tabindex="0">
      <div class="cover" ${coverStyle}></div>
      <div class="info">
        <div class="title">${esc(a.title)}</div>
        <div class="meta">
          ${a.club ? `<span><i class="fa-regular fa-flag"></i>${esc(a.club.name)}</span>` : ''}
          <span><i class="fa-regular fa-calendar"></i>${esc(timeLabel)}</span>
        </div>
        <div class="meta" style="margin-top:2px">
          ${a.meetup_name ? `<span class="chip ghost"><i class="fa-solid fa-location-dot"></i>${esc(a.meetup_name)}</span>` : ''}
          ${until}
          ${statusChip}
          ${badge ?? ''}
          ${fullChip ?? ''}
        </div>
      </div>
    </article>
  `;
}

function bindActivityCards(container) {
  on(container, 'click', '[data-activity]', (_ev, el) => {
    navigate(`#/activity/${el.dataset.activity}`);
  });
  on(container, 'keydown', '[data-activity]', (ev, el) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      navigate(`#/activity/${el.dataset.activity}`);
    }
  });
}

/* =================================================================
   AUTH · login + signup
   ================================================================= */

export async function renderLogin(container) {
  container.innerHTML = `
    <h1>Welcome back</h1>
    <p class="sub">Sign in to see upcoming activities, check in at the meetup spot, and track your monthly mileage.</p>
    <form id="login-form" autocomplete="on">
      <div class="field">
        <label for="email">Email</label>
        <input type="email" id="email" name="email" required autocomplete="email" placeholder="demo@runlink.test" />
      </div>
      <div class="field">
        <label for="password">Password</label>
        <input type="password" id="password" name="password" required autocomplete="current-password" placeholder="••••••••" />
      </div>
      <button class="btn block lg" type="submit">
        <i class="fa-solid fa-right-to-bracket"></i> Sign in
      </button>
      <p class="switch">No account yet? <a href="#/signup">Create one</a></p>
      <p class="switch" style="margin-top:8px">
        <button type="button" class="ghost-btn" id="fill-demo" style="width:100%">
          <i class="fa-solid fa-wand-magic-sparkles"></i> Use demo account
        </button>
      </p>
    </form>`;
  const form = $('#login-form', container);
  $('#fill-demo', container).addEventListener('click', () => {
    $('#email', container).value = 'demo@runlink.test';
    $('#password', container).value = 'Demo12345!';
  });
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await api.signIn({ email: form.email.value.trim(), password: form.password.value });
      toast('Signed in', { kind: 'success' });
    } catch (err) {
      toast(err.message || 'Sign-in failed', { kind: 'error' });
      btn.disabled = false;
    }
  });
}

export async function renderSignup(container) {
  container.innerHTML = `
    <h1>Join RunLink</h1>
    <p class="sub">Create an account to register for activities, record runs, and climb the monthly leaderboard.</p>
    <form id="signup-form" autocomplete="on">
      <div class="field">
        <label for="display_name">Display name</label>
        <input id="display_name" name="display_name" required minlength="2" maxlength="40" placeholder="Alex Runner" />
      </div>
      <div class="field">
        <label for="email">Email</label>
        <input type="email" id="email" name="email" required autocomplete="email" />
      </div>
      <div class="field">
        <label for="password">Password</label>
        <input type="password" id="password" name="password" required minlength="8" autocomplete="new-password" />
        <div class="hint">At least 8 characters.</div>
      </div>
      <button class="btn block lg" type="submit">
        <i class="fa-solid fa-user-plus"></i> Create account
      </button>
      <p class="switch">Already have an account? <a href="#/login">Sign in</a></p>
    </form>`;
  const form = $('#signup-form', container);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await api.signUp({
        displayName: form.display_name.value.trim(),
        email: form.email.value.trim(),
        password: form.password.value,
      });
      toast('Account created — welcome!', { kind: 'success' });
    } catch (err) {
      toast(err.message || 'Sign-up failed', { kind: 'error' });
      btn.disabled = false;
    }
  });
}

/* =================================================================
   DISCOVER tab  (prototype-style:  search + chips + my-regs + hero + recs)
   ================================================================= */

export async function renderDiscover(container) {
  setHeader({ title: 'Discover' });
  const user = await api.getCurrentUser();
  const myClubIds = new Set(await supabaseHelperMemberships(user.id));
  const upcoming = await api.listActivities({ timeframe: 'upcoming', status: 'published' });

  container.innerHTML = `
    <div class="search-pill" role="search">
      <i class="fa-solid fa-magnifying-glass"></i>
      <input id="disc-search" placeholder="Search clubs, activities, routes…" autocomplete="off" />
    </div>

    <div class="chip-row" role="tablist" aria-label="Filter">
      <button class="chip brand" data-filter="for-you"><i class="fa-solid fa-fire"></i> For you</button>
      <button class="chip ghost" data-filter="nearby"><i class="fa-regular fa-compass"></i> Nearby</button>
      <button class="chip ghost" data-filter="this-week"><i class="fa-solid fa-calendar-week"></i> This week</button>
      <button class="chip ghost" data-filter="beginner"><i class="fa-solid fa-user-group"></i> Beginner</button>
      <button class="chip ghost" data-filter="trail"><i class="fa-solid fa-mountain"></i> Trail</button>
    </div>

    <div class="section-title">
      <h2>My registrations</h2>
      <a class="link" href="#/my-activities">See all <i class="fa-solid fa-chevron-right" style="font-size:10px"></i></a>
    </div>
    <div id="my-regs"></div>

    <div class="section-title"><h2>Featured activity</h2></div>
    <div id="featured"></div>

    <div class="section-title"><h2>Recommended for you</h2></div>
    <div id="recommended" class="hscroll"></div>

    <div class="section-title"><h2>Upcoming activities</h2><span class="count" id="up-count">—</span></div>
    <div id="upcoming" class="activity-grid"></div>
  `;

  const upBox = $('#upcoming', container);
  const searchEl = $('#disc-search', container);
  const featured = upcoming[0] || null;
  const recs = upcoming.slice(1, 6);
  const pinnedIds = new Set([featured?.id, ...recs.map(a => a.id)].filter(Boolean));
  /** @type {'for-you'|'nearby'|'this-week'|'beginner'|'trail'} */
  let discoverMode = 'for-you';
  /** @type {typeof upcoming | null} */
  let nearbyRows = null;

  function rowsForDiscoverMode(list) {
    const now = Date.now();
    const weekAhead = now + 7 * 86_400_000;
    switch (discoverMode) {
      case 'for-you': {
        const mine = list.filter(a => myClubIds.has(a.club_id));
        return mine.length ? mine : list;
      }
      case 'this-week':
        return list.filter(a => new Date(a.start_at).getTime() < weekAhead);
      case 'beginner':
        return list.filter(a => /beginner|chill|easy/i.test(`${a.description || ''} ${a.title || ''}`));
      case 'trail':
        return list.filter(a => /trail|mountain/i.test(`${a.description || ''} ${a.title || ''}`));
      case 'nearby':
        return nearbyRows ?? [];
      default:
        return list;
    }
  }

  function rebuildUpcomingGrid() {
    if (!upcoming.length) {
      $('#up-count', container).textContent = '0';
      upBox.innerHTML = `<div class="empty"><i class="fa-regular fa-clock"></i><h3>No published activities</h3><p>Check back later or create one from your club.</p></div>`;
      return;
    }
    let rows = rowsForDiscoverMode(upcoming);
    // Avoid showing the same activity in top sections and the grid.
    rows = rows.filter(a => !pinnedIds.has(a.id));
    const q = (searchEl?.value || '').trim().toLowerCase();
    if (q) {
      rows = rows.filter(a =>
        a.title?.toLowerCase().includes(q) ||
        a.club?.name?.toLowerCase().includes(q) ||
        a.meetup_name?.toLowerCase().includes(q));
    }
    $('#up-count', container).textContent = `${rows.length}`;
    upBox.innerHTML = rows.length
      ? rows.map(a => activityCardWithCap(a)).join('')
      : `<div class="empty"><i class="fa-solid fa-clock"></i><p>${q ? 'No matches for this filter and search.' : 'Nothing in this filter right now.'}</p></div>`;
    bindActivityCards(upBox);
  }

  on(container, 'click', '[data-filter]', async (_ev, btn) => {
    container.querySelectorAll('[data-filter]').forEach(b => {
      b.classList.toggle('brand', b === btn);
      b.classList.toggle('ghost', b !== btn);
    });
    const f = btn.dataset.filter;
    discoverMode = f;
    nearbyRows = null;

    if (f === 'nearby') {
      showLoading(upBox, 2);
      try {
        const pos = await getCurrentPosition({ timeoutMs: 12_000 });
        const R = 15_000;
        nearbyRows = upcoming
          .filter(a => a.meetup_lat != null && a.meetup_lng != null)
          .map(a => ({
            a,
            d: haversineMeters(pos.lat, pos.lng, a.meetup_lat, a.meetup_lng),
          }))
          .filter(({ d }) => d <= R)
          .sort((x, y) => x.d - y.d)
          .map(({ a }) => a);
        if (!nearbyRows.length) {
          toast('No activities with a meetup pin within 15 km.', { kind: 'info' });
        }
      } catch {
        toast('Could not read your location. Allow access or try again.', { kind: 'error' });
        nearbyRows = [];
      }
    }
    rebuildUpcomingGrid();
  });

  // My registrations — fixed 2 cards as per PRD §4.1
  const myBox = $('#my-regs', container);
  showLoading(myBox, 2);
  const regs = await api.listMyRegistrations({ timeframe: 'upcoming' });
  const live = regs.filter(r => {
    const a = r.activity;
    if (!a) return false;
    const now = new Date();
    const wsOK = !a.checkin_window_start || new Date(a.checkin_window_start) <= now;
    const weOK = !a.checkin_window_end   || new Date(a.checkin_window_end)   >= now;
    return wsOK && weOK && r.status !== 'cancelled';
  });
  const ordered = [...live, ...regs.filter(r => !live.includes(r))].slice(0, 2);
  myBox.innerHTML = ordered.length
    ? ordered.map(r => regCardHtml(r)).join('<div style="height:10px"></div>')
    : `<div class="empty">
        <i class="fa-regular fa-calendar-plus"></i>
        <h3>No upcoming registrations</h3>
        <p>Pick an activity below and tap Register.</p>
      </div>`;
  bindRegCardActions(myBox);

  // Featured activity
  const featBox = $('#featured', container);
  if (featured) {
    featBox.innerHTML = featuredHeroHtml(featured);
    featBox.querySelector('[data-open-activity]')?.addEventListener('click', (ev) => {
      navigate(`#/activity/${ev.currentTarget.dataset.openActivity}`);
    });
  } else {
    featBox.innerHTML = `<div class="empty"><i class="fa-regular fa-star"></i><p>No featured activity yet.</p></div>`;
  }

  // Recommended (horizontal scroll)
  const recBox = $('#recommended', container);
  recBox.innerHTML = recs.length
    ? recs.map(a => recCardHtml(a)).join('')
    : `<div class="empty" style="flex:1"><p>Check back later.</p></div>`;
  bindActivityCards(recBox);

  rebuildUpcomingGrid();
  searchEl?.addEventListener('input', () => rebuildUpcomingGrid());
}

/** Registration card as per prototype (with overflow + Map check-in CTA). */
function regCardHtml(r) {
  const a = r.activity;
  if (!a) return '';
  const now = new Date();
  const ws = a.checkin_window_start ? new Date(a.checkin_window_start) : null;
  const we = a.checkin_window_end   ? new Date(a.checkin_window_end)   : null;
  const windowOpen  = ws && we && now >= ws && now <= we;
  const windowLater = ws && now < ws;
  const windowClosed = we && now > we;
  const checkedIn = r.status === 'checked_in' || r.status === 'late';

  // Build the CTA button
  let primaryBtn = '';
  if (checkedIn) {
    primaryBtn = `<button class="btn sm block" data-reg-act="run" data-activity="${esc(a.id)}">
      <i class="fa-solid fa-person-running"></i> Go run</button>`;
  } else if (windowOpen) {
    primaryBtn = `<button class="btn cta sm block" data-reg-act="checkin" data-activity="${esc(a.id)}">
      <i class="fa-solid fa-location-crosshairs"></i> Map check-in</button>`;
  } else if (windowLater) {
    const mins = Math.max(1, Math.round((ws - now) / 60000));
    primaryBtn = `<button class="btn sm block" disabled>
      <i class="fa-regular fa-clock"></i> Opens in ${mins} min</button>`;
  } else if (windowClosed) {
    primaryBtn = `<button class="btn sm block" disabled>Window closed</button>`;
  } else {
    // No check-in window on this activity — still show "Map check-in" (radius-only guard).
    primaryBtn = `<button class="btn cta sm block" data-reg-act="checkin" data-activity="${esc(a.id)}">
      <i class="fa-solid fa-location-crosshairs"></i> Map check-in</button>`;
  }

  const hint = windowOpen ? `
    <div class="checkin-hint">
      <i class="fa-solid fa-circle-dot"></i>
      Check-in open · ${esc(fmtTime(a.checkin_window_start))} → ${esc(fmtTime(a.checkin_window_end))} · auto-verifies your location in one tap
    </div>` : '';

  const statusChip = checkedIn
    ? `<span class="chip success"><i class="fa-solid fa-check"></i> ${r.status === 'late' ? 'Checked in · Late' : 'Checked in'}</span>`
    : '';

  const canCancel = r.status === 'registered' && now < new Date(a.start_at);

  return `
    <div class="reg-card" data-reg-card="${esc(a.id)}">
      <div class="top">
        ${avatarHtml(a.club, { size: 'md' })}
        <div style="flex:1; min-width:0;">
          <div class="title">${esc(a.title)}</div>
          <div class="meta">
            <span class="chip"><i class="fa-regular fa-clock"></i> ${esc(fmtTime(a.start_at))} → ${esc(fmtTime(a.end_at))}</span>
            ${a.meetup_name ? `<span class="chip"><i class="fa-solid fa-location-dot"></i> ${esc(a.meetup_name)}</span>` : ''}
            ${r.group_name ? `<span class="chip"><i class="fa-solid fa-people-group"></i> ${esc(r.group_name)}</span>` : ''}
            ${statusChip}
          </div>
        </div>
        ${canCancel ? `<button class="overflow" data-reg-act="cancel" data-activity="${esc(a.id)}" title="More"><i class="fa-solid fa-ellipsis"></i></button>` : ''}
      </div>
      ${hint}
      <div class="actions">
        ${primaryBtn}
        <button class="btn ghost sm block" data-reg-act="detail" data-activity="${esc(a.id)}">View detail</button>
      </div>
    </div>`;
}

function bindRegCardActions(container) {
  on(container, 'click', '[data-reg-act]', async (_ev, el) => {
    const id = el.dataset.activity;
    switch (el.dataset.regAct) {
      case 'detail':
        return navigate(`#/activity/${id}`);
      case 'run':
        return navigate('#/running');
      case 'checkin': {
        const a = await api.getActivity(id);
        return runCheckinFlow(a);
      }
      case 'cancel': {
        if (!await confirmDialog({
          title: 'Cancel this registration?',
          message: 'Your seat will be released. You can register again while capacity lasts.',
          danger: true, confirmText: 'Cancel registration',
        })) return;
        try {
          await api.cancelRegistration(id);
          toast('Registration cancelled', { kind: 'info' });
          renderDiscover(document.getElementById('view'));
        } catch (err) {
          toast(err.message, { kind: 'error' });
        }
      }
    }
  });
}

function featuredHeroHtml(a) {
  const cover = a.cover_url || `https://images.unsplash.com/photo-1552674605-db6ffd4facb5?w=900&h=500&fit=crop`;
  return `
    <div class="hero-feature" role="link" tabindex="0" data-open-activity="${esc(a.id)}">
      <div class="cover" style="background-image:url('${esc(cover)}');"></div>
      <div class="overlay"></div>
      <div class="club-pill">
        ${avatarHtml(a.club, { size: 'sm' })}
        ${esc(a.club?.name || 'Running club')}
      </div>
      <div class="content">
        <h3>${esc(a.title)}</h3>
        <div class="row">
          <span><i class="fa-regular fa-calendar"></i> ${esc(fmtDate(a.start_at))}</span>
          ${a.meetup_name ? `<span>·</span><span><i class="fa-solid fa-location-dot"></i> ${esc(a.meetup_name)}</span>` : ''}
        </div>
      </div>
    </div>`;
}

function recCardHtml(a) {
  const cover = a.cover_url || `https://images.unsplash.com/photo-1486218119243-13883505764c?w=500&h=300&fit=crop`;
  return `
    <article class="rec-card interactive" data-activity="${esc(a.id)}">
      <div class="cover" style="background-image:url('${esc(cover)}')"></div>
      <div class="body">
        <div class="title">${esc(a.title)}</div>
        <div class="club">
          ${avatarHtml(a.club, { size: 'sm' })}
          ${esc(a.club?.name || 'Club')}
        </div>
      </div>
    </article>`;
}

function activityCardWithCap(a) {
  // We render the "Full" chip optimistically using the total_cap presence;
  // the authoritative check happens on register (§api.register).
  // This lightweight view doesn't block on a second network round-trip per card.
  return activityCard(a);
}

/* =================================================================
   CHECK-IN FLOW   (Map check-in · single tap)
   ================================================================= */

async function runCheckinFlow(activity) {
  if (!activity) return toast('Activity not found', { kind: 'error' });

  // PRD §3.3 step 2 — time-window validation first.
  const now = new Date();
  if (activity.checkin_window_start && now < new Date(activity.checkin_window_start)) {
    return toast('Check-in window hasn\'t opened yet.', { kind: 'warn' });
  }
  if (activity.checkin_window_end && now > new Date(activity.checkin_window_end)) {
    return toast('Check-in window is closed.', { kind: 'warn' });
  }

  toast('Locating you…', { kind: 'info' });
  let result;
  try {
    result = await validateCheckin(activity);
  } catch (err) {
    return gpsFallbackModal(activity, {
      reason: 'gps_error',
      accuracy: null,
      errorMessage: err?.message || 'Unable to get location',
    });
  }
  if (result.ok) {
    try {
      const reg = await api.checkIn({
        activityId: activity.id, method: 'gps',
        lat: result.lat, lng: result.lng, accuracy: result.accuracy,
      });
      const isLate = reg.status === 'late';
      toast(`Checked in · ${Math.round(result.distance)} m from meetup${isLate ? ' · Late' : ''}`,
        { kind: 'success', duration: 3500 });
      showCheckinSuccess(activity, result, reg);
    } catch (err) {
      toast(err.message, { kind: 'error' });
    }
    return;
  }
  return gpsFallbackModal(activity, result);
}

function showCheckinSuccess(activity, result, reg) {
  openModal((close) => {
    const el = document.createElement('div');
    el.innerHTML = `
      <h3>You're checked in!</h3>
      <p>${reg.status === 'late'
          ? 'Welcome — you\'re a little late but still counted. Enjoy the run.'
          : 'Location and time verified. Have a great run!'}</p>

      <div class="card card-compact" style="margin-bottom:14px">
        <div style="display:flex;gap:10px;align-items:center">
          ${avatarHtml(activity.club, { size: 'md' })}
          <div style="flex:1">
            <div style="font-weight:700">${esc(activity.title)}</div>
            <div style="color:var(--ink-500);font-size:12px">${esc(activity.club?.name || '')} · ${esc(fmtTime(activity.start_at))}</div>
          </div>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px;font-size:13px">
        <div style="display:flex;gap:8px;align-items:center;color:var(--accent-dark)">
          <i class="fa-solid fa-circle-check"></i>
          <span>Location verified · ${Math.round(result.distance)} m from meetup (within ${CHECK_IN_RADIUS_M} m zone)</span>
        </div>
        <div style="display:flex;gap:8px;align-items:center;color:var(--accent-dark)">
          <i class="fa-solid fa-circle-check"></i>
          <span>Within check-in window</span>
        </div>
        <div style="display:flex;gap:8px;align-items:center;color:var(--accent-dark)">
          <i class="fa-solid fa-circle-check"></i>
          <span>Activity route unlocked in the Running tab</span>
        </div>
      </div>

      <div class="actions">
        <button class="btn ghost" data-act="close">Close</button>
        <button class="btn" data-act="run"><i class="fa-solid fa-play"></i> Go run</button>
      </div>`;
    el.querySelector('[data-act="close"]').addEventListener('click', () => close());
    el.querySelector('[data-act="run"]').addEventListener('click', () => { close(); navigate('#/running'); });
    return el;
  });
}

function gpsFallbackModal(activity, result = {}) {
  const reason = result?.reason || 'unknown';
  const allowManual = reason !== 'no_meetup';
  const reasonTitle =
    reason === 'low_accuracy' ? `GPS accuracy too low (±${Math.round(result.accuracy || 0)} m)` :
    reason === 'too_far' ? `You're ${Math.round(result.distance || 0)} m from meetup` :
    reason === 'gps_error' ? 'Unable to read GPS location' :
    reason === 'no_meetup' ? 'Meetup point not configured' :
    'GPS verification failed';
  const reasonBody =
    reason === 'low_accuracy'
      ? 'Indoor parking, tall buildings, or airplane mode can cause this.'
      : reason === 'too_far'
      ? `Move within ${CHECK_IN_RADIUS_M} m of the meetup point and retry.`
      : reason === 'gps_error'
      ? `Location service returned an error: ${esc(result.errorMessage || 'Unknown error')}.`
      : reason === 'no_meetup'
      ? 'Organizer has not set a valid meetup point yet. You can retry later.'
      : 'Please retry GPS or contact the organizer.';
  const closeText = activity?.checkin_window_end
    ? `Check-in closes ${esc(fmtTime(activity.checkin_window_end))}`
    : 'Check-in window is active';

  return openModal((close) => {
    const el = document.createElement('div');
    el.innerHTML = `
      <div style="text-align:center;margin-bottom:6px">
        <div style="width:64px;height:64px;margin:0 auto 8px;border-radius:18px;display:grid;place-items:center;background:linear-gradient(160deg,#FDBA74,#F97316);color:#fff;box-shadow:0 10px 22px rgba(249,115,22,.28)">
          <i class="fa-solid fa-location-dot" style="font-size:26px"></i>
        </div>
        <h3 style="margin-bottom:8px">Confirm you're at the meetup</h3>
        <p style="margin:0;color:var(--ink-600)">We couldn't verify the ${CHECK_IN_RADIUS_M} m geofence with high confidence.</p>
      </div>

      <div class="card card-compact" style="background:#FFF7ED;border-color:#FED7AA;margin:12px 0">
        <div style="display:flex;gap:10px;align-items:flex-start">
          <i class="fa-solid fa-triangle-exclamation" style="color:#F59E0B;margin-top:2px"></i>
          <div>
            <div style="font-weight:800;color:#7C2D12">${esc(reasonTitle)}</div>
            <div style="color:#9A3412;font-size:13px;margin-top:3px">${esc(reasonBody)}</div>
          </div>
        </div>
      </div>

      <div class="card card-compact" style="background:#FFF7ED;border-color:#FED7AA;margin-bottom:14px">
        <div style="display:flex;gap:10px;align-items:flex-start">
          <i class="fa-solid fa-map-pin" style="color:#F97316;margin-top:2px"></i>
          <div>
            <div style="font-weight:700;color:#7C2D12">${esc(activity.meetup_name || 'Meetup point')}</div>
            <div style="color:#9A3412;font-size:13px">${closeText}</div>
          </div>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:10px">
        ${allowManual ? `
          <button class="btn cta block" data-act="ok">
            <i class="fa-solid fa-circle-check"></i> I'm at the meetup
          </button>` : ''}
        <button class="btn ghost block" data-act="retry">Retry GPS</button>
        <button class="btn ghost block" data-act="cancel">Cancel</button>
      </div>
      ${allowManual ? `
        <p data-role="manual-confirm-note" hidden style="margin-top:10px;color:#9A3412;font-size:12px;text-align:center">
          Tap once more to confirm immediate check-in at the meetup point.
        </p>` : ''}

      <p style="margin-top:12px;color:var(--ink-500);font-size:12px;text-align:center">
        Confirmations are logged. False claims are flagged for organizer review.
      </p>
      <div class="actions" style="display:none">
        <button class="btn ghost" data-act="cancel-hidden">Cancel</button>
      </div>`;

    el.querySelector('[data-act="retry"]')?.addEventListener('click', () => {
      close(false);
      runCheckinFlow(activity);
    });
    el.querySelector('[data-act="cancel"]').addEventListener('click', () => close(false));
    el.querySelector('[data-act="ok"]')?.addEventListener('click', async () => {
      const btn = el.querySelector('[data-act="ok"]');
      const note = el.querySelector('[data-role="manual-confirm-note"]');
      if (btn?.dataset.armed !== '1') {
        if (btn) {
          btn.dataset.armed = '1';
          btn.classList.remove('cta');
          btn.classList.add('danger');
          btn.innerHTML = `<i class="fa-solid fa-location-check"></i> Confirm now — check me in`;
        }
        if (note) note.hidden = false;
        return;
      }
      close(true);
      try {
        await api.checkIn({ activityId: activity.id, method: 'fallback' });
        toast('Manual check-in recorded', { kind: 'success' });
        navigate(`#/activity/${activity.id}`);
      } catch (err) {
        toast(err.message, { kind: 'error' });
      }
    });
    return el;
  });
}

/* =================================================================
   ACTIVITY DETAIL — two states (Not registered / Registered)
   ================================================================= */

export async function renderActivity(container, { id }) {
  setHeader({ title: 'Activity', backTo: '#/discover' });
  container.innerHTML = `<div class="skeleton" style="height:220px;border-radius:18px"></div>`;

  const activity = await api.getActivity(id);
  if (!activity) {
    container.innerHTML = `<div class="empty"><i class="fa-solid fa-circle-exclamation"></i><h3>Not found</h3><p>This activity no longer exists.</p></div>`;
    return;
  }
  const user = await api.getCurrentUser();
  const reg = await api.getMyRegistration(id);
  const isPast = new Date(activity.end_at) < new Date();
  const isOwner = activity.club?.owner_id === user?.id;
  const isCheckedIn = reg?.status === 'checked_in' || reg?.status === 'late';

  // Registration counts (for cap display / Full chip)
  const counts = await api.getRegistrationCounts(id).catch(() => ({ total: 0, byGroup: new Map() }));
  const totalCap = activity.total_cap;
  const isFull = totalCap != null && counts.total >= totalCap;
  const registered = !!reg && reg.status !== 'cancelled';

  // Header badges
  const stateChip =
    activity.status === 'cancelled' ? `<span class="chip danger">Cancelled</span>` :
    isPast ? `<span class="chip success">Completed</span>` :
    registered && (reg.status === 'checked_in' || reg.status === 'late')
      ? `<span class="chip success">Checked in${reg.status === 'late' ? ' · Late' : ''}</span>` :
    registered ? `<span class="chip brand">Registered</span>` :
    isFull ? `<span class="chip danger">Full</span>` :
    `<span class="chip accent">Open</span>`;

  const coverBg = activity.cover_url
    ? `url('${esc(activity.cover_url)}') center/cover`
    : 'linear-gradient(135deg,#F97316,#FB923C)';
  const hasRouteImage = activity.route_file_kind === 'image' && activity.route_file_url;
  const hasRouteGeo = !!activity.route_geojson;

  container.innerHTML = `
    <article class="card" style="padding:0;overflow:hidden">
      <div style="aspect-ratio:2.2;background:${coverBg};position:relative">
        ${registered && !isPast ? `<span class="chip success" style="position:absolute;top:12px;right:12px;box-shadow:var(--shadow-sm)">
          <i class="fa-solid fa-circle-check"></i> Registered</span>` : ''}
      </div>
      <div style="padding:18px">
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
          ${stateChip}
          ${activity.club ? `<span class="chip ghost"><i class="fa-regular fa-flag"></i>${esc(activity.club.name)}</span>` : ''}
          ${isOwner ? `<span class="chip brand"><i class="fa-solid fa-shield"></i>Organizer</span>` : ''}
          ${totalCap != null ? `<span class="chip ghost"><i class="fa-solid fa-users"></i>${counts.total}/${totalCap}</span>` : ''}
        </div>
        <h2 style="margin:0 0 8px;font-family:var(--font-display);color:var(--ink-900);font-size:26px;line-height:1.15">${esc(activity.title)}</h2>
        <p style="color:var(--ink-700);font-size:14px;line-height:1.6;margin:0 0 14px">${esc(activity.description || '')}</p>

        <div class="stat-grid" style="margin-bottom:14px">
          <div class="stat"><div class="v">${esc(new Date(activity.start_at).toLocaleDateString(undefined,{month:'short',day:'numeric'}))}</div><div class="l">Date</div></div>
          <div class="stat"><div class="v">${esc(fmtTime(activity.start_at))}</div><div class="l">Start</div></div>
          <div class="stat"><div class="v">${esc(fmtTime(activity.end_at))}</div><div class="l">End</div></div>
        </div>

        <div class="card card-compact" style="margin-top:0">
          <div style="font-weight:700"><i class="fa-solid fa-location-dot" style="color:var(--brand)"></i> ${esc(activity.meetup_name || 'Meetup')}</div>
          <div style="color:var(--ink-500);font-size:12px;margin-top:4px">
            Check-in radius <b>${CHECK_IN_RADIUS_M} m</b>
            ${activity.checkin_window_start ? ` · window ${esc(fmtTime(activity.checkin_window_start))} → ${esc(fmtTime(activity.checkin_window_end || activity.start_at))}` : ''}
          </div>
          <div id="meetup-preview" class="leaflet-map" style="margin-top:10px;height:180px"></div>
          ${registered && !isPast ? `
            ${isCheckedIn ? `
              <div class="chip success" style="margin-top:10px;display:inline-flex">
                <i class="fa-solid fa-circle-check"></i> Checked in${reg?.status === 'late' ? ' · Late' : ''}
              </div>` : `
              <button class="btn cta sm block" style="margin-top:10px" data-act="detail-map-checkin">
                <i class="fa-solid fa-location-crosshairs"></i> Map check-in
              </button>`}
          ` : ''}
        </div>

        ${hasRouteImage ? `
          <div class="card card-compact" style="margin-top:12px">
            <div style="font-weight:700"><i class="fa-solid fa-route" style="color:var(--brand)"></i> Route map</div>
            <div style="color:var(--ink-500);font-size:12px;margin-top:4px">
              Uploaded by the organizer${activity.route_file_name ? ` · ${esc(activity.route_file_name)}` : ''}
            </div>
            <img src="${esc(activity.route_file_url)}" alt="Route map"
                 style="width:100%;margin-top:10px;border-radius:14px;border:1px solid var(--ink-100);display:block" />
          </div>` : ''}

        ${hasRouteGeo ? `
          <div class="card card-compact" style="margin-top:12px">
            <div style="font-weight:700"><i class="fa-solid fa-route" style="color:var(--brand)"></i> Route file</div>
            <div style="color:var(--ink-500);font-size:12px;margin-top:4px">
              ${esc(activity.route_file_name || 'Uploaded route')} · rendered directly on the map
            </div>
            ${activity.route_file_url ? `
              <a href="${esc(activity.route_file_url)}" target="_blank" rel="noopener" style="margin-top:8px;display:inline-flex;align-items:center;gap:6px;color:var(--brand);font-size:13px;font-weight:700;text-decoration:none">
                <i class="fa-solid fa-download"></i> Download source file
              </a>` : ''}
          </div>` : ''}

        <div id="activity-action-area" style="margin-top:18px"></div>
      </div>
    </article>

    <div id="reflections-area"></div>

    ${isOwner ? `<div class="section-title">
      <h2>Organizer tools</h2>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <button class="btn ghost" data-nav="#/activity/${esc(id)}/dashboard"><i class="fa-solid fa-chart-simple"></i> Dashboard</button>
      <button class="btn ghost" id="cancel-activity"><i class="fa-solid fa-ban"></i> Cancel activity</button>
    </div>` : ''}
  `;

  on(container, 'click', '[data-nav]', (_ev, el) => navigate(el.dataset.nav));
  on(container, 'click', '[data-act="detail-map-checkin"]', async () => {
    await runCheckinFlow(activity);
  });

  // Preview map with meetup pin + 50m circle + optional route
  (async () => {
    try {
      const prevEl = $('#meetup-preview', container);
      if (!prevEl || activity.meetup_lat == null) { prevEl && (prevEl.style.display = 'none'); return; }
      const center = [activity.meetup_lat, activity.meetup_lng];
      const map = await createMap(prevEl, { center, zoom: 16 });
      const L = await whenLeafletReady();
      L.marker(center, { title: activity.meetup_name || 'Meetup' }).addTo(map);
      L.circle(center, {
        radius: CHECK_IN_RADIUS_M,
        color: '#F97316', weight: 2, fillColor: '#F97316', fillOpacity: 0.14,
      }).addTo(map);
      if (activity.route_geojson) {
        await addRouteGeoJson(map, activity.route_geojson, {
          color: '#F97316',
          weight: 4,
          opacity: 0.9,
          fit: true,
          fitPadding: [24, 24],
        });
      }
    } catch { /* non-fatal */ }
  })();

  const area = $('#activity-action-area', container);
  if (activity.status === 'cancelled') {
    area.innerHTML = `<div class="empty"><i class="fa-solid fa-ban"></i><h3>This activity was cancelled</h3><p>Keep an eye on your club for the next one.</p></div>`;
  } else if (isPast) {
    await renderReflectionsArea(container, activity, reg, { user });
  } else if (!registered) {
    renderRegisterForm(area, activity, counts, isFull);
  } else {
    renderRegisteredInfoState(area, activity, reg);
  }

  if (isOwner) {
    $('#cancel-activity', container)?.addEventListener('click', async () => {
      if (!await confirmDialog({
        title: 'Cancel this activity?', danger: true, confirmText: 'Cancel activity',
        message: 'All registrations will be notified. You can\'t undo this.',
      })) return;
      try { await api.cancelActivity(id); toast('Activity cancelled', { kind: 'success' }); navigate('#/discover'); }
      catch (err) { toast(err.message, { kind: 'error' }); }
    });
  }
}

/** PRD §4.2.a — Not registered · pick group + Register CTA. */
function renderRegisterForm(area, activity, counts, isFull) {
  const groupChoices = Array.isArray(activity.groups) ? activity.groups : [];
  const options = groupChoices.length
    ? groupChoices.map((g, i) => {
        const cap = g.cap;
        const used = counts.byGroup.get(g.name) ?? 0;
        const groupFull = cap != null && used >= cap;
        return `
          <label class="card card-compact" style="display:flex;align-items:center;gap:10px;cursor:${groupFull ? 'not-allowed' : 'pointer'};margin-top:${i?8:0}px;${groupFull?'opacity:0.5':''}">
            <input type="radio" name="group" value="${esc(g.name)}" ${i===0?'checked':''} ${groupFull?'disabled':''} style="accent-color:var(--brand)" />
            <div style="flex:1">
              <div style="font-weight:700;color:var(--ink-900)">${esc(g.name)}</div>
              ${cap != null ? `<div style="color:var(--ink-500);font-size:12px">${used}/${cap}${groupFull ? ' · Full' : ''}</div>` : ''}
            </div>
            ${groupFull ? `<span class="chip danger">Full</span>` : ''}
          </label>`;
      }).join('')
    : '';
  area.innerHTML = `
    ${isFull ? `<div class="empty" style="margin-bottom:12px"><i class="fa-solid fa-users"></i><h3>This activity is full</h3><p>Cancellations release seats on a first-come basis.</p></div>` : ''}
    <form id="register-form">
      ${options ? `<div style="margin-bottom:12px">
        <div style="font-weight:700;color:var(--ink-900);margin-bottom:8px">Pick a group</div>
        ${options}
      </div>` : ''}
      <button class="btn block lg" type="submit" ${isFull ? 'disabled' : ''}>
        <i class="fa-solid fa-right-to-bracket"></i> Register
      </button>
    </form>`;
  const form = $('#register-form', area);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const group = new FormData(form).get('group');
    try {
      await api.register({ activityId: activity.id, groupName: group });
      toast('Registered. See you there!', { kind: 'success' });
      navigate(`#/activity/${activity.id}`);
    } catch (err) { toast(err.message, { kind: 'error' }); }
  });
}

/** PRD §4.2.b — Registered: informational, NO check-in affordance. */
function renderRegisteredInfoState(area, activity, reg) {
  const now = new Date();
  const canCancel = reg.status === 'registered' && now < new Date(activity.start_at);
  const isCheckedIn = reg.status === 'checked_in' || reg.status === 'late';

  area.innerHTML = `
    <div class="card card-compact" style="background:${isCheckedIn ? 'var(--accent-soft)' : 'var(--brand-soft)'};border-color:${isCheckedIn ? 'rgba(34,197,94,0.35)' : 'rgba(249,115,22,0.35)'}">
      <div style="color:${isCheckedIn ? 'var(--accent-dark)' : 'var(--brand-dark)'};font-weight:700">
        <i class="fa-solid fa-${isCheckedIn ? 'circle-check' : 'circle-check'}"></i>
        ${isCheckedIn
          ? `You're checked in${reg.status === 'late' ? ' · Late' : ''}.`
          : `You're registered${reg.group_name ? ` in <b>${esc(reg.group_name)}</b>` : ''}.`}
      </div>
      <div style="color:var(--ink-500);font-size:12.5px;margin-top:6px">
        ${isCheckedIn
          ? `Method: ${esc(reg.checkin_method || 'gps')} · ${esc(fmtTime(reg.checkin_ts))}`
          : 'You can tap Map check-in directly below the meetup map on this page when you arrive.'}
      </div>
    </div>

    ${isCheckedIn ? `
      <button class="btn block" style="margin-top:12px" data-nav="#/running">
        <i class="fa-solid fa-play"></i> Go run
      </button>` : `
      <button class="btn block" style="margin-top:12px" data-nav="#/my-activities">
        <i class="fa-regular fa-calendar"></i> View in My registrations
      </button>`}

    ${canCancel ? `
      <button class="btn ghost block" style="margin-top:8px" id="cancel-my-reg">
        <i class="fa-solid fa-ban"></i> Cancel registration
      </button>` : ''}
  `;
  $('#cancel-my-reg', area)?.addEventListener('click', async () => {
    if (!await confirmDialog({
      title: 'Cancel registration?',
      message: 'You\'ll lose your spot. You can register again while capacity lasts.',
      danger: true, confirmText: 'Yes, cancel',
    })) return;
    try { await api.cancelRegistration(activity.id); toast('Registration cancelled', { kind: 'info' }); navigate(`#/activity/${activity.id}`); }
    catch (err) { toast(err.message, { kind: 'error' }); }
  });
}

/* =================================================================
   Reflections section — fixed 7-emoji preset + counts + list
   ================================================================= */

async function renderReflectionsArea(container, activity, myReg, { user }) {
  const area = $('#activity-action-area', container);
  const canPost = myReg && (myReg.status === 'checked_in' || myReg.status === 'late');

  area.innerHTML = `
    <div class="section-title"><h2>Reflections</h2><span class="count" id="refl-count">—</span></div>
    <div id="emoji-row-wrap"></div>
    <div id="reflection-composer" ${canPost ? '' : 'hidden'}></div>
    ${canPost ? '' : `<div class="card card-compact" style="background:var(--ink-50)"><i class="fa-regular fa-comment-dots" style="color:var(--ink-400)"></i> <span style="color:var(--ink-500);font-size:13px">Check in on Discover → My registrations to react and post a reflection.</span></div>`}
    <div id="reflections-list" style="margin-top:12px"></div>
  `;

  let reflections = [];
  try { reflections = await api.listActivityReflections(activity.id); } catch {}

  // Counts per emoji
  const counts = Object.fromEntries(EMOJI_PRESET.map(e => [e, 0]));
  let myEmoji = null;
  for (const r of reflections) {
    if (counts[r.emoji] != null) counts[r.emoji] += 1;
    if (r.user_id === user?.id) myEmoji = r.emoji;
  }
  $('#refl-count', area).textContent = `${reflections.length}`;

  // Emoji reaction row
  const wrap = $('#emoji-row-wrap', area);
  wrap.innerHTML = `
    <div class="emoji-row" role="group" aria-label="React">
      ${EMOJI_PRESET.map(e => `
        <button type="button" data-emoji="${e}"
                class="${myEmoji === e ? 'selected' : ''}"
                ${canPost ? '' : 'disabled'}
                aria-label="React ${e}">
          <span>${e}</span>
          <span class="count">${counts[e]}</span>
        </button>`).join('')}
    </div>`;

  on(wrap, 'click', '[data-emoji]', async (_ev, btn) => {
    if (!canPost) return;
    const emoji = btn.dataset.emoji;
    const textarea = area.querySelector('#refl-note');
    const existing = reflections.find(r => r.user_id === user?.id);
    try {
      const next = existing && existing.emoji === emoji ? null : emoji;
      if (next == null) {
        // Toggle off — delete their reflection if they had one
        // We don't have a dedicated delete endpoint; upsert with a sentinel
        // isn't ideal. Instead we upsert with keep their note and swap emoji
        // back to '' (but schema requires emoji not null). Simplest: re-post
        // same emoji as 'none' marker — keep UX simple: tapping same emoji removes
        // by saving a neutral '' — but NOT NULL forbids that. So we set to  '👋'
        // as the documented neutral. Use a DB delete instead for cleanliness.
        const { supabase } = await import('./supabase.js');
        await supabase.from('reflections')
          .delete().eq('activity_id', activity.id).eq('user_id', user.id);
      } else {
        await api.upsertReflection({
          activityId: activity.id,
          emoji: next,
          note: existing?.note || (textarea?.value.trim() ?? ''),
        });
      }
      await renderReflectionsArea(container, activity, myReg, { user });
    } catch (err) { toast(err.message, { kind: 'error' }); }
  });

  // Text composer
  const composer = $('#reflection-composer', area);
  if (canPost) {
    const existingNote = reflections.find(r => r.user_id === user?.id)?.note || '';
    composer.innerHTML = `
      <div class="field" style="margin-top:10px;margin-bottom:8px">
        <label for="refl-note">Share how it felt (optional, ≤ 200 chars)</label>
        <textarea id="refl-note" maxlength="200" placeholder="Pace, weather, the post-run coffee…">${esc(existingNote)}</textarea>
        <div class="hint" id="refl-count-live">${existingNote.length} / 200</div>
      </div>
      <button class="btn block" id="save-reflection">
        <i class="fa-solid fa-paper-plane"></i> ${existingNote ? 'Update reflection' : 'Post reflection'}
      </button>`;
    const ta = $('#refl-note', composer);
    ta.addEventListener('input', () => {
      $('#refl-count-live', composer).textContent = `${ta.value.length} / 200`;
    });
    $('#save-reflection', composer).addEventListener('click', async () => {
      const note = ta.value.trim();
      const emoji = myEmoji ?? '💪'; // default if user hasn't reacted yet
      try {
        await api.upsertReflection({ activityId: activity.id, emoji, note: note || null });
        toast('Reflection saved', { kind: 'success' });
        await renderReflectionsArea(container, activity, myReg, { user });
      } catch (err) { toast(err.message, { kind: 'error' }); }
    });
  }

  // Reflection list — viewer's pinned on top
  const listBox = $('#reflections-list', area);
  const sorted = [
    ...reflections.filter(r => r.user_id === user?.id),
    ...reflections.filter(r => r.user_id !== user?.id),
  ];
  listBox.innerHTML = sorted.length
    ? sorted.map(r => `
        <div class="card card-compact" style="${r.user_id === user?.id ? 'border-color: rgba(249,115,22,0.3)' : ''}">
          <div style="display:flex;align-items:center;gap:10px">
            ${avatarHtml(r.user, { size: 'sm' })}
            <div style="flex:1;min-width:0">
              <div style="font-weight:700;color:var(--ink-900)">${esc(r.user?.display_name || 'Runner')}</div>
              <div style="color:var(--ink-500);font-size:12px">${esc(fmtDate(r.created_at))}${r.user_id === user?.id ? ' · You' : ''}</div>
            </div>
            <div style="font-size:22px">${esc(r.emoji)}</div>
          </div>
          ${r.note ? `<p style="margin:8px 0 0;color:var(--ink-700);font-size:13.5px;line-height:1.5">${esc(r.note)}</p>` : ''}
        </div>`).join('')
    : `<div class="empty"><i class="fa-regular fa-comment-dots"></i><h3>Be the first to share</h3><p>How did this activity feel?</p></div>`;
}

/* =================================================================
   MY ACTIVITIES — full-screen, Upcoming / Past tabs
   ================================================================= */

export async function renderMyActivities(container) {
  setHeader({ title: 'My activities', backTo: '#/discover' });
  container.innerHTML = `
    <div class="tabs-pill">
      <button class="pill-tab active" data-tab="upcoming">Upcoming</button>
      <button class="pill-tab" data-tab="past">Past</button>
    </div>
    <div id="list"></div>
  `;
  const listBox = $('#list', container);
  let active = 'upcoming';
  const runsByActivity = await api.myRunsByActivity();

  async function load() {
    showLoading(listBox, 3);
    const regs = await api.listMyRegistrations({ timeframe: active });
    if (!regs.length) {
      listBox.innerHTML = `<div class="empty"><i class="fa-regular fa-calendar"></i>
        <h3>${active === 'upcoming' ? 'No upcoming activities' : 'Nothing here yet'}</h3>
        <p>${active === 'upcoming' ? 'Discover one on Discover.' : 'Your first finished activity will show up here.'}</p>
        ${active === 'upcoming' ? '<button class="btn" data-nav="#/discover">Browse activities</button>' : ''}
      </div>`;
      return;
    }
    listBox.innerHTML = regs.map(r => myActivityCard(r, runsByActivity)).join('');
    bindActivityCards(listBox);
    bindRegCardActions(listBox);
  }

  on(container, 'click', '[data-tab]', (_ev, btn) => {
    container.querySelectorAll('[data-tab]').forEach(t => t.classList.toggle('active', t === btn));
    active = btn.dataset.tab;
    load();
  });
  on(container, 'click', '[data-nav]', (_ev, el) => navigate(el.dataset.nav));
  load();
}

function myActivityCard(r, runsByActivity) {
  const a = r.activity;
  if (!a) return '';
  const isPast = new Date(a.end_at) < new Date();
  const checkedIn = r.status === 'checked_in' || r.status === 'late';
  const hasRun = (runsByActivity?.get?.(a.id) ?? 0) > 0;

  let badge = '';
  if (r.status === 'cancelled') {
    badge = `<span class="chip danger">Cancelled</span>`;
  } else if (isPast) {
    if (checkedIn && hasRun) badge = `<span class="chip success">Completed</span>`;
    else if (checkedIn)      badge = `<span class="chip ghost">Checked in · no run recorded</span>`;
    else                     badge = `<span class="chip warn">Missed</span>`;
  } else {
    const now = new Date();
    const ws = a.checkin_window_start ? new Date(a.checkin_window_start) : null;
    const we = a.checkin_window_end   ? new Date(a.checkin_window_end)   : null;
    if (checkedIn)                          badge = `<span class="chip success">Checked in${r.status === 'late' ? ' · Late' : ''}</span>`;
    else if (ws && we && now >= ws && now <= we) badge = `<span class="chip accent">Check-in open</span>`;
    else if (now >= new Date(a.start_at))   badge = `<span class="chip warn">Live</span>`;
    else                                    badge = `<span class="chip brand">Upcoming</span>`;
  }

  return activityCard(a, { badge });
}

/* =================================================================
   RUNNING tab · preview + Activity-route picker + real-time recorder
   ================================================================= */

// Module-level state so pressing Pause doesn't lose the recorder.
let runState = null;

export async function renderRunning(container) {
  setHeader({ title: 'Running' });
  if (runState) return renderRunRecording(container);

  // All activities the user has checked in for (upcoming + past)
  const regs = await api.listMyRegistrations({ timeframe: 'upcoming' });
  const pickable = regs
    .filter(r => (r.status === 'checked_in' || r.status === 'late') && r.activity)
    .map(r => r.activity);

  const hasManualLinkedActivity = Object.prototype.hasOwnProperty.call(window, '__runLinkedActivity');
  const picked = hasManualLinkedActivity
    ? window.__runLinkedActivity
    : (pickable[0] || null);
  return renderRunPreview(container, { picked, pickable });
}

async function renderRunPreview(container, { picked, pickable }) {
  const activity = picked;
  const clubName = activity?.club?.name || '';
  const meta = activity
    ? `${esc(clubName)}${clubName ? ' · ' : ''}${esc(fmtTime(activity.start_at))}`
    : '';

  container.innerHTML = `
    <div class="run-fullbleed">
      <div id="run-map" class="run-map" aria-label="Map of the meetup"></div>

      <!-- Top bar -->
      <div class="run-topbar">
        <div aria-hidden="true"></div>
        <button class="route-square ${activity ? 'has-route' : ''}"
                id="pick-route"
                title="Activity route" aria-label="Activity route">
          <i class="fa-solid fa-route"></i>
          ${activity ? '<span class="route-dot" aria-hidden="true"></span>' : ''}
        </button>
      </div>

      <!-- Activity summary (only when linked) -->
      ${activity ? `
        <div class="activity-summary glass">
          ${avatarHtml(activity.club, { size: 'sm' })}
          <div style="min-width:0;flex:1">
            <div class="title">${esc(activity.title)}</div>
            <div class="sub">${meta}</div>
          </div>
          <button class="x" id="clear-route" aria-label="Clear linked activity">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>` : ''}

      <!-- Right-edge floating controls -->
      <div class="map-fabs">
        <button class="map-fab primary" id="fab-locate" aria-label="Locate me">
          <i class="fa-solid fa-location-crosshairs"></i>
        </button>
        <button class="map-fab" id="fab-zoom-in" aria-label="Zoom in">
          <i class="fa-solid fa-plus"></i>
        </button>
        <button class="map-fab" id="fab-zoom-out" aria-label="Zoom out">
          <i class="fa-solid fa-minus"></i>
        </button>
      </div>

      <!-- Start panel -->
      <div class="start-panel glass">
        <div class="stats-row">
          <div class="stat-tile">
            <div class="stat-value">0.00</div>
            <div class="stat-label">Kilometers</div>
          </div>
          <div class="stat-tile">
            <div class="stat-value">—’—”</div>
            <div class="stat-label">Avg Pace</div>
          </div>
          <div class="stat-tile">
            <div class="stat-value">0:00</div>
            <div class="stat-label">Duration</div>
          </div>
        </div>

        <button class="big-start" id="start-run" aria-label="Start run">START</button>

        <div class="status-strip">
          <span><i class="fa-solid fa-circle-dot ok"></i><span id="gps-status">Locating…</span></span>
          <span>
            <a href="#/my-activities" style="color:rgba(255,255,255,0.78);text-decoration:none;margin-right:12px">
              <i class="fa-regular fa-calendar"></i> Activities
            </a>
            <a href="#/stats" style="color:rgba(255,255,255,0.78);text-decoration:none">
              <i class="fa-solid fa-chart-simple"></i> Stats
            </a>
          </span>
        </div>
      </div>

      <div class="run-attr">
        &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OSM</a>
        &middot; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>
      </div>
    </div>`;

  // Route square → picker modal
  $('#pick-route', container).addEventListener('click', () => openRoutePicker(container, pickable));
  $('#clear-route', container)?.addEventListener('click', () => {
    window.__runLinkedActivity = null;
    renderRunning(container);
  });

  // Map
  const mapEl = $('#run-map', container);
  let map, L;
  try {
    L = await whenLeafletReady();
    const center = activity?.meetup_lat ? [activity.meetup_lat, activity.meetup_lng] : undefined;
    map = await createMap(mapEl, {
      center, zoom: center ? 16 : 13, theme: 'dark',
      zoomControl: false, attributionControl: false,
    });

    if (activity?.meetup_lat) {
      L.marker(center, { title: activity.meetup_name || 'Meetup' })
        .addTo(map).bindPopup(esc(activity.meetup_name || 'Meetup'));
      L.circle(center, {
        radius: CHECK_IN_RADIUS_M,
        color: '#22C55E', weight: 1.5, dashArray: '4 4',
        fillColor: '#22C55E', fillOpacity: 0.10,
      }).addTo(map);
    } else {
      // Try to centre on current position
      try {
        const pos = await new Promise((r, j) => navigator.geolocation.getCurrentPosition(
          (p) => r({ lat: p.coords.latitude, lng: p.coords.longitude }), j,
          { enableHighAccuracy: false, timeout: 5000 }));
        map.setView([pos.lat, pos.lng], 15);
        L.circleMarker([pos.lat, pos.lng], {
          radius: 7, color: '#fff', weight: 2, fillColor: '#F97316', fillOpacity: 1,
        }).addTo(map);
      } catch { /* keep default center */ }
    }
    if (activity?.route_geojson) {
      await addRouteGeoJson(map, activity.route_geojson, {
        color: '#FB923C',
        weight: 5,
        opacity: 0.9,
        fit: true,
        fitPadding: [28, 28],
      });
    }
  } catch (err) {
    mapEl.innerHTML =
      `<div class="empty" style="border:0;background:transparent;color:rgba(255,255,255,0.7)">
         <i class="fa-solid fa-map"></i><p>${esc(err.message)}</p>
       </div>`;
  }

  // GPS status probe (non-blocking)
  const gpsEl = $('#gps-status', container);
  if (gpsEl) {
    if (!('geolocation' in navigator)) { gpsEl.textContent = 'GPS unavailable'; }
    else {
      navigator.geolocation.getCurrentPosition(
        () => { gpsEl.textContent = 'GPS ready'; },
        () => { gpsEl.textContent = 'GPS waiting…'; },
        { enableHighAccuracy: true, timeout: 4000, maximumAge: 0 },
      );
    }
  }

  // Map FABs
  $('#fab-locate', container).addEventListener('click', async () => {
    if (!map || !L) return;
    try {
      const pos = await new Promise((r, j) => navigator.geolocation.getCurrentPosition(
        (p) => r({ lat: p.coords.latitude, lng: p.coords.longitude }), j,
        { enableHighAccuracy: true, timeout: 7000 }));
      map.setView([pos.lat, pos.lng], 16, { animate: true });
    } catch {
      toast('Could not locate you.', { kind: 'warn' });
    }
  });
  $('#fab-zoom-in',  container).addEventListener('click', () => map?.setZoom((map.getZoom() || 13) + 1));
  $('#fab-zoom-out', container).addEventListener('click', () => map?.setZoom((map.getZoom() || 13) - 1));

  $('#start-run', container).addEventListener('click', () => startRun(container, activity));
}

function openRoutePicker(container, pickable) {
  openModal((close) => {
    const el = document.createElement('div');
    el.innerHTML = `
      <h3>Pick activity route</h3>
      <p>Only activities you've checked in for show up here. Free run = no activity route.</p>
      <button class="btn ghost block" style="margin-bottom:10px" data-pick="none">
        <i class="fa-solid fa-shoe-prints"></i> None · free run
      </button>
      ${pickable.length
        ? pickable.map(a => `
          <button class="card interactive" data-pick="${esc(a.id)}" style="display:block;width:100%;text-align:left;border:0">
            <div style="display:flex;gap:10px;align-items:center">
              ${avatarHtml(a.club, { size: 'sm' })}
              <div style="flex:1">
                <div style="font-weight:700;color:var(--ink-900)">${esc(a.title)}</div>
                <div style="color:var(--ink-500);font-size:12px">${esc(a.club?.name || '')} · ${esc(fmtTime(a.start_at))}</div>
              </div>
              <i class="fa-solid fa-chevron-right" style="color:var(--ink-400)"></i>
            </div>
          </button>`).join('')
        : `<div class="empty" style="margin-top:6px"><i class="fa-regular fa-calendar-check"></i><p>No checked-in activities yet.<br>Check in from Discover to unlock.</p></div>`}
      <div class="actions" style="margin-top:14px"><button class="btn ghost" data-act="cancel">Close</button></div>
    `;
    el.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.pick;
      window.__runLinkedActivity = id === 'none' ? null : pickable.find(a => a.id === id) || null;
      close();
      renderRunning(container);
    }));
    el.querySelector('[data-act="cancel"]').addEventListener('click', () => close());
    return el;
  });
}

async function startRun(container, activity) {
  runState = {
    startedAt: new Date(),
    duration_s: 0,
    distance_m: 0,
    activity,
    recorder: null,
    useMock: false,
    paused: false,
    timer: null,
  };
  renderRunRecording(container);

  const mapEl = $('#run-map', container);
  const meetup = activity?.meetup_lat != null
    ? { lat: activity.meetup_lat, lng: activity.meetup_lng } : null;

  try {
    runState.recorder = await runRecorder(mapEl, {
      meetup,
      radius: CHECK_IN_RADIUS_M,
      theme: 'dark',
      routeGeoJson: activity?.route_geojson || null,
    });
  } catch (err) {
    toast('Map failed to load — recording a time-only run.', { kind: 'warn' });
  }

  let simulateNoticeShown = false;
  const switchToMock = (reason) => {
    if (runState.useMock) return;
    runState.useMock = true;
    if (!simulateNoticeShown) {
      simulateNoticeShown = true;
      toast(`${reason} — simulating the run.`, { kind: 'warn', duration: 3200 });
    }
  };

  try {
    runState.recorder?.start({
      onError: (err) => {
        if (runState.recorder.getPoints().length === 0) {
          switchToMock(
            err?.code === 1 ? 'Location permission denied'
            : err?.code === 3 ? 'Location timed out'
            : 'Location unavailable'
          );
        }
      },
    });
  } catch (err) {
    switchToMock(err.message || 'No GPS');
  }

  runState.timer = setInterval(() => {
    if (runState.paused) return;
    runState.duration_s += 1;

    const slot = document.getElementById('sim-badge-slot');
    if (slot && runState.useMock && !slot.childElementCount) {
      slot.innerHTML = '<div class="chip warn"><i class="fa-solid fa-flask"></i> simulated GPS</div>';
    }

    if (runState.useMock) {
      runState.recorder?.simulateStep();
      runState.distance_m = runState.recorder?.getDistanceMeters() ?? (runState.distance_m + 3.2);
    } else if (runState.recorder) {
      runState.distance_m = runState.recorder.getDistanceMeters();
      if (runState.duration_s >= 12 && runState.recorder.getPoints().length === 0) {
        switchToMock('No GPS fix after 12 s');
      }
      // GPS quality hint
      const gpsEl = document.getElementById('gps-quality');
      if (gpsEl && runState.recorder.getFilterStats) {
        const { accepted, rejected } = runState.recorder.getFilterStats();
        const ratio = accepted + rejected > 0 ? accepted / (accepted + rejected) : 1;
        if (ratio >= 0.7) gpsEl.textContent = 'GPS: good';
        else if (ratio >= 0.3) gpsEl.textContent = 'GPS: fair';
        else gpsEl.textContent = 'GPS: poor';
      }
    }

    const tEl = $('#run-timer');    if (tEl) tEl.textContent = fmtDuration(runState.duration_s);
    const dEl = $('#run-distance'); if (dEl) dEl.textContent = fmtDistance(runState.distance_m);
    const pEl = $('#run-pace');
    if (pEl && runState.distance_m > 50) {
      pEl.textContent = fmtPace(Math.round((runState.duration_s * 1000) / runState.distance_m));
    }
    const cEl = $('#run-cal');
    if (cEl && runState.distance_m > 0) {
      // ≈ 60 kcal per km for an average adult (rough visual estimate).
      cEl.textContent = String(Math.round(runState.distance_m * 0.06));
    }
  }, 1000);
}

function renderRunRecording(container) {
  const { activity, useMock } = runState;
  const clubName = activity?.club?.name || '';
  const metaLine = activity
    ? `${esc(clubName)}${clubName ? ' · ' : ''}Route locked for this session`
    : '';

  container.innerHTML = `
    <div class="run-fullbleed">
      <div id="run-map" class="run-map" aria-label="Live running map"></div>

      <!-- Top bar: Running + REC pill + locked route square -->
      <div class="run-topbar">
        <h1 class="run-title">
          <span class="rec-dot"><span class="dot"></span> Recording</span>
          <span id="sim-badge-slot"></span>
          <span id="gps-quality" style="font-size:11px;color:rgba(255,255,255,0.6);margin-left:8px;"></span>
        </h1>
        <button class="route-square locked" disabled
                aria-label="Activity route (locked during run)">
          <i class="fa-solid fa-route"></i>
          ${activity ? '<span class="lock"><i class="fa-solid fa-lock"></i></span>' : ''}
        </button>
      </div>

      ${activity ? `
        <div class="activity-summary glass">
          ${avatarHtml(activity.club, { size: 'sm' })}
          <div style="min-width:0;flex:1">
            <div class="title">${esc(activity.title)}</div>
            <div class="sub">${metaLine}</div>
          </div>
        </div>` : ''}

      <div class="map-fabs">
        <button class="map-fab primary" id="fab-locate" aria-label="Recenter">
          <i class="fa-solid fa-location-crosshairs"></i>
        </button>
        <button class="map-fab" id="fab-zoom-in" aria-label="Zoom in">
          <i class="fa-solid fa-plus"></i>
        </button>
        <button class="map-fab" id="fab-zoom-out" aria-label="Zoom out">
          <i class="fa-solid fa-minus"></i>
        </button>
      </div>

      <div class="resilience-hint">
        <i class="fa-solid fa-shield-halved"></i>
        Recording in background · your distance is saved even if the tab freezes
      </div>

      <div class="rec-panel glass">
        <div class="rec-distance">
          <span id="run-distance">${fmtDistance(runState.distance_m)}</span>
          <small>Kilometers</small>
        </div>
        <div class="rec-mid">
          <div class="stat-tile">
            <div class="stat-value" id="run-pace">—’—”</div>
            <div class="stat-label">Avg Pace</div>
          </div>
          <div class="stat-tile">
            <div class="stat-value" id="run-timer">${fmtDuration(runState.duration_s)}</div>
            <div class="stat-label">Duration</div>
          </div>
          <div class="stat-tile">
            <div class="stat-value" id="run-cal">—</div>
            <div class="stat-label">Kcal</div>
          </div>
        </div>
        <div class="rec-ctrl">
          <button class="ctrl-btn" id="pause-run"
                  aria-label="${runState.paused ? 'Resume' : 'Pause'}"
                  title="${runState.paused ? 'Resume' : 'Pause'}">
            <i class="fa-solid fa-${runState.paused ? 'play' : 'pause'}" id="pause-icon"></i>
          </button>
          <button class="end-btn" id="stop-run" aria-label="Finish and save the run">END</button>
          <button class="ctrl-btn" id="lap-run" aria-label="Mark a lap" title="Mark a lap">
            <i class="fa-solid fa-flag"></i>
          </button>
        </div>
      </div>

      <div class="run-attr">
        &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OSM</a>
        &middot; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>
      </div>
    </div>`;

  // Simulated-GPS chip
  const slot = $('#sim-badge-slot', container);
  if (useMock && slot) {
    slot.innerHTML = '<span class="sim-chip"><i class="fa-solid fa-flask"></i> Sim GPS</span>';
  }

  // Map FABs
  $('#fab-locate', container).addEventListener('click', () => runState?.recorder?.recenter());
  $('#fab-zoom-in',  container).addEventListener('click', () => runState?.recorder?.zoomIn());
  $('#fab-zoom-out', container).addEventListener('click', () => runState?.recorder?.zoomOut());

  // Lap (visual-only nudge — we don't persist laps yet)
  $('#lap-run', container).addEventListener('click', () => {
    toast(`Lap @ ${fmtDistance(runState.distance_m)}`, { kind: 'info', duration: 2200 });
  });

  $('#pause-run', container).addEventListener('click', () => {
    runState.paused = !runState.paused;
    const icon = $('#pause-icon', container);
    if (icon) icon.className = `fa-solid fa-${runState.paused ? 'play' : 'pause'}`;
    toast(runState.paused ? 'Paused' : 'Resumed', { kind: 'info' });
  });

  $('#stop-run', container).addEventListener('click', async () => {
    if (runState.timer) clearInterval(runState.timer);
    runState.recorder?.stop();
    const snap = { ...runState };
    runState = null;
    if (snap.distance_m < 100) {
      toast('Run too short, discarded.', { kind: 'warn' });
      return renderRunning(container);
    }
    try {
      await api.saveRun({
        activityId: snap.activity?.id ?? null,
        distance_m: Math.round(snap.distance_m),
        duration_s: snap.duration_s,
        started_at: snap.startedAt.toISOString(),
        ended_at:   new Date().toISOString(),
        polyline:   snap.recorder?.getPolyline() || null,
      });
      toast(`Saved: ${fmtDistance(snap.distance_m)} in ${fmtDuration(snap.duration_s)}`,
        { kind: 'success', duration: 4000 });
    } catch (err) {
      toast('Save failed: ' + err.message, { kind: 'error' });
    }
    navigate('#/stats');
  });
}

/* =================================================================
   COMMUNITY tab
   ================================================================= */

export async function renderCommunity(container) {
  setHeader({ title: 'Community' });
  const clubs = await api.listClubs({ mineOnly: true });
  const user = await api.getCurrentUser();

  // PRD §4.4 — Discover clubs empty state.
  if (!clubs.length) {
    container.innerHTML = `
      <div class="empty" style="margin-top:20px">
        <i class="fa-solid fa-people-group"></i>
        <h3>Find your people</h3>
        <p>Join a public club or create your own to unlock activities, albums, and monthly rankings.</p>
        <div style="display:flex;gap:8px;justify-content:center">
          <button class="btn" data-nav="#/clubs">Browse nearby clubs</button>
          <button class="btn ghost" data-nav="#/clubs">Create your own</button>
        </div>
      </div>`;
    on(container, 'click', '[data-nav]', (_ev, el) => navigate(el.dataset.nav));
    return;
  }

  const active = clubs[0];
  const isOwner = active.owner_id === user?.id;
  container.innerHTML = `
    <div class="club-header">
      <div class="crest" style="background-image:url('${esc(active.crest_url || '')}')"></div>
      <div style="flex:1;min-width:0">
        <div class="name">${esc(active.name)}</div>
        <div class="sub">${esc(active.description || '')}</div>
      </div>
      ${clubs.length > 1 ? `<button class="icon-btn neutral" data-nav="#/clubs" title="Switch club"><i class="fa-solid fa-repeat"></i></button>` : ''}
      <button class="icon-btn neutral" id="club-overflow" title="Club options"><i class="fa-solid fa-ellipsis"></i></button>
    </div>

    <div class="section-title">
      <h2>Activities</h2>
      ${isOwner ? `<button class="link" id="new-activity-btn">＋ New</button>` : ''}
    </div>
    <div id="club-activities"></div>

    <div class="section-title"><h2>Monthly mileage</h2><span class="count" id="lb-count">—</span></div>
    <div id="leaderboard"></div>

    <div class="section-title"><h2>Members</h2><span class="count" id="mem-count">—</span></div>
    <div id="members"></div>
  `;
  on(container, 'click', '[data-nav]', (_ev, el) => navigate(el.dataset.nav));
  $('#new-activity-btn', container)?.addEventListener('click', () => navigate(`#/club/${active.id}/publish`));
  $('#club-overflow', container).addEventListener('click', () => openClubOverflow(active, isOwner, () => renderCommunity(container)));

  // Activities
  const actBox = $('#club-activities', container);
  showLoading(actBox, 2);
  const acts = await api.listActivities({ clubId: active.id, timeframe: 'upcoming' });
  actBox.innerHTML = acts.length
    ? acts.map(a => activityCard(a)).join('')
    : `<div class="empty"><i class="fa-regular fa-calendar"></i><p>No upcoming activities in this club.</p></div>`;
  bindActivityCards(actBox);

  // Leaderboard
  const lbBox = $('#leaderboard', container);
  const rows = await api.listLeaderboard({ clubId: active.id });
  $('#lb-count', container).textContent = rows.length ? `${rows.length} runners this month` : 'No runs yet';
  lbBox.innerHTML = rows.length
    ? rows.map((r, i) => {
        const t = tier(r.total_distance_m);
        const isMe = r.user_id === user?.id;
        return `
          <div class="leader-row ${isMe ? 'me' : ''}">
            <div class="rank rank-${Math.min(i + 1, 3)}">${i + 1}</div>
            <div class="who">
              ${avatarHtml(r, { size: 'sm' })}
              <div class="name">${esc(r.display_name || 'Runner')}${isMe ? ' (you)' : ''}</div>
              <span class="trophy" title="${esc(t.name)}">${t.emoji}</span>
            </div>
            <div class="dist">${(r.total_distance_m / 1000).toFixed(1)} km</div>
          </div>`;
      }).join('')
    : `<div class="empty"><i class="fa-solid fa-medal"></i><p>No runs logged yet this month — be the first to kick it off.</p></div>`;

  // Members
  const memBox = $('#members', container);
  const members = await api.listClubMembers(active.id);
  $('#mem-count', container).textContent = `${members.length}`;
  memBox.innerHTML = `
    <div class="card card-compact" style="display:flex;flex-wrap:wrap;gap:8px">
      ${members.map(m => `
        <div style="display:flex;align-items:center;gap:8px;padding:4px 10px 4px 4px;background:var(--ink-100);border-radius:999px">
          ${avatarHtml(m.profile, { size: 'sm' })}
          <span style="font-size:13px;font-weight:600">${esc(m.profile?.display_name || 'Runner')}</span>
          ${m.role !== 'member' ? `<span class="chip brand" style="padding:0 8px;font-size:10px">${esc(m.role.replace('_',' '))}</span>` : ''}
        </div>`).join('')}
    </div>`;
}

function openClubOverflow(club, isOwner, refresh) {
  openModal((close) => {
    const el = document.createElement('div');
    el.innerHTML = `
      <h3>${esc(club.name)}</h3>
      <p>Manage your club.</p>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${isOwner ? `
          <button class="btn ghost block" data-act="manage-co"><i class="fa-solid fa-user-shield"></i> Manage Co-organizers</button>
          <button class="btn ghost block" data-act="transfer"><i class="fa-solid fa-right-left"></i> Transfer ownership</button>
          <button class="btn ghost block" data-act="delete" style="color:var(--danger)"><i class="fa-solid fa-trash"></i> Delete club</button>
        ` : `
          <button class="btn ghost block" data-act="leave"><i class="fa-solid fa-right-from-bracket"></i> Leave club</button>
        `}
      </div>
      <div class="actions" style="margin-top:10px"><button class="btn ghost" data-act="cancel">Close</button></div>`;
    el.querySelector('[data-act="cancel"]').addEventListener('click', () => close());
    el.querySelector('[data-act="transfer"]')?.addEventListener('click', () => { close(); openTransferOwnership(club, refresh); });
    el.querySelector('[data-act="delete"]')?.addEventListener('click', () => { close(); openDeleteClub(club, refresh); });
    el.querySelector('[data-act="manage-co"]')?.addEventListener('click', () => { close(); openManageCoorganizers(club, refresh); });
    el.querySelector('[data-act="leave"]')?.addEventListener('click', async () => {
      close();
      if (!await confirmDialog({
        title: 'Leave this club?',
        message: 'You\'ll stop seeing it in My clubs. Past runs and achievements are kept.',
        confirmText: 'Leave',
      })) return;
      try { await api.leaveClub(club.id); toast('Left the club', { kind: 'info' }); refresh(); }
      catch (err) { toast(err.message, { kind: 'error' }); }
    });
    return el;
  });
}

function openTransferOwnership(club, refresh) {
  openModal(async (close) => {
    const members = (await api.listClubMembers(club.id))
      .filter(m => m.profile?.id !== club.owner_id);
    const el = document.createElement('div');
    el.innerHTML = `
      <h3>Transfer ownership</h3>
      <p>Pick the new owner. You'll become a regular member after transfer.</p>
      <div id="mem-list" style="max-height:260px;overflow:auto">
        ${members.length ? members.map(m => `
          <label class="card card-compact" style="display:flex;align-items:center;gap:10px;cursor:pointer">
            <input type="radio" name="new-owner" value="${esc(m.profile.id)}" style="accent-color:var(--brand)" />
            ${avatarHtml(m.profile, { size: 'sm' })}
            <div style="flex:1">
              <div style="font-weight:700">${esc(m.profile.display_name)}</div>
              <div style="color:var(--ink-500);font-size:12px">${esc(m.role.replace('_',' '))}</div>
            </div>
          </label>`).join('') :
          '<div class="empty"><p>No eligible members.</p></div>'}
      </div>
      <div class="field" style="margin-top:12px">
        <label>Type the club name <b>${esc(club.name)}</b> to confirm</label>
        <input id="confirm-input" placeholder="${esc(club.name)}" />
      </div>
      <div class="actions">
        <button class="btn ghost" data-act="cancel">Cancel</button>
        <button class="btn danger" data-act="ok" disabled><i class="fa-solid fa-right-left"></i> Transfer</button>
      </div>`;
    const input = el.querySelector('#confirm-input');
    const okBtn = el.querySelector('[data-act="ok"]');
    const update = () => {
      const picked = el.querySelector('[name=new-owner]:checked');
      okBtn.disabled = !picked || input.value.trim() !== club.name;
    };
    el.querySelectorAll('[name=new-owner]').forEach(r => r.addEventListener('change', update));
    input.addEventListener('input', update);
    el.querySelector('[data-act="cancel"]').addEventListener('click', () => close());
    okBtn.addEventListener('click', async () => {
      const picked = el.querySelector('[name=new-owner]:checked').value;
      try {
        await api.transferClubOwnership({ clubId: club.id, newOwnerId: picked });
        toast('Ownership transferred', { kind: 'success' });
        close(); refresh();
      } catch (err) { toast(err.message, { kind: 'error' }); }
    });
    return el;
  });
}

function openDeleteClub(club, refresh) {
  openModal((close) => {
    const normalize = (s) => (s || '')
      .toString()
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
    const el = document.createElement('div');
    el.innerHTML = `
      <h3 style="color:var(--danger)">Delete club</h3>
      <p>This is irreversible. All club activities, registrations, and reflections for this club are removed. Run history is kept, but linked activities are cleared. Only the owner can delete.</p>
      <div class="field">
        <label>Type the club name <b>${esc(club.name)}</b> to confirm</label>
        <input id="confirm-input" placeholder="${esc(club.name)}" />
      </div>
      <div class="actions">
        <button class="btn ghost" data-act="cancel">Cancel</button>
        <button class="btn danger" data-act="ok" disabled><i class="fa-solid fa-trash"></i> Delete</button>
      </div>`;
    const input = el.querySelector('#confirm-input');
    const okBtn = el.querySelector('[data-act="ok"]');
    input.addEventListener('input', () => {
      okBtn.disabled = normalize(input.value) !== normalize(club.name);
    });
    el.querySelector('[data-act="cancel"]').addEventListener('click', () => close());
    okBtn.addEventListener('click', async () => {
      try {
        await api.deleteClub(club.id);
        toast('Club deleted', { kind: 'info' });
        close(); navigate('#/clubs');
      } catch (err) { toast(err.message, { kind: 'error' }); }
    });
    return el;
  });
}

function openManageCoorganizers(club, refresh) {
  openModal(async (close) => {
    const members = await api.listClubMembers(club.id);
    const el = document.createElement('div');
    el.innerHTML = `
      <h3>Manage Co-organizers</h3>
      <p>Co-organizers can publish activities, mark check-ins, and upload to Album.</p>
      <div style="max-height:320px;overflow:auto">
        ${members.filter(m => m.profile?.id !== club.owner_id).map(m => `
          <div class="card card-compact" style="display:flex;align-items:center;gap:10px">
            ${avatarHtml(m.profile, { size: 'sm' })}
            <div style="flex:1">
              <div style="font-weight:700">${esc(m.profile.display_name)}</div>
              <div style="color:var(--ink-500);font-size:12px">${esc(m.role.replace('_',' '))}</div>
            </div>
            ${m.role === 'co_organizer'
              ? `<button class="btn ghost sm" data-demote="${esc(m.profile.id)}"><i class="fa-solid fa-user-minus"></i> Remove</button>`
              : `<button class="btn sm" data-promote="${esc(m.profile.id)}"><i class="fa-solid fa-user-plus"></i> Appoint</button>`}
          </div>`).join('') || '<div class="empty"><p>No other members yet.</p></div>'}
      </div>
      <div class="actions" style="margin-top:10px"><button class="btn ghost" data-act="close">Close</button></div>
    `;
    el.querySelector('[data-act="close"]').addEventListener('click', () => close());
    el.querySelectorAll('[data-promote]').forEach(b => b.addEventListener('click', async () => {
      try { await api.setMemberRole({ clubId: club.id, userId: b.dataset.promote, role: 'co_organizer' }); toast('Appointed', { kind: 'success' }); close(); refresh(); }
      catch (err) { toast(err.message, { kind: 'error' }); }
    }));
    el.querySelectorAll('[data-demote]').forEach(b => b.addEventListener('click', async () => {
      try { await api.setMemberRole({ clubId: club.id, userId: b.dataset.demote, role: 'member' }); toast('Removed', { kind: 'info' }); close(); refresh(); }
      catch (err) { toast(err.message, { kind: 'error' }); }
    }));
    return el;
  });
}

/* =================================================================
   PROFILE tab
   ================================================================= */

/**
 * Compute a list of achievement medallions from a user's runs.
 * Each entry is { key, name, sub, medal, icon, unlocked }.
 */
function computeAchievements(runs) {
  const totalKm = runs.reduce((s, r) => s + (r.distance_m || 0), 0) / 1000;
  const byDate = (pred) => runs
    .filter(pred)
    .sort((a, b) => new Date(a.started_at) - new Date(b.started_at))[0];

  const first10K = byDate(r => (r.distance_m || 0) >= 10000);
  const first5K  = byDate(r => (r.distance_m || 0) >= 5000);
  const halfM    = byDate(r => (r.distance_m || 0) >= 21097);
  const sub25_5K = byDate(r => (r.distance_m || 0) >= 5000 && (r.duration_s || 0) <= 25 * 60);
  const subFive  = byDate(r => r.avg_pace_s_per_km && r.avg_pace_s_per_km <= 300);
  const nightRun = byDate(r => {
    const h = new Date(r.started_at).getHours();
    return h >= 20 || h < 6;
  });

  // Streak: count how many of the most recent distinct calendar days have a run (cap 7).
  const days = [...new Set(runs.map(r => fmtDate(r.started_at, { withTime: false })))];
  const streak = Math.min(days.length, 7);

  const fmt = (d) => d ? fmtDate(d.started_at, { withTime: false }) : 'Locked';

  return [
    { key: 'first-run', name: 'First run', sub: runs.length ? fmt(runs[runs.length - 1]) : 'Locked',
      medal: 'emerald', icon: 'fa-shoe-prints', unlocked: runs.length >= 1 },
    { key: 'first-5k', name: 'First 5K', sub: fmt(first5K),
      medal: 'bronze', icon: 'fa-person-running', unlocked: !!first5K },
    { key: 'first-10k', name: 'First 10K', sub: fmt(first10K),
      medal: '', icon: 'fa-crown', unlocked: !!first10K },
    { key: 'sub-25-5k', name: 'Sub-25′ 5K', sub: fmt(sub25_5K),
      medal: 'emerald', icon: 'fa-bolt', unlocked: !!sub25_5K },
    { key: 'sub-five', name: 'Sub-5′ pace', sub: fmt(subFive),
      medal: 'sky', icon: 'fa-gauge-high', unlocked: !!subFive },
    { key: 'half-m', name: 'Half-marathon', sub: fmt(halfM),
      medal: 'ruby', icon: 'fa-medal', unlocked: !!halfM },
    { key: 'km-50', name: '50 km total', sub: `${totalKm.toFixed(1)} km`,
      medal: 'silver', icon: 'fa-mountain', unlocked: totalKm >= 50 },
    { key: 'km-100', name: '100 km total', sub: `${totalKm.toFixed(1)} km`,
      medal: '', icon: 'fa-trophy', unlocked: totalKm >= 100 },
    { key: 'night', name: 'Night runner', sub: fmt(nightRun),
      medal: 'silver', icon: 'fa-moon', unlocked: !!nightRun },
    { key: 'streak', name: `Streak ${streak}`, sub: streak ? 'Active' : 'Locked',
      medal: 'bronze', icon: 'fa-fire', unlocked: streak >= 2 },
  ];
}

export async function renderProfile(container) {
  setHeader({ title: 'Profile' });
  const [profile, runs, user, myRegs, myClubs] = await Promise.all([
    api.getMyProfile(),
    api.listMyRuns({ limit: 500 }),
    api.getCurrentUser(),
    api.listMyRegistrations({ timeframe: 'upcoming' }).catch(() => []),
    api.listClubs({ mineOnly: true }).catch(() => []),
  ]);

  const totalM  = runs.reduce((s, r) => s + (r.distance_m || 0), 0);
  const totalS  = runs.reduce((s, r) => s + (r.duration_s || 0), 0);
  const totalKm = totalM / 1000;
  const avgPace = totalM ? Math.round((totalS * 1000) / totalM) : null;
  const t = tier(totalM);

  const ownedClubs = (myClubs || []).filter(c => c.owner_id === user?.id);
  const isOrganizer = ownedClubs.length > 0;
  const handle = user?.email ? '@' + user.email.split('@')[0] : '';

  const upcomingCount = (myRegs || []).length;
  const achievements = computeAchievements(runs);
  const unlockedCount = achievements.filter(a => a.unlocked).length;
  const profileCoverUrl = profile?.cover_url || DEFAULT_PROFILE_COVER_URL;

  container.innerHTML = `
    <!-- Dark hero banner -->
    <section class="profile-hero" style="--profile-cover-image:url('${esc(profileCoverUrl)}')">
      <div class="hero-top">
        <div aria-hidden="true"></div>
        <div class="hero-actions">
          <button class="icon-btn" id="p-qr"       aria-label="My QR code"><i class="fa-solid fa-qrcode"></i></button>
          <button class="icon-btn" id="p-settings" aria-label="Settings"><i class="fa-solid fa-gear"></i></button>
        </div>
      </div>

      <div class="profile-identity">
        <div class="av-wrap">
          ${avatarHtml(profile, { size: 'lg' })}
          <button class="edit" id="p-edit-avatar" aria-label="Edit profile"><i class="fa-solid fa-pen"></i></button>
        </div>
        <div class="info">
          <h2>${esc(profile?.display_name || 'Runner')}</h2>
          <div class="bio">${esc(profile?.bio || 'Tell your crew a little about you…')}</div>
          <div class="chips">
            ${handle ? `<span class="chip">${esc(handle)}</span>` : ''}
            <span class="chip">${t.emoji} ${esc(t.name)}</span>
            ${isOrganizer ? '<span class="chip"><i class="fa-solid fa-bolt"></i> Organizer</span>' : ''}
          </div>
        </div>
      </div>
    </section>

    <!-- Stats strip overlapping the hero -->
    <div class="profile-stats-strip">
      <div class="stat-tile">
        <div class="v">${totalKm.toFixed(1)}</div>
        <div class="l">Total km</div>
      </div>
      <div class="stat-tile">
        <div class="v">${runs.length}</div>
        <div class="l">Runs</div>
      </div>
      <div class="stat-tile">
        <div class="v">${fmtPace(avgPace)}</div>
        <div class="l">Avg pace</div>
      </div>
    </div>

    <!-- Quick action tiles -->
    <div class="tile-grid">
      <button class="tile" data-nav="#/stats" aria-label="Stats report">
        <span class="ico"><i class="fa-solid fa-chart-line"></i></span>
        <span class="lbl">Stats report</span>
      </button>
      <button class="tile" id="tile-achievements" aria-label="Achievements">
        <span class="ico"><i class="fa-solid fa-medal"></i></span>
        <span class="lbl">Achievements</span>
      </button>
      <button class="tile" data-nav="#/my-activities" aria-label="My activities">
        <span class="ico"><i class="fa-solid fa-flag-checkered"></i></span>
        <span class="lbl">My activities</span>
        ${upcomingCount ? `<span class="badge">${upcomingCount}</span>` : ''}
      </button>
      <button class="tile" data-nav="#/clubs" aria-label="Clubs">
        <span class="ico"><i class="fa-solid fa-people-group"></i></span>
        <span class="lbl">Clubs</span>
      </button>
    </div>

    <!-- Achievements row -->
    <div class="section-title" style="margin-top:18px">
      <h2 id="achievements-anchor">Achievements</h2>
      <span class="count">${unlockedCount} / ${achievements.length}</span>
    </div>
    <div class="ach-row">
      ${achievements.map(a => `
        <div class="ach-card ${a.unlocked ? '' : 'locked'}" title="${esc(a.name)}">
          <div class="ach-medal ${a.unlocked ? a.medal : 'locked'}">
            <i class="fa-solid ${a.unlocked ? a.icon : 'fa-lock'}"></i>
          </div>
          <div class="name">${esc(a.name)}</div>
          <div class="sub">${esc(a.sub || '')}</div>
        </div>`).join('')}
    </div>

    ${isOrganizer ? `
      <div class="section-head">Organizer tools</div>
      <div class="pro-list">
        <button class="row" data-publish>
          <i class="lead" style="background: var(--brand);"><i class="fa-solid fa-plus"></i></i>
          <div class="meta">
            <div class="t">Publish activity</div>
            <div class="s">Create a new club activity with route upload</div>
          </div>
          <i class="fa-solid fa-chevron-right chev"></i>
        </button>
        <button class="row" data-manage>
          <i class="lead" style="background: #8B5CF6;"><i class="fa-solid fa-user-gear"></i></i>
          <div class="meta">
            <div class="t">Manage club</div>
            <div class="s">${ownedClubs.length} club${ownedClubs.length > 1 ? 's' : ''} · co-organizers · transfer · delete</div>
          </div>
          <i class="fa-solid fa-chevron-right chev"></i>
        </button>
      </div>` : ''}

    <!-- Preferences / account list -->
    <div class="section-head">Preferences</div>
    <div class="pro-list">
      <button class="row" data-nav="#/profile/edit">
        <i class="lead" style="background: var(--brand);"><i class="fa-solid fa-user-pen"></i></i>
        <div class="meta">
          <div class="t">Edit profile</div>
          <div class="s">Display name · bio · avatar</div>
        </div>
        <i class="fa-solid fa-chevron-right chev"></i>
      </button>
      <button class="row" id="p-notifications">
        <i class="lead" style="background: #0EA5E9;"><i class="fa-regular fa-bell"></i></i>
        <div class="meta"><div class="t">Notifications</div></div>
        <i class="fa-solid fa-chevron-right chev"></i>
      </button>
      <button class="row" id="p-privacy">
        <i class="lead" style="background: #8B5CF6;"><i class="fa-solid fa-shield-halved"></i></i>
        <div class="meta"><div class="t">Privacy &amp; safety</div></div>
        <i class="fa-solid fa-chevron-right chev"></i>
      </button>
      <button class="row" id="p-help">
        <i class="lead" style="background: #64748B;"><i class="fa-solid fa-circle-question"></i></i>
        <div class="meta"><div class="t">Help center</div></div>
        <i class="fa-solid fa-chevron-right chev"></i>
      </button>
      <button class="row danger" id="logout-btn">
        <i class="lead" style="background: var(--danger);"><i class="fa-solid fa-arrow-right-from-bracket"></i></i>
        <div class="meta"><div class="t">Log out</div></div>
        <i class="fa-solid fa-chevron-right chev"></i>
      </button>
    </div>

    <div style="height:24px"></div>
  `;

  // --- wiring ---
  on(container, 'click', '[data-nav]', (_ev, el) => navigate(el.dataset.nav));
  $('#p-edit-avatar', container).addEventListener('click', () => navigate('#/profile/edit'));
  $('#tile-achievements', container).addEventListener('click', () => {
    const el = $('#achievements-anchor', container);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('#p-settings', container).addEventListener('click', () => navigate('#/profile/edit'));
  $('#p-qr', container).addEventListener('click', () => {
    toast(handle ? `Share ${handle} with friends to connect` : 'QR codes coming soon', { kind: 'info' });
  });
  ['p-notifications', 'p-privacy', 'p-help'].forEach(id => {
    const btn = $('#' + id, container);
    if (btn) btn.addEventListener('click', () => toast('Coming soon', { kind: 'info' }));
  });
  $('#logout-btn', container).addEventListener('click', async () => {
    if (!(await confirmDialog({ title: 'Log out of RunLink?', message: 'You can sign back in anytime.', confirmText: 'Log out', danger: true }))) return;
    await api.signOut();
    toast('Logged out', { kind: 'info' });
  });
  // Organizer-only rows
  const pubBtn = container.querySelector('[data-publish]');
  if (pubBtn) pubBtn.addEventListener('click', () => {
    if (ownedClubs.length === 1) navigate(`#/club/${ownedClubs[0].id}/publish`);
    else navigate('#/community');
  });
  const mgmtBtn = container.querySelector('[data-manage]');
  if (mgmtBtn) mgmtBtn.addEventListener('click', () => {
    if (ownedClubs.length === 1) navigate(`#/club/${ownedClubs[0].id}/manage`);
    else navigate('#/clubs');
  });
}

export async function renderEditProfile(container) {
  setHeader({ title: 'Edit profile', backTo: '#/profile' });
  const p = await api.getMyProfile();
  const user = await api.getCurrentUser();
  const editCoverUrl = p?.cover_url || DEFAULT_PROFILE_COVER_URL;

  container.innerHTML = `
    <!-- Cover banner + floating avatar -->
    <div class="edit-banner" id="edit-banner" style="background-image:url('${esc(editCoverUrl)}')">
      <button class="change-cover" type="button" id="change-cover">
        <i class="fa-solid fa-camera"></i> Change cover
      </button>
    </div>
    <input id="cover-file-input" name="cover_file" type="file" accept="image/png,image/jpeg,image/webp,image/gif" style="display:none" />

    <div class="av-holder">
      ${avatarHtml(p, { size: 'lg' })}
      <button class="edit" type="button" id="pick-avatar" aria-label="Change avatar">
        <i class="fa-solid fa-pen"></i>
      </button>
    </div>
    <input id="avatar-file-input" name="avatar_file" type="file" accept="image/png,image/jpeg,image/webp,image/gif" style="display:none" />

    <form id="edit-form">
      <div class="section-head">Profile</div>
      <div class="field-group">
        <div class="field-row">
          <span class="label">Name</span>
          <input name="display_name" required minlength="2" maxlength="40"
                 value="${esc(p?.display_name || '')}" placeholder="Your display name" />
        </div>
        <div class="field-row vertical">
          <span class="label">Bio</span>
          <textarea name="bio" maxlength="240"
                    placeholder="Tell your crew a little about you…">${esc(p?.bio || '')}</textarea>
        </div>
      </div>

      <div class="section-head">Account</div>
      <div class="field-group">
        <div class="field-row">
          <span class="label">Email</span>
          <input value="${esc(user?.email || '')}" disabled />
        </div>
        <div class="field-row">
          <span class="label">User ID</span>
          <input value="${esc((user?.id || '').slice(0, 8))}…" disabled
                 style="font-family:ui-monospace,SFMono-Regular,Consolas,monospace" />
        </div>
      </div>

      <div class="edit-save-bar">
        <button class="btn block" type="submit" style="height:48px;font-size:16px">
          <i class="fa-solid fa-floppy-disk"></i> Save changes
        </button>
      </div>
    </form>
  `;

  $('#change-cover', container).addEventListener('click', () =>
    $('#cover-file-input', container)?.click()
  );
  const editBanner = $('#edit-banner', container);
  const coverFileInput = $('#cover-file-input', container);
  const avatarFileInput = $('#avatar-file-input', container);
  let avatarUrl = p?.avatar_url || null;
  let coverUrl = p?.cover_url || null;
  let coverPreviewUrl = null;

  coverFileInput?.addEventListener('change', () => {
    const file = coverFileInput.files?.[0];
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      toast(`Cover image must be <= ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB`, { kind: 'warn' });
      coverFileInput.value = '';
      return;
    }
    if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
    coverPreviewUrl = URL.createObjectURL(file);
    editBanner.style.backgroundImage = `url('${coverPreviewUrl}')`;
    const mb = (file.size / (1024 * 1024)).toFixed(2);
    toast(`Selected cover: ${file.name} (${mb} MB)`, { kind: 'info' });
  });

  avatarFileInput?.addEventListener('change', () => {
    const file = avatarFileInput.files?.[0];
    if (!file) return;
    const mb = (file.size / (1024 * 1024)).toFixed(2);
    toast(`Selected avatar: ${file.name} (${mb} MB)`, { kind: 'info' });
  });

  $('#pick-avatar', container).addEventListener('click', () => {
    avatarFileInput?.click();
  });

  $('#edit-form', container).addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const submitBtn = ev.target.querySelector('button[type="submit"]');
    try {
      if (submitBtn) submitBtn.disabled = true;
      const avatarFile = avatarFileInput?.files?.[0] || null;
      if (avatarFile && avatarFile.size > MAX_UPLOAD_BYTES) {
        throw new Error(`Avatar image must be <= ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB`);
      }
      const coverFile = coverFileInput?.files?.[0] || null;
      const avatarUpload = avatarFile
        ? await api.uploadActivityAsset(avatarFile, { folder: 'profile-avatars' })
        : null;
      const coverUpload = coverFile
        ? await api.uploadActivityAsset(coverFile, { folder: 'profile-covers' })
        : null;
      avatarUrl = avatarUpload?.publicUrl || avatarUrl;
      coverUrl = coverUpload?.publicUrl || coverUrl;
      await api.updateMyProfile({
        display_name: fd.get('display_name').toString().trim(),
        avatar_url: avatarUrl,
        cover_url: coverUrl,
        bio: fd.get('bio').toString().trim() || null,
      });
      toast('Profile updated', { kind: 'success' });
      navigate('#/profile');
    } catch (err) {
      toast(err.message, { kind: 'error' });
    } finally {
      if (submitBtn) submitBtn.disabled = false;
      if (coverPreviewUrl) {
        URL.revokeObjectURL(coverPreviewUrl);
        coverPreviewUrl = null;
      }
    }
  });
}

/* =================================================================
   STATS
   ================================================================= */

export async function renderStats(container) {
  setHeader({ title: 'My stats', backTo: '#/profile' });
  const runs = await api.listMyRuns({ limit: 200 });
  if (!runs.length) {
    container.innerHTML = `<div class="empty"><i class="fa-solid fa-chart-line"></i><h3>No runs recorded</h3><p>Your runs will appear here once you finish one.</p></div>`;
    return;
  }
  const total_m = runs.reduce((s, r) => s + (r.distance_m || 0), 0);
  const total_s = runs.reduce((s, r) => s + (r.duration_s || 0), 0);
  const avgPace = total_m ? Math.round((total_s * 1000) / total_m) : null;
  const longest = runs.reduce((a, b) => (b.distance_m > a.distance_m ? b : a));

  container.innerHTML = `
    <div class="stat-grid">
      <div class="stat"><div class="v">${runs.length}</div><div class="l">Runs</div></div>
      <div class="stat"><div class="v">${(total_m/1000).toFixed(1)}</div><div class="l">Total km</div></div>
      <div class="stat"><div class="v">${fmtDuration(total_s)}</div><div class="l">Total time</div></div>
      <div class="stat"><div class="v">${fmtPace(avgPace)}</div><div class="l">Avg pace</div></div>
    </div>

    <div class="section-title"><h2>Longest run</h2></div>
    <div class="card">
      <div style="font-family:var(--font-display);font-size:28px;color:var(--ink-900)">${fmtDistance(longest.distance_m)}</div>
      <div style="color:var(--ink-500);font-size:12px">${esc(fmtDate(longest.started_at))} · ${fmtDuration(longest.duration_s)} · ${fmtPace(longest.avg_pace_s_per_km)}</div>
    </div>

    <div class="section-title"><h2>Recent</h2><span class="count">${runs.length} total</span></div>
    <div>${runs.slice(0,20).map(r => `
      <div class="card card-compact">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:40px;height:40px;border-radius:10px;background:var(--brand-soft);display:flex;align-items:center;justify-content:center;color:var(--brand)">
            <i class="fa-solid fa-person-running"></i>
          </div>
          <div style="flex:1">
            <div style="font-weight:700;color:var(--ink-900)">${fmtDistance(r.distance_m)} · ${fmtDuration(r.duration_s)}</div>
            <div style="color:var(--ink-500);font-size:12px">${esc(fmtDate(r.started_at))} · ${fmtPace(r.avg_pace_s_per_km)}${r.activity_id ? ' · linked activity' : ' · free run'}</div>
          </div>
        </div>
      </div>`).join('')}</div>
  `;
}

/* =================================================================
   CLUBS · switcher + create + join
   ================================================================= */

export async function renderClubs(container) {
  setHeader({ title: 'Clubs', backTo: '#/community' });
  container.innerHTML = `
    <div class="tabs-pill">
      <button class="pill-tab active" data-ctab="mine">My clubs</button>
      <button class="pill-tab" data-ctab="all">Browse</button>
      <button class="pill-tab" data-ctab="new">＋ Create</button>
    </div>
    <div id="clubs-body"></div>
  `;
  const body = $('#clubs-body', container);
  const user = await api.getCurrentUser();
  const all = await api.listClubs();
  const memberships = await supabaseHelperMemberships(user.id);
  const mineIds = new Set(memberships);

  const render = (mode) => {
    if (mode === 'new') return renderCreateClubForm(body);
    const subset = mode === 'mine' ? all.filter(c => mineIds.has(c.id)) : all;
    body.innerHTML = subset.length ? subset.map(c => clubCard(c, mineIds)).join('')
      : `<div class="empty"><i class="fa-solid fa-people-group"></i><p>${mode === 'mine' ? 'You haven\'t joined any clubs yet. Browse below.' : 'No clubs here yet.'}</p></div>`;
    on(body, 'click', '[data-join]', async (_ev, el) => {
      await api.joinClub(el.dataset.join);
      toast('Joined', { kind: 'success' });
      renderClubs(container);
    });
    on(body, 'click', '[data-open]', () => navigate('#/community'));
  };
  on(container, 'click', '[data-ctab]', (_ev, btn) => {
    container.querySelectorAll('[data-ctab]').forEach(t => t.classList.toggle('active', t === btn));
    render(btn.dataset.ctab);
  });
  render('mine');
}

async function supabaseHelperMemberships(userId) {
  const { supabase } = await import('./supabase.js');
  const { data } = await supabase.from('club_members').select('club_id').eq('user_id', userId);
  return (data ?? []).map(m => m.club_id);
}

function clubCard(c, mineIds) {
  const joined = mineIds.has(c.id);
  return `
    <article class="card" style="display:flex;gap:12px;align-items:center">
      <div class="crest" style="width:56px;height:56px;border-radius:14px;background:var(--ink-100) center/cover url('${esc(c.crest_url || '')}')"></div>
      <div style="flex:1;min-width:0">
        <div style="font-family:var(--font-display);font-size:20px;color:var(--ink-900)">${esc(c.name)}</div>
        <div style="color:var(--ink-500);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.description || '')}</div>
      </div>
      ${joined
        ? `<button class="btn ghost sm" data-open>Open</button>`
        : `<button class="btn sm" data-join="${esc(c.id)}">Join</button>`}
    </article>`;
}

const CHINA_CITY_TIMEZONE = Object.freeze({
  Beijing: 'Asia/Shanghai',
  Shanghai: 'Asia/Shanghai',
  Guangzhou: 'Asia/Shanghai',
  Shenzhen: 'Asia/Shanghai',
  Hangzhou: 'Asia/Shanghai',
  Nanjing: 'Asia/Shanghai',
  Suzhou: 'Asia/Shanghai',
  Chengdu: 'Asia/Shanghai',
  Chongqing: 'Asia/Shanghai',
  Wuhan: 'Asia/Shanghai',
  XiAn: 'Asia/Shanghai',
  Tianjin: 'Asia/Shanghai',
  Qingdao: 'Asia/Shanghai',
  Xiamen: 'Asia/Shanghai',
  Zhengzhou: 'Asia/Shanghai',
  Changsha: 'Asia/Shanghai',
  Ningbo: 'Asia/Shanghai',
  Hefei: 'Asia/Shanghai',
});

function renderCreateClubForm(body) {
  const cityOptions = Object.keys(CHINA_CITY_TIMEZONE)
    .map((city) => `<option value="${city}">${city.replace('XiAn', "Xi'an")}</option>`)
    .join('');

  body.innerHTML = `
    <form id="create-club-form" class="card">
      <div class="field"><label>Club name</label><input name="name" required minlength="2" maxlength="60" /></div>
      <div class="field"><label>Description</label><textarea name="description" maxlength="240" placeholder="When, where, and what you run."></textarea></div>
      <div class="field">
        <label>Club avatar</label>
        <input name="crest_file" type="file" accept="image/png,image/jpeg,image/webp,image/gif" />
        <div id="club-crest-preview" class="hint" style="margin-top:8px">No avatar selected.</div>
      </div>
      <div class="field"><label>City (China)</label>
        <select name="china_city" id="club-city">
          ${cityOptions}
        </select>
        <div class="hint" style="margin-top:6px">Timezone auto-matched for China: <b id="club-tz-label">Asia/Shanghai</b></div>
      </div>
      <div class="field"><label>Visibility</label>
        <select name="visibility">
          <option value="public">Public — anyone can find it</option>
          <option value="private">Private — invite-only</option>
        </select>
      </div>
      <button class="btn block" type="submit"><i class="fa-solid fa-plus"></i> Create</button>
    </form>`;

  const form = $('#create-club-form', body);
  const crestInput = form.querySelector('[name=crest_file]');
  const crestPreview = $('#club-crest-preview', body);
  const citySelect = $('#club-city', body);
  const tzLabel = $('#club-tz-label', body);
  const submitBtn = form.querySelector('button[type=submit]');

  const updateTimezoneLabel = () => {
    const city = citySelect.value;
    tzLabel.textContent = CHINA_CITY_TIMEZONE[city] || 'Asia/Shanghai';
  };
  updateTimezoneLabel();
  citySelect.addEventListener('change', updateTimezoneLabel);

  crestInput?.addEventListener('change', () => {
    const file = crestInput.files?.[0];
    if (!file) {
      crestPreview.textContent = 'No avatar selected.';
      return;
    }
    const mb = (file.size / (1024 * 1024)).toFixed(2);
    crestPreview.innerHTML = `<i class="fa-solid fa-circle-check" style="color:var(--accent)"></i> ${esc(file.name)} (${mb} MB)`;
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    try {
      submitBtn.disabled = true;
      const crestFile = crestInput?.files?.[0] || null;
      if (crestFile && crestFile.size > MAX_UPLOAD_BYTES) {
        throw new Error(`Club avatar must be <= ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB`);
      }
      const crestUpload = crestFile
        ? await api.uploadActivityAsset(crestFile, { folder: 'club-crests' })
        : null;
      const city = fd.get('china_city').toString();
      const club = await api.createClub({
        name: fd.get('name').toString().trim(),
        description: fd.get('description').toString().trim() || null,
        crest_url: crestUpload?.publicUrl || null,
        timezone: CHINA_CITY_TIMEZONE[city] || 'Asia/Shanghai',
        visibility: fd.get('visibility').toString(),
      });
      toast(`Club "${club.name}" created`, { kind: 'success' });
      navigate(`#/community`);
    } catch (err) {
      toast(err.message, { kind: 'error' });
    } finally {
      submitBtn.disabled = false;
    }
  });
}

export async function renderManageClub(container, { id }) {
  setHeader({ title: 'Manage club', backTo: '#/community' });
  const club = await api.getClub(id);
  if (!club) { container.innerHTML = `<div class="empty"><h3>Not found</h3></div>`; return; }
  const members = await api.listClubMembers(id);
  const user = await api.getCurrentUser();
  const isOwner = club.owner_id === user?.id;
  container.innerHTML = `
    <div class="card">
      <div style="font-family:var(--font-display);font-size:22px;color:var(--ink-900)">${esc(club.name)}</div>
      <div style="color:var(--ink-500);font-size:12px;margin-top:4px">${esc(club.description || '')}</div>
    </div>

    <div class="section-title"><h2>Activities</h2>
      <button class="link" id="new-act">＋ New activity</button>
    </div>

    <div class="section-title"><h2>Members · ${members.length}</h2></div>
    <div id="members-mgmt"></div>

    ${isOwner
      ? `<div class="section-title"><h2>Danger zone</h2></div>
         <button class="btn ghost block" id="transfer-owner"><i class="fa-solid fa-right-left"></i> Transfer ownership</button>
         <button class="btn danger block" id="delete-club" style="margin-top:8px"><i class="fa-solid fa-trash"></i> Delete club</button>`
      : `<button class="btn ghost block" id="leave-club" style="margin-top:12px"><i class="fa-solid fa-right-from-bracket"></i> Leave club</button>`}
  `;
  $('#new-act', container).addEventListener('click', () => navigate(`#/club/${id}/publish`));
  const memBox = $('#members-mgmt', container);
  memBox.innerHTML = members.map(m => `
    <div class="card card-compact" style="display:flex;align-items:center;gap:10px">
      ${avatarHtml(m.profile, { size: 'sm' })}
      <div style="flex:1">
        <div style="font-weight:700;color:var(--ink-900)">${esc(m.profile?.display_name)}</div>
        <div style="color:var(--ink-500);font-size:12px">${esc(m.role.replace('_',' '))}</div>
      </div>
    </div>`).join('') || `<div class="empty"><p>No members yet.</p></div>`;

  $('#transfer-owner', container)?.addEventListener('click', () =>
    openTransferOwnership(club, () => renderManageClub(container, { id })));
  $('#delete-club', container)?.addEventListener('click', () =>
    openDeleteClub(club, () => navigate('#/clubs')));
  $('#leave-club', container)?.addEventListener('click', async () => {
    if (!await confirmDialog({
      title: 'Leave this club?', confirmText: 'Leave',
      message: 'You can rejoin later as long as it\'s public.',
    })) return;
    try { await api.leaveClub(id); toast('Left the club', { kind: 'info' }); navigate('#/clubs'); }
    catch (err) { toast(err.message, { kind: 'error' }); }
  });
}

/* =================================================================
   PUBLISH ACTIVITY (organizer)
   ================================================================= */

export async function renderPublishActivity(container, { clubId }) {
  setHeader({ title: 'Publish activity', backTo: '#/community' });
  const club = await api.getClub(clubId);
  if (!club) { container.innerHTML = `<div class="empty"><h3>Club not found</h3></div>`; return; }

  container.innerHTML = `
    <div class="card"><b>${esc(club.name)}</b> · timezone <span class="chip ghost">${esc(club.timezone)}</span></div>
    <form id="publish-form" class="card" style="margin-top:12px">
      <div class="field"><label>Title</label><input name="title" required maxlength="80" placeholder="Sunset Bund 5K" /></div>
      <div class="field"><label>Description</label><textarea name="description" placeholder="Route, pace, who this is for."></textarea></div>
      <div class="field">
        <label>Cover image</label>
        <input name="cover_file" type="file" accept="image/png,image/jpeg,image/webp,image/gif" />
        <div class="hint">Upload a JPG / PNG / WebP / GIF cover image. This will be uploaded to Supabase Storage.</div>
        <div id="cover-preview" class="card card-compact" hidden style="margin-top:8px">
          <div style="font-weight:700;color:var(--ink-900);margin-bottom:8px">Cover preview</div>
          <img id="cover-preview-img" alt="Cover preview"
               style="width:100%;aspect-ratio:2.2;object-fit:cover;border-radius:14px;border:1px solid var(--ink-100);display:block" />
        </div>
      </div>

      <div class="field">
        <label>Route map file (optional)</label>
        <input name="route_file" type="file" accept=".gpx,.geojson,.json,image/png,image/jpeg,image/webp,image/gif,application/gpx+xml,application/geo+json,application/json" />
        <div class="hint">Upload a route image, GPX, or GeoJSON file. Vector routes are uploaded to Supabase Storage and drawn directly on the map.</div>
        <div id="route-preview" class="card card-compact" hidden style="margin-top:8px">
          <div style="font-weight:700;color:var(--ink-900);margin-bottom:8px">Route preview</div>
          <div id="route-preview-body"></div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div class="field"><label>Start</label><input type="datetime-local" name="start_at" required /></div>
        <div class="field"><label>End</label><input type="datetime-local" name="end_at" required /></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div class="field"><label>Check-in opens</label><input type="datetime-local" name="checkin_window_start" /></div>
        <div class="field"><label>Check-in closes</label><input type="datetime-local" name="checkin_window_end" /></div>
      </div>

      <div class="field">
        <label>Meetup point</label>
        <div id="meetup-map" class="leaflet-map"></div>
        <div class="hint">
          <i class="fa-solid fa-circle-info"></i>
          Tap the map or drag the pin to set the exact meetup.
          Runners can Map check-in while within <b>${CHECK_IN_RADIUS_M} m</b> of this point —
          the radius is fixed for every activity.
        </div>
        <button type="button" class="ghost-btn" id="use-location" style="margin-top:8px;width:100%">
          <i class="fa-solid fa-location-crosshairs"></i> Center on my current location
        </button>
        <div id="meetup-picked-note" class="hint" style="margin-top:8px">
          <i class="fa-regular fa-hand-pointer"></i> No meetup point selected yet.
        </div>
      </div>

      <div class="field"><label>Meetup name</label><input name="meetup_name" placeholder="Bund Lighthouse" /></div>

      <div class="field">
        <label>Total capacity (optional)</label>
        <input name="total_cap" type="number" min="1" placeholder="Blank = unlimited" />
        <div class="hint">When reached, the activity shows Full and new registrations are blocked.</div>
      </div>

      <div class="field">
        <label>Groups</label>
        <div id="groups-list"></div>
        <button type="button" class="ghost-btn" id="add-group" style="margin-top:6px;width:100%">
          <i class="fa-solid fa-plus"></i> Add group
        </button>
        <div class="hint">Each group has a pace / goal. Optional per-group capacity.</div>
      </div>

      <button class="btn block" type="submit"><i class="fa-solid fa-bullhorn"></i> Publish</button>
    </form>
  `;

  // --- Groups repeater -----------------------------------------------
  const groupsBox = $('#groups-list', container);
  const renderGroups = (rows) => {
    groupsBox.innerHTML = rows.map((g, i) => `
      <div class="card card-compact" style="display:grid;grid-template-columns:1fr 80px auto;gap:6px;margin-bottom:6px;align-items:center">
        <input name="g-name-${i}" placeholder="Group name (e.g. 5K Chill)" value="${esc(g.name)}" />
        <input name="g-cap-${i}"  placeholder="cap" type="number" min="1" value="${g.cap ?? ''}" />
        <button class="icon-btn neutral" data-rm-group="${i}" type="button" aria-label="Remove"><i class="fa-solid fa-xmark"></i></button>
      </div>`).join('');
  };
  let groupRows = [{ name: '5K Chill', cap: null }, { name: '5K Push', cap: null }];
  renderGroups(groupRows);
  on(groupsBox, 'click', '[data-rm-group]', (_ev, el) => {
    const i = Number(el.dataset.rmGroup);
    groupRows.splice(i, 1); renderGroups(groupRows);
  });
  $('#add-group', container).addEventListener('click', () => {
    // persist current field values before re-render
    groupRows = groupRows.map((_, i) => ({
      name: (groupsBox.querySelector(`[name=g-name-${i}]`)?.value ?? '').trim(),
      cap:  groupsBox.querySelector(`[name=g-cap-${i}]`)?.value ? Number(groupsBox.querySelector(`[name=g-cap-${i}]`).value) : null,
    }));
    groupRows.push({ name: '', cap: null });
    renderGroups(groupRows);
  });

  // --- Map picker ---------------------------------------------------
  const mapEl = $('#meetup-map', container);
  const meetupPickedNote = $('#meetup-picked-note', container);
  const coverFileInput = container.querySelector('[name=cover_file]');
  const routeFileInput = container.querySelector('[name=route_file]');
  const coverPreview = $('#cover-preview', container);
  const coverPreviewImg = $('#cover-preview-img', container);
  const routePreview = $('#route-preview', container);
  const routePreviewBody = $('#route-preview-body', container);

  let meetupSelection = null;
  let routeUpload = null;
  let routeOverlay = null;
  let routePreviewUrl = null;
  let coverPreviewUrl = null;

  coverFileInput?.addEventListener('change', () => {
    const file = coverFileInput.files?.[0];
    if (!file) {
      coverPreview.hidden = true;
      if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
      coverPreviewUrl = null;
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      coverFileInput.value = '';
      coverPreview.hidden = true;
      if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
      coverPreviewUrl = null;
      toast('Please keep uploads under 10 MB.', { kind: 'warn' });
      return;
    }
    const url = URL.createObjectURL(file);
    if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
    coverPreviewUrl = url;
    coverPreviewImg.src = url;
    coverPreview.hidden = false;
  });

  let picker;
  try {
    picker = await meetupPicker(mapEl, {
      radius: CHECK_IN_RADIUS_M,
      onChange: ({ lat, lng }) => {
        meetupSelection = { lat, lng };
        meetupPickedNote.innerHTML = `<i class="fa-solid fa-circle-check" style="color:var(--accent)"></i> Meetup point selected on the map.`;
      },
    });
  } catch (err) {
    mapEl.innerHTML = `<div class="empty" style="border:0"><i class="fa-solid fa-map"></i><p>${esc(err.message)}</p></div>`;
  }

  routeFileInput?.addEventListener('change', async () => {
    const file = routeFileInput.files?.[0];
    routeUpload = null;
    routePreview.hidden = true;
    routePreviewBody.innerHTML = '';
    routeOverlay?.remove?.();
    routeOverlay = null;
    if (routePreviewUrl) {
      URL.revokeObjectURL(routePreviewUrl);
      routePreviewUrl = null;
    }
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      routeFileInput.value = '';
      toast('Please keep uploads under 10 MB.', { kind: 'warn' });
      return;
    }
    try {
      const parsed = await parseRouteFile(file);
      routeUpload = { file, kind: parsed.kind, geojson: parsed.geojson };
      routePreview.hidden = false;

      if (parsed.kind === 'image') {
        routePreviewUrl = URL.createObjectURL(file);
        routePreviewBody.innerHTML = `
          <img src="${esc(routePreviewUrl)}" alt="Route map preview"
               style="width:100%;object-fit:cover;border-radius:14px;border:1px solid var(--ink-100);display:block" />`;
      } else {
        routePreviewBody.innerHTML = `
          <div style="display:flex;gap:8px;align-items:flex-start;color:var(--ink-700);font-size:13px;line-height:1.5">
            <i class="fa-solid fa-route" style="color:var(--brand);margin-top:2px"></i>
            <div>
              <div style="font-weight:700;color:var(--ink-900)">${esc(file.name)}</div>
              <div>Vector route parsed successfully. It will be uploaded to Supabase Storage and drawn on the meetup map.</div>
            </div>
          </div>`;
        if (picker?.map && parsed.geojson) {
          routeOverlay = await addRouteGeoJson(picker.map, parsed.geojson, {
            color: '#F97316',
            weight: 4,
            opacity: 0.88,
            fit: true,
            fitPadding: [24, 24],
          });
        }
      }
    } catch (err) {
      routeFileInput.value = '';
      toast(err.message || 'Could not parse route file', { kind: 'error' });
    }
  });

  $('#use-location', container).addEventListener('click', async () => {
    try {
      await picker.locate();
      toast('Centered on your current location.', { kind: 'success' });
    } catch {
      try {
        const pos = await getCurrentPosition();
        picker?.setLatLng(pos);
        toast('Centered on your current location.', { kind: 'success' });
      } catch (err2) { toast(err2.message || 'Could not get location', { kind: 'error' }); }
    }
  });

  $('#publish-form', container).addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const startRaw = fd.get('start_at')?.toString() || '';
    const endRaw = fd.get('end_at')?.toString() || '';
    const checkinStartRaw = fd.get('checkin_window_start')?.toString() || '';
    const checkinEndRaw = fd.get('checkin_window_end')?.toString() || '';

    const startAt = startRaw ? new Date(startRaw) : null;
    const endAt = endRaw ? new Date(endRaw) : null;
    const checkinStartAt = checkinStartRaw ? new Date(checkinStartRaw) : null;
    const checkinEndAt = checkinEndRaw ? new Date(checkinEndRaw) : null;

    if (!startAt || Number.isNaN(startAt.getTime()) || !endAt || Number.isNaN(endAt.getTime())) {
      toast('Please provide valid start and end time.', { kind: 'warn' });
      return;
    }
    if (endAt <= startAt) {
      toast('End time must be later than start time.', { kind: 'warn' });
      return;
    }
    if (checkinStartAt && Number.isNaN(checkinStartAt.getTime())) {
      toast('Check-in open time is invalid.', { kind: 'warn' });
      return;
    }
    if (checkinEndAt && Number.isNaN(checkinEndAt.getTime())) {
      toast('Check-in close time is invalid.', { kind: 'warn' });
      return;
    }
    if (checkinStartAt && checkinEndAt && checkinEndAt < checkinStartAt) {
      toast('Check-in close time must be later than check-in open time.', { kind: 'warn' });
      return;
    }
    if (checkinEndAt && checkinEndAt > endAt) {
      toast('Check-in close time cannot be later than activity end time.', { kind: 'warn' });
      return;
    }

    if (!meetupSelection) {
      toast('Tap the map to set the meetup point.', { kind: 'warn' });
      return;
    }
    const groups = groupRows.map((_, i) => ({
      name: (groupsBox.querySelector(`[name=g-name-${i}]`)?.value ?? '').trim(),
      cap:  groupsBox.querySelector(`[name=g-cap-${i}]`)?.value
        ? Number(groupsBox.querySelector(`[name=g-cap-${i}]`).value) : null,
    })).filter(g => g.name);
    try {
      const coverFile = coverFileInput?.files?.[0] || null;
      const routeFile = routeUpload?.file || null;
      const coverUpload = coverFile ? await api.uploadActivityAsset(coverFile, { folder: 'covers' }) : null;
      const routeAsset = routeFile ? await api.uploadActivityAsset(routeFile, { folder: 'routes' }) : null;

      const a = await api.createActivity({
        club_id: clubId,
        title: fd.get('title').toString(),
        description: fd.get('description').toString() || null,
        cover_url: coverUpload?.publicUrl || null,
        start_at: startAt.toISOString(),
        end_at:   endAt.toISOString(),
        checkin_window_start: checkinStartAt ? checkinStartAt.toISOString() : null,
        checkin_window_end:   checkinEndAt ? checkinEndAt.toISOString() : null,
        meetup_name: fd.get('meetup_name').toString() || null,
        meetup_lat:  meetupSelection.lat,
        meetup_lng:  meetupSelection.lng,
        geofence_m:  CHECK_IN_RADIUS_M,
        total_cap:   fd.get('total_cap') ? Number(fd.get('total_cap')) : null,
        route_file_url: routeAsset?.publicUrl || null,
        route_file_name: routeAsset?.name || null,
        route_file_kind: routeUpload?.kind || null,
        route_geojson: routeUpload?.geojson || null,
        groups,
        status: 'published',
      });
      toast('Activity published!', { kind: 'success' });
      navigate(`#/activity/${a.id}`);
    } catch (err) { toast(err.message, { kind: 'error' }); }
  });
}

/* =================================================================
   DATA DASHBOARD (organizer-only)
   ================================================================= */

export async function renderDataDashboard(container, { activityId }) {
  setHeader({ title: 'Dashboard', backTo: `#/activity/${activityId}` });
  const activity = await api.getActivity(activityId);
  if (!activity) {
    container.innerHTML = `<div class="empty"><h3>Not found</h3></div>`;
    return;
  }
  const user = await api.getCurrentUser();
  const isOwner = activity.club?.owner_id === user?.id;
  if (!isOwner) {
    container.innerHTML = `<div class="empty"><h3>Not authorized</h3><p>Only organizers of this club can view the dashboard.</p></div>`;
    return;
  }
  await loadDashboard(container, activityId, activity);
}

async function loadDashboard(container, activityId, activity) {
  const rows = await api.listActivityRegistrations(activityId);
  const active = rows.filter(r => r.status !== 'cancelled');
  const checkedIn = active.filter(r => r.status === 'checked_in' || r.status === 'late').length;
  const lateCount = active.filter(r => r.status === 'late').length;
  const cancelledCount = rows.filter(r => r.status === 'cancelled').length;

  const windowOpen = activity.checkin_window_end
    ? new Date() < new Date(activity.checkin_window_end) : true;

  container.innerHTML = `
    <div class="card">
      <div style="font-family:var(--font-display);font-size:22px;color:var(--ink-900)">${esc(activity.title)}</div>
      <div style="color:var(--ink-500);font-size:12px">${esc(fmtDate(activity.start_at))}</div>
    </div>
    <div class="stat-grid" style="margin-top:12px">
      <div class="stat"><div class="v">${active.length}${activity.total_cap ? `<small style="font-size:14px;color:var(--ink-500)"> / ${activity.total_cap}</small>` : ''}</div><div class="l">Registered</div></div>
      <div class="stat"><div class="v">${checkedIn}</div><div class="l">Checked in</div></div>
      <div class="stat"><div class="v">${lateCount}</div><div class="l">Late</div></div>
      <div class="stat"><div class="v">${cancelledCount}</div><div class="l">Cancelled</div></div>
    </div>

    <div class="section-title"><h2>Roster</h2></div>
    <div class="card" style="padding:0;overflow:hidden">
      <table class="table">
        <thead>
          <tr><th>Runner</th><th>Group</th><th>Status</th><th>Check-in</th><th></th></tr>
        </thead>
        <tbody id="roster-body">
          ${rows.map(r => `
            <tr>
              <td>${esc(r.user?.display_name || 'Runner')}</td>
              <td>${esc(r.group_name || '—')}</td>
              <td>${statusChipFor(r.status)}</td>
              <td style="color:var(--ink-500);font-size:12px">
                ${r.checkin_ts ? esc(fmtTime(r.checkin_ts)) : '—'}
                ${r.checkin_method === 'fallback' ? '<br><span class="chip ghost" style="font-size:10px">self-confirmed</span>' : ''}
              </td>
              <td style="text-align:right">
                ${(r.status === 'registered' && windowOpen)
                  ? `<button class="btn sm" data-mark="${esc(r.user_id)}"><i class="fa-solid fa-check"></i> Mark in</button>`
                  : ''}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;

  on(container, 'click', '[data-mark]', async (_ev, el) => {
    const userId = el.dataset.mark;
    if (!await confirmDialog({
      title: 'Mark this runner as checked in?',
      message: 'Use this only if the runner is physically at the meetup but GPS failed for them.',
      confirmText: 'Mark in',
    })) return;
    try {
      await api.manualCheckIn({ activityId, userId });
      toast('Marked as checked in', { kind: 'success' });
      loadDashboard(container, activityId, activity);
    } catch (err) { toast(err.message, { kind: 'error' }); }
  });
}

function statusChipFor(status) {
  const map = {
    registered:   `<span class="chip brand">Registered</span>`,
    checked_in:   `<span class="chip success">Checked in</span>`,
    late:         `<span class="chip warn">Late</span>`,
    cancelled:    `<span class="chip danger">Cancelled</span>`,
    completed:    `<span class="chip success">Completed</span>`,
    no_run_recorded: `<span class="chip ghost">No run recorded</span>`,
  };
  return map[status] || `<span class="chip ghost">${esc(status)}</span>`;
}
