/* TEST ONLY (tests/): in-browser stand-in for the Supabase backend. Same surface as ka-backend.js
 * (window.claude.use, KA_AUTH, KA_INVITE, KA_PIN, KA_GRADE, KA_MAIL, KA_NOTIFY), state kept in localStorage.
 * Nothing here talks to the live database. Sign-in code is always 123456. */
(function () {
  'use strict';
  var K = 'KA_MOCK_DB';
  function load() { try { return JSON.parse(localStorage.getItem(K)) || null; } catch (e) { return null; } }
  var DB = load() || { session: null, profiles: {}, docs: {}, pins: {}, pending: null };
  function save() { localStorage.setItem(K, JSON.stringify(DB)); }
  window.__MOCK = { get db() { return DB; }, save: save, reset: function () { localStorage.removeItem(K); } };
  var listeners = [];
  function notify(path) { listeners.forEach(function (l) { if (l.doc === path || l.parent === parentOf(path)) setTimeout(l.fire, 0); }); }
  function parentOf(p) { var a = p.split('/'); a.pop(); return a.join('/'); }
  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  function snap(path) { var d = DB.docs[path]; return { id: path.split('/').pop(), exists: d !== undefined, data: function () { return clone(d); } }; }
  function docRef(path) {
    return {
      id: path.split('/').pop(), path: path,
      get: function () { return Promise.resolve(snap(path)); },
      set: function (data) { data = clone(data); if (path.indexOf('decisions/') === 0 && !CRED_OK) { delete data.credential; var old = DB.docs[path]; if (old && old.credential) data.credential = old.credential; }
        if (path.indexOf('registry/') === 0 && !CRED_OK) return Promise.reject(new Error('new row violates row-level security policy')); DB.docs[path] = data; save(); notify(path); return Promise.resolve(); },
      update: function (patch) { DB.docs[path] = Object.assign({}, DB.docs[path] || {}, clone(patch)); save(); notify(path); return Promise.resolve(); },
      delete: function () { delete DB.docs[path]; save(); notify(path); return Promise.resolve(); },
      onSnapshot: function (next) { var l = { doc: path, fire: function () { next(snap(path)); } }; listeners.push(l); setTimeout(l.fire, 0); return function () { listeners.splice(listeners.indexOf(l), 1); }; },
      collection: function (sub) { return colRef(path + '/' + sub); }
    };
  }
  function colRef(path) {
    function q() { var docs = Object.keys(DB.docs).filter(function (p) { return parentOf(p) === path; }).map(snap); return { docs: docs, size: docs.length, empty: !docs.length, docChanges: function () { return []; } }; }
    var api = { path: path, doc: function (id) { return docRef(path + '/' + id); }, orderBy: function () { return api; }, limit: function () { return api; }, where: function () { return api; },
      get: function () { return Promise.resolve(q()); },
      onSnapshot: function (next) { var l = { parent: path, fire: function () { next(q()); } }; listeners.push(l); setTimeout(l.fire, 0); return function () { listeners.splice(listeners.indexOf(l), 1); }; } };
    return api;
  }
  var uid = function () { return DB.session && DB.session.uid; };
  var prof = function () { return uid() ? DB.profiles[uid()] : null; };
  var STAFF = ['mentor', 'council', 'admin']; var CRED_OK = false;
  function isCouncil() { var p = prof(); return !!p && (p.role === 'council' || p.role === 'admin'); }
  window.KA_COUNCIL = {
    vote: function (cand, v, note) { if (!isCouncil()) return Promise.reject(new Error('Only Apostolic Council members can vote')); if (cand === uid()) return Promise.reject(new Error('You cannot vote on your own credential'));
      var p = prof(); DB.docs['votes/' + cand + '/' + uid()] = { vote: v, note: note || '', name: p.display_name || p.email, email: p.email, at: new Date().toISOString() }; save(); notify('votes/' + cand + '/' + uid()); return Promise.resolve({ ok: true }); },
    issue: function (cand, pl) { if (!isCouncil()) return Promise.reject(new Error('Only the Apostolic Council can issue credentials'));
      var dec = DB.docs['decisions/' + cand]; if (!dec || dec.status !== 'ACCEPTED') return Promise.reject(new Error('Candidate is not accepted'));
      var app = DB.docs['applications/' + cand] || {}, ro = DB.docs['roster/' + cand] || { office: (app.data || {}).office };
      var cred = Object.assign({}, dec.credential || {}, { type: pl.type, office: ro.office, name: (app.data || {}).fullName || '', scope: pl.scope || '', supervisor: pl.supervisor || '', reviewDate: pl.reviewDate || '', serviceDate: pl.serviceDate || '', secretaryName: pl.secretaryName || '', conditions: pl.conditions || '' });
      if (pl.type !== 'further') { var c = dec.council || {}; if (!(c.service && c.references && c.interview)) return Promise.reject(new Error('Complete service, references and interview first'));
        var vs = Object.keys(DB.docs).filter(function (k) { return k.indexOf('votes/' + cand + '/') === 0; }).map(function (k) { return DB.docs[k].vote; });
        var ap = vs.filter(function (v) { return v === 'approve'; }).length, op = vs.filter(function (v) { return v === 'oppose'; }).length;
        if (ap < 3 || op >= ap) return Promise.reject(new Error('At least 3 distinct Apostolic Council approvals are required (now ' + ap + ')'));
        if (!pl.supervisor || !pl.reviewDate) return Promise.reject(new Error('Supervisor and review date are required'));
        if (pl.type === 'revalidation') { var sh = DB.docs['submissions/' + cand + '/exams/studyhall']; if (!sh || !sh.passed) return Promise.reject(new Error('The Study Hall has not been passed')); } else { var fx = DB.docs['submissions/' + cand + '/exams/final']; if (!fx || !fx.passed) return Promise.reject(new Error('The final exam has not been passed')); }
        if (!cred.number) { var pre = { ordination: 'ORD', license: 'LIC', commissioning: 'COM', revalidation: 'REV' }[pl.type]; cred.number = 'KAM-' + pre + '-' + new Date().getFullYear() + '-' + (1000 + Math.floor(Math.random() * 9000)); cred.issuedAt = new Date().toISOString(); }
        cred.status = 'ACTIVE'; cred.votes = { approve: ap, oppose: op }; }
      CRED_OK = true; dec.credential = cred; DB.docs['decisions/' + cand] = dec;
      if (pl.type !== 'further') DB.docs['registry/' + cred.number] = { name: cred.name, type: cred.type, office: cred.office, issuedAt: cred.issuedAt, reviewDate: cred.reviewDate, status: 'ACTIVE' };
      CRED_OK = false; save(); notify('decisions/' + cand); return Promise.resolve(cred); },
    revoke: function (cand) { var p = prof(); if (!p || p.role !== 'admin') return Promise.reject(new Error('Only the presiding apostle can revoke a credential')); var dec = DB.docs['decisions/' + cand]; dec.credential.status = 'REVOKED'; DB.docs['registry/' + dec.credential.number].status = 'REVOKED'; save(); notify('decisions/' + cand); return Promise.resolve(dec.credential); }
  };
  window.KA_SUPABASE = { from: function () { var q = { path: null, select: function () { return q; }, eq: function (k, v) { q.path = v; return q; }, maybeSingle: function () { var d = DB.docs[q.path]; return Promise.resolve({ data: d === undefined ? null : { data: clone(d) } }); } }; return q; } };
  window.KA_AUTH = {
    sendCode: function (email) { DB.pending = String(email).toLowerCase(); save(); return Promise.resolve(); },
    verify: function (email, token) {
      if (String(token) !== '123456') return Promise.reject(new Error('Invalid code'));
      email = String(email).toLowerCase();
      var id = Object.keys(DB.profiles).find(function (k) { return DB.profiles[k].email === email; });
      if (!id) { id = 'u-' + Math.random().toString(36).slice(2, 10); DB.profiles[id] = { id: id, email: email, display_name: email.split('@')[0], role: 'student' }; }
      DB.session = { uid: id }; save(); return Promise.resolve({});
    },
    signOut: function () { DB.session = null; save(); location.reload(); return Promise.resolve(); }
  };
  var userNS = {
    id: function () { return Promise.resolve(uid() || null); },
    me: function () { var p = prof(); return Promise.resolve(p ? { id: p.id, name: p.display_name || '', email: p.email } : { id: null, name: '', email: null }); },
    isOwner: function () { var p = prof(); return Promise.resolve(!!p && p.role === 'admin'); },
    canEdit: function () { var p = prof(); return Promise.resolve(!!p && STAFF.indexOf(p.role) >= 0); },
    can: function () { return Promise.resolve(null); },
    profiles: function (ids) { var o = {}; [].concat(ids || []).forEach(function (i) { if (DB.profiles[i]) o[i] = { id: i, name: DB.profiles[i].display_name || '' }; }); return Promise.resolve(o); }
  };
  function sample(input, opts) {
    var text = (document.documentElement.lang === 'es' ? 'GLOR AI (simulado en esta auditoría): ' : 'GLOR AI (simulated in this audit): ') +
      (document.documentElement.lang === 'es' ? 'esta semana nos llama a servir con humildad, verdad y gracia, con Cristo como piedra angular.' : 'this week calls us to serve with humility, truth and grace, with Christ as the cornerstone.');
    if (opts && opts.onText) opts.onText({ text: text, delta: text });
    return Promise.resolve({ text: text, truncated: false });
  }
  window.KA_MAIL = function () { return Promise.resolve({ ok: true, simulated: true }); };
  window.KA_NOTIFY = function () { return Promise.resolve({ ok: true, simulated: true }); };
  function code(c) { return String(c || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase(); }
  function findInv(c) { var ps = ['invites/' + c, 'invites-r/' + c, 'invites-c/' + c]; for (var i = 0; i < ps.length; i++) if (DB.docs[ps[i]]) return ps[i]; return null; }
  window.KA_INVITE = {
    peek: function (c) { c = code(c); var p = findInv(c); if (!p) return Promise.resolve({ valid: false, reason: 'not_found' }); var d = DB.docs[p];
      if (d.revoked) return Promise.resolve({ valid: false, reason: 'revoked' });
      if ((d.uses || 0) >= (d.maxUses || 1)) return Promise.resolve({ valid: false, reason: 'used' });
      return Promise.resolve({ valid: true, track: d.track, name: d.name, lang: d.lang }); },
    redeem: function (c) { c = code(c); if (!uid()) return Promise.reject(new Error('Sign in first')); var p = findInv(c); if (!p) return Promise.reject(new Error('Invitation not found'));
      var d = DB.docs[p], tr = d.track, tp = tr === 'restoration' ? 'tracks-r' : 'tracks';
      var mine = DB.docs[tp + '/' + uid()]; if (mine && mine.code === c) return Promise.resolve({ track: tr, already: true });
      if ((d.uses || 0) >= (d.maxUses || 1)) return Promise.reject(new Error('Invitation already used'));
      d.uses = (d.uses || 0) + 1; d.usedBy = (d.usedBy || []).concat(uid()); d.usedByEmail = prof().email;
      if (tr === 'council' && prof().role !== 'admin') prof().role = 'council';
      DB.docs[tp + '/' + uid()] = { track: tr, code: c, at: new Date().toISOString() }; save(); notify(p); return Promise.resolve({ track: tr }); }
  };
  window.KA_PIN = {
    has: function () { return Promise.resolve(!!DB.pins[uid()]); },
    check: function (pin) { return Promise.resolve(DB.pins[uid()] === pin ? 'ok' : 'wrong'); },
    set: function (pn) { DB.pins[uid()] = pn; save(); return Promise.resolve('ok'); }
  };
  function shuffleIdx(n, seed) { var a = []; for (var i = 0; i < n; i++) a.push(i); var s = seed || 1; for (var i2 = n - 1; i2 > 0; i2--) { s = (s * 9301 + 49297) % 233280; var j = Math.floor(s / 233280 * (i2 + 1)); var t = a[i2]; a[i2] = a[j]; a[j] = t; } return a; }
  function keyFor(id) { var k = window.__KEYS; if (id === 'studyhall') return k.studyhall; if (/^w\d{2}$/.test(id)) return k.weeks[String(parseInt(id.slice(1), 10))];
    if (id === 'final') { var out = []; for (var n = 1; n <= 12; n++) { var wk = k.weeks[String(n)]; shuffleIdx(wk.length, n * 7 + 3).slice(0, 3).forEach(function (i) { out.push(wk[i]); }); } return out; } return null; }
  window.KA_GRADE = function (pl) {
    var id = String(pl.id), key = keyFor(id); if (!key) return Promise.reject(new Error('Unknown exam'));
    var path = 'submissions/' + uid() + '/exams/' + id, prev = DB.docs[path] || { attempts: 0 };
    var correct = 0, wrong = []; key.forEach(function (a, i) { if (Number((pl.answers || [])[i]) === a) correct++; else wrong.push(i); });
    var pct = Math.round(correct / key.length * 100);
    var rec = { id: id, attempts: (prev.attempts || 0) + 1, last: pct, best: Math.max(pct, prev.best || 0), passed: !!prev.passed || pct >= 80, answers: pl.answers, sa: pl.sa || [], wrongIdx: wrong, at: new Date().toISOString(), lang: pl.lang, gradedBy: 'server' };
    DB.docs[path] = rec; save(); notify(path); return Promise.resolve(rec);
  };
  var assetsNS = { upload: function (blob) { return new Promise(function (res) { var r = new FileReader(); r.onload = function () { res({ id: uid() + '/' + Date.now(), url: r.result, sizeBytes: blob.size, contentType: blob.type }); }; r.readAsDataURL(blob); }); } };
  window.KA_BUG = {
    report: function (row) { if (!DB.session) return Promise.reject(new Error('not signed in')); DB.bugs = DB.bugs || []; var id = (DB.bugs.length ? DB.bugs[DB.bugs.length - 1].id : 0) + 1; var p = (DB.profiles || {})[DB.session.uid] || {}; DB.bugs.push(Object.assign({ id: id, created_at: new Date().toISOString(), uid: DB.session.uid, email: p.email || null, status: 'open', agent_note: null }, row)); save(); return Promise.resolve(true); },
    list: function (st) { var p = prof(); if (!p || ['mentor','council','admin'].indexOf(p.role) < 0) return Promise.resolve([]); return Promise.resolve((DB.bugs || []).slice().reverse().filter(function (b) { return !st || b.status === st; })); },
    mark: function (id, st, note) { var b = (DB.bugs || []).find(function (x) { return x.id === id; }); if (b) { b.status = st; b.agent_note = note || null; save(); } return Promise.resolve(true); }
  };
  var downloadsNS = { save: function () { return Promise.resolve({ status: 'saved' }); } };
  window.claude = { use: function (n) { var s = !!uid(); return Promise.resolve(n === 'db' ? (s ? { doc: docRef, collection: colRef } : null) : n === 'user' ? userNS : n === 'sample' ? (s ? sample : null) : n === 'assets' ? (s ? assetsNS : null) : n === 'downloads' ? downloadsNS : null); } };
})();
