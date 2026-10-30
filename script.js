/*!
 * PeopleSolve AI — AI-powered Community Complaint Management (India)
 *
 * RUNNING MODE: this build is a complete front-end that stores data in THIS BROWSER ONLY
 * (localStorage + IndexedDB). It is honest about that in the UI. To go to production, connect:
 *   1. Auth + database  -> replace the `DB`/auth functions with calls to your server (hash passwords server-side).
 *   2. AI service       -> set CONFIG.AI_ENDPOINT to YOUR server-side proxy (never put API keys in this file).
 *                          POST {title,description,category,location,incidentDate}; return JSON with
 *                          {category,priority,department,problemAnalysis,whyAttention,possibleSolution[],nextSteps[],missingInfo[]}.
 *   3. Email/SMS        -> for password-reset codes and notifications.
 *   4. Admin roles      -> CONFIG.ADMIN_EMAILS is a client-side convenience only; enforce roles on the server.
 */
(() => {
'use strict';

/* ================= CONFIG ================= */
const CONFIG = {
  TZ: 'Asia/Kolkata',
  ADMIN_EMAILS: [],            // e.g. ['staff@example.com'] — accounts registered with these emails get the admin role
  AI_ENDPOINT: '',             // server-side AI proxy URL; empty = built-in rule-based assistant
  AI_TIMEOUT_MS: 20000,
  MAX_PHOTOS: 5,
  MAX_PHOTO_BYTES: 5 * 1024 * 1024,
  PHOTO_TYPES: ['image/jpeg', 'image/png', 'image/webp'],
  SESSION_MS: 8 * 60 * 60 * 1000,
  PBKDF2_ITER: 150000,
  MAX_FAILS: 5,
  LOCK_MS: 60000
};

/* ================= STATIC DATA ================= */
const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];
const PRIO_COLOR = { Critical: '#E11D48', High: '#F97316', Medium: '#2563EB', Low: '#16A34A' };
const PRIO_HELP = { Critical: 'Immediate danger or serious hazard', High: 'Urgent, affects many people or safety', Medium: 'Needs attention soon', Low: 'Minor or a suggestion' };
const STATUSES = ['Submitted', 'Under Review', 'Assigned to Department', 'In Progress', 'Need More Information', 'Resolved', 'Closed'];
const FLOW = ['Submitted', 'Under Review', 'Assigned to Department', 'In Progress', 'Resolved', 'Closed'];
const stClass = s => 'st-' + s.toLowerCase().replace(/\s+/g, '-');

const CATEGORIES = [
  { id: 'roads', label: 'Roads & Public Works', icon: '🚧', dept: 'roads', phys: true },
  { id: 'water', label: 'Water Supply', icon: '💧', dept: 'water', phys: true },
  { id: 'electricity', label: 'Electricity & Streetlights', icon: '⚡', dept: 'electricity', phys: true },
  { id: 'sanitation', label: 'Sanitation & Waste', icon: '🧹', dept: 'sanitation', phys: true },
  { id: 'drainage', label: 'Drainage & Flooding', icon: '🌧️', dept: 'municipal', phys: true },
  { id: 'health', label: 'Public Health', icon: '🏥', dept: 'health', phys: true },
  { id: 'education', label: 'Education', icon: '🎓', dept: 'education', phys: false },
  { id: 'transport', label: 'Transport', icon: '🚌', dept: 'transport', phys: true },
  { id: 'safety', label: 'Safety & Crime', icon: '🛡️', dept: 'police', phys: true },
  { id: 'cyber', label: 'Cyber Crime & Online Fraud', icon: '💻', dept: 'cyber', phys: false },
  { id: 'consumer', label: 'Consumer Issues', icon: '🛒', dept: 'consumer', phys: false },
  { id: 'parks', label: 'Parks, Trees & Public Spaces', icon: '🌳', dept: 'municipal', phys: true },
  { id: 'other', label: 'Other', icon: '📌', dept: 'other', phys: false }
];
const CAT = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));
const catLabel = id => (CAT[id] || CAT.other).label;

const NO_CONTACT = 'No nationally verified number. Contact details differ by city/state — check the official website.';
const DEPARTMENTS = [
  { id: 'municipal', name: 'Municipal Corporation', icon: '🏙️', handles: ['Street cleaning & local garbage collection', 'Storm drains & waterlogging', 'Parks, trees & public spaces', 'Local roads, footpaths & streetlights', 'Stray animals & encroachment'],
    desc: 'Your city or town’s urban local body looks after everyday civic services inside municipal limits. The name differs by place (Municipal Corporation, Municipality, Nagar Palika; Gram Panchayat in villages).',
    contact: [], web: { url: 'https://www.india.gov.in/', label: 'India.gov.in — National Portal of India' }, webNote: 'Use the National Portal to find your own city’s official website.',
    how: ['Find your city or ward office through the National Portal of India.', 'Use your city’s own grievance app or helpline if one exists.', 'Keep photos, exact location and date ready.', 'If unresolved, lodge a grievance on CPGRAMS.'], portals: ['cpgrams'] },
  { id: 'water', name: 'Water Supply Department', icon: '💧', handles: ['No or low water supply', 'Pipeline leaks & bursts', 'Dirty or contaminated water', 'Water tanker requests', 'Meter and billing problems'],
    desc: 'Water supply is run by the city water board, municipal water wing or a state agency. Contact the one that serves your area.',
    contact: [], web: { url: 'https://www.india.gov.in/', label: 'India.gov.in — National Portal of India' }, webNote: 'Find your local water board via the National Portal.',
    how: ['Note your connection/consumer number from your latest bill.', 'Describe since when the problem exists and how many homes are affected.', 'Raise it with your local water board helpline or website.', 'Escalate through CPGRAMS if not resolved in the promised time.'], portals: ['cpgrams'] },
  { id: 'electricity', name: 'Electricity Department', icon: '⚡', handles: ['Power cuts & voltage problems', 'Street lights not working', 'Dangerous wires, poles & transformers', 'Meter and billing issues'],
    desc: 'Electricity is supplied by your state or city power distribution company (DISCOM). Fallen wires and sparking equipment are emergencies.',
    contact: [{ label: 'Emergency (fallen wire, fire)', value: '112' }], web: { url: 'https://www.india.gov.in/', label: 'India.gov.in — National Portal of India' }, webNote: 'Find your DISCOM through the National Portal.',
    how: ['For a live or fallen wire, stay away and call 112 first.', 'Keep your consumer number and pole/transformer number ready.', 'Report to your DISCOM’s complaint line or website.', 'Escalate through CPGRAMS if needed.'], portals: ['erss', 'cpgrams'] },
  { id: 'roads', name: 'Roads and Public Works', icon: '🚧', handles: ['Potholes & damaged roads', 'Footpaths, bridges & flyovers', 'Missing signs, signals & speed breakers', 'Open manholes and road hazards'],
    desc: 'City roads belong to the municipal body or state PWD. National highways fall under the Ministry of Road Transport and Highways.',
    contact: [], web: { url: 'https://morth.gov.in/', label: 'Ministry of Road Transport & Highways' }, webNote: 'National highways only. For city roads use your municipal body.',
    how: ['Identify who owns the road (city, state or national highway).', 'Photograph the damage with a landmark.', 'Report to the owner; for a highway use the Ministry’s official channels.', 'Escalate through CPGRAMS if needed.'], portals: ['cpgrams'] },
  { id: 'sanitation', name: 'Sanitation and Waste Management', icon: '🧹', handles: ['Missed garbage pickup', 'Overflowing bins & illegal dumping', 'Blocked sewers', 'Public toilet cleanliness'],
    desc: 'Solid-waste and sanitation services are delivered by your urban local body or Gram Panchayat.',
    contact: [], web: { url: 'https://www.india.gov.in/', label: 'India.gov.in — National Portal of India' }, webNote: 'Find your city’s sanitation wing via the National Portal.',
    how: ['Note the locality, ward and how many days pickup was missed.', 'Photograph the waste or overflow.', 'Report to your city’s sanitation helpline or app.', 'Escalate through CPGRAMS if needed.'], portals: ['cpgrams'] },
  { id: 'health', name: 'Public Health Department', icon: '🏥', handles: ['Government hospital & clinic services', 'Mosquito breeding & disease outbreaks', 'Unsafe food or hygiene', 'Medicine availability'],
    desc: 'Public health is run by state health departments with national guidance from the Ministry of Health and Family Welfare.',
    contact: [{ label: 'Medical emergency', value: '112' }], web: { url: 'https://www.mohfw.gov.in/', label: 'Ministry of Health & Family Welfare' }, webNote: 'National ministry site. Your state health department handles local issues.',
    how: ['For a medical emergency call 112 immediately.', 'Note the facility name, date and what happened.', 'Report to the facility head or district health office.', 'Escalate through CPGRAMS if unresolved.'], portals: ['erss', 'cpgrams'] },
  { id: 'education', name: 'Education Department', icon: '🎓', handles: ['School infrastructure & safety', 'Teacher or staff issues in government schools', 'Scholarships & fee concerns', 'Mid-day meal quality'],
    desc: 'Schools are handled by state education departments; the Ministry of Education sets national policy.',
    contact: [], web: { url: 'https://www.education.gov.in/', label: 'Ministry of Education' }, webNote: 'National ministry site. Start with your school, then the district education office.',
    how: ['Raise it with the school head first.', 'Then the block/district education office.', 'Escalate through CPGRAMS if needed.'], portals: ['cpgrams'] },
  { id: 'transport', name: 'Transport Department', icon: '🚌', handles: ['Public bus & metro services', 'Driving licence & vehicle registration', 'Auto/taxi overcharging', 'Parking & traffic problems'],
    desc: 'Transport is run by state transport departments and RTOs; the Parivahan portal hosts many vehicle and licence services.',
    contact: [], web: { url: 'https://parivahan.gov.in/', label: 'Parivahan — Ministry of Road Transport & Highways' }, webNote: 'Licence and registration services. Local services depend on your state.',
    how: ['Note vehicle number, route, date and time.', 'Report to the transport operator or your RTO.', 'Escalate through CPGRAMS if needed.'], portals: ['cpgrams'] },
  { id: 'police', name: 'Police Department', icon: '👮', handles: ['Crimes in progress & threats', 'Theft, harassment & assault', 'Missing persons', 'Traffic accidents'],
    desc: 'Crimes must be reported to the police, not only on this site. In an emergency dial 112. Non-emergency reports go to your local police station or state police website.',
    contact: [{ label: 'Emergency (Police, Fire, Medical)', value: '112' }], web: { url: 'https://112.gov.in/', label: 'ERSS 112 — Emergency Response' }, webNote: 'For non-emergencies, use your state police website or nearest station.',
    how: ['In danger: call 112 immediately.', 'Otherwise visit your nearest police station or your state police’s online citizen services.', 'Keep a copy of any acknowledgement or FIR number.', 'An internal complaint here is NOT an FIR.'], portals: ['erss', 'cyber'], external: true },
  { id: 'cyber', name: 'Cybercrime Reporting', icon: '💻', handles: ['Online financial fraud (UPI, cards, OTP)', 'Hacked accounts & phishing', 'Online harassment & impersonation', 'Fake websites & loan apps'],
    desc: 'Cyber crime is reported on the National Cyber Crime Reporting Portal. For fresh financial fraud, call 1930 quickly — speed matters.',
    contact: [{ label: 'Financial cyber-fraud helpline', value: '1930' }], web: { url: 'https://cybercrime.gov.in/', label: 'National Cyber Crime Reporting Portal' }, webNote: '',
    how: ['Call 1930 immediately for money lost in the last hours.', 'Collect screenshots, transaction IDs, phone numbers, URLs.', 'File the report on the official portal.', 'Save the acknowledgement number it gives you.'], portals: ['cyber'], external: true },
  { id: 'consumer', name: 'Consumer Protection', icon: '🛒', handles: ['Defective products & poor service', 'Refund & warranty refusal', 'Overcharging & misleading ads', 'E-commerce disputes'],
    desc: 'Consumer grievances are handled by the National Consumer Helpline run by the Department of Consumer Affairs.',
    contact: [{ label: 'Toll-free helpline', value: '1915' }, { label: 'WhatsApp / SMS', value: '+91 88000 01915' }], web: { url: 'https://consumerhelpline.gov.in/', label: 'National Consumer Helpline' }, webNote: '',
    how: ['Keep invoice, order ID, seller details and chats.', 'Contact the seller first and note the date.', 'Register a grievance online, by app, WhatsApp or 1915.', 'Save the docket/reference number.'], portals: ['consumer'], external: true },
  { id: 'other', name: 'Other Government Departments', icon: '🏛️', handles: ['Any public service not listed above', 'Delays by central or state government offices', 'Pensions, certificates and other services'],
    desc: 'For other public-service grievances, use CPGRAMS, which connects central and state authorities.',
    contact: [], web: { url: 'https://pgportal.gov.in/', label: 'CPGRAMS — Public Grievance Portal' }, webNote: '',
    how: ['Identify the office or service involved.', 'Gather dates, application numbers and documents.', 'Lodge the grievance on CPGRAMS.', 'Use the registration ID to track it.'], portals: ['cpgrams'], external: true }
];
const DEPT = Object.fromEntries(DEPARTMENTS.map(d => [d.id, d]));

const PORTALS = [
  { id: 'erss', name: 'ERSS 112 — Emergency Response Support System', url: 'https://112.gov.in/', icon: '🚨', tone: 'red',
    handles: 'Emergencies needing Police, Fire & Rescue or Health services. Not for routine complaints.',
    who: 'Anyone in, or witnessing, immediate danger.',
    info: ['Your exact location', 'What is happening and how many people are affected', 'A callback number'],
    how: 'Dial 112 from any phone. On smartphones you can use the 112 India app or the panic (power-button) call.',
    numbers: [{ label: 'Emergency', value: '112' }] },
  { id: 'cyber', name: 'National Cyber Crime Reporting Portal', url: 'https://cybercrime.gov.in/', icon: '💻', tone: 'blue',
    handles: 'Online financial fraud, hacking, phishing, online harassment and other cyber crimes.',
    who: 'Victims or witnesses of cyber crime. For money lost just now, call 1930 first.',
    info: ['Date, time and details of the incident', 'Transaction IDs, bank/UPI details', 'Screenshots, URLs, phone numbers or profiles of the suspect'],
    how: 'Open the official portal and choose the report option that matches your case. Note the acknowledgement number.',
    numbers: [{ label: 'Financial cyber-fraud helpline', value: '1930' }] },
  { id: 'consumer', name: 'National Consumer Helpline (NCH)', url: 'https://consumerhelpline.gov.in/', icon: '🛒', tone: 'orange',
    handles: 'Consumer grievances with products, services, refunds, warranties and e-commerce.',
    who: 'Consumers who have a dispute with a seller or service provider.',
    info: ['Seller/company name and contact', 'Invoice, order ID or payment proof', 'A short description of the problem and what you want'],
    how: 'Register online, via the NCH or UMANG app, on WhatsApp, or by calling 1915 (8 AM–8 PM).',
    numbers: [{ label: 'Toll-free', value: '1915' }, { label: 'WhatsApp / SMS', value: '+91 88000 01915' }] },
  { id: 'cpgrams', name: 'CPGRAMS — Central Public Grievance Redress and Monitoring System', url: 'https://pgportal.gov.in/', icon: '🏛️', tone: 'green',
    handles: 'Grievances about service delivery by central or state government authorities. Not for RTI, court matters, religious matters or government employees’ service matters.',
    who: 'Citizens, 24×7, free of charge. Grievances sent by email are not entertained — use the portal.',
    info: ['Name of the department or office', 'What happened, with dates and reference numbers', 'Your contact details'],
    how: 'Open the portal (or UMANG/CPGRAMS app), lodge a grievance and keep the registration ID to track it.',
    numbers: [] }
];
const PORTAL = Object.fromEntries(PORTALS.map(p => [p.id, p]));
const portalFor = (cat, emergency) => {
  const out = [];
  if (emergency || cat === 'safety') out.push('erss');
  if (cat === 'cyber') out.push('cyber');
  else if (cat === 'consumer') out.push('consumer');
  else if (cat !== 'safety') out.push('cpgrams');
  return [...new Set(out)];
};

/* ================= UTILITIES ================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rnd = n => Array.from(crypto.getRandomValues(new Uint8Array(n)));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : rnd(16).map(b => b.toString(16).padStart(2, '0')).join(''));
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

const TZ = CONFIG.TZ;
const F = {
  date: new Intl.DateTimeFormat('en-IN', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
  time: new Intl.DateTimeFormat('en-IN', { timeZone: TZ, hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }),
  short: new Intl.DateTimeFormat('en-IN', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' }),
  dt: new Intl.DateTimeFormat('en-IN', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }),
  day: new Intl.DateTimeFormat('en-CA', { timeZone: TZ }),
  hour: new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }),
  md: new Intl.DateTimeFormat('en-IN', { timeZone: TZ, day: 'numeric', month: 'short' })
};
const dayKey = ts => F.day.format(ts);
const todayISO = () => dayKey(Date.now());
const ago = ts => {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  if (s < 604800) return `${Math.floor(s / 86400)} d ago`;
  return F.short.format(ts);
};
const timeTag = ts => `<time data-ago="${ts}" datetime="${new Date(ts).toISOString()}" title="${esc(F.dt.format(ts))}">${esc(ago(ts))}</time>`;
const greeting = () => { const h = +F.hour.format(Date.now()); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
const dur = ms => { const m = Math.round(ms / 60000); if (m < 60) return `${m} min`; const h = Math.floor(m / 60); return h < 48 ? `${h} h ${m % 60} m` : `${Math.round(h / 24)} days`; };

/* ================= STORAGE ================= */
const LS = {
  get(k, d) { try { const v = localStorage.getItem('peoplesolve.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('peoplesolve.' + k, JSON.stringify(v)); return true; } catch { return false; } }
};
const DB = { users: [], complaints: [], notifications: [], resets: [] };
const loadDB = () => { for (const k of Object.keys(DB)) DB[k] = LS.get(k, []); };
const save = k => { if (!LS.set(k, DB[k])) toast('Could not save — browser storage is full or blocked.', 'error'); };

const idb = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      if (!window.indexedDB) return rej(new Error('IndexedDB unavailable'));
      const r = indexedDB.open('peoplesolve', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('photos', { keyPath: 'id' }).createIndex('complaintId', 'complaintId');
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => rej(r.error);
    });
  },
  async put(rec) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('photos', 'readwrite'); t.objectStore('photos').put(rec); t.oncomplete = res; t.onerror = () => rej(t.error); }); },
  async byComplaint(id) { const db = await this.open(); return new Promise((res, rej) => { const q = db.transaction('photos').objectStore('photos').index('complaintId').getAll(id); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); },
  async removeByComplaint(id) { const items = await this.byComplaint(id); const db = await this.open(); return new Promise(res => { const t = db.transaction('photos', 'readwrite'); items.forEach(i => t.objectStore('photos').delete(i.id)); t.oncomplete = res; t.onerror = res; }); }
};

/* ================= STATE ================= */
const S = { route: { page: 'dashboard', arg: null }, catScope: 'mine', filters: { q: '', priority: 'all', category: 'all', status: 'all' }, draft: { photos: [], ai: null, key: '' }, prefill: null, modal: false };
let routeFn = () => {}; // set later

/* ================= UI PRIMITIVES ================= */
let actx;
function beep() {
  const u = currentUser();
  if (!u || !u.prefs.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const t = actx.currentTime;
    [[660, 0], [880, .13]].forEach(([f, d]) => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(.0001, t + d); g.gain.exponentialRampToValueAtTime(.12, t + d + .02); g.gain.exponentialRampToValueAtTime(.0001, t + d + .2);
      o.connect(g); g.connect(actx.destination); o.start(t + d); o.stop(t + d + .22);
    });
  } catch { /* audio not available */ }
}
function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span aria-hidden="true">${{ success: '✅', error: '⚠️', info: 'ℹ️', notify: '🔔' }[type] || 'ℹ️'}</span><span>${esc(msg)}</span>`;
  const box = $('#toasts');
  box.appendChild(el);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, 4200);
}
let lastFocus = null;
function openModal(html, label = 'Dialog', wide = false) {
  lastFocus = document.activeElement;
  $('#modalRoot').innerHTML = `<div class="backdrop" data-action="backdrop"><div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(label)}" tabindex="-1"><button class="modal-x" type="button" data-action="close-modal" aria-label="Close dialog">×</button>${html}</div></div>`;
  document.body.classList.add('no-scroll'); S.modal = true;
  $('#modalRoot .modal').focus();
}
function closeModal() {
  $('#modalRoot').innerHTML = ''; document.body.classList.remove('no-scroll'); S.modal = false;
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}
const field = (id, label, o = {}) => {
  const { type = 'text', value = '', ph = '', req = false, hint = '', attrs = '', area = false, rows = 4 } = o;
  const control = area
    ? `<textarea id="${id}" rows="${rows}" placeholder="${esc(ph)}" ${attrs}>${esc(value)}</textarea>`
    : `<input id="${id}" type="${type}" value="${esc(value)}" placeholder="${esc(ph)}" ${attrs}>`;
  return `<div class="field"><label for="${id}">${label}${req ? ' <span class="req" aria-hidden="true">*</span>' : ''}</label>${control}${hint ? `<div class="hint" id="${id}-hint">${hint}</div>` : ''}<div class="error-msg" id="${id}-err"></div></div>`;
};
const selectField = (id, label, opts, value = '', o = {}) =>
  `<div class="field"><label for="${id}">${label}${o.req ? ' <span class="req" aria-hidden="true">*</span>' : ''}</label><select id="${id}" ${o.attrs || ''}>${opts.map(([v, l]) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>${o.hint ? `<div class="hint">${o.hint}</div>` : ''}<div class="error-msg" id="${id}-err"></div></div>`;
function setErr(id, msg) {
  const e = $('#' + id + '-err'), i = $('#' + id);
  if (e) e.textContent = msg || '';
  if (i) { if (msg) { i.setAttribute('aria-invalid', 'true'); i.setAttribute('aria-describedby', id + '-err'); } else { i.removeAttribute('aria-invalid'); } }
  return !msg;
}
const clearErrs = root => { $$('.error-msg', root).forEach(e => e.textContent = ''); $$('[aria-invalid]', root).forEach(i => i.removeAttribute('aria-invalid')); };
const firstInvalid = root => { const i = $('[aria-invalid="true"]', root); if (i) i.focus(); };
const busy = (btn, on, label) => { if (!btn) return; btn.disabled = on; const l = $('.btn-label', btn); if (l) { if (on) { btn.dataset.l = l.textContent; l.textContent = label || 'Please wait…'; } else if (btn.dataset.l) l.textContent = btn.dataset.l; } btn.classList.toggle('loading', on); };

const prioPill = p => `<span class="pill prio-${esc(String(p).toLowerCase())}"><i aria-hidden="true"></i>${esc(p)}</span>`;
const statusPill = s => `<span class="pill ${stClass(s)}"><i aria-hidden="true"></i>${esc(s)}</span>`;
const catPill = id => `<span class="pill pill-cat"><span aria-hidden="true">${CAT[id]?.icon || '📌'}</span>${esc(catLabel(id))}</span>`;
const emptyState = (icon, title, text, cta = '') => `<div class="empty"><div class="empty-icon" aria-hidden="true">${icon}</div><h3>${esc(title)}</h3><p>${text}</p>${cta}</div>`;

/* ================= AUTH ================= */
const b64 = u8 => btoa(String.fromCharCode(...u8));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function hashPw(pw, saltB64) {
  if (!crypto.subtle) throw new Error('Secure hashing needs HTTPS or localhost. Please open this site over HTTPS.');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: unb64(saltB64), iterations: CONFIG.PBKDF2_ITER, hash: 'SHA-256' }, key, 256);
  return b64(new Uint8Array(bits));
}
const safeEq = (a, b) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };
const normPhone = v => { let d = String(v).replace(/[\s\-()]/g, ''); if (d.length > 10) d = d.replace(/^(\+91|91|0)/, ''); return /^[6-9]\d{9}$/.test(d) ? d : null; };
const validEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) && v.length <= 120;
const validName = v => /^[\p{L}][\p{L}\s.'-]{1,59}$/u.test(v);
const pwProblem = v => v.length < 8 ? 'Password must be at least 8 characters.' : !/[a-z]/.test(v) ? 'Add a lower-case letter.' : !/[A-Z]/.test(v) ? 'Add an upper-case letter.' : !/\d/.test(v) ? 'Add a number.' : '';
const pwScore = v => [v.length >= 8, /[a-z]/.test(v) && /[A-Z]/.test(v), /\d/.test(v), /[^A-Za-z0-9]/.test(v) || v.length >= 12].filter(Boolean).length;

const getSession = () => { try { const s = JSON.parse(sessionStorage.getItem('peoplesolve.session')); return s && s.exp > Date.now() ? s : null; } catch { return null; } };
const currentUser = () => { const s = getSession(); return s ? DB.users.find(u => u.id === s.uid) || null : null; };
const isAdmin = u => u && u.role === 'admin';
const startSession = u => sessionStorage.setItem('peoplesolve.session', JSON.stringify({ uid: u.id, exp: Date.now() + CONFIG.SESSION_MS }));
function logout(msg) {
  sessionStorage.removeItem('peoplesolve.session'); closeModal();
  S.draft.photos.forEach(p => URL.revokeObjectURL(p.url)); S.draft = { photos: [], ai: null, key: '' };
  location.hash = '#/login'; routeFn();
  if (msg) authMsg(msg, 'success');
}
function authMsg(text, type = 'error') {
  const m = $('#authMsg'); if (!text) { m.hidden = true; return; }
  m.hidden = false; m.className = `form-msg ${type}`; m.textContent = text;
}
function authPanel(name) {
  const forms = { login: '#loginForm', register: '#registerForm', forgot: '#forgotForm', reset: '#resetForm' };
  Object.entries(forms).forEach(([k, sel]) => { $(sel).hidden = k !== name; });
  const tab = name === 'register' ? 'register' : 'login';
  $$('[role=tab]').forEach(t => { const on = t.dataset.authTab === tab; t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1; });
  authMsg('');
  $$('.error-msg', $('#auth')).forEach(e => e.textContent = '');
  const f = $(forms[name]); const first = $('input', f); if (first) setTimeout(() => first.focus(), 30);
}
const failKey = id => 'peoplesolve.fail.' + id;
const lockState = id => { try { return JSON.parse(sessionStorage.getItem(failKey(id))) || { n: 0, until: 0 }; } catch { return { n: 0, until: 0 }; } };

async function doRegister(f) {
  clearErrs(f);
  const name = $('#regName').value.trim(), phoneRaw = $('#regPhone').value.trim(), email = $('#regEmail').value.trim().toLowerCase(), pw = $('#regPassword').value;
  const phone = normPhone(phoneRaw);
  let ok = true;
  ok = setErr('regName', validName(name) ? '' : 'Enter your full name (letters only, at least 2 characters).') && ok;
  ok = setErr('regPhone', phone ? '' : 'Enter a valid 10-digit Indian mobile number.') && ok;
  ok = setErr('regEmail', validEmail(email) ? '' : 'Enter a valid email address.') && ok;
  ok = setErr('regPassword', pwProblem(pw)) && ok;
  ok = setErr('regConsent', $('#regConsent').checked ? '' : 'Please accept to continue.') && ok;
  if (!ok) { authMsg('Please fix the highlighted fields.'); firstInvalid(f); return; }
  if (DB.users.some(u => u.email === email)) { setErr('regEmail', 'An account with this email already exists.'); authMsg('This email is already registered. Try logging in.'); return; }
  if (DB.users.some(u => u.phone === phone)) { setErr('regPhone', 'An account with this phone number already exists.'); authMsg('This phone number is already registered.'); return; }
  const btn = $('button[type=submit]', f); busy(btn, true, 'Creating account…');
  try {
    const salt = b64(new Uint8Array(rnd(16)));
    const user = { id: uid(), name, phone, email, salt, hash: await hashPw(pw, salt), role: CONFIG.ADMIN_EMAILS.map(e => e.toLowerCase()).includes(email) ? 'admin' : 'candidate', createdAt: Date.now(), prefs: { sound: true, guideSeen: false, noticeSeen: false } };
    DB.users.push(user); save('users');
    startSession(user); f.reset(); updateStrength('');
    toast(`Welcome to PeopleSolve AI, ${name.split(' ')[0]}!`, 'success');
    location.hash = '#/dashboard'; routeFn();
  } catch (e) { authMsg(e.message || 'Registration failed.'); } finally { busy(btn, false); }
}
async function doLogin(f) {
  clearErrs(f);
  const id = $('#loginId').value.trim().toLowerCase(), pw = $('#loginPassword').value;
  let ok = setErr('loginId', id ? '' : 'Enter your email or phone number.');
  ok = setErr('loginPassword', pw ? '' : 'Enter your password.') && ok;
  if (!ok) { firstInvalid(f); return; }
  const lk = lockState(id);
  if (lk.until > Date.now()) { authMsg(`Too many failed attempts. Try again in ${Math.ceil((lk.until - Date.now()) / 1000)} seconds.`); return; }
  const btn = $('button[type=submit]', f); busy(btn, true, 'Logging in…');
  try {
    const ph = normPhone(id);
    const user = DB.users.find(u => u.email === id || (ph && u.phone === ph));
    const good = user && safeEq(await hashPw(pw, user.salt), user.hash);
    if (!good) {
      const n = lk.n + 1; sessionStorage.setItem(failKey(id), JSON.stringify({ n: n >= CONFIG.MAX_FAILS ? 0 : n, until: n >= CONFIG.MAX_FAILS ? Date.now() + CONFIG.LOCK_MS : 0 }));
      authMsg(n >= CONFIG.MAX_FAILS ? 'Too many failed attempts. Please wait a minute and try again.' : 'Incorrect email/phone or password.');
      return;
    }
    sessionStorage.removeItem(failKey(id)); startSession(user); f.reset();
    toast(`Welcome back, ${user.name.split(' ')[0]}!`, 'success');
    location.hash = '#/dashboard'; routeFn();
  } catch (e) { authMsg(e.message || 'Login failed.'); } finally { busy(btn, false); }
}
let resetTarget = null;
function doForgot(f) {
  clearErrs(f);
  const email = $('#forgotEmail').value.trim().toLowerCase();
  if (!setErr('forgotEmail', validEmail(email) ? '' : 'Enter a valid email address.')) return;
  const user = DB.users.find(u => u.email === email);
  if (!user) { setErr('forgotEmail', 'No account found with this email.'); return; }
  const code = String(new DataView(new Uint8Array(rnd(4)).buffer).getUint32(0) % 1000000).padStart(6, '0');
  DB.resets = DB.resets.filter(r => r.uid !== user.id && r.exp > Date.now());
  DB.resets.push({ uid: user.id, code, exp: Date.now() + 10 * 60000 }); save('resets');
  resetTarget = user.id;
  authPanel('reset');
  $('#resetNotice').innerHTML = `<strong>No email/SMS service is connected to this site,</strong> so your one-time code is shown here instead of being sent: <span class="code">${code}</span>. It expires in 10 minutes. (On a connected server this code would be emailed to you.)`;
}
async function doReset(f) {
  clearErrs(f);
  const code = $('#resetCode').value.trim(), pw = $('#resetPassword').value;
  let ok = setErr('resetCode', /^\d{6}$/.test(code) ? '' : 'Enter the 6-digit code.');
  ok = setErr('resetPassword', pwProblem(pw)) && ok;
  if (!ok) return;
  const r = DB.resets.find(x => x.uid === resetTarget && x.exp > Date.now());
  if (!r || r.code !== code) { setErr('resetCode', 'Invalid or expired code.'); return; }
  const user = DB.users.find(u => u.id === resetTarget);
  user.salt = b64(new Uint8Array(rnd(16))); user.hash = await hashPw(pw, user.salt); save('users');
  DB.resets = DB.resets.filter(x => x.uid !== user.id); save('resets'); resetTarget = null; f.reset();
  authPanel('login'); authMsg('Password updated. Please log in with your new password.', 'success');
}
function updateStrength(v) {
  const n = v ? pwScore(v) : 0; const el = $('.strength', $('#registerForm'));
  if (el) el.dataset.s = n;
}

/* ================= NOTIFICATIONS ================= */
const N_ICON = { submitted: '✅', priority_changed: '🚦', department_assigned: '🏛️', info_requested: '❓', status_changed: '🔄', resolved: '🎉' };
function notify(userId, type, title, body, complaintId) {
  DB.notifications.unshift({ id: uid(), userId, type, title, body, complaintId, at: Date.now(), read: false });
  DB.notifications = DB.notifications.slice(0, 500); save('notifications');
  const me = currentUser();
  if (me && me.id === userId) { toast(title, 'notify'); beep(); updateBell(true); }
}
const myNotifs = () => { const u = currentUser(); return u ? DB.notifications.filter(n => n.userId === u.id) : []; };
function updateBell(ring) {
  const n = myNotifs().filter(x => !x.read).length, b = $('#bellBadge');
  b.hidden = n === 0; b.textContent = n > 99 ? '99+' : n;
  $('#bell').setAttribute('aria-label', n ? `Notifications, ${n} unread` : 'Notifications');
  const nb = $('#navBadge'); if (nb) { nb.hidden = n === 0; nb.textContent = n; }
  if (ring) { $('#bell').classList.remove('ring'); void $('#bell').offsetWidth; $('#bell').classList.add('ring'); }
}

/* ================= COMPLAINT HELPERS ================= */
const visible = u => isAdmin(u) ? DB.complaints : DB.complaints.filter(c => c.userId === u.id);
const isOpen = c => !['Resolved', 'Closed'].includes(c.status);
const needsAttention = c => isOpen(c) && (['Critical', 'High'].includes(c.priority) || c.status === 'Need More Information');
const SLA_H = { Critical: 4, High: 24, Medium: 72, Low: 168 };
const dueAt = c => c.createdAt + SLA_H[c.priority] * 36e5;
const isOverdue = c => isOpen(c) && Date.now() > dueAt(c);
const resolvedAt = c => { const h = [...c.history].reverse().find(x => x.type === 'status' && x.to === 'Resolved'); return h ? h.at : null; };
function avgResolution(list) { const t = list.map(c => { const r = resolvedAt(c); return r ? r - c.createdAt : null; }).filter(x => x !== null && x >= 0); return t.length ? t.reduce((a, b) => a + b, 0) / t.length : null; }
const slaHtml = c => `${esc(F.dt.format(dueAt(c)))} ${isOverdue(c) ? '<span class="pill prio-critical overdue"><i aria-hidden="true"></i>Overdue</span>' : !isOpen(c) ? '<span class="muted">(closed)</span>' : ''}<small class="muted" style="display:block">Indicative target by priority (${SLA_H[c.priority]} h). Not a legal deadline.</small>`;
const tokens = s => new Set(String(s).toLowerCase().match(/[a-z0-9\u0900-\u097F]{4,}/g) || []);
function jaccard(a, b) { if (!a.size || !b.size) return 0; let n = 0; a.forEach(x => { if (b.has(x)) n++; }); return n / (a.size + b.size - n); }
function findSimilar(i, excludeId) { const t = tokens(i.title + ' ' + i.description); return DB.complaints.filter(c => c.id !== excludeId && isOpen(c) && c.category === i.category && jaccard(t, tokens(c.title + ' ' + c.description)) >= 0.3); }
function similarNotice(i, ai) {
  const sims = findSimilar({ ...i, category: ai.category }), u = currentUser(); if (!sims.length) return '';
  const mine = sims.filter(c => c.userId === u.id);
  return `<div class="notice notice-info">👥 <strong>${plural(sims.length, 'similar open complaint')}</strong> ${sims.length === 1 ? 'has' : 'have'} already been reported in this community. Staff can link duplicates to speed up action.${mine.length ? ' Your own: ' + mine.map(c => `<a href="#/complaint/${esc(c.id)}">${esc(c.id)}</a>`).join(', ') : ''}</div>`;
}
const dupHtml = c => { const ids = (c.similarIds || []).filter(id => DB.complaints.some(x => x.id === id)); return ids.length ? `<p class="muted sm">Possible duplicates at submission:</p><ul class="dup-list">${ids.map(id => `<li><a href="#/complaint/${esc(id)}">${esc(id)}</a></li>`).join('')}</ul>` : ''; };
function staffInsights(list, st) {
  const open = list.filter(isOpen), byDept = {}; open.forEach(c => byDept[c.department] = (byDept[c.department] || 0) + 1);
  const rows = Object.entries(byDept).sort((a, b) => b[1] - a[1]).slice(0, 5), max = rows[0] ? rows[0][1] : 1;
  return `<article class="card"><div class="card-h"><div><div class="eyebrow">STAFF INSIGHTS · ADMINISTRATOR ONLY</div><h2>Service performance</h2></div></div><div class="insights"><div class="mini"><strong>${st.avgRes === null ? '—' : esc(dur(st.avgRes))}</strong><small>Average time to resolve</small></div><div class="mini"><strong>${st.overdue}</strong><small>Past target time</small></div><div class="mini"><strong>${open.length}</strong><small>Open complaints</small></div></div>${rows.length ? `<div class="cat-list">${rows.map(([id, n], i) => `<div class="cat-row"><span class="cat-ico" aria-hidden="true">${esc(DEPT[id]?.icon || '🏛️')}</span><div class="cat-main"><div class="cat-top"><span>${esc(DEPT[id]?.name || id)}</span><strong>${n}</strong></div><div class="track"><i style="--w:${Math.round(n / max * 100)}%;--d:${i * 70}ms"></i></div></div></div>`).join('')}</div>` : '<p class="muted">No open complaints right now.</p>'}</article>`;
}

function computeStats(list) {
  const total = list.length, resolved = list.filter(c => !isOpen(c)).length, attention = list.filter(needsAttention).length;
  const byPrio = Object.fromEntries(PRIORITIES.map(p => [p, 0])), byCat = {}, byStatus = Object.fromEntries(STATUSES.map(s => [s, 0]));
  list.forEach(c => { byPrio[c.priority]++; byCat[c.category] = (byCat[c.category] || 0) + 1; byStatus[c.status]++; });
  return { total, resolved, attention, okay: total - resolved - attention, byPrio, byCat, byStatus, week: list.filter(c => c.createdAt >= Date.now() - 7 * 864e5).length, overdue: list.filter(isOverdue).length, avgRes: avgResolution(list) };
}
function genRef() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let ref;
  do { ref = `CIV-${todayISO().replace(/-/g, '')}-${rnd(5).map(b => A[b % A.length]).join('')}`; } while (DB.complaints.some(c => c.id === ref));
  return ref;
}
const addHist = (c, by, type, o = {}) => c.history.push({ at: Date.now(), by: by.name, role: by.role, type, ...o });

/* ================= AI ANALYSIS ENGINE ================= */
const KEYWORDS = {
  roads: ['road', 'pothole', 'footpath', 'sidewalk', 'speed breaker', 'speed bump', 'bridge', 'flyover', 'highway', 'zebra', 'traffic signal', 'manhole', 'sadak', 'gaddha', 'crack'],
  water: ['water supply', 'no water', 'water pressure', 'tap', 'pipeline', 'pipe', 'leak', 'borewell', 'tanker', 'dirty water', 'contaminated', 'paani', 'pani', 'water meter'],
  electricity: ['electric', 'power cut', 'outage', 'no power', 'voltage', 'transformer', 'streetlight', 'street light', 'lamp post', 'pole', 'wire', 'meter', 'bijli', 'blackout'],
  sanitation: ['garbage', 'trash', 'waste', 'dustbin', 'litter', 'sweeping', 'sewage', 'sewer', 'toilet', 'dump', 'kachra', 'safai', 'stink', 'smell'],
  drainage: ['drain', 'drainage', 'waterlogging', 'water logging', 'flood', 'overflow', 'nali', 'stormwater', 'clogged'],
  health: ['hospital', 'clinic', 'doctor', 'medicine', 'ambulance', 'dengue', 'malaria', 'mosquito', 'fever', 'epidemic', 'health centre', 'phc', 'food poisoning', 'unhygienic'],
  education: ['school', 'teacher', 'college', 'student', 'scholarship', 'exam', 'mid-day meal', 'midday meal', 'classroom', 'fee'],
  transport: ['bus', 'metro', 'train', 'auto', 'rickshaw', 'taxi', 'driving licence', 'license', 'rto', 'registration', 'challan', 'parking', 'bus stop'],
  safety: ['theft', 'robbery', 'harass', 'eve teasing', 'assault', 'threat', 'violence', 'stalking', 'crime', 'police', 'fight', 'drunk', 'kidnap', 'murder', 'molest', 'missing person'],
  cyber: ['upi', 'otp', 'online fraud', 'scam', 'phishing', 'hacked', 'hack', 'cyber', 'fake website', 'fake call', 'sextortion', 'bank fraud', 'whatsapp fraud', 'impersonat', 'loan app', 'deepfake', 'social media account'],
  consumer: ['refund', 'defective', 'warranty', 'overcharg', 'mrp', 'consumer', 'seller', 'delivery', 'e-commerce', 'amazon', 'flipkart', 'service centre', 'invoice', 'fake product', 'expired'],
  parks: ['park', 'tree', 'garden', 'playground', 'bench', 'branch', 'public space', 'encroach', 'stray dog', 'stray animal']
};
const T_CRIT = ['live wire', 'fallen wire', 'wire has fallen', 'electrocut', 'sparking', 'short circuit', 'fire', 'gas leak', 'explosion', 'collapsed', 'collapse', 'trapped', 'drowning', 'unconscious', 'bleeding', 'injured', 'accident', 'assault', 'attack', 'weapon', 'kidnap', 'murder', 'rape', 'molest', 'suicide', 'open manhole', 'flooding the street', 'burst', 'sinkhole', 'missing child', 'child missing'];
const T_HIGH = ['no electricity', 'no power', 'power outage', 'blackout', 'no water', 'sewage overflow', 'overflowing', 'contaminated', 'dirty water', 'dengue', 'outbreak', 'hospital', 'school', 'children', 'elderly', 'pregnant', 'disabled', 'main road', 'highway', 'blocked', 'money deducted', 'money stolen', 'lost money', 'fraud', 'scam', 'hacked', 'harassment', 'stalking', 'whole', 'entire', 'many families', 'several', 'colony', 'locality', 'residents', 'flood'];
const T_MED = ['broken', 'damaged', 'leak', 'pothole', 'not working', 'not collected', 'irregular', 'delay', 'low pressure', 'street light', 'streetlight', 'garbage', 'repeated', 'overcharg', 'refund', 'defective', 'stink', 'mosquito'];
const T_LOW = ['suggestion', 'request', 'minor', 'small', 'cosmetic', 'would like', 'please consider', 'paint', 'signboard'];
const rxCache = {};
const rx = t => rxCache[t] || (rxCache[t] = new RegExp((t.length <= 4 ? '\\b' : '\\b') + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + (t.length <= 4 ? '\\b' : ''), 'i'));
const hits = (text, list) => list.filter(t => rx(t).test(text));

const GUIDE = {
  roads: { s: ['Report the exact spot (landmark + ward) to the body that owns the road, with a clear photo.', 'For hazards, ask for temporary barricading or warning signs until repair is done.'], m: ['Road name and nearest landmark', 'A photo showing the size of the damage'] },
  water: { s: ['Check whether neighbours also have the problem — it may be a supply-line issue.', 'Report to your local water board with your connection number.'], m: ['Since when the problem exists', 'How many homes are affected', 'Your water connection/consumer number'] },
  electricity: { s: ['Stay away from any damaged wire, pole or transformer.', 'Report to your power distribution company with the pole/transformer number.'], m: ['Pole or transformer number', 'Consumer number (for supply issues)', 'Since when it has been out'] },
  sanitation: { s: ['Note the days pickup was missed and photograph the accumulated waste.', 'Report to your local body’s sanitation wing or helpline.'], m: ['Ward or locality name', 'Number of days since last pickup'] },
  drainage: { s: ['Photograph the clogged or overflowing drain, ideally with a landmark.', 'Report to the municipal drainage/stormwater section — ask for urgent clearing before rain.'], m: ['Exact location of the drain', 'Whether water is entering homes or the road'] },
  health: { s: ['For a medical emergency call 112 first.', 'Report service or hygiene issues to the facility head and the district health office.'], m: ['Name of the facility or area', 'Date and what exactly happened'] },
  education: { s: ['Raise the matter with the school head first and keep a written copy.', 'If unresolved, write to the block/district education office.'], m: ['School name and district', 'Dates and people involved'] },
  transport: { s: ['Note the vehicle/route number, date and time.', 'Report to the operator or your RTO / state transport department.'], m: ['Vehicle or route number', 'Date and time of the incident'] },
  safety: { s: ['If anyone is in danger, call 112 now.', 'Report crimes to your nearest police station and keep any acknowledgement or FIR number.'], m: ['Exact location, date and time', 'Description of people or vehicles involved (only what you safely observed)'] },
  cyber: { s: ['If money was lost in the last few hours, call 1930 immediately.', 'Do not delete chats, emails or SMS — they are evidence. Contact your bank to block the transaction.'], m: ['Transaction ID, amount, date and time', 'Screenshots, phone numbers, URLs or profile links of the suspect'] },
  consumer: { s: ['Contact the seller in writing first and keep proof.', 'If not resolved, register a grievance with the National Consumer Helpline.'], m: ['Seller/company name', 'Invoice, order ID or payment proof', 'What resolution you want (refund, replacement, repair)'] },
  parks: { s: ['Photograph the issue and note the park or street name.', 'Report to your municipal parks/horticulture wing.'], m: ['Name of park or street', 'Whether it is blocking a road or path'] },
  other: { s: ['Identify which office or service is involved.', 'Gather dates, application numbers and documents.'], m: ['Name of the office or service', 'Reference or application numbers'] }
};

function localAnalyze({ title = '', description = '', category = 'other', location = '', incidentDate = '', photoCount = 0 }) {
  const text = `${title}. ${description}`.toLowerCase();
  const scores = {};
  Object.entries(KEYWORDS).forEach(([k, list]) => { scores[k] = hits(text, list).reduce((s, t) => s + (t.includes(' ') ? 2 : 1), 0); });
  if (scores[category] !== undefined) scores[category] += 1; // weak prior toward the user's own choice
  let best = 'other', bs = 0;
  CATEGORIES.forEach(c => { if ((scores[c.id] || 0) > bs) { best = c.id; bs = scores[c.id]; } });
  const matched = hits(text, KEYWORDS[best] || []);
  const confidence = bs >= 4 ? 'High' : bs >= 2 ? 'Medium' : 'Low';
  const negated = /\b(no|not|without)\s+(any\s+)?(danger|emergency|injur|hazard)/.test(text);
  const crit = negated ? [] : hits(text, T_CRIT), high = hits(text, T_HIGH), med = hits(text, T_MED), low = hits(text, T_LOW);
  const days = (text.match(/(\d+)\s*(day|days|week|weeks)/) || []);
  const affected = (text.match(/(\d{2,})\s*(families|houses|homes|people|residents|households)/) || [])[1];
  let score = high.length * 2 + med.length + (days[1] && (+days[1] >= 3 || /week/.test(days[2])) ? 2 : 0) + (affected && +affected >= 20 ? 3 : 0);
  let priority = crit.length ? 'Critical' : score >= 4 ? 'High' : score >= 1 ? 'Medium' : 'Low';
  if (best === 'cyber' && /money|₹|rs\.?|rupees|upi|bank|card/.test(text) && priority === 'Low') priority = 'High';
  if (low.length && !crit.length && priority === 'Medium') priority = 'Low';
  const emergency = crit.length > 0;
  const reasonBits = crit.length ? [`possible immediate hazard (${crit.slice(0, 3).join(', ')})`] : [...high, ...med].slice(0, 4);
  const dept = CAT[best].dept;
  const g = GUIDE[best];
  const missing = [];
  if (!location.trim() && CAT[best].phys) missing.push('The exact location, landmark or PIN code');
  if (!incidentDate) missing.push('The date (and time) the problem started');
  if (!photoCount) missing.push('A clear photo as evidence, if it is safe to take one');
  if (description.trim().split(/\s+/).length < 25) missing.push('More detail: what happened, since when, and how many people are affected');
  g.m.forEach(m => { if (missing.length < 6) missing.push(m); });
  const portals = portalFor(best, emergency);
  const official = portals.map(id => ({ id, reason: id === 'erss' ? 'Use this for immediate danger — dial 112.' : id === 'cyber' ? 'The official place to report cyber crime and online fraud.' : id === 'consumer' ? 'The official place for consumer disputes with sellers or service providers.' : 'The official place to escalate public-service grievances if the local office does not respond.' }));
  const steps = [];
  if (emergency) steps.push('If anyone is in danger, call 112 right now before doing anything else.');
  steps.push(...g.s, 'Keep your PeopleSolve AI reference number and any photos or receipts together.', 'Check back here for status updates; add details if staff ask for more information.');
  return {
    category: best, categoryConfidence: confidence, priority, department: dept, emergency,
    problemAnalysis: `This looks like a “${catLabel(best)}” problem${location ? ` at ${location}` : ''}. ${matched.length ? `Words that pointed to this: ${matched.slice(0, 5).join(', ')}.` : 'No strong keywords were found, so the match is tentative.'}${best !== category ? ` You selected “${catLabel(category)}”, so please double-check the category.` : ''}`,
    whyAttention: reasonBits.length ? `Suggested ${priority} priority because of: ${reasonBits.join(', ')}.` : `Suggested ${priority} priority — nothing in the description points to urgent risk.`,
    possibleSolution: g.s, nextSteps: steps, missingInfo: missing, official,
    photoNote: photoCount ? `${plural(photoCount, 'photo')} attached as evidence. The built-in assistant reads text only; photos are not analysed.` : ''
  };
}
function normalizeAI(d) {
  const o = {};
  if (CAT[d.category]) o.category = d.category;
  if (PRIORITIES.includes(d.priority)) o.priority = d.priority;
  if (DEPT[d.department]) o.department = d.department;
  ['problemAnalysis', 'whyAttention'].forEach(k => { if (typeof d[k] === 'string') o[k] = d[k].slice(0, 1500); });
  ['possibleSolution', 'nextSteps', 'missingInfo'].forEach(k => { if (Array.isArray(d[k])) o[k] = d[k].filter(x => typeof x === 'string').slice(0, 10).map(x => x.slice(0, 400)); });
  return o;
}
async function analyzeComplaint(input) {
  const local = localAnalyze(input);
  if (!CONFIG.AI_ENDPOINT) return { ...local, source: 'rules', at: Date.now(), review: null };
  const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), CONFIG.AI_TIMEOUT_MS);
  try {
    const res = await fetch(CONFIG.AI_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit', signal: ctrl.signal, body: JSON.stringify({ title: input.title, description: input.description, category: input.category, location: input.location, incidentDate: input.incidentDate }) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const merged = { ...local, ...normalizeAI(await res.json()) };
    return { ...merged, source: 'service', at: Date.now(), review: null };
  } catch (e) { return { ...local, source: 'rules', serviceError: e.name === 'AbortError' ? 'timed out' : String(e.message || e), at: Date.now(), review: null }; }
  finally { clearTimeout(t); }
}
function aiReport(ai) {
  const dept = DEPT[ai.department] || DEPT.other;
  const src = ai.source === 'service'
    ? '<div class="ai-source ok">🤖 CiviBot AI · analysed by PeopleSolve Civic Intelligence (connected AI service)</div>'
    : `<div class="ai-source warn">🤖 CiviBot AI is running in built-in rule-based mode — no external AI service is connected.${ai.serviceError ? ` The AI service failed (${esc(ai.serviceError)}), so this fallback was used.` : ''} <button type="button" class="link-btn" data-action="goto" data-to="#/profile">What to connect</button></div>`;
  const rev = ai.review ? `<div class="notice notice-ok">✔ Reviewed by staff (${esc(ai.review.by)}, ${esc(F.short.format(ai.review.at))}).${ai.review.note ? ' ' + esc(ai.review.note) : ''}</div>` : '';
  return `<div class="ai-report">${src}${ai.emergency ? '<div class="notice notice-danger"><strong>🚨 This may be an emergency.</strong> If anyone is in danger, call <a href="tel:112">112</a> now. Do not wait for this website.</div>' : ''}${rev}
  <section><h4><span aria-hidden="true">🔍</span> Problem Analysis</h4><p>${catPill(ai.category)} <span class="muted">Category detected by AI (confidence: ${esc(ai.categoryConfidence || '—')})</span></p><p>${esc(ai.problemAnalysis)}</p><p class="muted">${esc(ai.whyAttention)}</p>${ai.photoNote ? `<p class="muted">📷 ${esc(ai.photoNote)}</p>` : ''}</section>
  <section><h4><span aria-hidden="true">🚦</span> Suggested Priority</h4><p>${prioPill(ai.priority)} <span class="muted">Set by AI as a suggestion — authorised staff can review and correct it.</span></p></section>
  <section><h4><span aria-hidden="true">🏛️</span> Recommended Department</h4><p><a href="#/departments/${esc(dept.id)}"><strong>${esc(dept.icon)} ${esc(dept.name)}</strong></a> </p></section>
  <section><h4><span aria-hidden="true">🛠️</span> Possible Solution</h4><ul>${ai.possibleSolution.map(x => `<li>${esc(x)}</li>`).join('')}</ul></section>
  <section><h4><span aria-hidden="true">🧭</span> Recommended Next Steps</h4><ol>${ai.nextSteps.map(x => `<li>${esc(x)}</li>`).join('')}</ol></section>
  <section><h4><span aria-hidden="true">📋</span> Official Reporting Options</h4><div class="mini-cards">${ai.official.map(o => { const p = PORTAL[o.id]; return p ? `<div class="mini-card"><strong>${p.icon} ${esc(p.name)}</strong><p>${esc(o.reason)}</p><a class="btn btn-sm btn-ghost" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">Open official portal ↗</a></div>` : ''; }).join('')}</div><p class="muted">Reporting here is <strong>not</strong> the same as reporting to the government. You must submit on the official portal yourself.</p></section>
  ${ai.missingInfo.length ? `<section><h4><span aria-hidden="true">❓</span> Information that would help</h4><ul>${ai.missingInfo.map(x => `<li>${esc(x)}</li>`).join('')}</ul></section>` : ''}
  <p class="disclaimer">CiviBot AI output is a suggestion, not a confirmed fact, a legal opinion or an official decision. Nothing has been filed with any government authority.</p></div>`;
}

/* ================= NAVIGATION ================= */
const NAV = [
  ['dashboard', 'Dashboard', '📊'], ['submit', 'Submit Complaint', '📝'], ['track', 'Track Complaints', '🔎'], ['ai', 'AI Analysis', '✨'],
  ['departments', 'Departments', '🏛️'], ['portals', 'Official Portals', '🇮🇳'], ['community', 'Community Activity', '👥'],
  ['notifications', 'Notifications', '🔔'], ['how', 'How It Works', '❓'], ['profile', 'Profile & Settings', '⚙️']
];
const TITLES = Object.fromEntries(NAV.map(n => [n[0], n[1]])); TITLES.complaint = 'Complaint details';
function renderNav(page) {
  $('#nav').innerHTML = NAV.map(([id, label, icon]) => `<a class="nav-item${id === page || (page === 'complaint' && id === 'track') ? ' active' : ''}" href="#/${id}"${id === page ? ' aria-current="page"' : ''}><span class="nav-ico" aria-hidden="true">${icon}</span><span>${label}</span>${id === 'notifications' ? '<b class="nav-badge" id="navBadge" hidden>0</b>' : ''}</a>`).join('')
    + '<button type="button" class="nav-item nav-logout" data-action="logout"><span class="nav-ico" aria-hidden="true">🚪</span><span>Logout</span></button>';
  const u = currentUser();
  $('#sideUser').innerHTML = `<div class="avatar" aria-hidden="true">${esc(u.name.trim()[0].toUpperCase())}</div><div><strong>${esc(u.name)}</strong><small>${isAdmin(u) ? 'Authorised administrator' : 'Candidate'}</small></div>`;
  updateBell();
}

/* ================= DASHBOARD ================= */
function donut(byPrio, total) {
  if (!total) return `<div class="donut empty-ring" role="img" aria-label="No complaints yet"><div class="donut-c"><strong>0</strong><small>complaints</small></div></div>`;
  let acc = 0; const parts = PRIORITIES.map(p => { const a = acc, b = acc + byPrio[p] / total * 100; acc = b; return `${PRIO_COLOR[p]} ${a}% ${b}%`; });
  return `<div class="donut" style="background:conic-gradient(${parts.join(',')})" role="img" aria-label="${PRIORITIES.map(p => `${byPrio[p]} ${p}`).join(', ')}"><div class="donut-c"><strong>${total}</strong><small>complaints</small></div></div>`;
}
function weekBars(list) {
  const days = Array.from({ length: 7 }, (_, i) => Date.now() - (6 - i) * 864e5);
  const counts = days.map(d => list.filter(c => dayKey(c.createdAt) === dayKey(d)).length), max = Math.max(1, ...counts);
  return `<div class="bars" role="img" aria-label="Complaints per day for the last 7 days: ${counts.join(', ')}">${days.map((d, i) => `<div class="bar-col"><span class="bar-n">${counts[i]}</span><div class="bar" style="--h:${Math.round(counts[i] / max * 100)}%"></div><small>${esc(F.md.format(d))}</small></div>`).join('')}</div>`;
}
function catBars(list) {
  const by = {}; list.forEach(c => by[c.category] = (by[c.category] || 0) + 1);
  const rows = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 6), max = rows[0] ? rows[0][1] : 1;
  return rows.map(([id, n], i) => `<div class="cat-row"><span class="cat-ico" aria-hidden="true">${CAT[id].icon}</span><div class="cat-main"><div class="cat-top"><span>${esc(catLabel(id))}</span><strong>${n}</strong></div><div class="track"><i style="--w:${Math.round(n / max * 100)}%;--d:${i * 70}ms"></i></div></div></div>`).join('');
}
function pulseEvents() {
  const ev = [];
  DB.complaints.forEach(c => {
    ev.push({ at: c.createdAt, icon: '📝', t: `A ${catLabel(c.category)} complaint was submitted` });
    c.history.forEach(h => { if (h.type === 'status' && h.to === 'Resolved') ev.push({ at: h.at, icon: '🎉', t: `A ${catLabel(c.category)} complaint was resolved` }); });
  });
  return ev.sort((a, b) => b.at - a.at).slice(0, 6);
}
function vDashboard(u) {
  const list = visible(u), st = computeStats(list), all = DB.complaints, comm = computeStats(all);
  const recent = [...list].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
  const members = DB.users.length, active = new Set(all.map(c => c.userId)).size;
  const guide = !u.prefs.guideSeen ? `<div class="notice notice-info guide-banner"><div><strong>👋 New here?</strong> Follow the 10 simple steps from registering to getting your complaint resolved.</div><div class="row"><a class="btn btn-sm btn-primary" href="#/how" data-action="dismiss-guide">See How It Works</a><button class="btn btn-sm btn-ghost" type="button" data-action="dismiss-guide">Dismiss</button></div></div>` : '';
  const none = !st.total;
  return `<div class="page-head"><div><div class="eyebrow">${isAdmin(u) ? 'ALL COMPLAINTS · ADMINISTRATOR VIEW' : 'YOUR COMPLAINTS AT A GLANCE'}</div><h1>${greeting()}, ${esc(u.name.split(' ')[0])} <span class="wave" aria-hidden="true">👋</span></h1><p class="sub">${isAdmin(u) ? 'You can review, reassign and update every complaint.' : 'Report a problem, follow its progress and find the right official channel.'}</p></div><a class="btn btn-primary" href="#/submit">＋ Submit a complaint</a></div>
  ${guide}
  ${st.overdue ? `<div class="notice notice-warn">⏰ <strong>${plural(st.overdue, 'complaint')}</strong> ${st.overdue === 1 ? 'is' : 'are'} past the indicative target time for ${isAdmin(u) ? 'staff action' : 'a response'}. <a href="#/track">Review</a></div>` : ''}
  ${isAdmin(u) ? staffInsights(list, st) : ''}
  <div class="stat-grid">
    <article class="stat s-blue"><div class="stat-top"><span>Total Complaints</span><i aria-hidden="true">📋</i></div><strong class="count" data-n="${st.total}">${st.total}</strong><small>${st.week ? `${st.week} in the last 7 days` : 'None in the last 7 days'}</small></article>
    <article class="stat s-red"><div class="stat-top"><span>Need Attention</span><i aria-hidden="true">🚩</i></div><strong class="count">${st.attention}</strong><small>Open · Critical/High or info requested</small></article>
    <article class="stat s-green"><div class="stat-top"><span>Resolved Complaints</span><i aria-hidden="true">✅</i></div><strong class="count">${st.resolved}</strong><small>${st.total ? Math.round(st.resolved / st.total * 100) + '% of total' : 'Nothing resolved yet'}</small></article>
    <article class="stat s-teal"><div class="stat-top"><span>Everything Okay</span><i aria-hidden="true">🌿</i></div><strong class="count">${st.okay}</strong><small>Open · No action required from you</small></article>
  </div>
  <div class="grid-2">
    <div class="stack">
      <article class="card priority-card"><div class="card-h"><div><div class="eyebrow">THE BIG PICTURE</div><h2>Priority Overview</h2></div></div>
        ${none ? emptyState('📭', 'No complaints have been submitted yet', 'Your priority chart will appear here after the first complaint.', '<a class="btn btn-primary btn-sm" href="#/submit">Submit your first complaint</a>') : `<div class="prio-wrap">${donut(st.byPrio, st.total)}<div class="prio-list">${PRIORITIES.map(p => `<div class="prio-row prio-${p.toLowerCase()}"><span class="dot" aria-hidden="true"></span><div><strong>${p}</strong><small>${PRIO_HELP[p]}</small></div><b>${st.byPrio[p]}</b><span class="pct">${Math.round(st.byPrio[p] / st.total * 100)}%</span></div>`).join('')}</div></div>
        <div class="prio-bars">${PRIORITIES.map(p => `<div class="pb prio-${p.toLowerCase()}" style="--w:${Math.round(st.byPrio[p] / st.total * 100)}%" title="${p}: ${st.byPrio[p]}"></div>`).join('')}</div>`}
      </article>
      <article class="card"><div class="card-h"><div><div class="eyebrow">WHAT PEOPLE ARE REPORTING</div><h2>Top Complaint Categories</h2></div><a class="link" href="#/track">View all →</a></div>${none ? emptyState('📊', 'No categories yet', 'Categories appear once complaints are submitted.') : `<div class="cat-list">${catBars(list)}</div>`}</article>
      <article class="card flush"><div class="card-h pad"><div><div class="eyebrow">LATEST</div><h2>Recent Complaints</h2></div><a class="link" href="#/track">Track all →</a></div>${recent.length ? `<div class="list">${recent.map(c => `<a class="row-item" href="#/complaint/${esc(c.id)}"><div class="ri-main"><strong>${esc(c.title)}</strong><small>${esc(c.id)} · ${timeTag(c.createdAt)}</small></div><div class="ri-pills">${prioPill(c.priority)}${statusPill(c.status)}</div></a>`).join('')}</div>` : emptyState('📝', 'No complaints have been submitted yet', 'When you submit one, it will show up here.')}</article>
    </div>
    <div class="stack">
      <article class="card ai-card"><div class="orbit" aria-hidden="true"><span>✨</span></div><div class="eyebrow light">AI-ASSISTED, HUMAN-REVIEWED</div><h2>Not sure where to report?</h2><p>Describe the problem and get a suggested category, priority, department and next steps — before you submit.</p><a class="btn btn-light btn-sm" href="#/ai">Try AI Analysis →</a></article>
      <article class="card"><div class="card-h"><div><div class="eyebrow">COMMUNITY ACTIVITY</div><h2>Last 7 days</h2></div><span class="muted sm">This browser’s records</span></div>${comm.total ? weekBars(all) : emptyState('📈', 'No activity yet', 'Trends appear once complaints are submitted.')}</article>
      <article class="card"><div class="card-h"><div><div class="eyebrow">LIVE PULSE</div><h2>What’s happening</h2></div><span class="live"><i></i> LIVE</span></div>${(() => { const ev = pulseEvents(); return ev.length ? `<ul class="pulse">${ev.map(e => `<li><span aria-hidden="true">${e.icon}</span><div>${esc(e.t)}<small>${timeTag(e.at)}</small></div></li>`).join('')}</ul>` : emptyState('💤', 'Nothing yet', 'Live updates will appear here. No private details are ever shown.'); })()}</article>
      <article class="card"><div class="card-h"><div><div class="eyebrow">INVOLVED COMMUNITY MEMBERS</div><h2>People taking part</h2></div></div><div class="members"><div><strong>${members}</strong><small>Registered members</small></div><div><strong>${active}</strong><small>Have reported a problem</small></div><div><strong>${comm.resolved}</strong><small>Problems resolved</small></div></div><p class="muted sm">Only counts are shown. Names and contact details are never displayed to other members.</p></article>
    </div>
  </div>`;
}

/* ================= SUBMIT COMPLAINT ================= */
function photoPreview() {
  const p = S.draft.photos;
  return p.length ? p.map(x => `<figure class="thumb"><img src="${x.url}" alt="Preview of ${esc(x.name)}"><figcaption>${esc(x.name.slice(0, 22))}<small>${(x.size / 1024).toFixed(0)} KB</small></figcaption><button type="button" class="thumb-x" data-action="remove-photo" data-id="${esc(x.id)}" aria-label="Remove ${esc(x.name)}">×</button></figure>`).join('') : '';
}
function vSubmit(u) {
  const pre = S.prefill || {}; S.prefill = null;
  return `<div class="page-head"><div><div class="eyebrow">NEW REPORT</div><h1>Submit a complaint</h1><p class="sub">Tell us what happened. Fields marked <span class="req">*</span> are required.</p></div></div>
  <div class="notice notice-danger"><strong>🚨 Immediate danger?</strong> Call <a href="tel:112">112</a> first. This form is not monitored in real time.</div>
  <div class="grid-2 submit-grid">
  <form id="complaintForm" class="card form" novalidate>
    ${field('cTitle', 'Complaint Title', { req: true, ph: 'e.g. Large pothole near the school gate', attrs: 'maxlength="120" autocomplete="off"', value: pre.title || '' })}
    ${(window.SpeechRecognition || window.webkitSpeechRecognition) ? '<div class="tools-row"><button type="button" class="btn btn-sm btn-ghost" data-action="voice" aria-pressed="false">🎤 Speak your complaint</button><small class="muted">Voice typing uses your browser’s speech service (English, India).</small></div>' : ''}
    ${field('cDesc', 'Detailed Problem Description', { req: true, area: true, rows: 6, ph: 'What happened? Since when? Who is affected? Any danger?', attrs: 'maxlength="2000"', value: pre.description || '', hint: '<span id="descCount">0</span>/2000 characters · at least 20' })}
    <div class="ai-decides"><span aria-hidden="true">🤖</span><div><strong>CiviBot AI decides the category and priority</strong><p>You don't need to choose. PeopleSolve Civic Intelligence reads your description and sets the <em>Complaint Category</em> and <em>Priority Level</em>. Authorised staff can review and correct them.</p></div></div>
    <div class="tools-row"><button type="button" class="btn btn-sm btn-ghost" data-action="geo">📍 Use my current location</button><small class="muted">Only used when you press the button.</small></div>
    ${field('cLoc', 'Location or Address', { ph: 'Street, landmark, area, city, PIN code', attrs: 'maxlength="200" autocomplete="street-address"', value: pre.location || '', hint: 'Needed for problems at a physical place (roads, water, power, waste…).' })}
    <div class="two">${selectField('cDept', 'Relevant Department', [['auto', '✨ Let AI suggest'], ...DEPARTMENTS.map(d => [d.id, `${d.icon} ${d.name}`])], pre.dept || 'auto')}
    ${field('cDate', 'Incident Date', { type: 'date', value: todayISO(), req: true, attrs: `max="${todayISO()}"` })}</div>
    <div class="field"><label for="cPhotos">Upload Supporting Photos</label>
      <label class="drop" for="cPhotos"><span aria-hidden="true">📸</span><strong>Choose photos</strong><small>JPG, PNG or WebP · up to ${CONFIG.MAX_PHOTOS} photos · max ${CONFIG.MAX_PHOTO_BYTES / 1048576} MB each</small></label>
      <input id="cPhotos" class="sr-only" type="file" accept="image/jpeg,image/png,image/webp" multiple>
      <div class="hint">Photos are stored only in this browser, visible only to you and authorised staff. Don’t upload ID documents or faces of private individuals.</div>
      <div id="photoGrid" class="thumbs" aria-live="polite">${photoPreview()}</div><div class="error-msg" id="cPhotos-err"></div></div>
    <div id="formAI"></div>
    <div class="actions"><button type="button" class="btn btn-ghost" data-action="analyze-draft"><span class="btn-label">✨ Get AI analysis first</span></button><button type="submit" class="btn btn-primary"><span class="btn-label">Submit complaint</span></button></div>
    <p class="muted sm">Submitting creates a complaint on <strong>PeopleSolve AI only</strong>. It is <strong>not</strong> filed with any government portal.</p>
  </form>
  <aside class="stack"><article class="card"><h3>Tips for a useful report</h3><ul class="ticks"><li>Give an exact location or landmark.</li><li>Say since when the problem exists.</li><li>Mention how many people are affected.</li><li>Add a clear photo if it is safe.</li></ul></article>
  <article class="card"><h3>Find the right department</h3><p class="muted">CiviBot AI matches your problem to a department.</p><div id="deptHint" class="muted sm">Run “Get AI analysis first” to see which department CiviBot AI recommends.</div></article></aside></div>`;
}
function draftInput() {
  return { title: $('#cTitle').value.trim(), description: $('#cDesc').value.trim(), category: 'other', location: $('#cLoc').value.trim(), incidentDate: $('#cDate').value, photoCount: S.draft.photos.length };
}
const draftKey = i => JSON.stringify([i.title, i.description, i.category, i.location, i.incidentDate, i.photoCount]);
function validateComplaint() {
  const f = $('#complaintForm'); clearErrs(f);
  const i = draftInput(), date = $('#cDate').value;
  let ok = setErr('cTitle', i.title.length >= 5 ? '' : 'Enter a title of at least 5 characters.');
  ok = setErr('cDesc', i.description.length >= 20 ? '' : 'Please describe the problem in at least 20 characters.') && ok;
  const dOk = date && date <= todayISO() && date >= `${+todayISO().slice(0, 4) - 5}-01-01`;
  ok = setErr('cDate', dOk ? '' : date > todayISO() ? 'The incident date cannot be in the future.' : 'Enter a valid incident date.') && ok;
  if (!ok) { toast('Please fix the highlighted fields.', 'error'); firstInvalid(f); }
  return ok;
}
async function packPhoto(file) {
  try {
    if (!window.createImageBitmap || file.size < 400 * 1024) return { type: file.type, blob: file };
    const bmp = await createImageBitmap(file), k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(bmp, 0, 0, cv.width, cv.height); bmp.close?.();
    const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.85));
    return blob && blob.size < file.size ? { type: 'image/jpeg', blob } : { type: file.type, blob: file };
  } catch { return { type: file.type, blob: file }; }
}
function addPhotos(files) {
  const err = [];
  for (const file of files) {
    if (S.draft.photos.length >= CONFIG.MAX_PHOTOS) { err.push(`You can attach at most ${CONFIG.MAX_PHOTOS} photos.`); break; }
    if (!CONFIG.PHOTO_TYPES.includes(file.type)) { err.push(`“${file.name}” is not a JPG, PNG or WebP image.`); continue; }
    if (file.size > CONFIG.MAX_PHOTO_BYTES) { err.push(`“${file.name}” is larger than ${CONFIG.MAX_PHOTO_BYTES / 1048576} MB.`); continue; }
    if (file.size === 0) { err.push(`“${file.name}” is empty.`); continue; }
    S.draft.photos.push({ id: uid(), file, url: URL.createObjectURL(file), name: file.name, size: file.size });
  }
  setErr('cPhotos', err.join(' ')); $('#photoGrid').innerHTML = photoPreview();
}
async function runDraftAnalysis(btn) {
  if (!validateComplaint()) return null;
  const i = draftInput(); busy(btn, true, 'Analysing…');
  $('#formAI').innerHTML = '<div class="skeleton" aria-busy="true" aria-label="Analysing"><i></i><i></i><i></i></div>';
  const ai = await analyzeComplaint(i); S.draft.ai = ai; S.draft.key = draftKey(i);
  $('#formAI').innerHTML = `<div class="card inset"><h3>🤖 CiviBot AI analysis</h3>${similarNotice(i, ai)}${aiReport(ai)}</div>`;
  const dh = $('#deptHint'); if (dh) { const d = DEPT[ai.department] || DEPT.other; dh.innerHTML = `Recommended: <a href="#/departments/${esc(d.id)}"><strong>${esc(d.icon)} ${esc(d.name)}</strong></a>`; }
  busy(btn, false); $('#formAI').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  return ai;
}
async function submitComplaint(f) {
  const u = currentUser(); if (!u) return;
  if (!validateComplaint()) return;
  const btn = $('button[type=submit]', f); busy(btn, true, 'Submitting…');
  try {
    const i = draftInput();
    let ai = S.draft.ai && S.draft.key === draftKey(i) ? S.draft.ai : await analyzeComplaint(i);
    if (CAT[ai.category].phys && !i.location) { setErr('cLoc', 'CiviBot AI detected a problem at a physical place — please enter the location.'); toast('Please add the location.', 'error'); firstInvalid(f); return; }
    const deptSel = $('#cDept').value, dept = deptSel === 'auto' ? ai.department : deptSel;
    const c = { id: genRef(), userId: u.id, title: i.title, description: i.description, category: ai.category, priority: ai.priority, aiPriority: ai.priority, department: dept, location: i.location, incidentDate: i.incidentDate, photoCount: 0, status: 'Submitted', createdAt: Date.now(), updatedAt: Date.now(), similarIds: findSimilar({ ...i, category: ai.category }).map(x => x.id), ai, history: [], messages: [], feedback: null };
    addHist(c, u, 'status', { from: null, to: 'Submitted', note: 'Complaint submitted' });
    let failed = 0;
    for (const p of S.draft.photos) { try { await idb.put({ id: p.id, complaintId: c.id, userId: u.id, name: p.name, ...(await packPhoto(p.file)) }); c.photoCount++; } catch { failed++; } }
    DB.complaints.unshift(c); save('complaints');
    notify(u.id, 'submitted', 'Complaint submitted', `Your complaint ${c.id} was recorded. It is not yet filed with any government portal.`, c.id);
    DB.users.filter(x => x.role === 'admin' && x.id !== u.id).forEach(a => notify(a.id, 'submitted', 'New complaint received', `${c.id}: ${c.title}`, c.id));
    S.draft.photos.forEach(p => URL.revokeObjectURL(p.url)); S.draft = { photos: [], ai: null, key: '' };
    if (failed) toast(`${plural(failed, 'photo')} could not be saved in this browser.`, 'error');
    openModal(`<div class="success"><div class="check" aria-hidden="true">✓</div><h2>Complaint submitted</h2><p>Your reference number</p><div class="refno" id="refno">${esc(c.id)}</div><button type="button" class="btn btn-sm btn-ghost" data-action="copy-ref" data-ref="${esc(c.id)}">Copy number</button>
      <p class="muted">Save this number. Track progress under <strong>Track Complaints</strong>. Status changes are made by authorised staff — nothing is filed with any government portal automatically.</p>
      ${portalFor(c.category, ai.emergency).length ? `<p class="muted">If this needs an official report, use: ${portalFor(c.category, ai.emergency).map(id => `<a href="${esc(PORTAL[id].url)}" target="_blank" rel="noopener noreferrer">${esc(PORTAL[id].name.split(' — ')[0])} ↗</a>`).join(', ')}</p>` : ''}
      <div class="actions center"><a class="btn btn-primary" href="#/complaint/${esc(c.id)}" data-action="close-modal">View complaint</a><a class="btn btn-ghost" href="#/dashboard" data-action="close-modal">Dashboard</a></div></div>`, 'Complaint submitted');
    location.hash = `#/complaint/${c.id}`;
  } catch (e) { toast('Could not submit: ' + (e.message || 'unknown error'), 'error'); } finally { busy(btn, false); }
}

/* ================= TRACK ================= */
function filtered(u) {
  const { q, priority, category, status } = S.filters, s = q.trim().toLowerCase();
  return visible(u).filter(c => (priority === 'all' || c.priority === priority) && (category === 'all' || c.category === category) && (status === 'all' || c.status === status)
    && (!s || `${c.id} ${c.title} ${c.description} ${catLabel(c.category)} ${DEPT[c.department]?.name || ''} ${c.location}`.toLowerCase().includes(s))).sort((a, b) => b.createdAt - a.createdAt);
}
function trackRows(u) {
  const rows = filtered(u), total = visible(u).length;
  if (!rows.length) return total ? emptyState('🔍', 'No complaints match', 'Try a different search or clear the filters.', '<button class="btn btn-sm btn-ghost" type="button" data-action="clear-filters">Clear filters</button>') : emptyState('📭', 'No complaints have been submitted yet', 'Complaints you submit will be listed here so you can track them.', '<a class="btn btn-primary btn-sm" href="#/submit">Submit a complaint</a>');
  return `<div class="table-wrap"><table><caption class="sr-only">Complaints</caption><thead><tr><th scope="col">Reference</th><th scope="col">Title</th><th scope="col">Submitted</th><th scope="col">Priority</th><th scope="col">Category</th><th scope="col">Department</th><th scope="col">Status</th></tr></thead><tbody>${rows.map(c => `<tr><td data-l="Reference"><a href="#/complaint/${esc(c.id)}" class="ref">${esc(c.id)}</a></td><td data-l="Title"><strong>${esc(c.title)}</strong>${isAdmin(u) ? `<small>by ${esc(DB.users.find(x => x.id === c.userId)?.name || 'Deleted user')}</small>` : ''}</td><td data-l="Submitted">${esc(F.short.format(c.createdAt))}</td><td data-l="Priority">${prioPill(c.priority)}</td><td data-l="Category">${catPill(c.category)}</td><td data-l="Department">${esc(DEPT[c.department]?.name || '—')}</td><td data-l="Status">${statusPill(c.status)}</td></tr>`).join('')}</tbody></table></div><p class="muted sm pad">Showing ${rows.length} of ${total}</p>`;
}
function vTrack(u) {
  const F2 = S.filters;
  return `<div class="page-head"><div><div class="eyebrow">${isAdmin(u) ? 'ALL COMPLAINTS' : 'MY COMPLAINTS'}</div><h1>Track complaints</h1><p class="sub">${isAdmin(u) ? 'Review and manage every complaint.' : 'Only you (and authorised staff) can see these.'}</p></div><div class="row"><button class="btn btn-ghost" type="button" data-action="export-csv">⬇ Export CSV</button><a class="btn btn-primary" href="#/submit">＋ Submit a complaint</a></div></div>
  <div class="filters card"><div class="field grow"><label for="fQ" class="sr-only">Search complaints</label><input id="fQ" type="search" placeholder="🔍 Search by reference, title, location…" value="${esc(F2.q)}"></div>
  <div class="field"><label for="fP" class="sr-only">Priority</label><select id="fP"><option value="all">All Priorities</option>${PRIORITIES.map(p => `<option${F2.priority === p ? ' selected' : ''}>${p}</option>`).join('')}</select></div>
  <div class="field"><label for="fC" class="sr-only">Category</label><select id="fC"><option value="all">All Categories</option>${CATEGORIES.map(c => `<option value="${c.id}"${F2.category === c.id ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}</select></div>
  <div class="field"><label for="fS" class="sr-only">Status</label><select id="fS"><option value="all">All Statuses</option>${STATUSES.map(s => `<option${F2.status === s ? ' selected' : ''}>${s}</option>`).join('')}</select></div></div>
  <article class="card flush" id="trackBody" aria-live="polite">${trackRows(u)}</article>`;
}

/* ================= COMPLAINT DETAIL ================= */
function timeline(c) {
  const idx = FLOW.indexOf(c.status), need = c.status === 'Need More Information';
  return `<ol class="steps" aria-label="Progress">${FLOW.map((s, i) => `<li class="${i < idx ? 'done' : i === idx ? 'now' : ''}"><span>${i < idx ? '✓' : i + 1}</span><small>${s}</small></li>`).join('')}</ol>${need ? '<div class="notice notice-warn">❓ Staff have asked for more information. See the history below and reply.</div>' : ''}`;
}
function historyList(c) {
  return `<ol class="history">${[...c.history].reverse().map(h => `<li><span class="h-dot" aria-hidden="true">${h.type === 'message' ? '💬' : h.type === 'priority' ? '🚦' : h.type === 'department' ? '🏛️' : h.type === 'category' ? '🏷️' : h.type === 'review' ? '🔍' : '🔄'}</span><div><strong>${h.type === 'status' ? (h.from ? `Status: ${esc(h.from)} → ${esc(h.to)}` : esc(h.note || 'Submitted')) : h.type === 'priority' ? `Priority: ${esc(h.from)} → ${esc(h.to)}` : h.type === 'department' ? `Department: ${esc(DEPT[h.from]?.name || h.from)} → ${esc(DEPT[h.to]?.name || h.to)}` : h.type === 'review' ? 'AI analysis reviewed by staff' : h.type === 'category' ? `Category: ${esc(catLabel(h.from))} → ${esc(catLabel(h.to))}` : `Message from ${h.role === 'admin' ? 'staff' : 'complainant'}`}</strong>${h.note && h.from ? `<p>${esc(h.note)}</p>` : ''}<small>${esc(h.by)}${h.role === 'admin' ? ' (staff)' : ''} · ${esc(F.dt.format(h.at))}</small></div></li>`).join('')}</ol>`;
}
async function loadPhotos(c) {
  const box = $('#photoBox'); if (!box || !c.photoCount) return;
  try {
    const items = await idb.byComplaint(c.id); if (!$('#photoBox')) return;
    box.innerHTML = items.length ? items.map(p => { const url = URL.createObjectURL(p.blob); return `<button type="button" class="thumb btn-reset" data-action="open-photo" data-src="${url}" data-name="${esc(p.name)}"><img src="${url}" alt="Evidence photo: ${esc(p.name)}"></button>`; }).join('') : '<p class="muted">Photos are not available in this browser (they are stored only on the device where the complaint was submitted).</p>';
  } catch { box.innerHTML = '<p class="muted">Could not load photos.</p>'; }
}
function vDetail(u, id) {
  const c = DB.complaints.find(x => x.id === id);
  if (!c || (!isAdmin(u) && c.userId !== u.id)) return `<div class="page-head"><div><h1>Complaint not found</h1></div></div>${emptyState('🔒', 'Not available', 'This complaint does not exist, or you do not have permission to view it.', '<a class="btn btn-primary btn-sm" href="#/track">Back to my complaints</a>')}`;
  const owner = DB.users.find(x => x.id === c.userId), dept = DEPT[c.department] || DEPT.other, mine = c.userId === u.id;
  const admin = isAdmin(u) ? `<article class="card"><h3>🛡️ Staff actions</h3><form id="adminForm" class="form" data-id="${esc(c.id)}">
    <div class="two">${selectField('aStatus', 'Status', STATUSES.map(s => [s, s]), c.status)}${selectField('aPrio', 'Priority', PRIORITIES.map(p => [p, p]), c.priority)}</div>${selectField('aCat', 'Category', CATEGORIES.map(x => [x.id, x.label]), c.category)}
    ${selectField('aDept', 'Assigned department', DEPARTMENTS.map(d => [d.id, d.name]), c.department)}
    ${field('aNote', 'Note to the complainant', { area: true, rows: 3, attrs: 'maxlength="500"', ph: 'Explain the change or ask for the information you need.' })}
    <div class="actions"><button class="btn btn-primary" type="submit"><span class="btn-label">Save changes</span></button><button class="btn btn-ghost" type="button" data-action="review-ai">✔ Mark AI suggestion reviewed</button></div></form>${dupHtml(c)}</article>` : '';
  const reply = mine && c.status === 'Need More Information' ? `<article class="card"><h3>Reply to staff</h3><form id="replyForm" class="form" data-id="${esc(c.id)}">${field('rMsg', 'Additional information', { area: true, rows: 4, req: true, attrs: 'maxlength="1000"' })}<button class="btn btn-primary" type="submit"><span class="btn-label">Send reply</span></button></form></article>` : '';
  const fb = mine && ['Resolved', 'Closed'].includes(c.status) ? `<article class="card"><h3>${c.feedback ? 'Your feedback' : 'How did we do?'}</h3><form id="feedbackForm" class="form" data-id="${esc(c.id)}">${selectField('fbRate', 'Rating', [['', 'Select…'], ['5', '★★★★★ Excellent'], ['4', '★★★★ Good'], ['3', '★★★ Okay'], ['2', '★★ Poor'], ['1', '★ Very poor']], c.feedback ? String(c.feedback.rating) : '')}${field('fbText', 'Comments (optional)', { area: true, rows: 3, value: c.feedback?.text || '', attrs: 'maxlength="500"' })}<button class="btn btn-primary btn-sm" type="submit"><span class="btn-label">${c.feedback ? 'Update feedback' : 'Send feedback'}</span></button></form></article>` : '';
  return `<div class="page-head"><div><a class="back" href="#/track">← All complaints</a><div class="eyebrow">${esc(c.id)}</div><h1>${esc(c.title)}</h1><p class="sub">Submitted ${esc(F.dt.format(c.createdAt))}${isAdmin(u) && owner ? ` by ${esc(owner.name)} · ${esc(owner.phone)} · ${esc(owner.email)}` : ''}</p></div><div class="ri-pills">${prioPill(c.priority)}${statusPill(c.status)}</div></div>
  <div class="grid-2"><div class="stack">
    <article class="card"><h3>Progress</h3>${timeline(c)}</article>
    <article class="card"><h3>Details</h3><dl class="dl"><dt>Description</dt><dd class="pre">${esc(c.description)}</dd><dt>Category</dt><dd>${catPill(c.category)} <span class="muted">${c.catBy === 'staff' ? 'Corrected by staff' : 'Detected by CiviBot AI'}</span></dd><dt>Location</dt><dd>${esc(c.location || 'Not provided')}</dd><dt>Incident date</dt><dd>${esc(c.incidentDate)}</dd><dt>Assigned department</dt><dd><a href="#/departments/${esc(dept.id)}">${esc(dept.icon)} ${esc(dept.name)}</a></dd><dt>Priority</dt><dd>${prioPill(c.priority)} <span class="muted">${c.priority === c.aiPriority ? 'Set by CiviBot AI' : 'AI suggested ' + esc(c.aiPriority) + '; adjusted by staff'}</span></dd><dt>Target resolution</dt><dd>${slaHtml(c)}</dd></dl>
    ${c.photoCount ? `<h4>Photos (${c.photoCount})</h4><div id="photoBox" class="thumbs"><span class="muted">Loading…</span></div>` : ''}</article>
    <article class="card"><h3>✨ AI Analysis</h3>${aiReport(c.ai)}</article>
    <article class="card"><h3>History</h3>${historyList(c)}</article>
  </div><div class="stack">${admin}${reply}${fb}
    <article class="card"><h3>Official reporting</h3><button class="btn btn-ghost btn-block" type="button" data-action="print">🖨 Print / save as PDF</button><p class="muted">This complaint is recorded on PeopleSolve AI only. To report to the government, use the official channel yourself:</p>${(c.ai.official || []).map(o => PORTAL[o.id] ? `<a class="btn btn-ghost btn-block" href="${esc(PORTAL[o.id].url)}" target="_blank" rel="noopener noreferrer">${PORTAL[o.id].icon} ${esc(PORTAL[o.id].name.split(' — ')[0])} ↗</a>` : '').join('')}</article>
    ${mine ? `<article class="card"><h3>Your data</h3><p class="muted sm">You can delete this complaint and its photos from this browser at any time.</p><div class="actions">${c.status === 'Resolved' ? '<button class="btn btn-sm btn-ghost" type="button" data-action="close-complaint">Confirm resolved &amp; close</button>' : ''}<button class="btn btn-sm btn-danger" type="button" data-action="del-complaint" data-id="${esc(c.id)}">Delete complaint</button></div></article>` : ''}
  </div></div>`;
}
function updateComplaint(f) {
  const u = currentUser(); if (!isAdmin(u)) return toast('Only authorised staff can do that.', 'error');
  const c = DB.complaints.find(x => x.id === f.dataset.id); if (!c) return;
  const cat = $('#aCat').value, status = $('#aStatus').value, prio = $('#aPrio').value, dept = $('#aDept').value, note = $('#aNote').value.trim();
  if (!STATUSES.includes(status) || !PRIORITIES.includes(prio) || !DEPT[dept] || !CAT[cat]) return toast('Invalid selection.', 'error');
  if (status === 'Need More Information' && !note) return setErr('aNote', 'Tell the complainant what information you need.');
  const changes = [];
  if (prio !== c.priority) { addHist(c, u, 'priority', { from: c.priority, to: prio, note }); notify(c.userId, 'priority_changed', 'Priority changed', `${c.id}: priority is now ${prio}.`, c.id); changes.push(1); c.priority = prio; }
  if (cat !== c.category) { addHist(c, u, 'category', { from: c.category, to: cat, note }); c.category = cat; c.catBy = 'staff'; changes.push(1); }
  if (dept !== c.department) { addHist(c, u, 'department', { from: c.department, to: dept, note }); notify(c.userId, 'department_assigned', 'Department assigned', `${c.id}: assigned to ${DEPT[dept].name}.`, c.id); changes.push(1); c.department = dept; }
  if (status !== c.status) {
    addHist(c, u, 'status', { from: c.status, to: status, note });
    const t = status === 'Need More Information' ? ['info_requested', 'More information requested', `${c.id}: ${note}`] : status === 'Resolved' ? ['resolved', 'Complaint resolved', `${c.id} was marked resolved. Please share feedback.`] : ['status_changed', 'Status updated', `${c.id}: now “${status}”.${note ? ' ' + note : ''}`];
    notify(c.userId, t[0], t[1], t[2], c.id); changes.push(1); c.status = status;
  } else if (note && !changes.length) { addHist(c, u, 'message', { note }); notify(c.userId, 'status_changed', 'Message from staff', `${c.id}: ${note}`, c.id); changes.push(1); }
  if (!changes.length) return toast('No changes to save.', 'info');
  c.updatedAt = Date.now(); save('complaints'); toast('Complaint updated and the complainant notified.', 'success'); routeFn();
}

/* ================= AI ANALYSIS PAGE ================= */
function vAI(u) {
  const mine = visible(u).filter(c => c.ai).sort((a, b) => b.createdAt - a.createdAt).slice(0, 8);
  return `<div class="page-head"><div><div class="eyebrow">POWERED BY PEOPLESOLVE CIVIC INTELLIGENCE</div><h1>AI Analysis <span aria-hidden="true">✨</span></h1><p class="sub">CiviBot AI reads a problem and suggests the category, priority, department and next steps. Nothing is saved or filed from this page.</p></div></div>
  <div class="grid-2"><div class="stack"><form id="tryForm" class="card form" novalidate><h3>Try CiviBot AI</h3>
    ${field('tText', 'Describe the problem', { req: true, area: true, rows: 6, ph: 'e.g. Water pipe burst near the market and the street is flooding since morning.', attrs: 'maxlength="2000"' })}
    ${field('tLoc', 'Location (optional)', { attrs: 'maxlength="200"' })}
    <button class="btn btn-primary" type="submit"><span class="btn-label">🤖 Analyse</span></button></form>
    <div id="tryResult"></div></div>
  <div class="stack"><article class="card"><h3>Your recent AI analyses</h3>${mine.length ? `<div class="list">${mine.map(c => `<a class="row-item" href="#/complaint/${esc(c.id)}"><div class="ri-main"><strong>${esc(c.title)}</strong><small>${esc(c.id)} · ${esc(catLabel(c.category))}</small></div><div class="ri-pills">${prioPill(c.priority)}</div></a>`).join('')}</div>` : emptyState('🤖', 'No analyses yet', 'Every complaint you submit gets an AI analysis that will be listed here.')}</article>
  <article class="card"><h3>How CiviBot AI is used</h3><ul class="ticks"><li>It <strong>suggests</strong>; it never decides legal matters.</li><li>It never claims anything was filed with the government.</li><li>Authorised staff can review and correct its category and priority.</li><li>Emergencies always point to <a href="tel:112">112</a>.</li></ul></article></div></div>`;
}
async function runTry(f) {
  clearErrs(f); const text = $('#tText').value.trim();
  if (!setErr('tText', text.length >= 10 ? '' : 'Describe the problem in at least 10 characters.')) return;
  const btn = $('button[type=submit]', f); busy(btn, true, 'Analysing…');
  const ai = await analyzeComplaint({ title: text.slice(0, 80), description: text, category: 'other', location: $('#tLoc').value.trim(), incidentDate: todayISO(), photoCount: 0 });
  $('#tryResult').innerHTML = `<article class="card">${aiReport(ai)}<div class="actions"><a class="btn btn-primary btn-sm" href="#/submit" data-action="prefill" data-text="${esc(text)}" data-loc="${esc($('#tLoc').value.trim())}">Submit this as a complaint →</a></div></article>`;
  busy(btn, false);
}

/* ================= DEPARTMENTS ================= */
function deptCard(d) { return `<a class="dept-card" href="#/departments/${esc(d.id)}"><span class="dept-ico" aria-hidden="true">${d.icon}</span><h3>${esc(d.name)}</h3><p>${esc(d.handles.slice(0, 3).join(' · '))}</p><span class="link">View details →</span></a>`; }
function vDepartments() {
  return `<div class="page-head"><div><div class="eyebrow">WHO HANDLES WHAT</div><h1>Department directory</h1><p class="sub">Find the authority responsible for your problem.</p></div></div>
  <article class="card finder"><h3>🧭 Find the Right Department</h3><div class="finder-row"><div class="field grow"><label for="finderCat">What is your problem about?</label><select id="finderCat"><option value="">Select a problem category…</option>${CATEGORIES.map(c => `<option value="${c.id}">${c.icon} ${esc(c.label)}</option>`).join('')}</select></div></div><div id="finderOut" aria-live="polite"></div></article>
  <div class="notice notice-info">Phone numbers are shown only where nationally verified. Local offices vary by city and state — use the official website links to find yours.</div>
  <div class="dept-grid">${DEPARTMENTS.map(deptCard).join('')}</div>`;
}
function finderResult(catId) {
  const out = $('#finderOut'); if (!catId) { out.innerHTML = ''; return; }
  const d = DEPT[CAT[catId].dept]; const ps = portalFor(catId, false);
  out.innerHTML = `<div class="result"><div><span class="muted">Recommended department</span><h4>${esc(d.icon)} ${esc(d.name)}</h4><p class="muted">${esc(d.desc)}</p></div><div class="actions"><a class="btn btn-primary btn-sm" href="#/departments/${esc(d.id)}">Open department page</a>${ps.map(id => `<a class="btn btn-ghost btn-sm" href="${esc(PORTAL[id].url)}" target="_blank" rel="noopener noreferrer">${esc(PORTAL[id].name.split(' — ')[0])} ↗</a>`).join('')}</div></div>`;
}
function vDept(id) {
  const d = DEPT[id]; if (!d) return `<div class="page-head"><h1>Department not found</h1></div>${emptyState('🔎', 'Not found', 'Please choose a department from the directory.', '<a class="btn btn-primary btn-sm" href="#/departments">Back to directory</a>')}`;
  const cats = CATEGORIES.filter(c => c.dept === d.id);
  return `<div class="page-head"><div><a class="back" href="#/departments">← All departments</a><div class="eyebrow">DEPARTMENT</div><h1>${esc(d.icon)} ${esc(d.name)}</h1><p class="sub">${esc(d.desc)}</p></div></div>
  ${d.external ? '<div class="notice notice-warn"><strong>Important:</strong> this type of problem must be reported to the official authority. A complaint on PeopleSolve AI is <strong>not</strong> an official report.</div>' : ''}
  <div class="grid-2"><div class="stack"><article class="card"><h3>Problems handled</h3><ul class="ticks">${d.handles.map(h => `<li>${esc(h)}</li>`).join('')}</ul></article>
  <article class="card"><h3>How to submit a complaint</h3><ol class="num">${d.how.map(h => `<li>${esc(h)}</li>`).join('')}</ol></article></div>
  <div class="stack"><article class="card"><h3>Contact &amp; official website</h3>${d.contact.length ? `<dl class="dl">${d.contact.map(c => `<dt>${esc(c.label)}</dt><dd><a href="tel:${esc(c.value.replace(/[^\d+]/g, ''))}" class="phone">${esc(c.value)}</a></dd>`).join('')}</dl>` : `<p class="muted">${NO_CONTACT}</p>`}
  <a class="btn btn-ghost btn-block" href="${esc(d.web.url)}" target="_blank" rel="noopener noreferrer">🌐 ${esc(d.web.label)} ↗</a>${d.webNote ? `<p class="muted sm">${esc(d.webNote)}</p>` : ''}</article>
  <article class="card"><h3>Report this problem</h3><p class="muted">Keep a tracked record on PeopleSolve AI. CiviBot AI will set the category and priority for you.</p><a class="btn btn-primary btn-block" href="#/submit">📝 Submit an internal complaint</a>
  ${d.portals.map(p => `<a class="btn btn-ghost btn-block" href="${esc(PORTAL[p].url)}" target="_blank" rel="noopener noreferrer">${PORTAL[p].icon} Official: ${esc(PORTAL[p].name.split(' — ')[0])} ↗</a>`).join('')}
  <p class="muted sm">${cats.length ? 'Related categories: ' + cats.map(c => esc(c.label)).join(', ') + '.' : ''}</p></article></div></div>`;
}

/* ================= OFFICIAL PORTALS ================= */
function vPortals() {
  return `<div class="page-head"><div><div class="eyebrow">GOVERNMENT OF INDIA</div><h1>Official Government Complaint Portals</h1><p class="sub">Verified official channels. They open in a new tab.</p></div></div>
  <div class="notice notice-danger big"><strong>🚨 Immediate danger? Call <a href="tel:112">112</a> now</strong> — Police, Fire &amp; Rescue and Health services, from any phone.</div>
  <div class="notice notice-warn"><strong>Internal vs official:</strong> a complaint on PeopleSolve AI is recorded here only. It is <strong>not</strong> submitted to any government portal unless you complete the submission on that portal yourself, and PeopleSolve AI can’t confirm it.</div>
  <div class="portal-grid">${PORTALS.map(p => `<article class="card portal tone-${p.tone}"><div class="portal-h"><span class="dept-ico" aria-hidden="true">${p.icon}</span><h3>${esc(p.name)}</h3></div>
  <dl class="dl"><dt>Handles</dt><dd>${esc(p.handles)}</dd><dt>Who should use it</dt><dd>${esc(p.who)}</dd><dt>Information you may need</dt><dd><ul class="ticks">${p.info.map(i => `<li>${esc(i)}</li>`).join('')}</ul></dd><dt>How to access</dt><dd>${esc(p.how)}</dd>${p.numbers.length ? `<dt>Helpline</dt><dd>${p.numbers.map(n => `${esc(n.label)}: <a class="phone" href="tel:${esc(n.value.replace(/[^\d+]/g, ''))}">${esc(n.value)}</a>`).join('<br>')}</dd>` : ''}</dl>
  <a class="btn btn-primary btn-block" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">Open official portal ↗</a><small class="muted">${esc(p.url)}</small></article>`).join('')}</div>`;
}

/* ================= COMMUNITY ================= */
function vCommunity() {
  const all = DB.complaints, st = computeStats(all);
  return `<div class="page-head"><div><div class="eyebrow">TRENDS · NO PRIVATE DETAILS</div><h1>Community activity</h1><p class="sub">Overall trends from complaints recorded in this browser. Names and contact details are never shown.</p></div></div>
  ${!all.length ? emptyState('👥', 'No complaints have been submitted yet', 'Community trends will appear after the first complaint is submitted.', '<a class="btn btn-primary btn-sm" href="#/submit">Submit a complaint</a>') : `<div class="stat-grid"><article class="stat s-blue"><div class="stat-top"><span>Total</span><i>📋</i></div><strong>${st.total}</strong><small>${st.week} in last 7 days</small></article><article class="stat s-red"><div class="stat-top"><span>Need attention</span><i>🚩</i></div><strong>${st.attention}</strong><small>Open urgent items</small></article><article class="stat s-green"><div class="stat-top"><span>Resolved</span><i>✅</i></div><strong>${st.resolved}</strong><small>${Math.round(st.resolved / st.total * 100)}% of total</small></article><article class="stat s-teal"><div class="stat-top"><span>Members</span><i>👥</i></div><strong>${DB.users.length}</strong><small>${new Set(all.map(c => c.userId)).size} have reported</small></article></div>
  <div class="grid-2"><article class="card"><div class="card-h"><div><div class="eyebrow">LAST 7 DAYS</div><h2>Complaints per day</h2></div></div>${weekBars(all)}</article><article class="card"><div class="card-h"><div><div class="eyebrow">WHAT PEOPLE ARE REPORTING</div><h2>By category</h2></div></div><div class="cat-list">${catBars(all)}</div></article></div>
  <div class="grid-2"><article class="card"><h2>By priority</h2><div class="prio-wrap">${donut(st.byPrio, st.total)}<div class="prio-list">${PRIORITIES.map(p => `<div class="prio-row prio-${p.toLowerCase()}"><span class="dot"></span><div><strong>${p}</strong></div><b>${st.byPrio[p]}</b></div>`).join('')}</div></div></article>
  <article class="card"><div class="card-h"><h2>Live pulse</h2><span class="live"><i></i> LIVE</span></div><ul class="pulse">${pulseEvents().map(e => `<li><span aria-hidden="true">${e.icon}</span><div>${esc(e.t)}<small>${timeTag(e.at)}</small></div></li>`).join('')}</ul></article></div>`}`;
}

/* ================= NOTIFICATIONS ================= */
function vNotifications(u) {
  const list = myNotifs(), unread = list.filter(n => !n.read).length;
  return `<div class="page-head"><div><div class="eyebrow">UPDATES</div><h1>Notifications</h1><p class="sub">${unread ? plural(unread, 'unread notification') : 'You’re all caught up.'}</p></div><div class="row"><button class="btn btn-ghost btn-sm" type="button" data-action="toggle-sound" aria-pressed="${u.prefs.sound}">${u.prefs.sound ? '🔊 Sounds on' : '🔇 Sounds muted'}</button>${unread ? '<button class="btn btn-primary btn-sm" type="button" data-action="mark-all-read">Mark all read</button>' : ''}</div></div>
  <article class="card flush">${list.length ? `<div class="list">${list.map(n => `<div class="notif${n.read ? '' : ' unread'}"><span class="n-ico" aria-hidden="true">${N_ICON[n.type] || '🔔'}</span><div class="ri-main"><strong>${esc(n.title)}${n.read ? '' : ' <span class="new">NEW</span>'}</strong><p>${esc(n.body)}</p><small>${timeTag(n.at)}</small></div><div class="row">${n.complaintId && (isAdmin(u) || DB.complaints.some(c => c.id === n.complaintId && c.userId === u.id)) ? `<a class="btn btn-sm btn-ghost" href="#/complaint/${esc(n.complaintId)}" data-action="mark-read" data-id="${esc(n.id)}">Open</a>` : ''}${n.read ? '' : `<button class="btn btn-sm btn-ghost" type="button" data-action="mark-read" data-id="${esc(n.id)}">Mark read</button>`}</div></div>`).join('')}</div>` : emptyState('🔔', 'No notifications yet', 'You’ll be notified when a complaint is submitted, assigned, updated or resolved.')}</article>`;
}

/* ================= HOW IT WORKS ================= */
const HOW = [['Register or log in', 'Create a free account with your name, phone and email.'], ['Open Submit Complaint', 'Choose “Submit Complaint” from the menu.'], ['Describe the problem', 'Write what happened, where and since when. CiviBot AI chooses the category and priority for you.'], ['Upload supporting photos', 'Add clear photos as evidence, if it is safe to take them.'], ['Review the AI analysis', 'See the suggested priority, department, solution and next steps.'], ['Submit the complaint', 'Press submit. This records it on PeopleSolve AI only.'], ['Receive a reference number', 'Save your unique number, e.g. CIV-20261019-XXXXX.'], ['Track progress', 'Follow the status and history under Track Complaints; you’ll get notifications.'], ['Follow next steps / use official portals', 'For crimes, cyber fraud, consumer disputes or escalation, report on the official portal yourself.'], ['Check the resolution & give feedback', 'When resolved, confirm it and rate the service.']];
function vHow() {
  return `<div class="page-head"><div><div class="eyebrow">NEW HERE?</div><h1>How PeopleSolve AI works</h1><p class="sub">From problem to resolution in 10 simple steps.</p></div><a class="btn btn-primary" href="#/submit">Start a complaint</a></div>
  <ol class="how">${HOW.map((h, i) => `<li><span class="how-n">${i + 1}</span><div><h3>${esc(h[0])}</h3><p>${esc(h[1])}</p></div></li>`).join('')}</ol>
  <article class="card"><h3>Good to know</h3><ul class="ticks"><li>AI results are <strong>suggestions</strong>, reviewed by authorised staff.</li><li>A complaint here is <strong>not</strong> an FIR or an official government filing.</li><li>In an emergency call <a href="tel:112">112</a>.</li></ul></article>`;
}

/* ================= PROFILE ================= */
function vProfile(u) {
  const mine = DB.complaints.filter(c => c.userId === u.id).length;
  return `<div class="page-head"><div><div class="eyebrow">ACCOUNT</div><h1>Profile &amp; settings</h1><p class="sub">${esc(u.email)} · ${isAdmin(u) ? 'Authorised administrator' : 'Candidate'} · joined ${esc(F.short.format(u.createdAt))}</p></div></div>
  <div class="grid-2"><div class="stack">
  <form id="profileForm" class="card form" novalidate><h3>Your details</h3>${field('pName', 'Candidate Name', { value: u.name, req: true, attrs: 'maxlength="60"' })}${field('pPhone', 'Phone Number', { type: 'tel', value: u.phone, req: true })}<div class="field"><label for="pEmail">Email ID</label><input id="pEmail" value="${esc(u.email)}" disabled></div><button class="btn btn-primary" type="submit"><span class="btn-label">Save details</span></button></form>
  <form id="pwForm" class="card form" novalidate><h3>Change password</h3>${field('pwOld', 'Current password', { type: 'password', attrs: 'autocomplete="current-password"' })}${field('pwNew', 'New password', { type: 'password', attrs: 'autocomplete="new-password"', hint: '8+ characters with upper-case, lower-case and a number.' })}<button class="btn btn-primary" type="submit"><span class="btn-label">Update password</span></button></form>
  <article class="card"><h3>Notifications</h3><button class="btn btn-ghost" type="button" data-action="toggle-sound" aria-pressed="${u.prefs.sound}">${u.prefs.sound ? '🔊 Sounds on — click to mute' : '🔇 Sounds muted — click to enable'}</button></article></div>
  <div class="stack"><article class="card"><h3>🔌 What must be connected for production</h3><p class="muted sm">This build stores data in <strong>this browser only</strong>. These are not yet connected, and the site does not pretend otherwise:</p>
  <ul class="status-list"><li class="${CONFIG.AI_ENDPOINT ? 'ok' : 'todo'}"><b>${CONFIG.AI_ENDPOINT ? '✔' : '✖'}</b> AI service (CiviBot AI) — ${CONFIG.AI_ENDPOINT ? 'connected' : 'set <code>CONFIG.AI_ENDPOINT</code> to your server-side proxy; using rule-based fallback'}</li><li class="todo"><b>✖</b> Server database &amp; authentication (shared across devices)</li><li class="todo"><b>✖</b> Email / SMS service for reset codes and alerts</li><li class="todo"><b>✖</b> Server-side validation, role enforcement &amp; secure photo storage</li><li class="todo"><b>✖</b> Government portal submission (users file on the official portal themselves)</li></ul></article>
  <article class="card"><h3>Your data</h3><p class="muted sm">You have ${plural(mine, 'complaint')} stored in this browser.</p><div class="actions"><button class="btn btn-ghost btn-sm" type="button" data-action="export-data">⬇ Download my data</button><button class="btn btn-danger btn-sm" type="button" data-action="del-account">Delete my account</button></div></article></div></div>`;
}

/* ================= CIVIBOT AI (chat assistant) ================= */
const BOT = { open: false, msgs: [] };
function botReply(text) {
  const t = text.toLowerCase().trim();
  if (!t) return null;
  if (hits(t, T_CRIT).length || /\b(emergency|help me|in danger|urgent help)\b/.test(t))
    return { html: '<strong>🚨 If anyone is in danger, call <a href="tel:112">112</a> right now</strong> (Police, Fire &amp; Rescue, Health). Don’t wait for this website. Once everyone is safe, you can report the problem here.' };
  if (/^(hi|hello|hey|namaste|hii)\b/.test(t)) return { html: 'Namaste! 🙏 I’m <strong>CiviBot AI</strong>. Describe a problem and I’ll suggest the category, priority and the right department — or ask how the site works.' };
  if (/(how|steps).*(work|use|start|submit|file)|\bhelp\b/.test(t)) return { html: 'It’s simple: <strong>Submit Complaint</strong> → describe the problem → AI sets category &amp; priority → get a <strong>reference number</strong> → track it. See <a href="#/how">How It Works</a>.' };
  if (/\b(track|status|reference|ref no|where is my)\b/.test(t)) return { html: 'Open <a href="#/track">Track Complaints</a> and search by your reference number (e.g. CIV-20261019-XXXXX).' };
  if (/\b(fir|police complaint)\b/.test(t)) return { html: 'A complaint here is <strong>not an FIR</strong>. For crimes, contact your nearest police station or dial <a href="tel:112">112</a>. See <a href="#/departments/police">Police Department</a>.' };
  if (/\b(portal|official|government|cpgrams|grievance)\b/.test(t)) return { html: 'See the verified <a href="#/portals">Official Government Complaint Portals</a>: ERSS 112, Cyber Crime, Consumer Helpline and CPGRAMS.' };
  if (t.split(/\s+/).length < 3) return { html: 'Could you tell me a bit more? For example: “Streetlight not working near my house for 3 days”.' };
  const a = localAnalyze({ title: text.slice(0, 80), description: text, category: 'other', location: '', incidentDate: todayISO(), photoCount: 0 });
  if (a.category === 'other') return { html: 'I couldn’t match that to a department. Try adding what kind of problem it is (water, road, electricity, waste, fraud…) — or browse the <a href="#/departments">Department Directory</a>.' };
  const d = DEPT[a.department] || DEPT.other;
  return { html: `This looks like <strong>${esc(catLabel(a.category))}</strong> · suggested priority ${prioPill(a.priority)}<br>Department: <a href="#/departments/${esc(d.id)}"><strong>${esc(d.icon)} ${esc(d.name)}</strong></a><br><span class="muted">${esc(a.nextSteps[0])}</span><div class="actions"><a class="btn btn-sm btn-primary" href="#/submit" data-action="prefill" data-text="${esc(text)}">Report this</a></div><small class="muted">Suggestion only — not an official decision.</small>` };
}
function botRender() {
  const root = $('#bot'); if (!root) return;
  root.innerHTML = `<button class="bot-fab" type="button" data-action="bot-toggle" aria-expanded="${BOT.open}" aria-controls="botPanel" aria-label="${BOT.open ? 'Close' : 'Open'} CiviBot AI assistant"><span aria-hidden="true">${BOT.open ? '×' : '🤖'}</span></button>
  <section id="botPanel" class="bot-panel" ${BOT.open ? '' : 'hidden'} aria-label="CiviBot AI"><header><span class="bot-av" aria-hidden="true">🤖</span><div><strong>CiviBot AI</strong><small>PeopleSolve Civic Intelligence</small></div></header>
  <div class="bot-log" id="botLog" role="log" aria-live="polite"><div class="bot-msg from-bot"><div>Namaste! I’m <strong>CiviBot AI</strong>. Tell me about a problem and I’ll point you to the right department.</div></div>${BOT.msgs.map(m => `<div class="bot-msg from-${m.who}"><div>${m.who === 'me' ? esc(m.text) : m.html}</div></div>`).join('')}</div>
  <div class="bot-chips">${['Streetlight not working', 'Money lost in UPI fraud', 'No water for 2 days', 'How does this work?'].map(q => `<button type="button" data-action="bot-chip" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
  <form id="botForm" class="bot-form"><label class="sr-only" for="botInput">Message CiviBot AI</label><input id="botInput" autocomplete="off" maxlength="300" placeholder="Describe your problem…"><button class="btn btn-primary btn-sm" type="submit">Send</button></form><p class="bot-note">AI suggestions only. Emergency? Call 112.</p></section>`;
  const log = $('#botLog'); if (log) log.scrollTop = log.scrollHeight;
  if (BOT.open) { const i = $('#botInput'); if (i && document.activeElement === document.body) i.focus(); }
}
function botSend(text) {
  text = text.trim(); if (!text) return;
  BOT.msgs.push({ who: 'me', text }); const r = botReply(text); if (r) BOT.msgs.push({ who: 'bot', html: r.html });
  BOT.msgs = BOT.msgs.slice(-20); botRender(); const i = $('#botInput'); if (i) i.focus();
}

/* ================= ROUTER ================= */
const clockTick = () => { const n = Date.now(); const d = $('#clockDate'), t = $('#clockTime'); if (d) d.textContent = F.date.format(n); if (t) t.textContent = F.time.format(n); };
function view(u, page, arg) {
  switch (page) {
    case 'submit': return vSubmit(u); case 'track': return vTrack(u); case 'complaint': return vDetail(u, arg); case 'ai': return vAI(u);
    case 'departments': return arg ? vDept(arg) : vDepartments(); case 'portals': return vPortals(); case 'community': return vCommunity();
    case 'notifications': return vNotifications(u); case 'how': return vHow(); case 'profile': return vProfile(u); default: return vDashboard(u);
  }
}
function route() {
  if (typeof rec !== 'undefined' && rec) rec.stop();
  const parts = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  let page = parts[0] || 'dashboard', arg = parts[1] || null;
  const u = currentUser();
  if (!u) {
    if (getSession()) sessionStorage.removeItem('peoplesolve.session');
    $('#app').hidden = true; $('#auth').hidden = false; $('#bot').innerHTML = '';
    if (!$('#loginForm').offsetParent && !$('#registerForm').offsetParent && !$('#forgotForm').offsetParent && !$('#resetForm').offsetParent) authPanel('login');
    document.title = 'PeopleSolve AI — Your Voice. Smarter Solutions. Trusted Service.';
    if (location.hash !== '#/login') history.replaceState(null, '', '#/login');
    return;
  }
  if (page === 'login' || !(page in TITLES) && page !== 'complaint') { page = 'dashboard'; arg = null; if (location.hash !== '#/dashboard') history.replaceState(null, '', '#/dashboard'); }
  $('#auth').hidden = true; $('#app').hidden = false;
  S.route = { page, arg };
  renderNav(page);
  $('#crumb').textContent = page === 'departments' && arg && DEPT[arg] ? DEPT[arg].name : TITLES[page];
  document.title = `${TITLES[page]} · PeopleSolve AI`;
  $('#view').innerHTML = view(u, page, arg);
  $('#sidebar').classList.remove('open'); $('#scrim').hidden = true;
  window.scrollTo(0, 0); $('#view').focus({ preventScroll: true });
  if (page === 'complaint') { const c = DB.complaints.find(x => x.id === arg); if (c && (isAdmin(u) || c.userId === u.id)) loadPhotos(c); }
  if (page === 'dashboard' && !u.prefs.guideSeen) { /* banner shown; dismissed explicitly */ }
  clockTick(); botRender();
}
routeFn = route;

/* ================= ACTIONS ================= */
let confirmCb = null;
function confirmBox(title, text, yes, danger = true) {
  confirmCb = yes;
  openModal(`<h2>${esc(title)}</h2><p class="muted">${esc(text)}</p><div class="actions"><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" type="button" data-action="confirm-yes">Yes, continue</button><button class="btn btn-ghost" type="button" data-action="close-modal">Cancel</button></div>`, title);
}
async function removeComplaint(id) {
  await idb.removeByComplaint(id).catch(() => {});
  DB.complaints = DB.complaints.filter(c => c.id !== id); DB.notifications = DB.notifications.filter(n => n.complaintId !== id);
  save('complaints'); save('notifications');
}
let rec = null;
const csvCell = v => { let t = String(v ?? '').replace(/\r?\n/g, ' '); if (/^[=+\-@\t]/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"'; };
const applyTheme = t => {
  document.documentElement.dataset.theme = t;
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = t === 'dark' ? '#0B1220' : '#1B4F9C';
  const b = $('#themeBtn'); if (b) { b.firstElementChild.textContent = t === 'dark' ? '☀️' : '🌙'; b.setAttribute('aria-label', t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'); }
};
const actions = {
  'toggle-theme': () => { const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; applyTheme(t); try { localStorage.setItem('peoplesolve.theme', JSON.stringify(t)); } catch { /* ignore */ } },
  print: () => window.print(),
  'export-csv': () => {
    const u = currentUser(), rows = filtered(u); if (!rows.length) return toast('Nothing to export.', 'info');
    const head = ['Reference', 'Title', 'Submitted', 'Priority', 'Category', 'Department', 'Status', 'Location', 'Target resolution'];
    const csv = [head, ...rows.map(c => [c.id, c.title, new Date(c.createdAt).toISOString(), c.priority, catLabel(c.category), DEPT[c.department]?.name || '', c.status, c.location, new Date(dueAt(c)).toISOString()])].map(r => r.map(csvCell).join(',')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })); a.download = 'peoplesolve-ai-complaints.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },
  geo: el => {
    if (!navigator.geolocation) return toast('Location is not available in this browser.', 'error');
    el.disabled = true;
    navigator.geolocation.getCurrentPosition(pos => {
      el.disabled = false; const { latitude: la, longitude: lo, accuracy } = pos.coords, f = $('#cLoc'); if (!f) return;
      const gps = `GPS ${la.toFixed(5)}, ${lo.toFixed(5)} (±${Math.round(accuracy)} m)`; f.value = f.value ? `${f.value} — ${gps}` : gps; setErr('cLoc', ''); toast('Location added. Please add a landmark too.', 'success');
    }, err => { el.disabled = false; toast(err.code === 1 ? 'Location permission was denied.' : 'Could not get your location.', 'error'); }, { enableHighAccuracy: true, timeout: 10000 });
  },
  voice: el => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR) return toast('Voice typing is not supported in this browser.', 'error');
    if (rec) { rec.stop(); return; }
    rec = new SR(); rec.lang = 'en-IN'; rec.continuous = true; rec.interimResults = false;
    rec.onresult = e => { const t = Array.from(e.results).slice(e.resultIndex).map(r => r[0].transcript).join(' '); const d = $('#cDesc'); if (d) { d.value = (d.value + ' ' + t).trim().slice(0, 2000); d.dispatchEvent(new Event('input', { bubbles: true })); } };
    rec.onend = () => { rec = null; el.textContent = '🎤 Speak your complaint'; el.setAttribute('aria-pressed', 'false'); el.classList.remove('rec'); };
    rec.onerror = ev => { if (ev.error !== 'aborted' && ev.error !== 'no-speech') toast('Voice typing failed: ' + ev.error, 'error'); };
    try { rec.start(); el.textContent = '⏹ Stop listening'; el.setAttribute('aria-pressed', 'true'); el.classList.add('rec'); } catch { rec = null; }
  },
  goto: el => { location.hash = el.dataset.to; },
  'open-sidebar': () => { $('#sidebar').classList.add('open'); $('#scrim').hidden = false; },
  'close-sidebar': () => { $('#sidebar').classList.remove('open'); $('#scrim').hidden = true; },
  'close-modal': () => closeModal(),
  'toggle-sound': () => {
    const u = currentUser(); u.prefs.sound = !u.prefs.sound; save('users');
    const b = $('#soundBtn'); b.setAttribute('aria-pressed', u.prefs.sound); b.setAttribute('aria-label', `Notification sounds: ${u.prefs.sound ? 'on. Activate to mute.' : 'muted. Activate to turn on.'}`); b.firstElementChild.textContent = u.prefs.sound ? '🔊' : '🔇';
    toast(u.prefs.sound ? 'Notification sounds on.' : 'Notification sounds muted.', 'info'); if (u.prefs.sound) beep();
    if (['notifications', 'profile'].includes(S.route.page)) route();
  },
  logout: () => logout('You have been logged out.'),
  'remove-photo': el => { const i = S.draft.photos.findIndex(p => p.id === el.dataset.id); if (i > -1) { URL.revokeObjectURL(S.draft.photos[i].url); S.draft.photos.splice(i, 1); $('#photoGrid').innerHTML = photoPreview(); } },
  'analyze-draft': el => runDraftAnalysis(el),
  'copy-ref': async el => { try { await navigator.clipboard.writeText(el.dataset.ref); toast('Reference number copied.', 'success'); } catch { toast('Copy failed — select the number manually.', 'error'); } },
  'mark-read': el => { const n = DB.notifications.find(x => x.id === el.dataset.id); if (n && !n.read) { n.read = true; save('notifications'); updateBell(); if (el.tagName === 'BUTTON') route(); } },
  'mark-all-read': () => { const u = currentUser(); DB.notifications.forEach(n => { if (n.userId === u.id) n.read = true; }); save('notifications'); route(); },
  'clear-filters': () => { S.filters = { q: '', priority: 'all', category: 'all', status: 'all' }; route(); },
  'del-complaint': el => confirmBox('Delete this complaint?', 'The complaint, its history and photos will be removed from this browser. This cannot be undone.', async () => { await removeComplaint(el.dataset.id); closeModal(); toast('Complaint deleted.', 'success'); location.hash = '#/track'; }),
  'close-complaint': () => { const u = currentUser(), c = DB.complaints.find(x => x.id === S.route.arg); if (!c || c.userId !== u.id) return; addHist(c, u, 'status', { from: c.status, to: 'Closed', note: 'Complainant confirmed resolution' }); c.status = 'Closed'; c.updatedAt = Date.now(); save('complaints'); toast('Complaint closed. Thank you!', 'success'); route(); },
  'review-ai': () => { const u = currentUser(); if (!isAdmin(u)) return; const c = DB.complaints.find(x => x.id === S.route.arg); if (!c) return; c.ai.review = { by: u.name, at: Date.now(), note: $('#aNote') ? $('#aNote').value.trim() : '' }; addHist(c, u, 'review', {}); save('complaints'); toast('Marked as reviewed.', 'success'); route(); },
  'export-data': () => { const u = currentUser(); const data = { exportedAt: new Date().toISOString(), user: { name: u.name, email: u.email, phone: u.phone }, complaints: DB.complaints.filter(c => c.userId === u.id), notifications: myNotifs() }; const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); a.download = 'peoplesolve-ai-my-data.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); },
  'del-account': () => confirmBox('Delete your account?', 'Your account, complaints, photos and notifications will be permanently removed from this browser.', async () => { const u = currentUser(); for (const c of DB.complaints.filter(x => x.userId === u.id)) await idb.removeByComplaint(c.id).catch(() => {}); DB.complaints = DB.complaints.filter(c => c.userId !== u.id); DB.notifications = DB.notifications.filter(n => n.userId !== u.id); DB.users = DB.users.filter(x => x.id !== u.id); ['users', 'complaints', 'notifications'].forEach(save); logout('Your account was deleted.'); }),
  'dismiss-guide': () => { const u = currentUser(); u.prefs.guideSeen = true; save('users'); if (S.route.page === 'dashboard') route(); },
  'open-photo': el => openModal(`<h2>${esc(el.dataset.name)}</h2><img class="photo-big" src="${esc(el.dataset.src)}" alt="Evidence photo: ${esc(el.dataset.name)}">`, 'Photo', true),
  prefill: el => { S.prefill = { title: (el.dataset.text || '').slice(0, 80), description: el.dataset.text || '', location: el.dataset.loc || '' }; },
  'confirm-yes': () => { const f = confirmCb; confirmCb = null; if (f) f(); },
  'bot-toggle': () => { BOT.open = !BOT.open; botRender(); if (BOT.open) { const i = $('#botInput'); if (i) i.focus(); } },
  'bot-chip': el => botSend(el.dataset.q)
};
document.addEventListener('click', e => {
  const t = e.target.closest('[data-action]');
  if (t) {
    const a = t.dataset.action;
    if (a === 'backdrop') { if (e.target === t) closeModal(); return; }
    if (actions[a]) { if (t.tagName === 'BUTTON' || t.tagName === 'DIV') e.preventDefault?.(); const r = actions[a](t); if (a === 'close-modal' && t.tagName === 'A') { /* let link navigate */ } return r; }
  }
  const tab = e.target.closest('[data-auth-tab]');
  if (tab) { authPanel(tab.dataset.authTab); return; }
  const pw = e.target.closest('[data-pw-toggle]');
  if (pw) { const i = $('#' + pw.dataset.pwToggle), show = i.type === 'password'; i.type = show ? 'text' : 'password'; pw.textContent = show ? 'Hide' : 'Show'; pw.setAttribute('aria-pressed', show); pw.setAttribute('aria-label', show ? 'Hide password' : 'Show password'); }
});
// anchors with data-action="close-modal"/prefill must still navigate: re-handled above without preventDefault for <a>
document.addEventListener('submit', e => {
  const f = e.target; e.preventDefault();
  const map = { loginForm: doLogin, registerForm: doRegister, forgotForm: doForgot, resetForm: doReset, complaintForm: submitComplaint, tryForm: runTry, adminForm: updateComplaint, botForm: () => { const i = $('#botInput'); const v = i.value; i.value = ''; botSend(v); } };
  if (map[f.id]) return map[f.id](f);
  if (f.id === 'replyForm') {
    const u = currentUser(), c = DB.complaints.find(x => x.id === f.dataset.id), msg = $('#rMsg').value.trim();
    if (!c || c.userId !== u.id) return; if (!setErr('rMsg', msg.length >= 3 ? '' : 'Please write your reply.')) return;
    addHist(c, u, 'message', { note: msg }); addHist(c, u, 'status', { from: c.status, to: 'Under Review', note: 'Complainant replied' }); c.status = 'Under Review'; c.updatedAt = Date.now(); save('complaints');
    DB.users.filter(x => x.role === 'admin').forEach(a => notify(a.id, 'status_changed', 'Complainant replied', `${c.id}: ${msg.slice(0, 80)}`, c.id)); toast('Reply sent.', 'success'); route();
  } else if (f.id === 'feedbackForm') {
    const u = currentUser(), c = DB.complaints.find(x => x.id === f.dataset.id), r = +$('#fbRate').value;
    if (!c || c.userId !== u.id) return; if (!setErr('fbRate', r >= 1 && r <= 5 ? '' : 'Choose a rating.')) return;
    c.feedback = { rating: r, text: $('#fbText').value.trim(), at: Date.now() }; save('complaints'); toast('Thank you for your feedback!', 'success'); route();
  } else if (f.id === 'profileForm') {
    clearErrs(f); const u = currentUser(), name = $('#pName').value.trim(), ph = normPhone($('#pPhone').value);
    let ok = setErr('pName', validName(name) ? '' : 'Enter your full name.'); ok = setErr('pPhone', ph ? '' : 'Enter a valid 10-digit mobile number.') && ok;
    if (ok && DB.users.some(x => x.id !== u.id && x.phone === ph)) ok = setErr('pPhone', 'This phone number is already used.');
    if (!ok) return; u.name = name; u.phone = ph; save('users'); toast('Profile updated.', 'success'); renderNav(S.route.page);
  } else if (f.id === 'pwForm') {
    clearErrs(f); const u = currentUser(), btn = $('button[type=submit]', f);
    (async () => {
      busy(btn, true); try {
        const okOld = safeEq(await hashPw($('#pwOld').value, u.salt), u.hash); let ok = setErr('pwOld', okOld ? '' : 'Current password is incorrect.'); ok = setErr('pwNew', pwProblem($('#pwNew').value)) && ok;
        if (!ok) return; u.salt = b64(new Uint8Array(rnd(16))); u.hash = await hashPw($('#pwNew').value, u.salt); save('users'); f.reset(); toast('Password updated.', 'success');
      } catch (er) { toast(er.message, 'error'); } finally { busy(btn, false); }
    })();
  }
});
const reTrack = () => { const u = currentUser(); if (u && $('#trackBody')) $('#trackBody').innerHTML = trackRows(u); };
document.addEventListener('input', e => {
  const id = e.target.id;
  if (id === 'cDesc') { $('#descCount').textContent = e.target.value.length; }
  else if (id === 'regPassword') updateStrength(e.target.value);
  else if (id === 'fQ') { S.filters.q = e.target.value; debouncedTrack(); }
  if (e.target.getAttribute('aria-invalid') && id) setErr(id, '');
});
const debouncedTrack = debounce(reTrack, 150);
document.addEventListener('change', e => {
  const id = e.target.id;
  if (id === 'fP') { S.filters.priority = e.target.value; reTrack(); } else if (id === 'fC') { S.filters.category = e.target.value; reTrack(); } else if (id === 'fS') { S.filters.status = e.target.value; reTrack(); }
  else if (id === 'finderCat') finderResult(e.target.value);
  else if (id === 'cPhotos') { addPhotos(Array.from(e.target.files)); e.target.value = ''; }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { if (S.modal) closeModal(); else if (BOT.open) { BOT.open = false; botRender(); } else actions['close-sidebar'](); }
  if (e.key === 'Tab' && S.modal) { const m = $('#modalRoot .modal'); const f = $$('a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])', m).filter(x => x.offsetParent !== null); if (!f.length) return; const first = f[0], last = f[f.length - 1]; if (e.shiftKey && (document.activeElement === first || document.activeElement === m)) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } }
  if (['ArrowLeft', 'ArrowRight'].includes(e.key) && e.target.matches?.('[role=tab]')) { const next = e.target.dataset.authTab === 'login' ? 'register' : 'login'; authPanel(next); $('#tab' + next[0].toUpperCase() + next.slice(1)).focus(); }
});
// Links with data-action (prefill / close-modal / mark-read) must navigate normally.
document.addEventListener('click', e => { const a = e.target.closest('a[data-action]'); if (a && a.dataset.action === 'close-modal') closeModal(); }, true);
window.addEventListener('hashchange', route);
window.addEventListener('storage', e => {
  if (!e.key || !e.key.startsWith('peoplesolve.')) return;
  loadDB(); const u = currentUser(); if (!u) { route(); return; }
  updateBell(); if (!S.modal && ['dashboard', 'community', 'notifications', 'track'].includes(S.route.page)) { const y = window.scrollY; route(); window.scrollTo(0, y); }
});

/* ================= BOOT ================= */
function boot() {
  loadDB();
  { const saved = LS.get('theme', null); applyTheme(saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')); }
  if (!window.crypto || !crypto.subtle) toast('Secure features need HTTPS or localhost. Please open this site over HTTPS.', 'error');
  setInterval(clockTick, 1000);
  setInterval(() => {
    $$('time[data-ago]').forEach(t => { t.textContent = ago(+t.dataset.ago); });
    if (!getSession() && !$('#app').hidden) logout('Your session expired. Please log in again.');
  }, 30000);
  const u = currentUser();
  if (u) { const b = $('#soundBtn'); b.setAttribute('aria-pressed', u.prefs.sound); b.firstElementChild.textContent = u.prefs.sound ? '🔊' : '🔇'; }
  if (!location.hash) location.hash = u ? '#/dashboard' : '#/login';
  route();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
