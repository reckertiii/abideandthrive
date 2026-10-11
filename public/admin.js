const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'value') n.value = v; else if (k === 'checked') n.checked = v; else n.setAttribute(k, v === true ? '' : v);
  }
  n.append(...kids);
  return n;
};
const api = async (url, method = 'GET', body) => {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && !url.endsWith('/login')) { showLogin(); throw new Error('Please log in again.'); }
  if (!r.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
};
let toastTimer;
const toast = (msg, bad) => {
  const t = $('toast'); t.textContent = msg; t.className = `show${bad ? ' bad' : ''}`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = ''; }, 2800);
};
const run = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };
const money = (c) => (c === 0 ? 'Free' : `$${(c / 100).toFixed(2)}`);
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const fmtDate = (d) => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const fmtTime = (t) => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };

function field(label, input, hint) { return el('label', {}, label, input, hint ? el('span', { class: 'hint' }, hint) : ''); }
const text = (v, extra = {}) => el('input', { value: v ?? '', ...extra });
const area = (v, rows = 3) => { const a = el('textarea', { rows }); a.value = v ?? ''; return a; };

// ---------- login / shell ----------
function showLogin() { $('app').hidden = true; $('login').hidden = false; }
$('loginForm').addEventListener('submit', run(async (e) => {
  e.preventDefault();
  $('loginError').textContent = '';
  try {
    await api('/api/admin/login', 'POST', { email: e.target.email.value, password: e.target.password.value });
    e.target.password.value = '';
    await start();
  } catch (ex) { $('loginError').textContent = ex.message; }
}));
$('logout').addEventListener('click', run(async () => { await api('/api/admin/logout', 'POST', {}); showLogin(); }));
$('tabs').addEventListener('click', (e) => { const t = e.target.dataset?.tab; if (t) openTab(t); });

let me;
async function start() {
  try { me = await api('/api/admin/me'); } catch { return showLogin(); }
  $('login').hidden = true; $('app').hidden = false;
  openTab(location.hash.slice(1) || 'bookings');
}
const tabs = { bookings, content, services, hours, testimonials, account };
function openTab(name) {
  if (!tabs[name]) name = 'bookings';
  location.hash = name;
  document.querySelectorAll('#tabs button[data-tab]').forEach((b) => b.setAttribute('aria-current', String(b.dataset.tab === name)));
  $('panel').replaceChildren(el('p', {}, 'Loading…'));
  run(async () => { $('panel').replaceChildren(await tabs[name]()); })();
}

// ---------- bookings ----------
async function bookings() {
  const rows = await api('/api/admin/bookings');
  const today = me.today || new Date().toISOString().slice(0, 10);
  const act = (id, body) => run(async () => { await api(`/api/admin/bookings/${id}`, 'PUT', body); toast('Updated'); openTab('bookings'); });
  const table = el('table', {},
    el('thead', {}, el('tr', {}, ...['When', 'Client', 'Service', 'Payment', 'Status', ''].map((h) => el('th', {}, h)))),
    el('tbody', {}, ...rows.map((b) => el('tr', {},
      el('td', {}, el('strong', {}, fmtDate(b.date)), el('br'), `${fmtTime(b.time)} (${b.duration_min} min)`),
      el('td', {}, b.name, el('br'), el('a', { href: `mailto:${b.email}` }, b.email), b.phone ? el('br') : '', b.phone, b.notes ? el('br') : '', b.notes ? el('em', { class: 'hint' }, `“${b.notes}”`) : ''),
      el('td', {}, b.service_name, el('br'), el('span', { class: 'hint' }, b.mode === 'in_person' ? 'In person' : 'Online')),
      el('td', {}, `${b.mode === 'in_person' ? 'In person' : 'Online'} · ${money(b.price_cents)} · ${b.price_cents === 0 ? '—' : b.paid ? 'paid' : 'unpaid'}`),
      el('td', {}, el('span', { class: `pill ${b.status}` }, b.status), b.date < today ? el('div', { class: 'hint' }, 'past') : ''),
      el('td', {}, el('div', { class: 'row' },
        b.status !== 'cancelled' ? el('button', { class: 'btn sm plain', onclick: () => { if (confirm('Cancel this booking? The time slot will reopen and the client will be notified.')) act(b.id, { status: 'cancelled' })(); } }, 'Cancel') : el('button', { class: 'btn sm plain', onclick: act(b.id, { status: 'confirmed' }) }, 'Restore'),
        b.price_cents > 0 && b.status !== 'cancelled' ? el('button', { class: 'btn sm plain', onclick: act(b.id, { status: 'confirmed', paid: !b.paid }) }, b.paid ? 'Mark unpaid' : 'Mark paid') : '')))
    )));
  return el('div', {}, el('h2', {}, 'Bookings'),
    me.payments ? '' : el('p', { class: 'notice warn' }, 'Square is not configured, so paid sessions are booked as “pay at session”. Add SQUARE_ACCESS_TOKEN and SQUARE_LOCATION_ID to .env to accept online payments.'),
    rows.length ? el('div', { class: 'tablewrap' }, table) : el('p', { class: 'muted' }, 'No bookings yet.'));
}

// ---------- site content ----------
async function content() {
  const s = await api('/api/admin/settings');
  const inputs = {};
  const simple = (key, label, opts = {}) => {
    inputs[key] = opts.area ? area(s[key], opts.area) : text(s[key], opts.type ? { type: opts.type } : {});
    return field(label, inputs[key], opts.hint);
  };
  const photoInput = text(s.coachPhoto, { placeholder: 'Paste an image URL or upload a photo below' });
  inputs.coachPhoto = photoInput;
  const filePicker = el('input', { type: 'file', accept: 'image/*' });
  filePicker.addEventListener('change', () => {
    const file = filePicker.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 280;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        photoInput.value = c.toDataURL('image/jpeg', 0.84);
        toast('Photo ready — click Save changes below');
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

  const listEditor = (key, fields, addLabel) => {
    let items = s[key].map((i) => ({ ...i }));
    const box = el('div', { class: 'stack' });
    const draw = () => box.replaceChildren(...items.map((it, idx) => el('div', { class: 'item' },
      ...fields.map(([f, label, rows]) => {
        const inp = rows ? area(it[f], rows) : text(it[f]);
        inp.addEventListener('input', () => { it[f] = inp.value; });
        return field(label, inp);
      }),
      el('button', { type: 'button', class: 'btn sm plain', onclick: () => { items.splice(idx, 1); draw(); } }, 'Remove'))),
    el('button', { type: 'button', class: 'btn sm plain', onclick: () => { items.push(Object.fromEntries(fields.map(([f]) => [f, '']))); draw(); } }, addLabel));
    draw();
    return { box, get: () => items };
  };
  const versionPicker = () => {
    const sel = el('select', {}, ...me.bibleVersions.map((v) => el('option', { value: v.code, selected: s.verseVersion === v.code }, `${v.code} - ${v.name}${v.pd ? ' (public domain)' : ''}`)));
    const other = text(s.verseAttribution);
    const otherBox = field('Attribution text (required for “Other”)', other, 'Copy the exact copyright notice your Bible publisher asks for.');
    const hint = el('p', { class: 'hint' });
    const sync = () => {
      const v = me.bibleVersions.find((x) => x.code === sel.value);
      otherBox.hidden = sel.value !== 'OTHER';
      hint.textContent = sel.value === 'OTHER' ? '' : v.pd ? 'Public domain: free to quote. A short attribution line is still shown in the footer.' : 'Copyrighted translation. The publisher’s required notice is added to the footer automatically. Check the publisher’s limits on how much you may quote (usually fine for a verse or two).';
    };
    sel.addEventListener('change', sync); sync();
    inputs.verseVersion = sel; inputs.verseAttribution = other;
    return el('div', {}, field('Bible version', sel), hint, otherBox);
  };
  const steps = listEditor('steps', [['title', 'Step title'], ['body', 'Description', 2]], '+ Add step');
  const faq = listEditor('faq', [['q', 'Question'], ['a', 'Answer', 3]], '+ Add question');

  const form = el('form', { class: 'stack', onsubmit: run(async (e) => {
    e.preventDefault();
    const body = { steps: steps.get(), faq: faq.get() };
    for (const [k, i] of Object.entries(inputs)) body[k] = i.value;
    await api('/api/admin/settings', 'PUT', body);
    toast('Saved — site updated');
  }) },
  el('h2', {}, 'Site content'),
  el('div', { class: 'card' }, el('h3', {}, 'Home page'), simple('brandName', 'Business name'), simple('tagline', 'Tagline (small text above headline)'), simple('heroTitle', 'Headline'), simple('heroSubtitle', 'Intro paragraph', { area: 3 }), simple('verse', 'Scripture verse (optional)', { area: 2, hint: 'Type or paste the verse in the version you pick below. Leave blank to hide it.' }), simple('verseRef', 'Verse reference', { hint: 'e.g. John 15:5. The version is added automatically.' }), versionPicker()),
  el('div', { class: 'card' }, el('h3', {}, 'About you'), simple('aboutTitle', 'Section title'), simple('coachName', 'Your name'), simple('coachCredentials', 'Credentials / tagline'),
    field('Coach photo (optional)', photoInput, 'Leave blank to show your initials badge, or choose an image file below to resize and embed automatically.'),
    field('Upload photo file', filePicker),
    simple('aboutBody', 'About text', { area: 8, hint: 'Leave a blank line between paragraphs.' })),
  el('div', { class: 'card stack' }, el('h3', {}, 'How it works'), simple('approachTitle', 'Box title'), steps.box),
  el('div', { class: 'card stack' }, el('h3', {}, 'FAQ'), faq.box),
  el('div', { class: 'card' }, el('h3', {}, 'Contact & footer'), el('div', { class: 'two' }, simple('email', 'Contact email'), simple('phone', 'Phone (optional)')), simple('location', 'Short location line (footer)', { hint: 'e.g. “Online or in person in Austin, TX”' }), simple('inPersonAddress', 'In-person address', { hint: 'Shown to clients who choose an in-person session.' }), simple('onlineInfo', 'Online session note', { hint: 'Shown to clients who choose online, e.g. how they will get the video link.' }), simple('disclaimer', 'Disclaimer shown in footer', { area: 3 })),
  el('div', { class: 'card' }, el('h3', {}, 'Booking rules'),
    simple('timezone', 'Your time zone', { hint: 'IANA name, e.g. America/New_York, America/Chicago, America/Los_Angeles' }),
    el('div', { class: 'two' }, simple('minNoticeHours', 'Minimum notice (hours)', { type: 'number' }), simple('horizonDays', 'How far ahead clients can book (days)', { type: 'number' })),
    simple('bufferMin', 'Buffer between sessions (minutes)', { type: 'number' }),
    simple('blockedDates', 'Days off (vacation, holidays)', { area: 2, hint: 'Dates as YYYY-MM-DD, separated by commas or spaces.' })),
  el('button', { class: 'btn', type: 'submit' }, 'Save changes'));
  return form;
}

// ---------- services ----------
async function services() {
  const list = await api('/api/admin/services');
  const card = (s) => {
    const isNew = !s;
    s = s || { name: '', description: '', duration_min: 50, price_cents: 0, active: 1, sort: list.length + 1 };
    const name = text(s.name), desc = area(s.description, 3);
    const dur = text(s.duration_min, { type: 'number', min: 10, max: 480 });
    const price = text((s.price_cents / 100).toFixed(2), { type: 'number', min: 0, step: '0.01' });
    const sort = text(s.sort, { type: 'number' });
    const format = el('select', {}, ...[['either', 'Online or in person (client chooses)'], ['online', 'Online only'], ['in_person', 'In person only']].map(([v, l]) => el('option', { value: v, selected: s.format === v }, l)));
    const active = el('input', { type: 'checkbox', checked: !!s.active });
    return el('form', { class: 'item', onsubmit: run(async (e) => {
      e.preventDefault();
      const body = { name: name.value, description: desc.value, duration_min: dur.value, price_cents: Math.round(Number(price.value) * 100), format: format.value, sort: sort.value, active: active.checked };
      await api(isNew ? '/api/admin/services' : `/api/admin/services/${s.id}`, isNew ? 'POST' : 'PUT', body);
      toast('Saved'); openTab('services');
    }) },
    field('Service name', name), field('Description', desc),
    el('div', { class: 'two' }, field('Length (minutes)', dur), field('Price (USD)', price, 'Enter 0 for a free session.')),
    el('div', { class: 'two' }, field('Format', format), field('Display order', sort)),
    el('label', { class: 'check' }, active, el('span', {}, 'Show on website & allow booking')),
    el('div', { class: 'row' }, el('button', { class: 'btn sm', type: 'submit' }, isNew ? 'Add service' : 'Save'),
      isNew ? '' : el('button', { type: 'button', class: 'btn sm danger', onclick: run(async () => { if (confirm(`Delete “${s.name}”? Existing bookings are kept.`)) { await api(`/api/admin/services/${s.id}`, 'DELETE'); toast('Deleted'); openTab('services'); } }) }, 'Delete')));
  };
  return el('div', { class: 'stack' }, el('h2', {}, 'Services & pricing'), ...list.map(card), el('h3', {}, 'Add a new service'), card(null));
}

// ---------- availability ----------
async function hours() {
  const rows = (await api('/api/admin/availability')).map((r) => ({ ...r }));
  const box = el('div', { class: 'stack' });
  const draw = () => box.replaceChildren(...DAYS.map((name, d) => {
    const mine = rows.filter((r) => r.weekday === d);
    return el('div', { class: 'item' }, el('strong', {}, name),
      mine.length ? '' : el('p', { class: 'hint' }, 'Unavailable'),
      ...mine.map((r) => {
        const a = el('input', { type: 'time', value: r.start }), b = el('input', { type: 'time', value: r.end });
        a.addEventListener('input', () => { r.start = a.value; }); b.addEventListener('input', () => { r.end = b.value; });
        return el('div', { class: 'row' }, a, 'to', b, el('button', { type: 'button', class: 'btn sm plain', onclick: () => { rows.splice(rows.indexOf(r), 1); draw(); } }, 'Remove'));
      }),
      el('button', { type: 'button', class: 'btn sm plain', onclick: () => { rows.push({ weekday: d, start: '09:00', end: '17:00' }); draw(); } }, '+ Add hours'));
  }));
  draw();
  return el('div', { class: 'stack' }, el('h2', {}, 'Weekly availability'),
    el('p', { class: 'muted' }, 'Clients can book any open time inside these windows. Sessions are offered back-to-back, with your buffer from Site content › Booking rules.'),
    box, el('button', { class: 'btn', onclick: run(async () => { await api('/api/admin/availability', 'PUT', rows); toast('Availability saved'); }) }, 'Save availability'));
}

// ---------- testimonials ----------
async function testimonials() {
  const list = await api('/api/admin/testimonials');
  const card = (t) => {
    const name = text(t.name), body = area(t.body, 3);
    const rating = el('select', {}, ...[5, 4, 3, 2, 1].map((n) => el('option', { value: n, selected: t.rating === n }, '★'.repeat(n))));
    const save = (approved) => run(async () => { await api(`/api/admin/testimonials/${t.id}`, 'PUT', { name: name.value, body: body.value, rating: rating.value, approved }); toast('Saved'); openTab('testimonials'); });
    return el('div', { class: 'item' },
      el('p', {}, el('span', { class: `pill ${t.approved ? '' : 'pending'}` }, t.approved ? 'Published' : 'Awaiting review'), ' ', el('span', { class: 'hint' }, new Date(t.created_at).toLocaleDateString())),
      el('div', { class: 'two' }, field('Name', name), field('Rating', rating)), field('Testimonial', body),
      el('div', { class: 'row' },
        t.approved ? el('button', { class: 'btn sm', onclick: save(true) }, 'Save') : el('button', { class: 'btn sm', onclick: save(true) }, 'Approve & publish'),
        t.approved ? el('button', { class: 'btn sm plain', onclick: save(false) }, 'Unpublish') : el('button', { class: 'btn sm plain', onclick: save(false) }, 'Save draft'),
        el('button', { class: 'btn sm danger', onclick: run(async () => { if (confirm('Delete this testimonial permanently?')) { await api(`/api/admin/testimonials/${t.id}`, 'DELETE'); openTab('testimonials'); } }) }, 'Delete')));
  };
  const n = text(''), b = area('', 3), r = el('select', {}, ...[5, 4, 3, 2, 1].map((x) => el('option', { value: x }, '★'.repeat(x))));
  const add = el('form', { class: 'item', onsubmit: run(async (e) => {
    e.preventDefault();
    await api('/api/admin/testimonials', 'POST', { name: n.value, body: b.value, rating: r.value });
    toast('Added'); openTab('testimonials');
  }) }, field('Client name', n), field('Rating', r), field('Testimonial (record one you received by phone, email, or in person)', b), el('button', { class: 'btn sm', type: 'submit' }, 'Add & publish'));
  const pending = list.filter((t) => !t.approved);
  return el('div', { class: 'stack' }, el('h2', {}, 'Testimonials'),
    pending.length ? el('p', { class: 'notice warn' }, `${pending.length} awaiting your review`) : '',
    ...list.map(card), el('h3', {}, 'Record a testimonial yourself'), add);
}

// ---------- account ----------
async function account() {
  const email = text(me.email, { type: 'email' }), cur = text('', { type: 'password', autocomplete: 'current-password' }), next = text('', { type: 'password', autocomplete: 'new-password' });
  return el('form', { class: 'card stack', onsubmit: run(async (e) => {
    e.preventDefault();
    const body = { currentPassword: cur.value, email: email.value };
    if (next.value) body.newPassword = next.value;
    await api('/api/admin/account', 'PUT', body);
    me.email = email.value; cur.value = ''; next.value = ''; toast('Account updated');
  }) }, el('h2', {}, 'Account'),
  field('Login email', email), field('New password (leave blank to keep current)', next, 'At least 10 characters.'),
  field('Current password (required to save)', cur), el('button', { class: 'btn', type: 'submit' }, 'Update account'));
}

start();
