const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v);
  }
  n.append(...kids);
  return n;
};
const money = (c) => (c === 0 ? 'Free' : `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`);
const fmtTime = (t) => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const fmtDate = (d) => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const api = async (url, opts) => {
  const r = await fetch(url, opts && { ...opts, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opts.body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
};

let site, state = { service: null, date: '', time: '', mode: '' };
const FORMAT = { online: 'Online', in_person: 'In person', either: 'Online or in person' };
const modeLabel = (m) => (m === 'in_person' ? 'In person' : 'Online');

function paragraphs(text) {
  return String(text).split(/\n\s*\n/).filter(Boolean).map((p) => el('p', {}, p));
}

function render() {
  const s = site.settings;
  document.title = `${s.brandName} | Christian Mental Health Coaching`;
  $('brand').textContent = s.brandName; $('fBrand').textContent = s.brandName;
  $('tagline').textContent = s.tagline; $('heroTitle').textContent = s.heroTitle; $('heroSubtitle').textContent = s.heroSubtitle;
  $('verse').textContent = s.verse ? `“${s.verse}”` : ''; $('verseRef').textContent = s.verseRef; $('verseBox').hidden = !s.verse;
  $('aboutTitle').textContent = s.aboutTitle; $('coachName').textContent = s.coachName; $('coachCredentials').textContent = s.coachCredentials;
  $('aboutBody').replaceChildren(...paragraphs(s.aboutBody));
  $('approachTitle').textContent = s.approachTitle;
  $('steps').replaceChildren(...s.steps.map((st) => el('li', {}, el('strong', {}, st.title), st.body)));
  $('disclaimer').textContent = s.disclaimer;
  $('fLocation').textContent = s.location;
  $('fEmail').textContent = s.email; $('fEmail').href = `mailto:${s.email}`;
  $('fPhoneWrap').replaceChildren(...(s.phone ? ['· ', el('a', { href: `tel:${s.phone.replace(/[^\d+]/g, '')}` }, s.phone)] : []));
  $('year').textContent = new Date().getFullYear();
  $('tzNote').textContent = `Times shown in ${s.timezone.replace(/_/g, ' ')} time.`;

  $('serviceList').replaceChildren(...site.services.map((v) => el('article', { class: 'card' },
    el('h3', {}, v.name),
    el('p', { class: 'price' }, money(v.priceCents)),
    el('p', { class: 'meta' }, `${v.durationMin} minutes · ${FORMAT[v.format]}`),
    el('p', {}, v.description),
    el('a', { class: 'btn small', href: '#book', onclick: () => pickService(v.id) }, 'Book this'))));

  $('svcPick').replaceChildren(...site.services.map((v) => el('label', {},
    el('input', { type: 'radio', name: 'svc', value: v.id, onchange: () => pickService(v.id) }),
    el('span', {}, el('strong', {}, v.name), el('br'), el('span', { class: 'meta' }, `${v.durationMin} min · ${FORMAT[v.format]} · ${money(v.priceCents)}`)))));

  const t = site.testimonials;
  $('tList').replaceChildren(...(t.length ? t.map((x) => el('figure', { class: 'card' },
    el('div', { class: 'stars', 'aria-label': `${x.rating} out of 5 stars` }, '★'.repeat(x.rating) + '☆'.repeat(5 - x.rating)),
    el('blockquote', {}, `“${x.body}”`),
    el('figcaption', { class: 'quote-by' }, `— ${x.name}`))) : [el('p', { class: 'muted' }, 'Client stories will appear here soon.')]));

  $('faqList').replaceChildren(...s.faq.map((f) => el('details', { class: 'q' }, el('summary', {}, f.q), el('p', {}, f.a))));

  $('dateInput').min = new Date().toISOString().slice(0, 10);
  $('payNote').textContent = site.payments
    ? 'Paid sessions are completed through secure Square checkout.'
    : 'Payment for paid sessions is collected at your appointment.';
  if (!site.services.length) $('booker').hidden = true;
}

function pickService(id) {
  state.service = site.services.find((s) => s.id === Number(id));
  state.time = '';
  state.mode = state.service.format === 'either' ? '' : state.service.format;
  document.querySelectorAll('input[name=mode]').forEach((r) => { r.checked = false; });
  $('modeBox').hidden = state.service.format !== 'either';
  $('modeNote').textContent = state.service.format === 'in_person' ? `In person: ${site.settings.inPersonAddress}` : state.service.format === 'online' ? site.settings.onlineInfo : '';
  const radio = document.querySelector(`input[name=svc][value="${id}"]`);
  if (radio) radio.checked = true;
  loadSlots(); updateSummary();
}

async function loadSlots() {
  const box = $('slots');
  if (!state.service || !state.date) { box.replaceChildren(el('p', { class: 'muted' }, 'Choose a service and date to see times.')); return; }
  box.replaceChildren(el('p', { class: 'muted' }, 'Loading…'));
  try {
    const { slots } = await api(`/api/slots?service=${state.service.id}&date=${state.date}`);
    box.replaceChildren(...(slots.length
      ? slots.map((t) => el('button', { type: 'button', class: 'slot', 'aria-pressed': 'false', onclick: (e) => selectTime(t, e.currentTarget) }, fmtTime(t)))
      : [el('p', { class: 'muted' }, 'No openings that day. Please try another date.')]));
  } catch (e) { box.replaceChildren(el('p', { class: 'error' }, e.message)); }
}

function selectTime(t, btn) {
  state.time = t;
  document.querySelectorAll('.slot').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
  updateSummary();
}

function updateSummary() {
  const ready = state.service && state.date && state.time && state.mode;
  $('summary').textContent = ready
    ? `${state.service.name} (${state.mode ? modeLabel(state.mode) : 'choose online or in person'}) · ${fmtDate(state.date)} at ${fmtTime(state.time)} · ${money(state.service.priceCents)}`
    : 'Nothing selected yet.';
  const btn = $('bookBtn');
  btn.disabled = !ready;
  btn.textContent = !ready ? (state.service && state.date && state.time ? 'Choose online or in person' : 'Select a time')
    : state.service.priceCents > 0 && site.payments ? `Continue to payment (${money(state.service.priceCents)})` : 'Confirm booking';
}

function notice(text, warn, email) {
  const box = el('div', { class: `notice${warn ? ' warn' : ''}` }, text);
  if (email) {
    const offer = el('p', {}, 'Want to view or cancel your bookings online later? ');
    const btn = el('button', { class: 'btn small', type: 'button' }, 'Create a free account');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try { await api('/api/account/start', { method: 'POST', body: { email } }); offer.textContent = `Done! We’ve emailed a link to ${email} to set your password.`; }
      catch (e) { offer.textContent = e.message; }
    });
    offer.append(btn); box.append(offer);
  }
  $('bookNotice').replaceChildren(box);
  $('book').scrollIntoView();
}

document.querySelectorAll('input[name=mode]').forEach((r) => r.addEventListener('change', () => {
  state.mode = r.value;
  $('modeNote').textContent = r.value === 'in_person' ? `In person: ${site.settings.inPersonAddress}` : site.settings.onlineInfo;
  updateSummary();
}));

$('dateInput').addEventListener('change', (e) => { state.date = e.target.value; state.time = ''; loadSlots(); updateSummary(); });

$('bookForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, err = $('bookError');
  err.textContent = '';
  if (!f.name.value.trim() || !f.email.validity.valid || !f.email.value) { err.textContent = 'Please enter your name and a valid email.'; return; }
  if (!f.consent.checked) { err.textContent = 'Please confirm the disclaimer checkbox.'; return; }
  $('bookBtn').disabled = true;
  try {
    const r = await api('/api/bookings', { method: 'POST', body: {
      serviceId: state.service.id, mode: state.mode, date: state.date, time: state.time,
      name: f.name.value, email: f.email.value, phone: f.phone.value, notes: f.notes.value, consent: true } });
    if (r.checkoutUrl) { location.href = r.checkoutUrl; return; }
    notice(`You’re booked! ${state.service.name} (${modeLabel(state.mode)}) on ${fmtDate(state.date)} at ${fmtTime(state.time)}.${r.payLater ? ' Payment is due at your appointment.' : ''} A confirmation email is on its way.`, false, r.email);
    f.reset(); state.time = ''; loadSlots(); updateSummary();
  } catch (ex) {
    err.textContent = ex.message; updateSummary(); loadSlots();
  }
});

$('tForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  $('tError').textContent = ''; $('tOk').textContent = '';
  if (!f.name.value.trim() || f.body.value.trim().length < 10) { $('tError').textContent = 'Please add your name and a few words.'; return; }
  if (!f.consent.checked) { $('tError').textContent = 'Please tick the consent box.'; return; }
  try {
    await api('/api/testimonials', { method: 'POST', body: { name: f.name.value, rating: f.rating.value, body: f.body.value, consent: true } });
    $('tOk').textContent = 'Thank you! Your testimonial will appear once it has been reviewed.'; f.reset();
  } catch (ex) { $('tError').textContent = ex.message; }
});

async function handleReturn() {
  const q = new URLSearchParams(location.search);
  if (q.get('orderId') || q.get('paid')) {
    try {
      const b = await api(`/api/bookings/confirm?order_id=${encodeURIComponent(q.get('orderId') || '')}`);
      if (b.paid) notice(`Payment received — you’re booked! ${b.serviceName} on ${fmtDate(b.date)} at ${fmtTime(b.time)}. A confirmation email is on its way.`, false, b.email);
      else notice('We haven’t received confirmation of your payment yet. If you were charged, please email us.', true);
    } catch { notice('We couldn’t find that booking. Please contact us if you were charged.', true); }
    history.replaceState(null, '', '/#book');
  }
}

try {
  site = await api('/api/site');
  render();
  await handleReturn();
} catch (e) {
  document.querySelector('main').prepend(el('p', { class: 'wrap error' }, 'Sorry, the site failed to load. Please refresh.'));
}
