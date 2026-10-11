const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'value') n.value = v; else n.setAttribute(k, v === true ? '' : v);
  }
  n.append(...kids);
  return n;
};
const api = async (url, method = 'GET', body) => {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data.error || 'Something went wrong.'); e.status = r.status; throw e; }
  return data;
};
let timer;
const toast = (msg, bad) => { const t = $('toast'); t.textContent = msg; t.className = `show${bad ? ' bad' : ''}`; clearTimeout(timer); timer = setTimeout(() => { t.className = ''; }, 3000); };
const money = (c) => (c === 0 ? 'Free' : `$${(c / 100).toFixed(2)}`);
const fmtDate = (d) => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const fmtTime = (t) => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const field = (label, input) => el('label', {}, label, input);
const show = (...nodes) => $('root').replaceChildren(el('p', {}, el('a', { href: '/' }, '← Back to site')), ...nodes);

// Shown after "forgot password" or "create account" requests
function requestForm(title, intro) {
  const email = el('input', { type: 'email', required: true, autocomplete: 'email' });
  const msg = el('p', { class: 'ok', role: 'status' }), err = el('p', { class: 'error', role: 'alert' });
  return el('form', { class: 'card', onsubmit: async (e) => {
    e.preventDefault(); err.textContent = ''; msg.textContent = '';
    try { await api('/api/account/start', 'POST', { email: email.value }); msg.textContent = 'If that email has a booking or account, a link is on its way. Check your inbox (and spam).'; }
    catch (ex) { err.textContent = ex.message; }
  } }, el('h2', {}, title), el('p', { class: 'muted' }, intro), field('Email', email), err, msg, el('button', { class: 'btn', type: 'submit' }, 'Email me a link'));
}

function loginView() {
  const email = el('input', { type: 'email', required: true, autocomplete: 'username' });
  const pw = el('input', { type: 'password', required: true, autocomplete: 'current-password' });
  const err = el('p', { class: 'error', role: 'alert' });
  show(
    el('form', { class: 'card', onsubmit: async (e) => {
      e.preventDefault(); err.textContent = '';
      try { await api('/api/account/login', 'POST', { email: email.value, password: pw.value }); dashboard(); } catch (ex) { err.textContent = ex.message; }
    } }, el('h1', {}, 'My bookings'), field('Email', email), field('Password', pw), err, el('button', { class: 'btn', type: 'submit' }, 'Log in')),
    requestForm('First time here, or forgot your password?', 'Enter the email you used to book and we’ll send a link to set your password. You don’t need an account to book.'));
}

function setupView(token) {
  const pw = el('input', { type: 'password', required: true, minlength: 10, autocomplete: 'new-password' });
  const err = el('p', { class: 'error', role: 'alert' });
  show(el('form', { class: 'card', onsubmit: async (e) => {
    e.preventDefault(); err.textContent = '';
    try { await api('/api/account/setup', 'POST', { token, password: pw.value }); history.replaceState(null, '', '/account'); dashboard(); } catch (ex) { err.textContent = ex.message; }
  } }, el('h1', {}, 'Choose a password'), el('p', { class: 'muted' }, 'At least 10 characters. You’ll use it with your email to log in.'), field('New password', pw), err, el('button', { class: 'btn', type: 'submit' }, 'Save & continue')));
}

function pad2(n) { return String(n).padStart(2, '0'); }
function endLocalStamp(dateStr, timeStr, addMin = 50) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = timeStr.split(':').map(Number);
  const total = h * 60 + mi + addMin;
  const dt = new Date(Date.UTC(y, mo - 1, d, Math.floor(total / 60), total % 60, 0));
  return `${dt.getUTCFullYear()}${pad2(dt.getUTCMonth() + 1)}${pad2(dt.getUTCDate())}T${pad2(dt.getUTCHours())}${pad2(dt.getUTCMinutes())}00`;
}

async function dashboard() {
  let me;
  try { me = await api('/api/account/me'); } catch (e) { return e.status === 401 ? loginView() : show(el('p', { class: 'error' }, e.message)); }
  const today = me.today || new Date().toISOString().slice(0, 10);
  const upcoming = me.bookings.filter((b) => b.status !== 'cancelled' && b.date >= today).reverse();
  const past = me.bookings.filter((b) => !upcoming.includes(b));
  const dlIcs = (b) => {
    const title = `${b.service_name} — ${me.brandName || 'Abide & Thrive'}`;
    const loc = b.mode === 'in_person' ? me.inPersonAddress : 'Online (Video Session)';
    const desc = b.mode === 'in_person' ? `In-person session at ${me.inPersonAddress}` : (me.onlineInfo || 'Online video session');
    const startLocal = `${b.date.replace(/-/g, '')}T${b.time.replace(':', '')}00`;
    const endLocal = endLocalStamp(b.date, b.time, b.duration_min);
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Abide & Thrive//Coaching//EN',
      'BEGIN:VEVENT',
      `UID:booking-${b.id}@abideandthrive`,
      `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')}`,
      `DTSTART;TZID=${me.timezone}:${startLocal}`,
      `DTEND;TZID=${me.timezone}:${endLocal}`,
      `SUMMARY:${title}`,
      `LOCATION:${String(loc || '').replace(/,/g, '\\,')}`,
      `DESCRIPTION:${String(desc || '').replace(/\n/g, '\\n')}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const a = el('a', {
      href: URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' })),
      download: `session-${b.date}.ics`,
    });
    a.click();
  };
  const card = (b) => el('div', { class: 'item' },
    el('strong', {}, b.service_name), ' ', el('span', { class: `pill ${b.status === 'confirmed' ? '' : b.status}` }, b.status),
    el('p', {}, `${fmtDate(b.date)} at ${fmtTime(b.time)} · ${b.duration_min} min · ${b.mode === 'in_person' ? 'In person' : 'Online'} · ${money(b.price_cents)}${b.price_cents ? (b.paid ? ' (paid)' : ' (unpaid)') : ''}`),
    upcoming.includes(b) ? el('div', { class: 'row' },
      el('button', { class: 'btn sm plain', type: 'button', onclick: () => dlIcs(b) }, '📅 Add to Calendar'),
      b.canCancel
        ? el('button', { class: 'btn sm plain', onclick: async () => {
          if (!confirm('Cancel this session?')) return;
          try { await api(`/api/account/bookings/${b.id}/cancel`, 'POST', {}); toast('Canceled'); dashboard(); } catch (ex) { toast(ex.message, true); }
        } }, 'Cancel session')
        : el('span', { class: 'hint' }, `Within ${me.minNoticeHours} hours of the session. Please email ${me.contact} to change it.`),
      el('a', { class: 'btn sm plain', href: '/#book' }, 'Book another')) : '');
  const name = el('input', { value: me.name, maxlength: 100 }), phone = el('input', { value: me.phone, type: 'tel', maxlength: 40 });
  show(
    el('h1', {}, 'My bookings'), el('p', { class: 'muted' }, `Signed in as ${me.email}. Times are in ${me.timezone.replace(/_/g, ' ')} time.`),
    el('h2', {}, 'Upcoming'), ...(upcoming.length ? upcoming.map(card) : [el('p', { class: 'muted' }, 'Nothing scheduled. '), el('a', { class: 'btn', href: '/#book' }, 'Book a session')]),
    el('h2', {}, 'Past & canceled'), ...(past.length ? past.map(card) : [el('p', { class: 'muted' }, 'None yet.')]),
    el('form', { class: 'card', onsubmit: async (e) => { e.preventDefault(); try { await api('/api/account/me', 'PUT', { name: name.value, phone: phone.value }); toast('Saved'); } catch (ex) { toast(ex.message, true); } } },
      el('h2', {}, 'My details'), field('Name', name), field('Phone', phone), el('button', { class: 'btn sm', type: 'submit' }, 'Save')),
    el('button', { class: 'btn plain', onclick: async () => { await api('/api/account/logout', 'POST', {}); loginView(); } }, 'Log out'));
}

const token = new URLSearchParams(location.search).get('token');
if (token) setupView(token); else dashboard();
