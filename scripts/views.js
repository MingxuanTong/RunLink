/**
 * All view renderers. Each function takes the container element it
 * should populate; it is responsible for fetching data, writing HTML,
 * and wiring up its own event listeners.
 */
import * as api from './api.js';
import {
  $, $$, on, esc, toast, openModal, confirmDialog,
  timeUntil, fmtDate, fmtTime, fmtDistance, fmtDuration, fmtPace,
  avatarHtml, tier, showLoading, initials,
} from './ui.js';
import { validateCheckin, getCurrentPosition, haversineMeters } from './geofence.js';
import { navigate, setHeader } from './app.js';

/* ================================================================
   Reusable card
   ================================================================ */

function activityCard(a, { wide = false, badge } = {}) {
  const ends = new Date(a.end_at);
  const isPast = ends < new Date();
  const timeLabel = isPast ? fmtDate(a.end_at) : `${fmtDate(a.start_at, { withTime: false })} · ${fmtTime(a.start_at)}`;
  const until = !isPast ? `<span class="chip brand">${esc(timeUntil(a.start_at))}</span>` : '';
  const statusChip =
    a.status === 'cancelled' ? `<span class="chip danger">CANCELLED</span>` :
    a.status === 'completed' ? `<span class="chip accent">COMPLETED</span>` :
    '';
  const coverStyle = a.cover_url ? `style="background-image:url('${esc(a.cover_url)}');background-size:cover;background-position:center;"` : '';
  return `
    <article class="card activity-card ${wide ? 'wide' : ''} interactive" data-activity="${esc(a.id)}" role="link" tabindex="0">
      <div class="cover" ${coverStyle}></div>
      <div class="info">
        <div class="title">${esc(a.title)}</div>
        <div class="meta">
          ${a.club ? `<span><i class="fa-regular fa-flag"></i>${esc(a.club.name)}</span>` : ''}
          <span><i class="fa-regular fa-calendar"></i>${esc(timeLabel)}</span>
          ${a.meetup_name ? `<span><i class="fa-solid fa-location-dot"></i>${esc(a.meetup_name)}</span>` : ''}
        </div>
        <div class="meta">
          ${until}
          ${statusChip}
          ${badge ?? ''}
          ${Array.isArray(a.groups) && a.groups.length ? `<span class="chip ghost"><i class="fa-solid fa-layer-group"></i>${a.groups.length} group${a.groups.length>1?'s':''}</span>` : ''}
          ${a.total_cap ? `<span class="chip ghost"><i class="fa-solid fa-users"></i>${a.total_cap}</span>` : ''}
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

/* ================================================================
   AUTH · login + signup
   ================================================================ */

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
      <p class="switch" style="margin-top:8px"><button type="button" class="ghost-btn" id="fill-demo" style="width:100%">
        <i class="fa-solid fa-wand-magic-sparkles"></i> Use demo account
      </button></p>
    </form>
  `;
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
    </form>
  `;
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

/* ================================================================
   DISCOVER tab
   ================================================================ */

export async function renderDiscover(container) {
  setHeader({ title: 'Discover' });
  container.innerHTML = `
    <section class="hero">
      <div class="greeting" id="greeting">Good day, runner</div>
      <h1>Find your next run.</h1>
      <p>Register, check in at the meetup, and keep your streak alive.</p>
      <button class="checkin-cta" id="quick-checkin" type="button">
        <div class="pin"><i class="fa-solid fa-location-crosshairs"></i></div>
        <div style="flex:1">
          <div class="title">Map check-in</div>
          <div class="sub">Verify your position at the meetup spot (50 m geofence)</div>
        </div>
        <i class="fa-solid fa-chevron-right"></i>
      </button>
    </section>

    <div class="section-title">
      <h2>Your registrations</h2>
      <span class="count" id="myreg-count">—</span>
      <button class="link" data-nav="#/my-activities">See all →</button>
    </div>
    <div id="my-regs"></div>

    <div class="section-title">
      <h2>Upcoming activities</h2>
      <span class="count" id="up-count">—</span>
    </div>
    <div id="upcoming" class="activity-grid"></div>
  `;

  // Header greeting
  const profile = await api.getMyProfile();
  if (profile) $('#greeting', container).textContent = `Hi, ${profile.display_name}`;

  // Quick check-in — opens a chooser of registered upcoming activities
  $('#quick-checkin', container).addEventListener('click', openQuickCheckin);

  on(container, 'click', '[data-nav]', (_ev, el) => navigate(el.dataset.nav));

  // My registrations
  const myBox = $('#my-regs', container);
  showLoading(myBox, 2);
  const myRegs = (await api.listMyRegistrations({ timeframe: 'upcoming' })).slice(0, 2);
  $('#myreg-count', container).textContent = `${myRegs.length} upcoming`;
  if (!myRegs.length) {
    myBox.innerHTML = `<div class="empty">
      <i class="fa-regular fa-calendar-plus"></i>
      <h3>No upcoming registrations</h3>
      <p>Pick an activity below and tap Register.</p>
    </div>`;
  } else {
    myBox.innerHTML = myRegs.map(r => activityCard(r.activity, {
      badge: `<span class="chip ${r.status === 'checked_in' ? 'accent' : 'brand'}">${esc(r.status.replace('_',' '))}</span>`,
    })).join('');
    bindActivityCards(myBox);
  }

  // Upcoming (all clubs)
  const upBox = $('#upcoming', container);
  showLoading(upBox, 3);
  const upcoming = await api.listActivities({ timeframe: 'upcoming', status: 'published' });
  $('#up-count', container).textContent = `${upcoming.length}`;
  upBox.innerHTML = upcoming.length
    ? upcoming.map(a => activityCard(a)).join('')
    : `<div class="empty"><i class="fa-regular fa-clock"></i><h3>No published activities</h3><p>Check back later or create one from your club.</p></div>`;
  bindActivityCards(upBox);
}

async function openQuickCheckin() {
  const regs = await api.listMyRegistrations({ timeframe: 'upcoming' });
  const targets = regs.filter(r => r.status === 'registered' && r.activity?.status === 'published');
  if (!targets.length) {
    toast('No eligible activity to check in.', { kind: 'warn' });
    return;
  }
  if (targets.length === 1) return runCheckinFlow(targets[0].activity);

  openModal((close) => {
    const el = document.createElement('div');
    el.innerHTML = `
      <h3>Pick an activity to check in</h3>
      <p>Select the one you're attending right now.</p>
      <div>${targets.map(r => `
        <button class="card interactive" style="display:block;width:100%;text-align:left;margin-bottom:8px" data-act-id="${esc(r.activity.id)}">
          <div style="font-weight:700;color:#fff">${esc(r.activity.title)}</div>
          <div style="color:var(--ink-muted);font-size:12px;margin-top:4px">${esc(fmtDate(r.activity.start_at))}</div>
        </button>`).join('')}</div>
      <div class="actions"><button class="btn ghost" data-act="cancel">Close</button></div>`;
    el.querySelectorAll('[data-act-id]').forEach(b =>
      b.addEventListener('click', () => { close(); runCheckinFlow(targets.find(t => t.activity.id === b.dataset.actId).activity); }));
    el.querySelector('[data-act="cancel"]').addEventListener('click', () => close());
    return el;
  });
}

async function runCheckinFlow(activity) {
  const loading = toast('Locating you…', { kind: 'info', duration: 60_000 });
  let result;
  try {
    result = await validateCheckin(activity);
  } catch (err) {
    toast(`Location error: ${err.message}`, { kind: 'error' });
    return gpsFallbackModal(activity);
  }
  if (result.ok) {
    await api.checkIn({
      activityId: activity.id, method: 'gps',
      lat: result.lat, lng: result.lng, accuracy: result.accuracy,
    });
    toast(`Checked in · ${Math.round(result.distance)} m from meetup`, { kind: 'success', duration: 3500 });
    navigate(`#/activity/${activity.id}`);
    return;
  }
  if (result.reason === 'too_far') {
    toast(`You're ${Math.round(result.distance)} m away — must be within ${result.radius} m.`, { kind: 'error', duration: 4000 });
    return;
  }
  if (result.reason === 'low_accuracy' || result.reason === 'no_meetup') {
    return gpsFallbackModal(activity);
  }
}

function gpsFallbackModal(activity) {
  return openModal((close) => {
    const el = document.createElement('div');
    el.innerHTML = `
      <h3>Confirm you're at the meetup</h3>
      <p>Your GPS accuracy is too low to auto-verify. Only confirm if you're actually at <b>${esc(activity.meetup_name || 'the meetup')}</b>. This will be flagged as a manual check-in.</p>
      <div class="actions">
        <button class="btn ghost" data-act="cancel">Cancel</button>
        <button class="btn accent" data-act="ok"><i class="fa-solid fa-circle-check"></i> I'm here</button>
      </div>`;
    el.querySelector('[data-act="cancel"]').addEventListener('click', () => close(false));
    el.querySelector('[data-act="ok"]').addEventListener('click', async () => {
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

/* ================================================================
   ACTIVITY DETAIL · handles 3 states (not registered / registered / completed)
   ================================================================ */

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

  const stateChip =
    activity.status === 'cancelled' ? `<span class="chip danger">CANCELLED</span>` :
    isPast ? `<span class="chip accent">COMPLETED</span>` :
    reg?.status === 'checked_in' ? `<span class="chip accent">CHECKED IN</span>` :
    reg?.status === 'registered' ? `<span class="chip brand">REGISTERED</span>` :
    `<span class="chip info">OPEN</span>`;

  const groupChoices = Array.isArray(activity.groups) ? activity.groups : [];

  container.innerHTML = `
    <article class="card" style="padding:0;overflow:hidden">
      <div style="aspect-ratio:2.2;background:${activity.cover_url ? `url('${esc(activity.cover_url)}') center/cover` : 'linear-gradient(135deg,#F97316,#22C55E)'};"></div>
      <div style="padding:18px">
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
          ${stateChip}
          ${activity.club ? `<span class="chip ghost"><i class="fa-regular fa-flag"></i>${esc(activity.club.name)}</span>` : ''}
          ${isOwner ? `<span class="chip brand"><i class="fa-solid fa-shield"></i>Organizer</span>` : ''}
        </div>
        <h2 style="margin:0 0 8px;font-family:var(--font-display);color:#fff;font-size:26px">${esc(activity.title)}</h2>
        <p style="color:var(--ink-2);font-size:14px;line-height:1.6;margin:0 0 12px">${esc(activity.description || '')}</p>

        <div class="stat-grid" style="margin-bottom:12px">
          <div class="stat"><div class="v">${esc(new Date(activity.start_at).toLocaleDateString(undefined,{month:'short',day:'numeric'}))}</div><div class="l">Date</div></div>
          <div class="stat"><div class="v">${esc(fmtTime(activity.start_at))}</div><div class="l">Start</div></div>
          <div class="stat"><div class="v">${esc(fmtTime(activity.end_at))}</div><div class="l">End</div></div>
        </div>

        <div class="card card-compact" style="margin-top:0">
          <div style="font-weight:700;color:#fff"><i class="fa-solid fa-location-dot"></i> ${esc(activity.meetup_name || 'Meetup')}</div>
          <div style="color:var(--ink-muted);font-size:12px;margin-top:4px">
            Geofence radius <b>${activity.geofence_m || 50} m</b> · check-in window
            ${activity.checkin_window_start ? esc(fmtTime(activity.checkin_window_start)) : '—'} → ${activity.checkin_window_end ? esc(fmtTime(activity.checkin_window_end)) : '—'}
          </div>
        </div>
        <div id="activity-action-area" style="margin-top:16px"></div>
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

  // Render action area based on state
  const area = $('#activity-action-area', container);
  if (activity.status === 'cancelled') {
    area.innerHTML = `<div class="empty"><i class="fa-solid fa-ban"></i><h3>This activity was cancelled</h3><p>Keep an eye on your club for the next one.</p></div>`;
  } else if (isPast) {
    renderReflectionsArea(container, activity, reg);
  } else if (!reg || reg.status === 'cancelled') {
    renderRegisterForm(area, activity, groupChoices);
  } else if (reg.status === 'registered') {
    renderRegisteredActions(area, activity, reg);
  } else if (reg.status === 'checked_in') {
    area.innerHTML = `
      <div class="card" style="background:var(--accent-soft);border-color:rgba(34,197,94,0.35)">
        <div style="color:#BBF7D0;font-weight:700"><i class="fa-solid fa-circle-check"></i> You're checked in.</div>
        <div style="color:var(--ink-muted);font-size:12.5px;margin-top:4px">Method: ${esc(reg.checkin_method || 'gps')} · at ${esc(fmtTime(reg.checkin_ts))}</div>
      </div>
      <button class="btn block" style="margin-top:12px" data-nav="#/running"><i class="fa-solid fa-play"></i> Go run</button>`;
  }

  // Cancel-activity (organizer)
  if (isOwner) {
    const cancelBtn = $('#cancel-activity', container);
    cancelBtn?.addEventListener('click', async () => {
      if (!await confirmDialog({ title: 'Cancel this activity?', message: 'All registrations will be notified. You can\'t undo this.', danger: true, confirmText: 'Cancel activity' })) return;
      try { await api.cancelActivity(id); toast('Activity cancelled', { kind: 'success' }); navigate('#/discover'); }
      catch (err) { toast(err.message, { kind: 'error' }); }
    });
  }
}

function renderRegisterForm(area, activity, groupChoices) {
  const options = groupChoices.length
    ? groupChoices.map((g, i) => `
        <label class="card card-compact" style="display:flex;align-items:center;gap:10px;cursor:pointer;margin-top:${i?8:0}px">
          <input type="radio" name="group" value="${esc(g.name)}" ${i===0?'checked':''} style="accent-color:var(--brand)" />
          <div style="flex:1">
            <div style="font-weight:700;color:#fff">${esc(g.name)}</div>
            ${g.cap ? `<div style="color:var(--ink-muted);font-size:12px">Cap ${g.cap}</div>` : ''}
          </div>
        </label>`).join('')
    : '';
  area.innerHTML = `
    <form id="register-form">
      ${options ? `<div style="margin-bottom:12px"><div style="font-weight:700;color:#fff;margin-bottom:8px">Choose a group</div>${options}</div>` : ''}
      <button class="btn block lg" type="submit"><i class="fa-solid fa-right-to-bracket"></i> Register</button>
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

function renderRegisteredActions(area, activity, reg) {
  area.innerHTML = `
    <div class="card card-compact" style="background:var(--brand-soft);border-color:rgba(249,115,22,0.35)">
      <div style="color:#FED7AA;font-weight:700"><i class="fa-solid fa-circle-check"></i> You're registered${reg.group_name ? ` in <b>${esc(reg.group_name)}</b>` : ''}.</div>
      <div style="color:var(--ink-muted);font-size:12.5px;margin-top:4px">Tap Map check-in within the window to confirm attendance.</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px">
      <button class="btn" id="do-checkin"><i class="fa-solid fa-location-crosshairs"></i> Map check-in</button>
      <button class="btn ghost" id="do-cancel"><i class="fa-solid fa-ban"></i> Cancel</button>
    </div>`;
  $('#do-checkin', area).addEventListener('click', () => runCheckinFlow(activity));
  $('#do-cancel', area).addEventListener('click', async () => {
    if (!await confirmDialog({ title: 'Cancel registration?', message: 'You\'ll lose your spot. You can register again while capacity lasts.', danger: true, confirmText: 'Yes, cancel' })) return;
    try { await api.cancelRegistration(activity.id); toast('Registration cancelled', { kind: 'info' }); navigate(`#/activity/${activity.id}`); }
    catch (err) { toast(err.message, { kind: 'error' }); }
  });
}

async function renderReflectionsArea(container, activity, myReg) {
  const area = $('#activity-action-area', container);
  area.innerHTML = `
    <div class="section-title"><h2>How was it?</h2></div>
    <div id="reflection-form"></div>
    <div class="section-title"><h2>Reflections</h2><span class="count" id="refl-count">—</span></div>
    <div id="reflections-list"></div>
  `;

  const emojis = ['😀','🔥','💪','😅','🌧️','🌞','🤕','😴','🚀','🥲','🏁','❤️'];
  const existing = await api.getMyReflection(activity.id);
  const formBox = $('#reflection-form', area);
  formBox.innerHTML = `
    <div class="emoji-picker" id="emoji-picker">
      ${emojis.map(e => `<button type="button" data-emoji="${e}" class="${existing?.emoji === e ? 'selected':''}">${e}</button>`).join('')}
    </div>
    <div class="field">
      <label for="note">Notes (optional)</label>
      <textarea id="note" placeholder="Pace, weather, how you felt…">${esc(existing?.note || '')}</textarea>
    </div>
    <button class="btn block" id="save-reflection"><i class="fa-solid fa-floppy-disk"></i> ${existing ? 'Update reflection' : 'Save reflection'}</button>
  `;
  let selected = existing?.emoji || '';
  on(formBox, 'click', '[data-emoji]', (_ev, btn) => {
    selected = btn.dataset.emoji;
    formBox.querySelectorAll('[data-emoji]').forEach(b => b.classList.toggle('selected', b.dataset.emoji === selected));
  });
  $('#save-reflection', formBox).addEventListener('click', async () => {
    if (!selected) return toast('Pick a mood emoji first', { kind: 'warn' });
    try {
      await api.upsertReflection({ activityId: activity.id, emoji: selected, note: $('#note', formBox).value.trim() });
      toast('Reflection saved', { kind: 'success' });
      renderReflectionsArea(container, activity, myReg);
    } catch (err) { toast(err.message, { kind: 'error' }); }
  });

  const listBox = $('#reflections-list', area);
  try {
    const reflections = await api.listActivityReflections(activity.id);
    $('#refl-count', area).textContent = `${reflections.length}`;
    listBox.innerHTML = reflections.length ? reflections.map(r => `
      <div class="card card-compact">
        <div style="display:flex;align-items:center;gap:10px">
          ${avatarHtml(r.user, { size: 'sm' })}
          <div style="flex:1">
            <div style="font-weight:700;color:#fff">${esc(r.user?.display_name || 'Runner')}</div>
            <div style="color:var(--ink-muted);font-size:12px">${esc(fmtDate(r.created_at))}</div>
          </div>
          <div style="font-size:26px">${esc(r.emoji)}</div>
        </div>
        ${r.note ? `<p style="margin:8px 0 0;color:var(--ink-2);font-size:13.5px;line-height:1.5">${esc(r.note)}</p>` : ''}
      </div>`).join('') :
      `<div class="empty"><i class="fa-regular fa-comment-dots"></i><h3>Be the first to reflect</h3><p>Share how the run felt.</p></div>`;
  } catch {
    listBox.innerHTML = `<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><p>Couldn\'t load reflections.</p></div>`;
  }
}

/* ================================================================
   MY ACTIVITIES
   ================================================================ */

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
  async function load() {
    showLoading(listBox, 3);
    const regs = await api.listMyRegistrations({ timeframe: active });
    listBox.innerHTML = regs.length
      ? regs.map(r => activityCard(r.activity, {
          badge: `<span class="chip ${r.status === 'checked_in' ? 'accent' : r.status === 'cancelled' ? 'danger' : 'brand'}">${esc(r.status.replace('_',' '))}</span>`,
        })).join('')
      : `<div class="empty"><i class="fa-regular fa-calendar"></i><h3>Nothing here yet</h3><p>${active === 'upcoming' ? 'Register from Discover.' : 'No past registrations.'}</p></div>`;
    bindActivityCards(listBox);
  }
  on(container, 'click', '[data-tab]', (_ev, btn) => {
    container.querySelectorAll('[data-tab]').forEach(t => t.classList.toggle('active', t === btn));
    active = btn.dataset.tab;
    load();
  });
  load();
}

/* ================================================================
   RUNNING tab · start → record → save
   ================================================================ */

let runState = null; // { startedAt, distance_m, duration_s, timer, registration? }

export async function renderRunning(container) {
  setHeader({ title: 'Running' });
  container.innerHTML = `<div id="run-root"></div>`;
  const root = $('#run-root', container);
  const regs = await api.listMyRegistrations({ timeframe: 'upcoming' });
  const checkedIn = regs.filter(r => r.status === 'checked_in');
  const activeLink = checkedIn[0]?.activity || null;

  if (!runState) {
    root.innerHTML = `
      <div class="run-screen">
        <div class="run-map" aria-label="Map area"><div class="pulse"></div></div>
        <div class="run-big-label">Ready to run</div>
        <div class="run-big">${activeLink ? esc(activeLink.title) : 'Free run'}</div>
        ${activeLink ? `<div style="color:var(--ink-muted);font-size:12px;text-align:center">Linked to your checked-in activity.</div>` : ''}
        <div class="run-ctas">
          <button class="btn lg block accent" id="start-run"><i class="fa-solid fa-play"></i> Start run</button>
        </div>
        <div style="margin-top:16px;display:grid;grid-template-columns:1fr 1fr;gap:8px;width:100%">
          <button class="btn ghost" data-nav="#/my-activities"><i class="fa-regular fa-calendar"></i> My activities</button>
          <button class="btn ghost" data-nav="#/stats"><i class="fa-solid fa-chart-simple"></i> My stats</button>
        </div>
      </div>`;
    on(container, 'click', '[data-nav]', (_ev, el) => navigate(el.dataset.nav));
    $('#start-run', container).addEventListener('click', () => startRun(container, activeLink));
  } else {
    renderRunRecording(container);
  }
}

function startRun(container, activity) {
  runState = {
    startedAt: new Date(),
    distance_m: 0,
    duration_s: 0,
    activity,
    timer: null,
  };
  // Mock telemetry: ~3.2 m/s with some jitter (≈ 5:12/km)
  runState.timer = setInterval(() => {
    runState.duration_s += 1;
    runState.distance_m += 3.1 + Math.random() * 0.8;
    const t = $('#run-timer'); if (t) t.textContent = fmtDuration(runState.duration_s);
    const d = $('#run-distance'); if (d) d.textContent = fmtDistance(runState.distance_m);
    const p = $('#run-pace');
    if (p && runState.distance_m > 50) {
      p.textContent = fmtPace(Math.round((runState.duration_s * 1000) / runState.distance_m));
    }
  }, 1000);
  renderRunRecording(container);
}

function renderRunRecording(container) {
  const { activity } = runState;
  container.innerHTML = `
    <div class="run-screen">
      <div class="run-map" aria-label="Map area"><div class="pulse"></div></div>
      <div class="run-big-label">Distance</div>
      <div class="run-big" id="run-distance">${fmtDistance(runState.distance_m)}</div>
      <div class="run-stats">
        <div class="stat"><div class="v" id="run-timer">${fmtDuration(runState.duration_s)}</div><div class="l">Time</div></div>
        <div class="stat"><div class="v" id="run-pace">—</div><div class="l">Pace</div></div>
      </div>
      ${activity ? `<div style="margin-top:10px;color:var(--ink-muted);font-size:12px">Recording for <b>${esc(activity.title)}</b></div>` : ''}
      <div class="run-ctas">
        <button class="btn ghost" id="pause-run"><i class="fa-solid fa-pause"></i> Pause</button>
        <button class="btn danger block" id="stop-run"><i class="fa-solid fa-stop"></i> Finish & save</button>
      </div>
    </div>`;
  $('#pause-run', container).addEventListener('click', () => {
    if (runState.timer) { clearInterval(runState.timer); runState.timer = null; toast('Paused', { kind: 'info' }); }
    else { runState.timer = setInterval(() => { runState.duration_s++; $('#run-timer').textContent = fmtDuration(runState.duration_s); }, 1000); toast('Resumed', { kind: 'info' }); }
  });
  $('#stop-run', container).addEventListener('click', async () => {
    if (runState.timer) clearInterval(runState.timer);
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
        ended_at: new Date().toISOString(),
      });
      toast(`Saved: ${fmtDistance(snap.distance_m)} in ${fmtDuration(snap.duration_s)}`, { kind: 'success', duration: 4000 });
    } catch (err) {
      toast('Save failed: ' + err.message, { kind: 'error' });
    }
    navigate('#/stats');
  });
}

/* ================================================================
   COMMUNITY tab
   ================================================================ */

export async function renderCommunity(container) {
  setHeader({ title: 'Community' });
  const clubs = await api.listClubs({ mineOnly: true });
  if (!clubs.length) {
    container.innerHTML = `
      <div class="empty" style="margin-top:20px">
        <i class="fa-solid fa-people-group"></i>
        <h3>You're not in any club yet</h3>
        <p>Join a public club or create your own.</p>
        <div style="display:flex;gap:8px;justify-content:center"><button class="btn" data-nav="#/clubs">Browse clubs</button></div>
      </div>`;
    on(container, 'click', '[data-nav]', (_ev, el) => navigate(el.dataset.nav));
    return;
  }

  const active = clubs[0];
  container.innerHTML = `
    <div class="club-header">
      <div class="crest" style="background-image:url('${esc(active.crest_url || '')}')"></div>
      <div style="flex:1">
        <div class="name">${esc(active.name)}</div>
        <div class="sub">${esc(active.description || '')}</div>
      </div>
      ${clubs.length > 1 ? `<button class="icon-btn" data-nav="#/clubs" title="Switch club"><i class="fa-solid fa-repeat"></i></button>` : ''}
    </div>

    <div class="section-title"><h2>Activities</h2><button class="link" id="new-activity-btn">＋ New</button></div>
    <div id="club-activities"></div>

    <div class="section-title"><h2>Monthly mileage</h2><span class="count" id="lb-count">—</span></div>
    <div id="leaderboard"></div>

    <div class="section-title"><h2>Members</h2><span class="count" id="mem-count">—</span></div>
    <div id="members"></div>
  `;
  on(container, 'click', '[data-nav]', (_ev, el) => navigate(el.dataset.nav));
  $('#new-activity-btn', container).addEventListener('click', () => navigate(`#/club/${active.id}/publish`));

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
        return `
          <div class="leader-row">
            <div class="rank rank-${Math.min(i + 1, 3)}">${i + 1}</div>
            <div class="who">
              ${avatarHtml(r, { size: 'sm' })}
              <div class="name">${esc(r.display_name || 'Runner')}</div>
              <span class="trophy" title="${esc(t.name)}">${t.emoji}</span>
            </div>
            <div class="dist">${(r.total_distance_m / 1000).toFixed(1)} km</div>
          </div>`;
      }).join('')
    : `<div class="empty"><i class="fa-solid fa-medal"></i><p>Record your first run to appear here.</p></div>`;

  // Members
  const memBox = $('#members', container);
  const members = await api.listClubMembers(active.id);
  $('#mem-count', container).textContent = `${members.length}`;
  memBox.innerHTML = `
    <div class="card card-compact" style="display:flex;flex-wrap:wrap;gap:10px">
      ${members.map(m => `
        <div style="display:flex;align-items:center;gap:8px;padding:4px 10px 4px 4px;background:var(--surface-2);border-radius:999px">
          ${avatarHtml(m.profile, { size: 'sm' })}
          <span style="font-size:13px">${esc(m.profile?.display_name || 'Runner')}</span>
          ${m.role !== 'member' ? `<span class="chip brand" style="padding:2px 8px;font-size:10px">${esc(m.role)}</span>` : ''}
        </div>`).join('')}
    </div>`;
}

/* ================================================================
   PROFILE tab
   ================================================================ */

export async function renderProfile(container) {
  setHeader({ title: 'Profile' });
  const profile = await api.getMyProfile();
  const runs = await api.listMyRuns({ limit: 200 });
  const totalKm = runs.reduce((s, r) => s + (r.distance_m || 0), 0) / 1000;
  const thisMonth = runs.filter(r => new Date(r.started_at).getMonth() === new Date().getMonth());
  const monthKm = thisMonth.reduce((s, r) => s + (r.distance_m || 0), 0) / 1000;
  const t = tier(totalKm * 1000);

  container.innerHTML = `
    <div class="card" style="display:flex;gap:14px;align-items:center">
      ${avatarHtml(profile, { size: 'lg' })}
      <div style="flex:1">
        <div style="font-family:var(--font-display);font-weight:700;color:#fff;font-size:24px">${esc(profile?.display_name || 'Runner')}</div>
        <div style="color:var(--ink-muted);font-size:12px;margin:4px 0">${esc(profile?.bio || 'No bio yet.')}</div>
        <span class="chip brand">${t.emoji} ${esc(t.name)} tier</span>
      </div>
      <button class="icon-btn" data-nav="#/profile/edit" aria-label="Edit profile"><i class="fa-solid fa-pen"></i></button>
    </div>

    <div class="stat-grid" style="margin-top:14px">
      <div class="stat"><div class="v">${runs.length}</div><div class="l">Total runs</div></div>
      <div class="stat"><div class="v">${totalKm.toFixed(1)}</div><div class="l">Total km</div></div>
      <div class="stat"><div class="v">${monthKm.toFixed(1)}</div><div class="l">This month</div></div>
    </div>

    <div class="section-title"><h2>Shortcuts</h2></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <button class="btn ghost" data-nav="#/my-activities"><i class="fa-regular fa-calendar"></i> My activities</button>
      <button class="btn ghost" data-nav="#/stats"><i class="fa-solid fa-chart-simple"></i> Stats</button>
      <button class="btn ghost" data-nav="#/clubs"><i class="fa-solid fa-people-group"></i> Clubs</button>
      <button class="btn ghost" id="logout-btn"><i class="fa-solid fa-right-from-bracket"></i> Log out</button>
    </div>
  `;
  on(container, 'click', '[data-nav]', (_ev, el) => navigate(el.dataset.nav));
  $('#logout-btn', container).addEventListener('click', async () => {
    await api.signOut();
    toast('Logged out', { kind: 'info' });
  });
}

export async function renderEditProfile(container) {
  setHeader({ title: 'Edit profile', backTo: '#/profile' });
  const p = await api.getMyProfile();
  container.innerHTML = `
    <form id="edit-form" class="card">
      <div style="display:flex;gap:14px;align-items:center;margin-bottom:14px">
        ${avatarHtml(p, { size: 'lg' })}
        <div style="flex:1">
          <div style="font-family:var(--font-display);font-size:22px;color:#fff">${esc(p?.display_name || '')}</div>
          <div style="color:var(--ink-muted);font-size:12px">Your profile is visible to club mates.</div>
        </div>
      </div>
      <div class="field">
        <label>Display name</label>
        <input name="display_name" required minlength="2" maxlength="40" value="${esc(p?.display_name || '')}" />
      </div>
      <div class="field">
        <label>Avatar URL (optional)</label>
        <input name="avatar_url" type="url" value="${esc(p?.avatar_url || '')}" placeholder="https://…" />
      </div>
      <div class="field">
        <label>Bio</label>
        <textarea name="bio" maxlength="240" placeholder="Pace, favourite routes…">${esc(p?.bio || '')}</textarea>
      </div>
      <button class="btn block" type="submit"><i class="fa-solid fa-floppy-disk"></i> Save</button>
    </form>
  `;
  $('#edit-form', container).addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    try {
      await api.updateMyProfile({
        display_name: fd.get('display_name').toString().trim(),
        avatar_url: fd.get('avatar_url').toString().trim() || null,
        bio: fd.get('bio').toString().trim() || null,
      });
      toast('Profile updated', { kind: 'success' });
      navigate('#/profile');
    } catch (err) { toast(err.message, { kind: 'error' }); }
  });
}

/* ================================================================
   STATS
   ================================================================ */

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
      <div style="font-family:var(--font-display);font-size:28px;color:#fff">${fmtDistance(longest.distance_m)}</div>
      <div style="color:var(--ink-muted);font-size:12px">${esc(fmtDate(longest.started_at))} · ${fmtDuration(longest.duration_s)} · ${fmtPace(longest.avg_pace_s_per_km)}</div>
    </div>

    <div class="section-title"><h2>Recent</h2><span class="count">${runs.length} total</span></div>
    <div>${runs.slice(0,20).map(r => `
      <div class="card card-compact">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:40px;height:40px;border-radius:10px;background:var(--brand-soft);display:flex;align-items:center;justify-content:center;color:var(--brand)">
            <i class="fa-solid fa-person-running"></i>
          </div>
          <div style="flex:1">
            <div style="font-weight:700;color:#fff">${fmtDistance(r.distance_m)} · ${fmtDuration(r.duration_s)}</div>
            <div style="color:var(--ink-muted);font-size:12px">${esc(fmtDate(r.started_at))} · ${fmtPace(r.avg_pace_s_per_km)}</div>
          </div>
        </div>
      </div>`).join('')}</div>
  `;
}

/* ================================================================
   CLUBS · switcher + create + join
   ================================================================ */

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
  const memberships = (await supabaseHelperMemberships(user.id));
  const mineIds = new Set(memberships);
  const render = (mode) => {
    if (mode === 'new') return renderCreateClubForm(body);
    const subset = mode === 'mine' ? all.filter(c => mineIds.has(c.id)) : all;
    body.innerHTML = subset.length ? subset.map(c => clubCard(c, mineIds)).join('')
      : `<div class="empty"><i class="fa-solid fa-people-group"></i><p>No clubs here yet.</p></div>`;
    on(body, 'click', '[data-join]', async (_ev, el) => {
      await api.joinClub(el.dataset.join);
      toast('Joined', { kind: 'success' });
      renderClubs(container);
    });
    on(body, 'click', '[data-manage]', (_ev, el) => navigate(`#/club/${el.dataset.manage}/manage`));
    on(body, 'click', '[data-open]', (_ev, el) => navigate(`#/community`));
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
      <div class="crest" style="width:56px;height:56px;border-radius:14px;background:var(--elev) center/cover url('${esc(c.crest_url || '')}')"></div>
      <div style="flex:1;min-width:0">
        <div style="font-family:var(--font-display);font-size:20px;color:#fff">${esc(c.name)}</div>
        <div style="color:var(--ink-muted);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.description || '')}</div>
      </div>
      ${joined
        ? `<button class="btn ghost sm" data-open>Open</button>`
        : `<button class="btn sm" data-join="${esc(c.id)}">Join</button>`}
    </article>`;
}

function renderCreateClubForm(body) {
  body.innerHTML = `
    <form id="create-club-form" class="card">
      <div class="field"><label>Club name</label><input name="name" required minlength="2" maxlength="60" /></div>
      <div class="field"><label>Description</label><textarea name="description" maxlength="240" placeholder="When, where, and what you run."></textarea></div>
      <div class="field"><label>Crest URL (optional)</label><input name="crest_url" type="url" placeholder="https://…" /></div>
      <div class="field"><label>Timezone</label>
        <select name="timezone">
          <option value="Asia/Shanghai">Asia/Shanghai</option>
          <option value="UTC">UTC</option>
          <option value="Europe/London">Europe/London</option>
          <option value="America/New_York">America/New_York</option>
        </select>
      </div>
      <div class="field"><label>Visibility</label>
        <select name="visibility">
          <option value="public">Public — anyone can find it</option>
          <option value="private">Private — invite-only</option>
        </select>
      </div>
      <button class="btn block" type="submit"><i class="fa-solid fa-plus"></i> Create</button>
    </form>`;
  $('#create-club-form', body).addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    try {
      const club = await api.createClub({
        name: fd.get('name').toString().trim(),
        description: fd.get('description').toString().trim() || null,
        crest_url: fd.get('crest_url').toString().trim() || null,
        timezone: fd.get('timezone').toString(),
        visibility: fd.get('visibility').toString(),
      });
      toast(`Club "${club.name}" created`, { kind: 'success' });
      navigate(`#/community`);
    } catch (err) { toast(err.message, { kind: 'error' }); }
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
      <div style="font-family:var(--font-display);font-size:22px;color:#fff">${esc(club.name)}</div>
      <div style="color:var(--ink-muted);font-size:12px;margin-top:4px">${esc(club.description || '')}</div>
    </div>

    <div class="section-title"><h2>Activities</h2>
      <button class="link" id="new-act">＋ New activity</button>
    </div>

    <div class="section-title"><h2>Members · ${members.length}</h2></div>
    <div id="members-mgmt"></div>

    ${isOwner ? `<div class="section-title"><h2>Danger zone</h2></div>
    <div class="card" style="border-color:rgba(239,68,68,0.35)">
      <p style="color:var(--ink-2);font-size:13.5px;margin:0 0 10px">Leaving a club you own requires transferring ownership first.</p>
    </div>` : `<button class="btn ghost block" id="leave-club" style="margin-top:12px"><i class="fa-solid fa-right-from-bracket"></i> Leave club</button>`}
  `;
  $('#new-act', container).addEventListener('click', () => navigate(`#/club/${id}/publish`));
  const memBox = $('#members-mgmt', container);
  memBox.innerHTML = members.map(m => `
    <div class="card card-compact" style="display:flex;align-items:center;gap:10px">
      ${avatarHtml(m.profile, { size: 'sm' })}
      <div style="flex:1">
        <div style="font-weight:700;color:#fff">${esc(m.profile?.display_name)}</div>
        <div style="color:var(--ink-muted);font-size:12px">${esc(m.role)}</div>
      </div>
    </div>`).join('') || `<div class="empty"><p>No members yet.</p></div>`;

  $('#leave-club', container)?.addEventListener('click', async () => {
    if (!await confirmDialog({ title: 'Leave this club?', message: 'You can rejoin later as long as it\'s public.', danger: true, confirmText: 'Leave' })) return;
    try { await api.leaveClub(id); toast('Left the club', { kind: 'info' }); navigate('#/clubs'); }
    catch (err) { toast(err.message, { kind: 'error' }); }
  });
}

/* ================================================================
   PUBLISH ACTIVITY (organizer)
   ================================================================ */

export async function renderPublishActivity(container, { clubId }) {
  setHeader({ title: 'Publish activity', backTo: '#/community' });
  const club = await api.getClub(clubId);
  if (!club) { container.innerHTML = `<div class="empty"><h3>Club not found</h3></div>`; return; }

  container.innerHTML = `
    <div class="card"><b>${esc(club.name)}</b> · timezone <span class="chip ghost">${esc(club.timezone)}</span></div>
    <form id="publish-form" class="card" style="margin-top:12px">
      <div class="field"><label>Title</label><input name="title" required maxlength="80" placeholder="Sunset Bund 5K" /></div>
      <div class="field"><label>Description</label><textarea name="description" placeholder="Route, pace, who this is for."></textarea></div>
      <div class="field"><label>Cover image URL (optional)</label><input name="cover_url" type="url" placeholder="https://…" /></div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div class="field"><label>Start</label><input type="datetime-local" name="start_at" required /></div>
        <div class="field"><label>End</label><input type="datetime-local" name="end_at" required /></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div class="field"><label>Check-in opens</label><input type="datetime-local" name="checkin_window_start" /></div>
        <div class="field"><label>Check-in closes</label><input type="datetime-local" name="checkin_window_end" /></div>
      </div>

      <div class="field"><label>Meetup name</label><input name="meetup_name" placeholder="Bund Lighthouse" /></div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
        <div class="field"><label>Latitude</label><input name="meetup_lat" type="number" step="0.000001" /></div>
        <div class="field"><label>Longitude</label><input name="meetup_lng" type="number" step="0.000001" /></div>
        <div class="field"><label>Geofence (m)</label><input name="geofence_m" type="number" value="50" min="20" max="200" /></div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div class="field"><label>Total capacity</label><input name="total_cap" type="number" min="1" /></div>
        <div class="field"><label>Groups (comma-separated)</label><input name="groups" placeholder="5K Chill, 5K Push" /></div>
      </div>

      <button class="btn block" type="submit"><i class="fa-solid fa-bullhorn"></i> Publish</button>
      <button type="button" class="ghost-btn" id="use-location" style="margin-top:8px;width:100%">
        <i class="fa-solid fa-location-crosshairs"></i> Use my current location
      </button>
    </form>
  `;

  $('#use-location', container).addEventListener('click', async () => {
    try {
      const pos = await getCurrentPosition();
      container.querySelector('[name=meetup_lat]').value = pos.lat.toFixed(6);
      container.querySelector('[name=meetup_lng]').value = pos.lng.toFixed(6);
      toast('Filled your current coordinates.', { kind: 'success' });
    } catch (err) { toast(err.message, { kind: 'error' }); }
  });

  $('#publish-form', container).addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const groups = (fd.get('groups')||'').toString().split(',').map(s => s.trim()).filter(Boolean).map(n => ({ name: n }));
    try {
      const a = await api.createActivity({
        club_id: clubId,
        title: fd.get('title').toString(),
        description: fd.get('description').toString() || null,
        cover_url: fd.get('cover_url').toString() || null,
        start_at: new Date(fd.get('start_at')).toISOString(),
        end_at: new Date(fd.get('end_at')).toISOString(),
        checkin_window_start: fd.get('checkin_window_start') ? new Date(fd.get('checkin_window_start')).toISOString() : null,
        checkin_window_end:   fd.get('checkin_window_end')   ? new Date(fd.get('checkin_window_end')).toISOString()   : null,
        meetup_name: fd.get('meetup_name').toString() || null,
        meetup_lat: fd.get('meetup_lat') ? Number(fd.get('meetup_lat')) : null,
        meetup_lng: fd.get('meetup_lng') ? Number(fd.get('meetup_lng')) : null,
        geofence_m: Number(fd.get('geofence_m') || 50),
        total_cap: fd.get('total_cap') ? Number(fd.get('total_cap')) : null,
        groups,
        status: 'published',
      });
      toast('Activity published!', { kind: 'success' });
      navigate(`#/activity/${a.id}`);
    } catch (err) { toast(err.message, { kind: 'error' }); }
  });
}

/* ================================================================
   DATA DASHBOARD (organizer-only)
   ================================================================ */

export async function renderDataDashboard(container, { activityId }) {
  setHeader({ title: 'Dashboard', backTo: `#/activity/${activityId}` });
  const activity = await api.getActivity(activityId);
  const rows = await api.listActivityRegistrations(activityId);
  const total = rows.length;
  const checkedIn = rows.filter(r => r.status === 'checked_in').length;
  const cancelled = rows.filter(r => r.status === 'cancelled').length;

  container.innerHTML = `
    <div class="card">
      <div style="font-family:var(--font-display);font-size:22px;color:#fff">${esc(activity.title)}</div>
      <div style="color:var(--ink-muted);font-size:12px">${esc(fmtDate(activity.start_at))}</div>
    </div>
    <div class="stat-grid" style="margin-top:12px">
      <div class="stat"><div class="v">${total}</div><div class="l">Registered</div></div>
      <div class="stat"><div class="v">${checkedIn}</div><div class="l">Checked in</div></div>
      <div class="stat"><div class="v">${cancelled}</div><div class="l">Cancelled</div></div>
    </div>
    <div class="section-title"><h2>Roster</h2></div>
    <div class="card" style="padding:0;overflow:hidden">
      <table class="table">
        <thead><tr><th>Runner</th><th>Group</th><th>Status</th><th>Check-in</th></tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td>${esc(r.user?.display_name || 'Runner')}</td>
              <td>${esc(r.group_name || '—')}</td>
              <td><span class="chip ${r.status === 'checked_in' ? 'accent' : r.status === 'cancelled' ? 'danger' : 'brand'}">${esc(r.status.replace('_',' '))}</span></td>
              <td style="color:var(--ink-muted);font-size:12px">${r.checkin_ts ? esc(fmtTime(r.checkin_ts)) + ' · ' + esc(r.checkin_method || '') : '—'}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}
