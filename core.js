/* Rent Desk – pure logic (dates, dues, statuses, messages). No page code here, so it can be tested in Node. */
(function (root) {
  var pad = function (n) { return String(n).padStart(2, '0'); };
  var iso = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  var parse = function (s) { var p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
  var addDays = function (s, n) { var d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
  var diffDays = function (a, b) { return Math.round((parse(a) - parse(b)) / 864e5); };
  var addMonths = function (key, n) { var y = +key.slice(0, 4), m = +key.slice(5, 7) - 1 + n; return new Date(y, m, 1).getFullYear() + '-' + pad(new Date(y, m, 1).getMonth() + 1); };
  var todayISO = function () { return iso(new Date()); };
  var round2 = function (n) { return Math.round(n * 100) / 100; };
  var uid = function () { return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); };

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function monthLabel(key) { return MONTHS[+key.slice(5, 7) - 1] + ' ' + key.slice(0, 4); }
  function longDate(s) { if (!s) return ''; var d = parse(s); return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }
  function shortDate(s) { if (!s) return ''; var d = parse(s); return d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3); }

  /* All rent instalments of one rental: [{key:'2026-12', dueDate, amount, index}] */
  function buildDues(t, today) {
    today = today || todayISO();
    var dues = [];
    if (!t.start || !(t.rent > 0)) return dues;
    var start = parse(t.start);
    var y = start.getFullYear(), m = start.getMonth() + 1, i = 0;
    var dueDay = Math.min(Math.max(+t.dueDay || 1, 1), 31);
    var stopKey = t.end ? t.end.slice(0, 7) : addMonths((t.start > today ? t.start : today).slice(0, 7), 1);
    var from = t.trackFrom ? t.trackFrom.slice(0, 7) : '';
    while (i < 600) {
      var key = y + '-' + pad(m);
      var last = new Date(y, m, 0).getDate();
      var due = key + '-' + pad(Math.min(dueDay, last));
      if (due < t.start) due = t.start;
      if (t.end && due > t.end) break;
      if (!t.end && key > stopKey) break;
      if (key > stopKey) break;
      var steps = Math.floor(i / 12);
      var amount = round2((+t.rent) * Math.pow(1 + (+t.escalation || 0) / 100, steps));
      /* amended plan: a new rent from a month on, and one-month changes (amount / due date) */
      var rv = (t.revisions || []).filter(function (x) { return x.from && x.from.slice(0, 7) <= key; }).sort(function (a, b) { return a.from < b.from ? -1 : 1; }).pop();
      if (rv) amount = round2(+rv.rent);
      var pl = (t.plan || {})[key];
      if (pl) { if (pl.amount !== undefined && pl.amount !== '' && pl.amount !== null) amount = round2(+pl.amount); if (pl.dueDate) due = pl.dueDate; }
      if (!from || key >= from) dues.push({ key: key, dueDate: due, amount: amount, index: i });
      i++; m++; if (m > 12) { m = 1; y++; }
    }
    return dues;
  }

  function paidFor(t, key) {
    return round2((t.payments || []).reduce(function (s, p) { return s + (p.key === key ? +p.amount : 0); }, 0));
  }

  /* paid | overdue | due | soon | future */
  function dueStatus(due, t, today, grace) {
    var paid = paidFor(t, due.key);
    var balance = round2(due.amount - paid);
    var out = { key: due.key, dueDate: due.dueDate, amount: due.amount, paid: paid, balance: balance, partial: paid > 0 && balance > 0.004, daysLate: 0, status: 'future' };
    if (balance <= 0.004) { out.status = 'paid'; out.balance = 0; return out; }
    var late = diffDays(today, due.dueDate);
    out.daysLate = Math.max(late, 0);
    if (late > (+grace || 0)) out.status = 'overdue';
    else if (late >= 0) out.status = 'due';
    else if (late >= -7) out.status = 'soon';
    return out;
  }

  function schedule(t, today, grace) { return buildDues(t, today).map(function (d) { return dueStatus(d, t, today, grace); }); }

  function latestPromise(t, today) {
    var best = '';
    (t.followups || []).forEach(function (f) { if (f.promiseDate && f.promiseDate >= today && f.promiseDate > best) best = f.promiseDate; });
    return best;
  }

  function isActive(t, today) { return (!t.end || t.end >= today) && t.start <= today; }

  function fill(tpl, vars) {
    return String(tpl).replace(/\{(\w+)\}/g, function (_, k) { return vars[k] == null ? '' : vars[k]; });
  }

  /* Phone number for wa.me / sms: digits only, with country code. */
  function phoneDigits(raw, cc) {
    var s = String(raw || '').replace(/[^\d+]/g, '');
    if (!s) return '';
    if (s.charAt(0) === '+') return s.slice(1);
    if (s.slice(0, 2) === '00') return s.slice(2);
    if (s.charAt(0) === '0' && cc) return String(cc).replace(/\D/g, '') + s.slice(1);
    return s;
  }

  /* ---- sync: merge two copies of the data. Each record has an id and u (last changed, ms). Newest wins; payments and
     follow-ups are joined; ids listed in tomb (deleted) are removed everywhere. ---- */
  function byId(arr) { var m = {}; (arr || []).forEach(function (x) { m[x.id] = x; }); return m; }
  function newer(a, b) { if (!a) return b; if (!b) return a; return (+b.u || 0) > (+a.u || 0) ? b : a; }
  function unionRecs(a, b) { var m = byId(a); (b || []).forEach(function (x) { m[x.id] = newer(m[x.id], x); }); return Object.keys(m).map(function (k) { return m[k]; }); }
  function mergeData(L, R) {
    var tm = {};
    (L.tomb || []).concat(R.tomb || []).forEach(function (t) { if (!tm[t.id] || (+t.u || 0) > (+tm[t.id].u || 0)) tm[t.id] = t; });
    var live = function (x) { return !tm[x.id]; };
    var lr = byId(L.rentals), rr = byId(R.rentals), rentals = [];
    Object.keys(Object.assign({}, lr, rr)).forEach(function (id) {
      var a = lr[id], b = rr[id], w = newer(a, b); if (!live(w)) return;
      var m = Object.assign({}, w);
      m.payments = unionRecs(a && a.payments, b && b.payments).filter(live);
      m.followups = unionRecs(a && a.followups, b && b.followups).filter(live);
      rentals.push(m);
    });
    var ls = L.settings || {}, rs = R.settings || {};
    return { settings: (+rs.u || 0) > (+ls.u || 0) ? rs : ls, flats: unionRecs(L.flats, R.flats).filter(live), expenses: unionRecs(L.expenses, R.expenses).filter(live), bills: unionRecs(L.bills, R.bills).filter(live), rentals: rentals, tomb: Object.keys(tm).map(function (k) { return tm[k]; }) };
  }
  function fingerprint(d) {
    var p = [];
    (d.flats || []).forEach(function (f) { p.push('f' + f.id + ':' + (+f.u || 0)); });
    (d.expenses || []).forEach(function (f) { p.push('e' + f.id + ':' + (+f.u || 0)); });
    (d.bills || []).forEach(function (f) { p.push('b' + f.id + ':' + (+f.u || 0)); });
    (d.rentals || []).forEach(function (r) {
      p.push('r' + r.id + ':' + (+r.u || 0));
      (r.payments || []).forEach(function (x) { p.push('p' + x.id + ':' + (+x.u || 0)); });
      (r.followups || []).forEach(function (x) { p.push('q' + x.id + ':' + (+x.u || 0)); });
    });
    (d.tomb || []).forEach(function (t) { p.push('t' + t.id + ':' + (+t.u || 0)); });
    p.push('s:' + (+((d.settings || {}).u) || 0));
    return p.sort().join('|');
  }
  /* true when merged has something the other copy does not */
  function needsPush(merged, other) { return fingerprint(merged) !== fingerprint(other); }

  var api = { mergeData: mergeData, needsPush: needsPush, pad: pad, iso: iso, parse: parse, addDays: addDays, diffDays: diffDays, addMonths: addMonths, todayISO: todayISO, round2: round2, uid: uid,
    monthLabel: monthLabel, longDate: longDate, shortDate: shortDate, buildDues: buildDues, paidFor: paidFor, dueStatus: dueStatus, schedule: schedule,
    latestPromise: latestPromise, isActive: isActive, fill: fill, phoneDigits: phoneDigits, MONTHS: MONTHS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Core = api;
})(typeof window !== 'undefined' ? window : globalThis);
