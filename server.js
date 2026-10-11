import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const SITE_URL = (process.env.SITE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SQ_TOKEN = process.env.SQUARE_ACCESS_TOKEN, SQ_LOCATION = process.env.SQUARE_LOCATION_ID;
const square = SQ_TOKEN && SQ_LOCATION;
const SQ_BASE = process.env.SQUARE_ENV === 'production' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com';
async function sq(method, urlPath, body) {
  const r = await fetch(SQ_BASE + urlPath, {
    method,
    headers: { 'Square-Version': '2024-10-17', Authorization: `Bearer ${SQ_TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Square ${r.status}: ${JSON.stringify(data.errors || data)}`);
  return data;
}

// ---------- database ----------
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'site.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS admins (id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    duration_min INTEGER NOT NULL DEFAULT 50, price_cents INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS availability (
    id INTEGER PRIMARY KEY, weekday INTEGER NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY, service_id INTEGER, service_name TEXT NOT NULL, price_cents INTEGER NOT NULL,
    date TEXT NOT NULL, time TEXT NOT NULL, duration_min INTEGER NOT NULL,
    name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL, paid INTEGER NOT NULL DEFAULT 0, payment_ref TEXT,
    created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS testimonials (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, rating INTEGER NOT NULL DEFAULT 5, body TEXT NOT NULL,
    approved INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
    salt TEXT NOT NULL, hash TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS tokens (
    hash TEXT PRIMARY KEY, email TEXT NOT NULL, expires INTEGER NOT NULL);
`);

for (const sql of ["ALTER TABLE services ADD COLUMN format TEXT NOT NULL DEFAULT 'either'", "ALTER TABLE bookings ADD COLUMN mode TEXT NOT NULL DEFAULT 'online'"]) { try { db.exec(sql); } catch { /* already added */ } }
try { db.exec('ALTER TABLE bookings RENAME COLUMN stripe_session TO payment_ref'); } catch { /* already current */ }

const DEFAULTS = {
  brandName: 'Abide & Thrive',
  tagline: 'Christian mental health coaching',
  heroTitle: 'You don’t have to carry it all alone.',
  heroSubtitle: 'Faith-centered, one-on-one coaching to help you manage stress, build healthy habits, and grow in peace and purpose — at a pace that feels safe.',
  verse: 'I am the vine, ye are the branches: He that abideth in me, and I in him, the same bringeth forth much fruit.',
  verseRef: 'John 15:5',
  verseVersion: 'KJV',
  verseAttribution: '',
  aboutTitle: 'Meet your coach',
  coachName: 'Your Name Here',
  coachCredentials: 'Add your credentials and certifications here',
  coachPhoto: '',
  aboutBody: 'Tell your story here. Share your walk with Christ, why you became a coach, who you love working with, and what clients can expect when they work with you.\n\nSeparate paragraphs with a blank line.',
  approachTitle: 'How coaching works',
  steps: [
    { title: 'Book a discovery call', body: 'A free, no-pressure conversation to see if we are a good fit.' },
    { title: 'Set your goals', body: 'We name what you want to change and build a plan, grounded in your faith and your real life.' },
    { title: 'Meet regularly', body: 'Weekly or bi-weekly sessions with practical tools, Scripture, prayer, and accountability.' },
  ],
  faq: [
    { q: 'What does “Christian-based” mean in sessions?', a: 'Your faith is welcome here. Sessions are rooted in a biblical worldview, and I can include Scripture and prayer. Edit this answer to describe your approach and church or denominational background.' },
    { q: 'Do I have to be a Christian to work with you?', a: 'Please edit this to match your practice. Example: Coaching is centered on Christian faith, so it is best suited to clients who want faith included in their growth.' },
    { q: 'Can I opt out of prayer or Scripture in a session?', a: 'Yes. Sessions go at your comfort level. Edit this answer to match how you work.' },
    { q: 'Is coaching the same as therapy?', a: 'No. Christian coaching is goal-focused and forward-looking. It does not diagnose or treat mental health conditions and is not a substitute for licensed therapy, medical care, or pastoral counseling.' },
    { q: 'What is your cancellation policy?', a: 'Please give at least 24 hours’ notice to reschedule or cancel. Edit this answer to match your policy.' },
    { q: 'Are sessions confidential?', a: 'Yes. What you share stays between us, except where safety concerns or the law require otherwise.' },
  ],
  email: 'hello@example.com',
  phone: '',
  location: 'Online or in person',
  inPersonAddress: '123 Main Street, Suite 4, Your City, ST 12345',
  onlineInfo: 'A private video link will be emailed to you before your session.',
  timezone: 'America/Chicago',
  minNoticeHours: 24,
  horizonDays: 60,
  bufferMin: 10,
  blockedDates: '',
  disclaimer: 'Christian coaching is not therapy or medical care and is not intended for emergencies. If you are in crisis or thinking about harming yourself, call or text 988 (U.S. Suicide & Crisis Lifeline) or call 911.',
};

// Bible versions and their required attribution. The verse text itself is typed in by the admin; nothing is bundled.
const BIBLE_VERSIONS = {
  KJV: { name: 'King James Version', pd: true, notice: 'Scripture quotations are from the King James Version (KJV), which is in the public domain.' },
  WEB: { name: 'World English Bible', pd: true, notice: 'Scripture quotations are from the World English Bible (WEB), which is in the public domain.' },
  ASV: { name: 'American Standard Version', pd: true, notice: 'Scripture quotations are from the American Standard Version (ASV), which is in the public domain.' },
  ESV: { name: 'English Standard Version', notice: 'Scripture quotations are from the ESV® Bible (The Holy Bible, English Standard Version®), © 2001 by Crossway, a publishing ministry of Good News Publishers. Used by permission. All rights reserved.' },
  NIV: { name: 'New International Version', notice: 'Scripture quotations taken from The Holy Bible, New International Version® NIV®. Copyright © 1973, 1978, 1984, 2011 by Biblica, Inc.® Used by permission. All rights reserved worldwide.' },
  NLT: { name: 'New Living Translation', notice: 'Scripture quotations are taken from the Holy Bible, New Living Translation, copyright © 1996, 2004, 2015 by Tyndale House Foundation. Used by permission of Tyndale House Publishers, a Division of Tyndale House Ministries, Carol Stream, Illinois 60188. All rights reserved.' },
  NKJV: { name: 'New King James Version', notice: 'Scripture taken from the New King James Version®. Copyright © 1982 by Thomas Nelson. Used by permission. All rights reserved.' },
  NASB: { name: 'New American Standard Bible', notice: 'Scripture quotations taken from the (NASB®) New American Standard Bible®, Copyright © 1960, 1971, 1977, 1995, 2020 by The Lockman Foundation. Used by permission. All rights reserved. www.lockman.org' },
  CSB: { name: 'Christian Standard Bible', notice: 'Scripture quotations marked CSB have been taken from the Christian Standard Bible®, Copyright © 2017 by Holman Bible Publishers. Used by permission. Christian Standard Bible® and CSB® are federally registered trademarks of Holman Bible Publishers.' },
};
const bibleList = () => [...Object.entries(BIBLE_VERSIONS).map(([code, v]) => ({ code, name: v.name, pd: !!v.pd })), { code: 'OTHER', name: 'Other (write your own attribution)', pd: false }];
function verseDisplay(s) {
  if (!s.verse) return { verseCite: '', verseNotice: '' };
  const v = BIBLE_VERSIONS[s.verseVersion];
  const hasParen = /\([^)]*\)\s*$/.test(s.verseRef);
  return {
    verseCite: v && !hasParen ? `${s.verseRef} (${s.verseVersion})` : s.verseRef,
    verseNotice: v ? v.notice : s.verseAttribution,
  };
}

const getSettings = () => {
  const out = { ...DEFAULTS };
  for (const r of db.prepare('SELECT key, value FROM settings').all()) {
    if (r.key in DEFAULTS) { try { out[r.key] = JSON.parse(r.value); } catch { /* ignore */ } }
  }
  return out;
};
const setSettings = (obj) => {
  const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [k, v] of Object.entries(obj)) if (k in DEFAULTS) up.run(k, JSON.stringify(v));
};

const OLD_DISCOVERY = 'A short, no-pressure conversation to talk about your goals and see if we are a good fit.';
const OLD_SESSION = 'A focused one-on-one session covering stress, habits, boundaries, motivation, or whatever matters most to you right now.';

// seed on first run
if (!db.prepare('SELECT COUNT(*) c FROM services').get().c) {
  const ins = db.prepare('INSERT INTO services (name, description, duration_min, price_cents, sort) VALUES (?,?,?,?,?)');
  ins.run('Free Discovery Call', OLD_DISCOVERY, 20, 0, 1);
  ins.run('Individual Coaching Session', OLD_SESSION, 50, 9500, 2);
  ins.run('Extended Deep-Dive Session', 'A longer session for big transitions, goal planning, or working through a tough season.', 80, 14000, 3);
  const av = db.prepare('INSERT INTO availability (weekday, start, end) VALUES (?,?,?)');
  for (const d of [1, 2, 3, 4, 5]) av.run(d, '09:00', '17:00');
}
db.prepare('UPDATE services SET description = ? WHERE description = ?').run('A short, no-pressure conversation about your goals and how faith-centered coaching could help. No obligation.', OLD_DISCOVERY);
db.prepare('UPDATE services SET description = ? WHERE description = ?').run('A focused one-on-one session on stress, habits, boundaries, motivation, or whatever matters most right now, with Scripture and prayer if you’d like them.', OLD_SESSION);
const verseRow = db.prepare("SELECT value FROM settings WHERE key = 'verse'").get();
if (verseRow && verseRow.value.includes('in them.,')) {
  db.prepare("UPDATE settings SET value = ? WHERE key = 'verse'").run(verseRow.value.replace('in them.,', 'in them,'));
}
// one-time: infer the Bible version from a reference like "John 15:5 (NLT)" saved before versions existed
if (!db.prepare("SELECT 1 FROM settings WHERE key = 'verseVersion'").get()) {
  let code = 'KJV';
  const refRow = db.prepare("SELECT value FROM settings WHERE key = 'verseRef'").get();
  if (refRow) {
    try {
      const ref = JSON.parse(refRow.value), m = ref.match(/\(([A-Za-z]+)\)\s*$/);
      if (m && BIBLE_VERSIONS[m[1].toUpperCase()]) {
        code = m[1].toUpperCase();
        db.prepare("UPDATE settings SET value = ? WHERE key = 'verseRef'").run(JSON.stringify(ref.replace(/\s*\([A-Za-z]+\)\s*$/, '')));
      }
    } catch { /* leave as is */ }
  }
  db.prepare("INSERT INTO settings (key, value) VALUES ('verseVersion', ?)").run(JSON.stringify(code));
}
const adminCount = db.prepare('SELECT COUNT(*) c FROM admins').get().c;
if (!adminCount) {
  const email = (process.env.ADMIN_EMAIL || 'admin@example.com').toLowerCase();
  const generated = !process.env.ADMIN_PASSWORD;
  const pw = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  const { salt, hash } = hashPw(pw);
  db.prepare('INSERT INTO admins (email, salt, hash) VALUES (?,?,?)').run(email, salt, hash);
  console.log('\n=== Admin account created ===');
  console.log(`  Login:    ${SITE_URL}/admin`);
  console.log(`  Email:    ${email}`);
  console.log(generated ? `  Password: ${pw}   (change it in Admin > Account)` : '  Password: (from ADMIN_PASSWORD)');
  console.log('=============================\n');
}

function hashPw(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(pw, salt, 64).toString('hex') };
}
function checkPw(pw, salt, hash) {
  const a = Buffer.from(crypto.scryptSync(pw, salt, 64).toString('hex'));
  const b = Buffer.from(hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- sessions & rate limiting ----------
const sessions = new Map(); // token -> { adminId, exp }
const csessions = new Map(); // token -> { clientId, exp }
const SESSION_MS = 8 * 3600 * 1000;
const parseCookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
const isSecure = SITE_URL.startsWith('https');
const requireAdmin = (req, res, next) => {
  const s = sessions.get(parseCookies(req).sid);
  if (!s || s.exp < Date.now()) return res.status(401).json({ error: 'Not logged in' });
  s.exp = Date.now() + SESSION_MS;
  req.adminId = s.adminId;
  next();
};
const hits = new Map();
const limit = (name, max, windowMs) => (req, res, next) => {
  const key = `${name}:${req.ip}`;
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
  arr.push(now); hits.set(key, arr);
  next();
};
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of sessions) if (v.exp < now) sessions.delete(k);
  for (const [k, v] of csessions) if (v.exp < now) csessions.delete(k);
  try { db.prepare('DELETE FROM tokens WHERE expires < ?').run(now); } catch { /* ignore */ }
  hits.clear();
}, 3600 * 1000).unref();

// ---------- scheduling helpers ----------
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const toHHMM = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
function nowIn(tz) {
  let parts;
  try {
    parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  } catch { return nowIn('UTC'); }
  return { date: `${parts.year}-${parts.month}-${parts.day}`, min: Number(parts.hour) * 60 + Number(parts.minute) };
}
const dayDiff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const hoursUntil = (date, time, tz) => { const n = nowIn(tz); return (dayDiff(n.date, date) * 1440 + toMin(time) - n.min) / 60; };

function activeBookings(date) {
  const holdCutoff = Date.now() - 30 * 60 * 1000;
  return db.prepare("SELECT time, duration_min FROM bookings WHERE date = ? AND (status = 'confirmed' OR (status = 'pending' AND created_at > ?))").all(date, holdCutoff);
}
function slotsFor(service, date, settings) {
  if (!isDate(date)) return [];
  const { date: today } = nowIn(settings.timezone);
  const diff = dayDiff(today, date);
  if (diff < 0 || diff > settings.horizonDays) return [];
  const blocked = String(settings.blockedDates).split(/[\s,]+/).filter(Boolean);
  if (blocked.includes(date)) return [];
  const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
  const windows = db.prepare('SELECT start, end FROM availability WHERE weekday = ? ORDER BY start').all(weekday);
  const taken = activeBookings(date).map((b) => [toMin(b.time), toMin(b.time) + b.duration_min + settings.bufferMin]);
  const step = Math.min(30, service.duration_min + settings.bufferMin);
  const out = [];
  for (const w of windows) {
    for (let s = toMin(w.start); s + service.duration_min <= toMin(w.end); s += step) {
      const hhmm = toHHMM(s);
      if (hoursUntil(date, hhmm, settings.timezone) < settings.minNoticeHours) continue;
      const e = s + service.duration_min + settings.bufferMin;
      if (taken.some(([a, b]) => s < b && e > a)) continue;
      if (!out.includes(hhmm)) out.push(hhmm);
    }
  }
  return out;
}

// ---------- app ----------
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https:; style-src 'self'; script-src 'self'; form-action 'self'; frame-ancestors 'none'",
  });
  next();
});

// Square webhook needs the raw body, so it goes before express.json()
app.post('/api/square/webhook', express.raw({ type: '*/*' }), (req, res) => {
  const key = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  if (!square || !key) return res.sendStatus(404);
  const url = process.env.SQUARE_WEBHOOK_URL || `${SITE_URL}/api/square/webhook`;
  const expected = crypto.createHmac('sha256', key).update(url + req.body.toString('utf8')).digest('base64');
  const got = String(req.headers['x-square-hmacsha256-signature'] || '');
  if (expected.length !== got.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(got))) return res.status(400).send('Bad signature');
  try {
    const p = JSON.parse(req.body.toString('utf8'))?.data?.object?.payment;
    if (p?.status === 'COMPLETED' && p.order_id) markPaid(p.order_id);
  } catch { /* ignore malformed */ }
  res.json({ received: true });
});
function markPaid(orderId) {
  const r = db.prepare("UPDATE bookings SET status = 'confirmed', paid = 1 WHERE payment_ref = ? AND status != 'cancelled' AND paid = 0").run(orderId);
  if (r.changes) sendBookingEmails(db.prepare('SELECT id FROM bookings WHERE payment_ref = ?').get(orderId).id);
}

app.use(express.json({ limit: '350kb' }));
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && !req.is('application/json')) return res.status(415).json({ error: 'JSON required' });
  next();
});

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
const publicService = (s) => ({ id: s.id, name: s.name, description: s.description, durationMin: s.duration_min, priceCents: s.price_cents, format: s.format });
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// ----- public API -----
app.get('/api/site', (req, res) => {
  const settings = getSettings();
  const services = db.prepare('SELECT * FROM services WHERE active = 1 ORDER BY sort, id').all().map(publicService);
  const testimonials = db.prepare('SELECT name, rating, body, created_at FROM testimonials WHERE approved = 1 ORDER BY created_at DESC').all();
  const cs = csessions.get(parseCookies(req).csid);
  const client = cs && cs.exp >= Date.now() ? db.prepare('SELECT name, email, phone FROM clients WHERE id = ?').get(cs.clientId) : null;
  res.json({ settings: { ...settings, ...verseDisplay(settings) }, services, testimonials, payments: Boolean(square), today: nowIn(settings.timezone).date, client: client || null });
});

app.get('/api/slots', (req, res) => {
  const service = db.prepare('SELECT * FROM services WHERE id = ? AND active = 1').get(Number(req.query.service));
  if (!service) return res.status(404).json({ error: 'Service not found' });
  res.json({ slots: slotsFor(service, String(req.query.date), getSettings()) });
});

app.post('/api/bookings', limit('book', 10, 3600 * 1000), async (req, res) => {
  const b = req.body || {};
  const settings = getSettings();
  const service = db.prepare('SELECT * FROM services WHERE id = ? AND active = 1').get(Number(b.serviceId));
  if (!service) return res.status(400).json({ error: 'Please choose a service.' });
  const name = clean(b.name, 100), email = clean(b.email, 200).toLowerCase(), phone = clean(b.phone, 40), notes = clean(b.notes, 1000);
  if (!name || !emailOk(email)) return res.status(400).json({ error: 'Please enter your name and a valid email.' });
  if (!isDate(b.date) || !isTime(b.time)) return res.status(400).json({ error: 'Please choose a date and time.' });
  if (!b.consent) return res.status(400).json({ error: 'Please confirm you have read the coaching disclaimer.' });
  if (!slotsFor(service, b.date, settings).includes(b.time)) return res.status(409).json({ error: 'Sorry, that time is no longer available. Please pick another.' });

  const mode = service.format === 'either' ? b.mode : service.format;
  if (!['online', 'in_person'].includes(mode)) return res.status(400).json({ error: 'Please choose online or in person.' });
  const needsPay = service.price_cents > 0 && square;
  const info = db.prepare('INSERT INTO bookings (service_id, service_name, price_cents, date, time, duration_min, name, email, phone, notes, status, paid, created_at, mode) VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?,?)')
    .run(service.id, service.name, service.price_cents, b.date, b.time, service.duration_min, name, email, phone, notes, needsPay ? 'pending' : 'confirmed', Date.now(), mode);
  const id = Number(info.lastInsertRowid);
  if (!needsPay) { sendBookingEmails(id); return res.json({ id, status: 'confirmed', payLater: service.price_cents > 0, email }); }

  try {
    const { payment_link: link } = await sq('POST', '/v2/online-checkout/payment-links', {
      idempotency_key: crypto.randomUUID(),
      quick_pay: { name: `${service.name} - ${b.date} ${b.time}`, price_money: { amount: service.price_cents, currency: 'USD' }, location_id: SQ_LOCATION },
      checkout_options: { redirect_url: `${SITE_URL}/?paid=${id}#book` },
      pre_populated_data: { buyer_email: email },
      payment_note: `Booking #${id}: ${service.name} ${b.date} ${b.time} (${settings.timezone})`,
    });
    db.prepare('UPDATE bookings SET payment_ref = ? WHERE id = ?').run(link.order_id, id);
    res.json({ id, status: 'pending', checkoutUrl: link.url });
  } catch (err) {
    console.error('Square error:', err.message);
    db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(id);
    res.status(502).json({ error: 'Payment could not be started. Please try again.' });
  }
});

// Called when the client returns from Square (works even if the webhook is not set up yet)
app.get('/api/bookings/confirm', async (req, res) => {
  const ref = String(req.query.order_id || '');
  const id = Number(req.query.id || 0);
  const row = ref
    ? db.prepare('SELECT * FROM bookings WHERE payment_ref = ?').get(ref)
    : (id ? db.prepare('SELECT * FROM bookings WHERE id = ?').get(id) : null);
  if (!row) return res.status(404).json({ error: 'Booking not found' });
  if (square && row.payment_ref && !row.paid) {
    try {
      const { order } = await sq('GET', `/v2/orders/${encodeURIComponent(row.payment_ref)}`);
      if (order.state === 'COMPLETED' || (order.tenders || []).length) markPaid(row.payment_ref);
    } catch { /* fall through to current status */ }
  }
  const cur = db.prepare('SELECT id, service_name, date, time, duration_min, mode, status, paid, email FROM bookings WHERE id = ?').get(row.id);
  res.json({ id: cur.id, serviceName: cur.service_name, date: cur.date, time: cur.time, durationMin: cur.duration_min, mode: cur.mode, status: cur.status, paid: !!cur.paid, email: cur.email });
});

app.post('/api/testimonials', limit('testimonial', 5, 3600 * 1000), (req, res) => {
  const b = req.body || {};
  const name = clean(b.name, 60), body = clean(b.body, 1500);
  const rating = Math.min(5, Math.max(1, Number(b.rating) || 5));
  if (!name || body.length < 10) return res.status(400).json({ error: 'Please add your name and a few words about your experience.' });
  if (!b.consent) return res.status(400).json({ error: 'Please confirm you are happy for this to be shared publicly.' });
  db.prepare('INSERT INTO testimonials (name, rating, body, approved, created_at) VALUES (?,?,?,0,?)').run(name, Math.round(rating), body, Date.now());
  res.json({ ok: true });
});

// ----- admin API -----
app.post('/api/admin/login', limit('login', 8, 15 * 60 * 1000), (req, res) => {
  const email = clean(req.body?.email, 200).toLowerCase(), pw = String(req.body?.password || '');
  const a = db.prepare('SELECT * FROM admins WHERE email = ?').get(email);
  const ok = a ? checkPw(pw, a.salt, a.hash) : (checkPw(pw, 'x', 'y'.repeat(128)), false);
  if (!ok) return res.status(401).json({ error: 'Incorrect email or password.' });
  const sid = crypto.randomBytes(32).toString('base64url');
  sessions.set(sid, { adminId: a.id, exp: Date.now() + SESSION_MS });
  res.set('Set-Cookie', `sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${isSecure ? '; Secure' : ''}`);
  res.json({ ok: true });
});
app.post('/api/admin/logout', (req, res) => {
  sessions.delete(parseCookies(req).sid);
  res.set('Set-Cookie', 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ ok: true });
});
app.get('/api/admin/me', requireAdmin, (req, res) => {
  const a = db.prepare('SELECT email FROM admins WHERE id = ?').get(req.adminId);
  const s = getSettings();
  res.json({ email: a.email, payments: Boolean(square), siteUrl: SITE_URL, today: nowIn(s.timezone).date, bibleVersions: bibleList() });
});

app.get('/api/admin/settings', requireAdmin, (req, res) => res.json(getSettings()));
app.put('/api/admin/settings', requireAdmin, (req, res) => {
  const b = req.body || {};
  const next = {};
  for (const [k, def] of Object.entries(DEFAULTS)) {
    if (!(k in b)) continue;
    if (typeof def === 'string') next[k] = clean(b[k], k === 'coachPhoto' ? 250000 : 4000);
    else if (typeof def === 'number') next[k] = Math.max(0, Number(b[k]) || 0);
    else if (Array.isArray(def)) {
      if (!Array.isArray(b[k])) continue;
      next[k] = b[k].slice(0, 30).map((it) => Object.fromEntries(Object.keys(def[0]).map((f) => [f, clean(it?.[f], 2000)]))).filter((it) => Object.values(it).some(Boolean));
    }
  }
  if (next.verseVersion && !BIBLE_VERSIONS[next.verseVersion] && next.verseVersion !== 'OTHER') return res.status(400).json({ error: 'Unknown Bible version.' });
  if (next.timezone) { try { new Intl.DateTimeFormat('en', { timeZone: next.timezone }); } catch { return res.status(400).json({ error: 'Unknown time zone (example: America/New_York).' }); } }
  setSettings(next);
  res.json(getSettings());
});

app.get('/api/admin/services', requireAdmin, (req, res) => res.json(db.prepare('SELECT * FROM services ORDER BY sort, id').all()));
app.post('/api/admin/services', requireAdmin, (req, res) => {
  const s = validService(req.body);
  if (s.error) return res.status(400).json(s);
  const info = db.prepare('INSERT INTO services (name, description, duration_min, price_cents, active, sort, format) VALUES (?,?,?,?,?,?,?)').run(s.name, s.description, s.duration_min, s.price_cents, s.active, s.sort, s.format);
  res.json({ id: Number(info.lastInsertRowid) });
});
app.put('/api/admin/services/:id', requireAdmin, (req, res) => {
  const s = validService(req.body);
  if (s.error) return res.status(400).json(s);
  db.prepare('UPDATE services SET name=?, description=?, duration_min=?, price_cents=?, active=?, sort=?, format=? WHERE id=?').run(s.name, s.description, s.duration_min, s.price_cents, s.active, s.sort, s.format, Number(req.params.id));
  res.json({ ok: true });
});
app.delete('/api/admin/services/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM services WHERE id = ?').run(Number(req.params.id)); // past bookings keep their own copy of name/price
  res.json({ ok: true });
});
function validService(b = {}) {
  const name = clean(b.name, 120);
  if (!name) return { error: 'Service name is required.' };
  const duration = Math.round(Number(b.duration_min));
  const price = Math.round(Number(b.price_cents));
  if (!(duration >= 10 && duration <= 480)) return { error: 'Duration must be between 10 and 480 minutes.' };
  if (!(price >= 0 && price <= 10000000)) return { error: 'Price is invalid.' };
  if (price > 0 && price < 100) return { error: 'Paid sessions must be at least $1.00.' };
  if (!['online', 'in_person', 'either'].includes(b.format)) return { error: 'Choose online, in person, or both.' };
  return { name, format: b.format, description: clean(b.description, 1500), duration_min: duration, price_cents: price, active: b.active ? 1 : 0, sort: Math.round(Number(b.sort)) || 0 };
}

app.get('/api/admin/availability', requireAdmin, (req, res) => res.json(db.prepare('SELECT weekday, start, end FROM availability ORDER BY weekday, start').all()));
app.put('/api/admin/availability', requireAdmin, (req, res) => {
  const rows = Array.isArray(req.body) ? req.body : [];
  for (const r of rows) {
    if (!(Number.isInteger(r.weekday) && r.weekday >= 0 && r.weekday <= 6) || !isTime(r.start) || !isTime(r.end) || toMin(r.start) >= toMin(r.end)) return res.status(400).json({ error: 'Each availability window needs a day and a start time earlier than its end time.' });
  }
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM availability').run();
    const ins = db.prepare('INSERT INTO availability (weekday, start, end) VALUES (?,?,?)');
    for (const r of rows) ins.run(r.weekday, r.start, r.end);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  res.json({ ok: true });
});

app.get('/api/admin/bookings', requireAdmin, (req, res) => res.json(db.prepare('SELECT * FROM bookings ORDER BY date DESC, time DESC LIMIT 500').all()));
app.put('/api/admin/bookings/:id', requireAdmin, (req, res) => {
  const status = req.body?.status;
  if (!['confirmed', 'cancelled'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const id = Number(req.params.id);
  const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
  if (!b) return res.status(404).json({ error: 'Booking not found' });
  const s = getSettings();
  if (status === 'confirmed' && b.status === 'cancelled') {
    const start = toMin(b.time), end = start + b.duration_min + s.bufferMin;
    const conflict = activeBookings(b.date).some((other) => {
      const os = toMin(other.time), oe = os + other.duration_min + s.bufferMin;
      return start < oe && end > os;
    });
    if (conflict) return res.status(409).json({ error: 'Cannot restore: another booking now occupies that time slot.' });
  }
  const paid = req.body?.paid === undefined ? null : (req.body.paid ? 1 : 0);
  db.prepare('UPDATE bookings SET status = ?, paid = COALESCE(?, paid) WHERE id = ?').run(status, paid, id);
  if (status === 'cancelled' && b.status !== 'cancelled') {
    sendMail(b.email, `Booking canceled: ${b.service_name}`,
      `Hi ${b.name},\n\nYour ${b.service_name} session on ${when(b)} has been canceled.${b.paid ? ` Since you paid online, ${s.brandName} will follow up regarding your refund.` : ''}\n\nYou can book a new time at ${SITE_URL}/#book or reply to ${s.email}.\n\n${s.brandName}`);
  }
  res.json({ ok: true });
});

app.get('/api/admin/testimonials', requireAdmin, (req, res) => res.json(db.prepare('SELECT * FROM testimonials ORDER BY approved, created_at DESC').all()));
app.post('/api/admin/testimonials', requireAdmin, (req, res) => {
  const b = req.body || {};
  const name = clean(b.name, 60), body = clean(b.body, 1500);
  if (!name || !body) return res.status(400).json({ error: 'Name and testimonial text are required.' });
  db.prepare('INSERT INTO testimonials (name, rating, body, approved, created_at) VALUES (?,?,?,?,?)').run(name, Math.min(5, Math.max(1, Math.round(Number(b.rating) || 5))), body, 1, Date.now());
  res.json({ ok: true });
});
app.put('/api/admin/testimonials/:id', requireAdmin, (req, res) => {
  const b = req.body || {};
  db.prepare('UPDATE testimonials SET name = ?, rating = ?, body = ?, approved = ? WHERE id = ?')
    .run(clean(b.name, 60), Math.min(5, Math.max(1, Math.round(Number(b.rating) || 5))), clean(b.body, 1500), b.approved ? 1 : 0, Number(req.params.id));
  res.json({ ok: true });
});
app.delete('/api/admin/testimonials/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM testimonials WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

app.put('/api/admin/account', requireAdmin, (req, res) => {
  const { currentPassword, newPassword, email } = req.body || {};
  const a = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.adminId);
  if (!checkPw(String(currentPassword || ''), a.salt, a.hash)) return res.status(403).json({ error: 'Current password is incorrect.' });
  if (email !== undefined) {
    const e = clean(email, 200).toLowerCase();
    if (!emailOk(e)) return res.status(400).json({ error: 'Enter a valid email.' });
    db.prepare('UPDATE admins SET email = ? WHERE id = ?').run(e, a.id);
  }
  if (newPassword) {
    if (String(newPassword).length < 10) return res.status(400).json({ error: 'New password must be at least 10 characters.' });
    const { salt, hash } = hashPw(String(newPassword));
    db.prepare('UPDATE admins SET salt = ?, hash = ? WHERE id = ?').run(salt, hash, a.id);
  }
  res.json({ ok: true });
});

// ----- email -----
// Uses Resend (https://resend.com) when RESEND_API_KEY and MAIL_FROM are set; otherwise messages are printed to the console.
async function sendMail(to, subject, text) {
  const key = process.env.RESEND_API_KEY, from = process.env.MAIL_FROM;
  if (!key || !from) { console.log(`\n--- EMAIL (not sent: mail not configured) ---\nTo: ${to}\nSubject: ${subject}\n\n${text}\n---------------------------------------------\n`); return; }
  try {
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to, subject, text }) });
    if (!r.ok) console.error('Email failed:', r.status, await r.text());
  } catch (e) { console.error('Email failed:', e.message); }
}
const when = (b) => `${b.date} at ${toHHMM(toMin(b.time))} (${getSettings().timezone})`;
function sendBookingEmails(id) {
  const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
  if (!b) return;
  const s = getSettings();
  sendMail(b.email, `Your session is booked: ${b.service_name}`,
    `Hi ${b.name},\n\nYou're booked for ${b.service_name} on ${when(b)} (${b.duration_min} minutes, ${b.mode === 'in_person' ? `in person at ${s.inPersonAddress}` : `online. ${s.onlineInfo}`}).\n${b.price_cents > 0 ? (b.paid ? 'Payment received. Thank you!\n' : 'Payment is due at your appointment.\n') : ''}\nTo manage your bookings online, create a free account: ${SITE_URL}/account\n\nNeed to change something? Reply to this email or write to ${s.email}.\n\n${s.brandName}`);
  sendMail(s.email, `New booking: ${b.name} - ${b.service_name}`,
    `${b.name} <${b.email}> ${b.phone}\n${b.service_name} on ${when(b)}\n${b.price_cents > 0 ? (b.paid ? 'PAID' : 'UNPAID') : 'Free'}\n${b.notes ? `Notes: ${b.notes}\n` : ''}\nManage: ${SITE_URL}/admin`);
}

// ----- client accounts (guests book first; accounts are optional and email-verified) -----
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const requireClient = (req, res, next) => {
  const s = csessions.get(parseCookies(req).csid);
  if (!s || s.exp < Date.now()) return res.status(401).json({ error: 'Not logged in' });
  s.exp = Date.now() + SESSION_MS;
  req.client = db.prepare('SELECT * FROM clients WHERE id = ?').get(s.clientId);
  if (!req.client) return res.status(401).json({ error: 'Not logged in' });
  next();
};
const startClientSession = (res, clientId) => {
  const sid = crypto.randomBytes(32).toString('base64url');
  csessions.set(sid, { clientId, exp: Date.now() + SESSION_MS });
  res.append('Set-Cookie', `csid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${isSecure ? '; Secure' : ''}`);
};

// Sends a link to create an account (if they have booked) or reset a password (if they have one). Always answers the same.
app.post('/api/account/start', limit('acct-start', 5, 3600 * 1000), (req, res) => {
  const email = clean(req.body?.email, 200).toLowerCase();
  if (!emailOk(email)) return res.status(400).json({ error: 'Enter a valid email.' });
  const known = db.prepare('SELECT 1 FROM clients WHERE email = ?').get(email) || db.prepare("SELECT 1 FROM bookings WHERE email = ? AND status != 'cancelled'").get(email);
  if (known) {
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO tokens (hash, email, expires) VALUES (?,?,?)').run(sha(token), email, Date.now() + 3600 * 1000);
    const has = db.prepare('SELECT 1 FROM clients WHERE email = ?').get(email);
    sendMail(email, has ? 'Reset your password' : 'Create your account',
      `${has ? 'Use this link to choose a new password' : 'Use this link to finish creating your account and manage your bookings'} (valid for 1 hour):\n\n${SITE_URL}/account?token=${token}\n\nIf you didn't ask for this, you can ignore this email.\n\n${getSettings().brandName}`);
  }
  res.json({ ok: true });
});
app.post('/api/account/setup', limit('acct-setup', 10, 3600 * 1000), (req, res) => {
  const pw = String(req.body?.password || '');
  if (pw.length < 10) return res.status(400).json({ error: 'Password must be at least 10 characters.' });
  const t = db.prepare('SELECT * FROM tokens WHERE hash = ?').get(sha(String(req.body?.token || '')));
  if (!t || t.expires < Date.now()) return res.status(400).json({ error: 'This link has expired. Please request a new one.' });
  db.prepare('DELETE FROM tokens WHERE hash = ?').run(t.hash);
  const { salt, hash } = hashPw(pw);
  const existing = db.prepare('SELECT id FROM clients WHERE email = ?').get(t.email);
  let id;
  if (existing) { db.prepare('UPDATE clients SET salt = ?, hash = ? WHERE id = ?').run(salt, hash, existing.id); id = existing.id; }
  else {
    const last = db.prepare('SELECT name, phone FROM bookings WHERE email = ? ORDER BY id DESC LIMIT 1').get(t.email) || { name: '', phone: '' };
    id = Number(db.prepare('INSERT INTO clients (email, name, phone, salt, hash, created_at) VALUES (?,?,?,?,?,?)').run(t.email, last.name, last.phone, salt, hash, Date.now()).lastInsertRowid);
  }
  startClientSession(res, id);
  res.json({ ok: true });
});
app.post('/api/account/login', limit('acct-login', 8, 15 * 60 * 1000), (req, res) => {
  const email = clean(req.body?.email, 200).toLowerCase(), pw = String(req.body?.password || '');
  const c = db.prepare('SELECT * FROM clients WHERE email = ?').get(email);
  const ok = c ? checkPw(pw, c.salt, c.hash) : (checkPw(pw, 'x', 'y'.repeat(128)), false);
  if (!ok) return res.status(401).json({ error: 'Incorrect email or password.' });
  startClientSession(res, c.id);
  res.json({ ok: true });
});
app.post('/api/account/logout', (req, res) => {
  csessions.delete(parseCookies(req).csid);
  res.append('Set-Cookie', 'csid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ ok: true });
});
app.get('/api/account/me', requireClient, (req, res) => {
  const s = getSettings();
  const bookings = db.prepare('SELECT id, service_name, date, time, duration_min, price_cents, paid, status, mode FROM bookings WHERE email = ? ORDER BY date DESC, time DESC').all(req.client.email)
    .map((b) => ({ ...b, canCancel: b.status !== 'cancelled' && hoursUntil(b.date, b.time, s.timezone) >= s.minNoticeHours }));
  res.json({
    email: req.client.email, name: req.client.name, phone: req.client.phone, bookings,
    minNoticeHours: s.minNoticeHours, contact: s.email, timezone: s.timezone,
    inPersonAddress: s.inPersonAddress, onlineInfo: s.onlineInfo, brandName: s.brandName,
    today: nowIn(s.timezone).date,
  });
});
app.put('/api/account/me', requireClient, (req, res) => {
  db.prepare('UPDATE clients SET name = ?, phone = ? WHERE id = ?').run(clean(req.body?.name, 100), clean(req.body?.phone, 40), req.client.id);
  res.json({ ok: true });
});
app.post('/api/account/bookings/:id/cancel', requireClient, (req, res) => {
  const s = getSettings();
  const b = db.prepare('SELECT * FROM bookings WHERE id = ? AND email = ?').get(Number(req.params.id), req.client.email);
  if (!b || b.status === 'cancelled') return res.status(404).json({ error: 'Booking not found.' });
  if (hoursUntil(b.date, b.time, s.timezone) < s.minNoticeHours) return res.status(400).json({ error: `Sessions can be canceled online up to ${s.minNoticeHours} hours ahead. Please contact ${s.email}.` });
  db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(b.id);
  sendMail(b.email, `Booking canceled: ${b.service_name}`, `Your ${b.service_name} session on ${when(b)} has been canceled.${b.paid ? ` Since you paid online, ${s.brandName} will follow up about your refund.` : ''}\n\nYou can book a new time any time at ${SITE_URL}/#book`);
  sendMail(s.email, `Client canceled: ${b.name} - ${b.service_name}`, `${b.name} <${b.email}> canceled ${b.service_name} on ${when(b)}.\n${b.paid ? 'THIS BOOKING WAS PAID - refund needed (in Square).\n' : ''}`);
  res.json({ ok: true });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// ----- static -----
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/account', (req, res) => res.sendFile(path.join(__dirname, 'public', 'account.html')));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(err.status || 500).json({ error: err.status && err.status < 500 ? err.message : 'Something went wrong.' });
});

app.listen(PORT, () => {
  console.log(`Site running at ${SITE_URL}`);
  console.log(square ? `Square payments: ENABLED (${process.env.SQUARE_ENV === 'production' ? 'production' : 'sandbox'})` : 'Square payments: not configured (paid sessions will be booked as "pay at session")');
});
