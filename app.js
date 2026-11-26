/* Rent Desk – the app. Data lives on this device (localStorage); back it up from Settings. */
(function () {
  'use strict';
  var C = Core, A = Agreement, esc = A.esc;
  var KEY = 'rentdesk.v1';

  /* ---------- data ---------- */
  var DEFAULT_SOON = 'Hello {tenant}, a friendly reminder that the rent for {flat} ({period}) of {amount} is due on {dueDate}. {payInfo}\nThank you! {landlord}';
  var DEFAULT_LATE = 'Hello {tenant}, the rent for {flat} ({period}) of {amount} was due on {dueDate} and is now {daysLate} days late. Could you please let me know when I can expect the payment? {payInfo}\nThank you, {landlord}';
  var DEFAULT_SEND = 'Hello {tenant}, please find attached the rental agreement for {flat}. Please read it, sign it and send it back to me. Thank you, {landlord}';

  function defaults() {
    return { v: 1, settings: { landlord: { name: '', address: '', phone: '', email: '', idNo: '', sig: '' }, currency: '€', countryCode: '', graceDays: 3, city: '', governingLaw: '', payInfo: '', msgSoon: '', msgLate: '', template: '', lastBackup: '' }, flats: [], expenses: [], bills: [], rentals: [], tomb: [] };
  }
  function load() {
    var d = defaults();
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) { var s = JSON.parse(raw); d.settings = Object.assign(d.settings, s.settings || {}); d.settings.landlord = Object.assign(defaults().settings.landlord, (s.settings || {}).landlord || {}); d.flats = s.flats || []; d.rentals = s.rentals || []; d.tomb = s.tomb || []; d.expenses = s.expenses || []; d.bills = s.bills || []; }
    } catch (e) { /* start empty */ }
    return d;
  }
  var S = load();
  /* ---- change tracking for sync: every record carries u (last changed). Deleted ids go to S.tomb. ---- */
  var snap = {}, known = {};
  function recJSON(o) { var c = Object.assign({}, o); delete c.u; delete c.payments; delete c.followups; return JSON.stringify(c); }
  function setsJSON() { var c = Object.assign({}, S.settings); delete c.u; delete c.lastBackup; return JSON.stringify(c); }
  function initSnap() {
    snap = {}; known = {}; var now = Date.now();
    [S.flats, S.expenses, S.bills].forEach(function (arr) { arr.forEach(function (f) { if (!f.u) f.u = now; snap[f.id] = recJSON(f); known[f.id] = 1; }); });
    S.rentals.forEach(function (r) {
      if (!r.u) r.u = now; snap[r.id] = recJSON(r); known[r.id] = 1;
      (r.payments || []).concat(r.followups || []).forEach(function (x) { if (!x.u) x.u = now; known[x.id] = 1; });
    });
    /* a device that never changed its settings must not overwrite the Sheet's settings */
    if (!S.settings.u) { var dd = defaults().settings; delete dd.u; delete dd.lastBackup; S.settings.u = setsJSON() === JSON.stringify(dd) ? 0 : now; }
    snap.__s = setsJSON();
  }
  function stamp() {
    var now = Date.now(), changed = false, cur = {};
    [S.flats, S.expenses, S.bills].forEach(function (arr) { arr.forEach(function (f) { cur[f.id] = 1; var j = recJSON(f); if (snap[f.id] !== j) { f.u = now; snap[f.id] = j; changed = true; } }); });
    S.rentals.forEach(function (r) {
      cur[r.id] = 1; var j = recJSON(r); if (snap[r.id] !== j) { r.u = now; snap[r.id] = j; changed = true; }
      (r.payments || []).concat(r.followups || []).forEach(function (x) { cur[x.id] = 1; if (!x.u) { x.u = now; changed = true; } });
    });
    Object.keys(known).forEach(function (id) { if (!cur[id]) { S.tomb.push({ id: id, u: now }); delete snap[id]; changed = true; } });
    known = cur;
    var sj = setsJSON(); if (snap.__s !== sj) { S.settings.u = now; snap.__s = sj; changed = true; }
    return changed;
  }
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('Could not save on this device. Please make a backup now.'); } }
  function save() { var ch = stamp(); persist(); if (ch && cfg.url) { cfg.dirty = true; saveCfg(); schedSync(2500); } }

  /* ---- Google Sheet sync ---- */
  /* Your Google web app address, so a fresh install only asks for the PIN. It is not secret: the PIN protects the data. */
  var DEFAULT_URL = 'https://script.google.com/macros/s/AKfycbzk1P4s1G-BgwA6iw8N61T1BecZaLXbZGnKKtPIuYTuv1RwqA506gWayKM2YhZFzfcm/exec';
  var CFGKEY = 'rentdesk.sync';
  function loadCfg() { try { return Object.assign({ url: '', pin: '', rev: -1, dirty: false, last: 0 }, JSON.parse(localStorage.getItem(CFGKEY) || '{}')); } catch (e) { return { url: '', pin: '', rev: -1, dirty: false, last: 0 }; } }
  var cfg = loadCfg(), syncBusy = false, syncErr = '', syncTimer = null;
  function saveCfg() { try { localStorage.setItem(CFGKEY, JSON.stringify(cfg)); } catch (e) { /* ignore */ } }
  function syncLabel() {
    if (!cfg.url) return '';
    if (syncBusy) return 'Syncing…';
    if (syncErr) return 'Not synced: ' + syncErr;
    return cfg.dirty ? 'Changes waiting to sync' : cfg.last ? 'Synced ' + new Date(cfg.last).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Connected';
  }
  function paintSync() { Array.prototype.forEach.call(document.querySelectorAll('.syncchip'), function (el) { el.textContent = syncLabel(); }); }
  function schedSync(ms) { clearTimeout(syncTimer); if (cfg.url) syncTimer = setTimeout(function () { syncNow(); }, ms); }
  function callSheet(body) {
    return fetch(cfg.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ pin: cfg.pin }, body)) })
      .then(function (r) { return r.json(); }).then(function (j) { if (j.error) throw new Error(j.error); return j; });
  }
  function payload() { return { settings: S.settings, flats: S.flats, expenses: S.expenses, bills: S.bills, rentals: S.rentals, tomb: S.tomb }; }
  function applyMerged(m) {
    var lb = S.settings.lastBackup; S.flats = m.flats; S.expenses = m.expenses || []; S.bills = m.bills || []; S.rentals = m.rentals; S.tomb = m.tomb;
    var dd = defaults().settings; S.settings = Object.assign(dd, m.settings); S.settings.landlord = Object.assign(dd.landlord, (m.settings || {}).landlord || {}); S.settings.lastBackup = lb || '';
    initSnap(); persist();
  }
  function syncNow(manual) {
    if (!cfg.url || syncBusy) return Promise.resolve();
    if (dlg.open) { schedSync(5000); return Promise.resolve(); }
    if (navigator.onLine === false) { syncErr = 'offline'; paintSync(); return Promise.resolve(); }
    syncBusy = true; syncErr = ''; paintSync();
    var changed = false;
    return callSheet({ op: 'pull', baseRev: cfg.rev }).then(function (r) {
      if (r.data) { var m = C.mergeData(payload(), r.data); applyMerged(m); cfg.rev = r.rev; changed = true; if (C.needsPush(m, r.data)) cfg.dirty = true; }
      return (function loop(i) {
        if (!cfg.dirty || i > 3) return;
        return callSheet({ op: 'push', baseRev: cfg.rev, data: payload() }).then(function (p) {
          if (p.conflict) { var m2 = C.mergeData(payload(), p.data); applyMerged(m2); cfg.rev = p.rev; changed = true; return loop(i + 1); }
          cfg.rev = p.rev; cfg.dirty = false;
        });
      })(0);
    }).then(function () { cfg.last = Date.now(); syncErr = ''; if (postBills()) { changed = true; save(); } })
      .catch(function (e) { syncErr = /Failed to fetch|NetworkError|Load failed/i.test(e.message) ? 'offline' : e.message; if (manual) toast('Sync problem: ' + syncErr); })
      .then(function () { syncBusy = false; saveCfg(); paintSync(); if (changed && !dlg.open) render(); });
  }

  /* ---------- helpers ---------- */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var today = function () { return C.todayISO(); };
  var money = function (n) { return A.money(+n || 0, S.settings.currency); };
  var flatOf = function (r) { return S.flats.find(function (f) { return f.id === r.flatId; }) || { name: '(removed flat)', address: '' }; };
  var rentalById = function (id) { return S.rentals.find(function (r) { return r.id === id; }); };
  var grace = function () { return S.settings.graceDays; };
  var firstName = function (n) { return String(n || '').trim().split(/\s+/)[0] || 'there'; };
  var toastTimer;
  function toast(msg) { var t = $('#toast'); t.textContent = msg; t.classList.remove('hide'); clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.add('hide'); }, 3800); }
  function download(blob, name) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000); }
  function safeName(s) { return String(s).replace(/[\\/:*?"<>|]+/g, '').trim(); }

  var ICON = {
    today: '<path d="M3 11l9-8 9 8M5 10v10h14V10"/>', flats: '<path d="M4 21V4h10v17M14 9h6v12M8 8h2M8 12h2M8 16h2M17 13h0M17 17h0"/>',
    pay: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h3"/>', agree: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
    exp: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>', dash: '<path d="M5 20V11M12 20V4M19 20v-6"/>', more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
    set: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 00-.1-1.3l2-1.5-2-3.4-2.3.9a7 7 0 00-2.3-1.3L14 3h-4l-.3 2.4a7 7 0 00-2.3 1.3l-2.3-.9-2 3.4 2 1.5a7 7 0 000 2.6l-2 1.5 2 3.4 2.3-.9a7 7 0 002.3 1.3L10 21h4l.3-2.4a7 7 0 002.3-1.3l2.3.9 2-3.4-2-1.5c.1-.4.1-.9.1-1.3z"/>'
  };
  var svg = function (k) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[k] + '</svg>'; };
  var NAV = [['dashboard', 'Dashboard', 'dash'], ['flats', 'Flats', 'flats'], ['payments', 'Rent', 'pay'], ['expenses', 'Expenses', 'exp'], ['more', 'More', 'more']];
  var SIDE = [['dashboard', 'Dashboard', 'dash'], ['flats', 'Flats', 'flats'], ['payments', 'Rent', 'pay'], ['expenses', 'Expenses', 'exp'], ['agreements', 'Agreements', 'agree'], ['settings', 'Settings', 'set']];

  /* ---------- sheets (dialog) ---------- */
  var dlg = $('#dlg'), dlgBody = $('#dlgBody');
  function openDlg(html) { dlgBody.innerHTML = html; if (!dlg.open) dlg.showModal(); }
  function closeDlg() { if (dlg.open) dlg.close(); }
  dlg.addEventListener('click', function (e) { if (e.target === dlg) closeDlg(); });

  function fieldHTML(f, v) {
    var val = v[f.name] == null ? '' : v[f.name], id = 'f_' + f.name, h = '<div class="' + (f.full ? 'full' : '') + '"><label for="' + id + '">' + esc(f.label) + '</label>';
    if (f.type === 'select') h += '<select id="' + id + '" name="' + f.name + '">' + f.options.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(val) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>';
    else if (f.type === 'textarea') h += '<textarea id="' + id + '" name="' + f.name + '"' + (f.rows ? ' rows="' + f.rows + '"' : '') + '>' + esc(val) + '</textarea>';
    else h += '<input id="' + id + '" name="' + f.name + '" type="' + (f.type || 'text') + '" value="' + esc(val) + '"' + (f.required ? ' required' : '') + (f.step ? ' step="' + f.step + '"' : '') + (f.min != null ? ' min="' + f.min + '"' : '') + (f.max != null ? ' max="' + f.max + '"' : '') + (f.type === 'tel' ? ' inputmode="tel"' : '') + (f.type === 'number' ? ' inputmode="decimal"' : '') + '>';
    return h + (f.hint ? '<div class="hint">' + esc(f.hint) + '</div>' : '') + '</div>';
  }
  function openForm(o) {
    openDlg('<h3>' + esc(o.title) + '</h3>' + (o.intro ? '<p class="muted small" style="margin:6px 0 0">' + esc(o.intro) + '</p>' : '') +
      '<form id="frm" novalidate><div class="fgrid">' + o.fields.filter(function (f) { return !f.more; }).map(function (f) { return fieldHTML(f, o.values || {}); }).join('') + '</div>' +
      (o.fields.some(function (f) { return f.more; }) ? '<details class="more"><summary>More details</summary><div class="fgrid">' + o.fields.filter(function (f) { return f.more; }).map(function (f) { return fieldHTML(f, o.values || {}); }).join('') + '</div></details>' : '') +
      '<div class="foot">' + (o.del ? '<button type="button" class="btn danger" id="delbtn" style="margin-right:auto">Delete</button>' : '') + '<button type="button" class="btn ghost" data-act="close">Cancel</button><button class="btn" type="submit">' + esc(o.submit || 'Save') + '</button></div></form>');
    var form = $('#frm');
    if (o.del) $('#delbtn').onclick = function () { closeDlg(); confirmBox('Delete this? It cannot be undone.', 'Delete', o.del); };
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var bad = o.fields.find(function (f) { return f.required && !String(form.elements[f.name].value || '').trim(); });
      if (bad) { form.elements[bad.name].focus(); toast('Please fill in: ' + bad.label); return; }
      var data = {}; o.fields.forEach(function (f) { data[f.name] = form.elements[f.name].value.trim(); });
      if (o.onSave(data) !== false) { save(); closeDlg(); render(); }
    });
  }
  function confirmBox(msg, label, fn) {
    openDlg('<h3>Are you sure?</h3><p style="margin:10px 0 0">' + esc(msg) + '</p><div class="foot"><button class="btn ghost" data-act="close">Cancel</button><button class="btn danger" id="yes">' + esc(label) + '</button></div>');
    $('#yes').onclick = function () { closeDlg(); fn(); save(); render(); };
  }

  /* ---------- rent overview ---------- */
  function allDues(t) {
    var out = [];
    S.rentals.forEach(function (r) { C.schedule(r, t, grace()).forEach(function (d) { out.push(Object.assign({ r: r, flat: flatOf(r) }, d)); }); });
    return out;
  }
  function lateText(d) {
    if (d.status === 'overdue') return d.daysLate + (d.daysLate === 1 ? ' day late' : ' days late');
    if (d.status === 'due') return d.daysLate === 0 ? 'Due today' : 'Due ' + d.daysLate + ' days ago';
    var n = C.diffDays(d.dueDate, today()); return n === 0 ? 'Due today' : 'Due in ' + n + (n === 1 ? ' day' : ' days');
  }
  function pillFor(d) { return d.status === 'paid' ? '<span class="pill ok">Paid</span>' : d.status === 'overdue' ? '<span class="pill bad">' + esc(lateText(d)) + '</span>' : d.status === 'due' ? '<span class="pill warn">' + esc(lateText(d)) + '</span>' : d.status === 'soon' ? '<span class="pill clay">' + esc(lateText(d)) + '</span>' : '<span class="pill grey">' + esc(C.shortDate(d.dueDate)) + '</span>'; }


  /* ---------- views ---------- */
  /* ---------- rent page: pick a flat (or all), one year at a time ---------- */
  var rentYear = '', rentFlat = '';
  function viewPayments() {
    var t = today(), g = grace(); if (!rentYear) rentYear = t.slice(0, 4);
    var flats = S.flats.filter(function (f) { return S.rentals.some(function (r) { return r.flatId === f.id; }); });
    if (rentFlat && !flats.some(function (f) { return f.id === rentFlat; })) rentFlat = '';
    var rs = S.rentals.filter(function (r) { return !rentFlat || r.flatId === rentFlat; }).sort(function (a, b) { var fa = flatOf(a).name, fb = flatOf(b).name; return fa < fb ? -1 : fa > fb ? 1 : (a.start < b.start ? 1 : -1); });
    var sched = rs.map(function (r) { return { r: r, ds: C.schedule(r, t, g).filter(function (d) { return d.key.slice(0, 4) === rentYear; }) }; }).filter(function (x) { return x.ds.length; });
    var due = 0, got = 0, late = 0;
    sched.forEach(function (x) {
      x.ds.forEach(function (d) { if (d.dueDate <= t) { due += d.amount; late += d.balance; } });
      (x.r.payments || []).forEach(function (p) { if (p.key.slice(0, 4) === rentYear && !p.waived && p.method !== 'Deposit') got += +p.amount; });
    });
    var h = '<div class="pagehead"><div><h1>Rent</h1></div><div class="row"><button class="btn sm ghost" data-act="ry" data-n="-1" aria-label="Previous year">‹</button><strong style="min-width:56px;text-align:center">' + esc(rentYear) + '</strong><button class="btn sm ghost" data-act="ry" data-n="1" aria-label="Next year">›</button></div></div>';
    if (!S.rentals.length) return h + '<div class="card empty"><h3>No rentals yet</h3><p>Rent shows here once a rental is set up.</p><button class="btn" data-act="newRentalPick">+ New rental</button></div>';
    h += '<div class="chips" style="margin-bottom:12px"><button class="chip' + (rentFlat ? '' : ' on') + '" data-act="rentFlat" data-f="">All flats</button>' + flats.map(function (f) { return '<button class="chip' + (rentFlat === f.id ? ' on' : '') + '" data-act="rentFlat" data-f="' + f.id + '">' + esc(f.name) + '</button>'; }).join('') + '</div>';
    h += '<div class="card row between wrapx" style="gap:18px"><div><div class="eyebrow">Due so far</div><div class="amt">' + money(due) + '</div></div><div><div class="eyebrow">Received</div><div class="amt">' + money(got) + '</div></div><div><div class="eyebrow">Still owed</div><div class="amt' + (late > 0 ? ' badtxt' : '') + '">' + money(late) + '</div></div></div>';
    if (!sched.length) return h + '<div class="card muted" style="margin-top:12px">No rent falls due in ' + esc(rentYear) + '.</div>';
    if (!rentFlat) {
      /* all flats: one row per tenancy, one small square per month */
      var sym = function (d) { return d.status === 'paid' ? ['✓', 'paid'] : d.amount <= 0 ? ['–', 'none'] : d.status === 'overdue' ? ['!', 'late'] : d.partial ? ['½', 'part'] : d.status === 'due' || d.status === 'soon' ? ['•', 'due'] : ['·', 'fut']; };
      h += '<div class="card tablewrap" style="margin-top:12px"><table class="mx"><thead><tr><th></th>' + C.MONTHS.map(function (m) { return '<th>' + esc(m.slice(0, 3)) + '</th>'; }).join('') + '</tr></thead><tbody>' + sched.map(function (x) {
        return '<tr><td class="mxn"><a href="#/rental/' + x.r.id + '">' + esc(flatOf(x.r).name) + '</a><div class="tiny muted">' + esc(x.r.tenant.name) + '</div></td>' + C.MONTHS.map(function (m, i) {
          var d = x.ds.find(function (y) { return y.key === rentYear + '-' + C.pad(i + 1); });
          if (!d) return '<td></td>';
          var s = sym(d);
          return '<td><button class="cell ' + s[1] + '" data-act="rentCell" data-r="' + x.r.id + '" data-k="' + d.key + '" title="' + esc(C.monthLabel(d.key) + ': ' + money(d.amount) + ' due, ' + money(d.paid) + ' paid') + '" aria-label="' + esc(C.monthLabel(d.key) + ' ' + s[1]) + '">' + s[0] + '</button></td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table></div><div class="tiny muted" style="margin:8px 2px 0"><span class="cell paid sm">✓</span> paid &nbsp; <span class="cell part sm">½</span> part paid &nbsp; <span class="cell due sm">•</span> due soon &nbsp; <span class="cell late sm">!</span> late &nbsp; <span class="cell fut sm">·</span> later. Tap a square to record or change a month.</div>';
    } else {
      sched.forEach(function (x) {
        h += '<h3 class="sech">' + esc(x.r.tenant.name) + ' <span class="muted small">' + esc(C.shortDate(x.r.start)) + (x.r.end ? ' to ' + esc(C.shortDate(x.r.end)) : '') + '</span></h3><div class="card">' + x.ds.map(function (d) {
          var pays = (x.r.payments || []).filter(function (p) { return p.key === d.key; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; }), lp = pays[0];
          var sub = money(d.amount) + ' · due ' + esc(C.shortDate(d.dueDate)) + (d.status === 'paid' ? (lp ? ' · ' + (lp.waived ? 'settled' : lp.method === 'Deposit' ? 'from deposit' : 'paid ' + esc(C.shortDate(lp.date))) : '') : d.partial ? ' · ' + money(d.paid) + ' paid' : '');
          var act = (d.status === 'paid' || d.status === 'future' ? '' : '<button class="btn sm olive" data-act="pay" data-r="' + x.r.id + '" data-k="' + d.key + '">Paid</button>') + ((d.status === 'overdue' || d.status === 'due') ? '<button class="btn sm ghost" data-act="remind" data-r="' + x.r.id + '" data-k="' + d.key + '">Remind</button>' : '') + '<button class="btn sm ghost" data-act="editMonth" data-r="' + x.r.id + '" data-k="' + d.key + '" aria-label="Change this month">⋯</button>';
          return '<div class="nrow inl' + (d.status === 'future' ? ' dim' : '') + '"><div class="grow"><div class="t">' + esc(C.monthLabel(d.key).replace(' ' + rentYear, '')) + ' ' + pillFor(d) + '</div><div class="s muted small">' + sub + '</div></div><div class="nact">' + act + '</div></div>';
        }).join('') + '</div>';
      });
    }
    return h;
  }

  function agPill(ag) {
    var s = ag.status || 'none';
    return s === 'signed' ? '<span class="pill ok">Signed</span>' : s === 'sent' ? '<span class="pill warn">Sent, waiting for signature</span>' : s === 'draft' ? '<span class="pill clay">Draft</span>' : '<span class="pill grey">Not drafted</span>';
  }
  function viewAgreements() {
    var h = '<div class="pagehead"><div><h1>Agreements</h1><p class="lede">Draft, sign and send rental agreements.</p></div></div>';
    if (!S.rentals.length) return h + '<div class="card empty"><h3>No rentals yet</h3><p>Set up a rental first. The agreement is then drafted from its details.</p><button class="btn" data-act="newRentalPick">+ New rental</button></div>';
    h += '<div class="stack">' + S.rentals.slice().sort(function (a, b) { return a.start < b.start ? 1 : -1; }).map(function (r) {
      var ag = r.agreement || {};
      return '<div class="card row between wrapx"><div class="grow"><div class="t" style="font-weight:700">' + esc(flatOf(r).name) + ' · ' + esc(r.tenant.name) + '</div><div class="muted small">' + esc(C.longDate(r.start)) + (r.end ? ' → ' + esc(C.longDate(r.end)) : ' → open-ended') + ' · ' + money(r.rent) + '/month</div></div>' + agPill(ag) + '<a class="btn sm" href="#/agreement/' + r.id + '">' + (ag.status && ag.status !== 'none' ? 'Open' : 'Draft') + '</a></div>';
    }).join('') + '</div>';
    return h + '<p class="tiny muted" style="margin-top:18px">The standard text is a general residential template. Have it checked against the rules where the flat is, and edit the template in Settings.</p>';
  }

  function agText(r) {
    var ag = r.agreement || {};
    if (ag.text) return ag.text;
    return A.renderText(S.settings.template || A.DEFAULT_TEMPLATE, A.vars(r, flatOf(r), S.settings));
  }
  function sigBlockHTML(r) {
    var ag = r.agreement || {}, L = S.settings.landlord, f = function (img, name, role, date) { return '<div><div class="box">' + (img ? '<img alt="' + role + ' signature" src="' + img + '">' : '') + '</div><div class="cap">' + role + '</div><div><strong>' + esc(name || '') + '</strong></div><div class="cap">Date: ' + (date ? esc(C.longDate(date)) : '______________') + '</div></div>'; };
    return '<div class="sigs">' + f(ag.sigL, L.name, 'Landlord', ag.sigLDate) + f(ag.sigT, r.tenant.name, 'Tenant', ag.sigTDate) + '</div>';
  }
  function viewAgreement(id) {
    var r = rentalById(id); if (!r) return '<div class="card empty"><h3>Not found</h3><a class="btn" href="#/agreements">Back</a></div>';
    r.agreement = r.agreement || { status: 'none' };
    if (!r.agreement.status || r.agreement.status === 'none') { r.agreement.status = 'draft'; save(); }
    var ag = r.agreement, locked = ag.status === 'signed', f = flatOf(r), miss = [];
    if (!S.settings.landlord.name) miss.push('your name and address');
    if (!f.address) miss.push('the flat address'); if (!r.tenant.address) miss.push('the tenant\'s address');
    var h = '<a class="back noprint" href="#/agreements">← Agreements</a><div class="pagehead noprint"><div><h1>Rental agreement</h1><p class="lede">' + esc(f.name) + ' · ' + esc(r.tenant.name) + ' ' + agPill(ag) + '</p></div></div>';
    if (miss.length) h += '<div class="notice noprint">Missing details show as blanks: ' + esc(miss.join(', ')) + '. <a href="#/settings">Settings</a> · <a href="#/rental/' + r.id + '">Edit rental</a></div>';
    h += '<div class="btns noprint" style="margin-bottom:16px"><button class="btn olive" data-act="sendAg" data-r="' + r.id + '">Send…</button><button class="btn ghost" data-act="pdf" data-r="' + r.id + '">Download PDF</button><button class="btn ghost" data-act="print">Print</button>' +
      (locked ? '' : '<button class="btn ghost" data-act="sig" data-r="' + r.id + '" data-who="L">Landlord signs</button><button class="btn ghost" data-act="sig" data-r="' + r.id + '" data-who="T">Tenant signs</button><button class="btn ghost" data-act="editAg" data-r="' + r.id + '">Edit text</button>' + (ag.text ? '<button class="btn ghost" data-act="resetAg" data-r="' + r.id + '">Reset to standard</button>' : '') + '<button class="btn" data-act="markSigned" data-r="' + r.id + '">Mark as signed</button>') +
      (locked ? '<button class="btn ghost" data-act="reopenAg" data-r="' + r.id + '">Re-open</button>' : '') + '</div>';
    h += '<div class="paper">' + A.blocksHTML(A.toBlocks(agText(r))) + sigBlockHTML(r) + '</div>';
    return h;
  }

  function viewSettings() {
    var s = S.settings, L = s.landlord;
    var h = '<div class="pagehead"><div><h1>Settings</h1><p class="lede">Your details are used in agreements and reminders.</p></div></div>';
    h += '<form id="setf" class="card" novalidate><h3>About you (landlord)</h3><div class="fgrid">' +
      [{ name: 'lname', label: 'Full name', v: L.name }, { name: 'lphone', label: 'Phone', v: L.phone, type: 'tel' }, { name: 'lemail', label: 'Email', v: L.email, type: 'email' }, { name: 'lid', label: 'ID number (optional)', v: L.idNo }, { name: 'laddr', label: 'Address', v: L.address, full: 1 }].map(function (x) { return fieldHTML({ name: x.name, label: x.label, type: x.type, full: x.full }, { [x.name]: x.v }); }).join('') + '</div>' +
      '<h3 style="margin-top:26px">Defaults</h3><div class="fgrid">' +
      fieldHTML({ name: 'currency', label: 'Currency symbol', hint: 'For example €, £, $, ₹ or AED' }, { currency: s.currency }) + fieldHTML({ name: 'cc', label: 'Phone country code', hint: 'For WhatsApp links, e.g. 33 for France, 91 for India' }, { cc: s.countryCode }) +
      fieldHTML({ name: 'grace', label: 'Grace days before "late"', type: 'number', min: 0 }, { grace: s.graceDays }) + fieldHTML({ name: 'city', label: 'City where agreements are signed' }, { city: s.city }) +
      fieldHTML({ name: 'law', label: 'Governing law', hint: 'e.g. "France" or "the State of Maharashtra, India"', full: 1 }, { law: s.governingLaw }) +
      fieldHTML({ name: 'payInfo', label: 'How tenants should pay', type: 'textarea', rows: 3, hint: 'Bank details or instructions. Added to reminders and the agreement.', full: 1 }, { payInfo: s.payInfo }) + '</div>' +
      '<h3 style="margin-top:26px">Message wording</h3><p class="muted small">Placeholders: {tenant} {flat} {amount} {period} {dueDate} {daysLate} {payInfo} {landlord}</p><div class="fgrid">' +
      fieldHTML({ name: 'msgSoon', label: 'Friendly reminder (before or on the due date)', type: 'textarea', rows: 4, full: 1 }, { msgSoon: s.msgSoon || DEFAULT_SOON }) + fieldHTML({ name: 'msgLate', label: 'Late payment reminder', type: 'textarea', rows: 4, full: 1 }, { msgLate: s.msgLate || DEFAULT_LATE }) + '</div>' +
      '<h3 style="margin-top:26px">Agreement template</h3><p class="muted small">Lines starting with # are the title, ## are headings, - are bullets. Placeholders in curly brackets are filled from each rental.</p>' +
      fieldHTML({ name: 'template', label: 'Template text', type: 'textarea', rows: 14, full: 1 }, { template: s.template || A.DEFAULT_TEMPLATE }) +
      '<div class="btns" style="margin-top:18px"><button class="btn" type="submit">Save settings</button><button class="btn ghost" type="button" data-act="resetTpl">Restore standard wording</button></div></form>';
    h += '<h2>Google Sheet sync</h2><div class="card">' + (cfg.url ?
      '<p style="margin-top:0"><span class="pill ok">Connected</span> <span class="syncchip muted small"></span></p><p class="muted small">Your phone and laptop share one Google Sheet. Changes sync by themselves when you are online.</p><div class="btns"><button class="btn olive" data-act="syncNow">Sync now</button><button class="btn sm danger" data-act="unsync">Disconnect</button></div>' :
      '<p class="muted small" style="margin-top:0">Keep your data in your own Google Sheet so your phone and laptop always show the same thing. One-time setup:</p><details style="margin-bottom:12px"><summary style="cursor:pointer;font-weight:500">Show the 4 setup steps</summary><ol class="small"><li>Create a new Google Sheet (any name, e.g. "Rent Desk data").</li><li>In it open Extensions, then Apps Script. Delete the sample code and paste the text of <a href="Code.gs" target="_blank" rel="noopener">Code.gs</a> <button type="button" class="btn sm ghost" data-act="copyGs">Copy it</button></li><li>In Apps Script open Project Settings, then Script properties, then add a property named <strong>PIN</strong> with a PIN of your choice.</li><li>Press Deploy, then New deployment, type Web app. Execute as: Me. Who has access: Anyone. Deploy, allow access, and copy the Web app URL.</li></ol></details>' +
      '<form id="syncf" novalidate><div class="fgrid">' + fieldHTML({ name: 'url', label: 'Web app URL', full: true }, { url: DEFAULT_URL }) + fieldHTML({ name: 'pin', label: 'PIN', type: 'password' }, {}) + '</div><div class="btns" style="margin-top:14px"><button class="btn" type="submit">Connect</button></div></form>') + '</div>';
    h += '<h2>Your data</h2><div class="card"><p class="muted small" style="margin-top:0">Everything is stored on this device. Make a backup file now and then, and use it to move to another phone or computer.</p><div class="btns"><button class="btn olive" data-act="backup">Download backup</button><button class="btn ghost" data-act="restore">Restore from backup</button><button class="btn ghost" data-act="ics">Rent dates for my calendar (.ics)</button></div>' +
      '<input id="restoreFile" type="file" accept=".json,application/json" class="hide"><div class="btns" style="margin-top:14px"><button class="btn sm danger" data-act="wipe">Erase everything on this device</button></div></div>';
    return h;
  }

  /* ---------- flats: list on the left, details on the right (like Students in ChiYoga) ---------- */
  var flatQ = '';
  var EXP_CATS = ['Maintenance & repairs', 'Property tax', 'Insurance', 'Service charge / fees', 'Utilities', 'Management / agent fee', 'Loan / mortgage', 'Furnishing', 'Legal & admin', 'Other'];
  function initials(n) { return String(n || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join('') || '·'; }
  function flatRentals(f) { return S.rentals.filter(function (r) { return r.flatId === f.id; }).sort(function (a, b) { return a.start < b.start ? 1 : -1; }); }
  function currentRental(f, t) {
    var rs = flatRentals(f), live = function (r) { return !r.end || r.end >= t; };
    return rs.find(function (r) { return r.start <= t && live(r); }) || rs.filter(function (r) { return r.start > t; }).pop() || rs.find(live) || rs[0] || null;
  }
  var tokenOf = function (r) { var ps = (r.payments || []).filter(function (p) { return p.method === 'Token'; }); return ps.length ? { amount: ps.reduce(function (s, p) { return s + (+p.amount); }, 0), date: ps.map(function (p) { return p.date; }).sort()[0] } : null; };

  function flatRow(f, t, selId) {
    if (f.soldDate) return '<a class="frow' + (f.id === selId ? ' sel' : '') + '" href="#/flat/' + f.id + '" data-q="' + esc((f.name + ' ' + (f.address || '')).toLowerCase()) + '"><span class="av">' + esc(initials(f.name)) + '</span><span class="grow"><b>' + esc(f.name) + '</b><span class="s">Sold ' + esc(C.shortDate(f.soldDate)) + '</span></span><span class="pill grey">Sold</span></a>';
    var r = currentRental(f, t), occ = r && (!r.end || r.end >= t), sub, pill, who = f.name;
    if (occ && r.start > t) { sub = r.tenant.name + ' · from ' + C.shortDate(r.start); who = r.tenant.name; pill = '<span class="pill warn">Reserved</span>'; }
    else if (occ) {
      var late = C.schedule(r, t, grace()).filter(function (d) { return d.status === 'overdue'; });
      sub = r.tenant.name + ' · ' + money(r.rent); who = r.tenant.name;
      pill = late.length ? '<span class="pill bad">' + late.length + ' late</span>' : '<span class="pill ok">Paid up</span>';
    } else { sub = 'Vacant' + (r && r.depositSettlement ? ' · deposit settled' : ''); pill = '<span class="pill grey">Vacant</span>'; }
    var q = (f.name + ' ' + (f.address || '') + ' ' + (occ ? r.tenant.name : '')).toLowerCase();
    return '<a class="frow' + (f.id === selId ? ' sel' : '') + '" href="#/flat/' + f.id + '" data-q="' + esc(q) + '"><span class="av">' + esc(initials(who)) + '</span><span class="grow"><b>' + esc(f.name) + '</b><span class="s">' + esc(sub) + '</span></span>' + pill + '</a>';
  }
  function viewFlats(selId, rid) {
    var t = today(), h = '<div class="pagehead"><div><h1>Flats</h1></div><div class="btns"><button class="btn" data-act="addFlat">+ Add flat</button></div></div>';
    if (!S.flats.length) return h + '<div class="card empty"><h3>No flats yet</h3><p>Add the first flat you rent out. You can add the tenant and rent right after.</p><button class="btn" data-act="addFlat">Add a flat</button></div>';
    var f = S.flats.find(function (x) { return x.id === selId; });
    var list = '<input id="flatQ" class="search" placeholder="Search flat or tenant" value="' + esc(flatQ) + '" autocomplete="off"><div class="card flist" id="flatRows">' + S.flats.slice().sort(function (a, b) { return (a.soldDate ? 1 : 0) - (b.soldDate ? 1 : 0); }).map(function (x) { return flatRow(x, t, selId); }).join('') + '</div>';
    var detail = f ? flatDetail(f, rid, t) : '<div class="stu-empty">Pick a flat from the list to see the tenant, rent and details here.</div>';
    return h + '<div class="split' + (f ? ' has-sel' : '') + '"><div class="split-list">' + list + '</div><div class="split-detail">' + detail + '</div></div>';
  }
  function applyFlatQ() {
    var q = flatQ.trim().toLowerCase();
    Array.prototype.forEach.call(document.querySelectorAll('#flatRows .frow'), function (a) { a.classList.toggle('hide', !!q && a.dataset.q.indexOf(q) < 0); });
  }

  var showAll = false;
  function flatDetail(f, rid, t) {
    var rs = flatRentals(f), r = rid ? rentalById(rid) : currentRental(f, t);
    var h = '<a class="back flatback" href="#/flats">‹ All flats</a><div class="card"><div class="row between" style="align-items:flex-start"><div><h2 style="margin:0">' + esc(f.name) + '</h2><div class="muted small">' + esc(f.address || '') + '</div></div><div class="btns"><button class="btn sm ghost" data-act="editFlat" data-f="' + f.id + '">Edit flat</button>' + (f.soldDate ? '' : '<button class="btn sm ghost" data-act="sellFlat" data-f="' + f.id + '">Sold</button>') + '</div></div>' +
      '<details class="more"><summary>Flat information (meter codes, contacts)</summary><div style="white-space:pre-wrap;margin-top:8px">' + (f.info ? esc(f.info) : '<span class="muted small">Nothing yet. Use Edit flat to add meter codes, support numbers, Wi-Fi.</span>') + '</div>' +
      (f.info && r ? '<div class="btns" style="margin-top:10px"><button class="btn sm olive" data-act="sendInfo" data-r="' + r.id + '">Send to tenant</button></div>' : '') + '</details></div>';
    if (f.soldDate) return h + '<div class="card"><div class="row between wrapx"><div><span class="pill grey">Sold</span> <b>' + esc(C.longDate(f.soldDate)) + '</b>' + (+f.soldPrice > 0 ? ' · ' + money(f.soldPrice) : '') + '</div><button class="btn sm ghost" data-act="unsellFlat" data-f="' + f.id + '">Undo sale</button></div>' + (f.soldNote ? '<div class="small muted" style="margin-top:6px">' + esc(f.soldNote) + '</div>' : '') + '<div class="tiny muted" style="margin-top:8px">Its rent history and expenses stay in the figures. Its recurring bills were closed on the sale date.</div></div>' + (r ? rentalBlock(f, r, t) : '');
    if (!r) return h + '<div class="card row between wrapx"><div><span class="pill grey">Vacant</span></div><button class="btn" data-act="newRental" data-f="' + f.id + '">Set up rental</button></div>';
    if (r.depositSettlement || (r.end && r.end < t)) h += '<div class="card row between wrapx" style="margin-top:12px"><div><span class="pill grey">Vacant</span> <span class="muted small">Last tenant: ' + esc(r.tenant.name) + '</span></div><button class="btn" data-act="newRental" data-f="' + f.id + '">Rent again</button></div>';
    h += rentalBlock(f, r, t);
    var others = rs.filter(function (x) { return x.id !== r.id; });
    if (!(r.depositSettlement || (r.end && r.end < t))) h += '<div style="margin-top:14px"><button class="btn sm ghost" data-act="newRental" data-f="' + f.id + '">+ Next tenant</button></div>';
    if (others.length) h += '<p class="tiny muted" style="margin-top:14px">Other tenancies: ' + others.map(function (x) { return '<a href="#/rental/' + x.id + '">' + esc(x.tenant.name) + ' (' + esc(C.shortDate(x.start)) + ')</a>'; }).join(', ') + '</p>';
    return h;
  }

  function rentalBlock(f, r, t) {
    var ds = C.schedule(r, t, grace()), T = r.tenant, ph = C.phoneDigits(T.phone, S.settings.countryCode), ag = r.agreement || {}, st = r.depositSettlement;
    var ended = r.end && r.end < t, rc = (r.revisions || []).slice().sort(function (a, b) { return a.from < b.from ? -1 : 1; });
    var h = '<div class="card"><div class="row between wrapx"><div><div class="t">' + esc(T.name) + (ended ? ' <span class="pill grey">Ended</span>' : r.start > t ? ' <span class="pill warn">Reserved · moves in ' + esc(C.shortDate(r.start)) + '</span>' : '') + '</div><div class="muted small">' + money(r.rent) + ' / month · due day ' + esc(r.dueDay) + ' · ' + esc(C.shortDate(r.start)) + ' to ' + (r.end ? esc(C.longDate(r.end)) : 'open-ended') + '</div></div>' +
      '<div class="btns">' + (T.phone ? '<a class="btn sm ghost" href="tel:' + esc(T.phone.replace(/\s/g, '')) + '">Call</a>' : '') + (ph ? '<a class="btn sm ghost" target="_blank" rel="noopener" href="https://wa.me/' + ph + '">WhatsApp</a>' : '') + '</div></div>';
    if (rc.length) h += '<div class="tiny muted" style="margin-top:6px">Rent changes: ' + rc.map(function (x) { return esc(C.monthLabel(x.from.slice(0, 7))) + ' → ' + money(x.rent); }).join(' · ') + '</div>';
    var tk = tokenOf(r); if (tk) h += '<div class="small" style="margin-top:8px">Token received: <b>' + money(tk.amount) + '</b> on ' + esc(C.shortDate(tk.date)) + ' <span class="muted">· taken off the first rent</span></div>';
    if (+r.deposit > 0 && !st) h += '<div class="row wrapx small" style="margin-top:10px;gap:8px"><span>Security deposit <b>' + money(r.deposit) + '</b></span>' + (r.depositReceived ? '<span class="pill ok">Received ' + esc(C.shortDate(r.depositReceived)) + '</span><button class="btn sm ghost" data-act="depositUndo" data-r="' + r.id + '">Undo</button>' : '<span class="pill warn">Not received yet</span><button class="btn sm olive" data-act="depositRecv" data-r="' + r.id + '">Mark received</button>') + '</div>';
    h += '<div class="btns" style="margin-top:12px"><button class="btn sm ghost" data-act="editRental" data-r="' + r.id + '">Edit</button><button class="btn sm ghost" data-act="changeRent" data-r="' + r.id + '">Change rent</button><button class="btn sm ghost" data-act="bulkPay" data-r="' + r.id + '">Past payments</button><button class="btn sm ghost" data-act="settleAll" data-r="' + r.id + '">Settle dues</button>' +
      (st ? '' : '<button class="btn sm danger" data-act="endRental" data-r="' + r.id + '">' + (ended && +r.deposit > 0 ? 'Settle deposit' : 'End tenancy') + '</button>') + '<button class="btn sm danger" data-act="delRental" data-r="' + r.id + '">Delete</button></div></div>';
    if (st) h += depositCard(r, st);
    var past = ds.filter(function (d) { return d.status !== 'future'; }), keep = showAll ? past : past.filter(function (d, i) { return i >= past.length - 6 || d.status !== 'paid'; });
    h += '<h3 class="sech">Rent</h3><div class="card tablewrap"><table><tbody>' +
      (keep.length ? keep.slice().reverse().map(function (d) {
        var pays = (r.payments || []).filter(function (p) { return p.key === d.key; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; }), lastP = pays[0];
        var info = d.status === 'paid' ? (lastP ? (lastP.waived ? 'Settled' : lastP.method === 'Deposit' ? 'From deposit' : lastP.method === 'Token' && pays.length === 1 ? 'Token ' + C.shortDate(lastP.date) : 'Paid ' + C.shortDate(lastP.date)) : '') : d.partial ? money(d.paid) + ' paid' : '';
        return '<tr><td>' + esc(C.monthLabel(d.key)) + '<div class="tiny muted">due ' + esc(C.shortDate(d.dueDate)) + '</div></td><td class="r">' + money(d.amount) + '</td><td>' + pillFor(d) + (info ? '<div class="tiny muted">' + esc(info) + '</div>' : '') + '</td><td class="right nowrap">' +
          (d.status === 'paid' ? '' : '<button class="btn sm olive" data-act="pay" data-r="' + r.id + '" data-k="' + d.key + '">Paid</button> ') + ((d.status === 'overdue' || d.status === 'due') ? '<button class="btn sm ghost" data-act="remind" data-r="' + r.id + '" data-k="' + d.key + '">Remind</button> ' : '') +
          '<button class="btn sm ghost" data-act="editMonth" data-r="' + r.id + '" data-k="' + d.key + '" aria-label="Change this month">⋯</button></td></tr>';
      }).join('') : '<tr><td class="muted">No rent due yet.</td></tr>') + '</tbody></table>' +
      (past.length > keep.length || showAll ? '<div style="margin-top:8px"><button class="btn sm ghost" data-act="toggleAll">' + (showAll ? 'Show less' : 'Show all ' + past.length + ' months') + '</button></div>' : '') + '</div>';
    var fus = (r.followups || []).slice(-3).reverse();
    h += '<h3 class="sech">Follow-ups</h3><div class="card">' + (fus.length ? '<div class="log">' + fus.map(function (x) { return '<div><div class="d">' + esc(C.shortDate(x.date)) + ' · ' + esc(x.channel) + (x.promiseDate ? ' · promised ' + esc(C.shortDate(x.promiseDate)) : '') + '</div>' + esc(x.note || '') + '</div>'; }).join('') + '</div>' : '<div class="muted small" style="margin-bottom:8px">Nothing logged yet.</div>') + '<button class="btn sm ghost" data-act="logfu" data-r="' + r.id + '">+ Log a call or note</button></div>';
    var yr = Money.figures(S, t.slice(0, 4) + '-01-01', t.slice(0, 4) + '-12-31', t, grace()), fr = yr.byFlat[f.id] || { expenses: 0 };
    h += '<div class="card row between wrapx" style="margin-top:12px"><div><span class="muted small">Agreement</span> ' + agPill(ag) + '</div><a class="btn sm ghost" href="#/agreement/' + r.id + '">' + (ag.status && ag.status !== 'none' ? 'Open' : 'Draft') + '</a></div>' +
      '<div class="card row between wrapx" style="margin-top:12px"><div><span class="muted small">Expenses ' + esc(t.slice(0, 4)) + '</span> <b>' + money(fr.expenses) + '</b></div><button class="btn sm ghost" data-act="addExpense" data-f="' + f.id + '">+ Expense</button></div>';
    return h;
  }
  function depositCard(r, s) {
    var rows = [['Deposit held', money(s.deposit)]];
    if (s.applied > 0) rows.push(['Settled against unpaid rent', money(s.applied)]);
    if (s.forfeited > 0) rows.push(['Forfeited (left before ' + C.longDate(r.agreedEnd || r.end) + ')', money(s.forfeited)]);
    (s.deductions || []).forEach(function (x) { if (!s.forfeit) rows.push([x.label || 'Deductions', money(x.amount)]); });
    if (!s.forfeit) rows.push(['Returned to tenant', money(s.refund)]);
    if (s.shortfall > 0) rows.push(['Rent still owed by tenant', money(s.shortfall)]);
    if (s.extraOwed > 0) rows.push(['Charges beyond the deposit', money(s.extraOwed)]);
    return '<div class="card" style="margin-top:12px"><div class="row between wrapx"><h3 style="margin:0">Deposit settled ' + esc(C.shortDate(s.date)) + '</h3><button class="btn sm ghost" data-act="sendSettle" data-r="' + r.id + '">Send to tenant</button></div><table style="margin-top:8px"><tbody>' + rows.map(function (x) { return '<tr><td>' + esc(x[0]) + '</td><td class="r"><b>' + x[1] + '</b></td></tr>'; }).join('') + '</tbody></table></div>';
  }

  /* ---------- dashboard: month / year, like the ChiYoga teacher app ---------- */
  var dashMode = 'month', dashKey = null;
  function delta(cur, prev) { if (!prev) return ''; var p = Math.round((cur - prev) / Math.abs(prev) * 100); return p === 0 ? '= same' : (p > 0 ? '↑ ' : '↓ ') + Math.abs(p) + '%'; }
  /* Things that need the owner, grouped so each flat appears once, most urgent flat first. */
  function needsList(t) {
    var mshort = function (k) { return C.MONTHS[+k.slice(5, 7) - 1].slice(0, 3) + (k.slice(0, 4) === t.slice(0, 4) ? '' : ' ' + k.slice(0, 4)); };
    var groups = {}, order = [];
    var grp = function (id, title) { if (!groups[id]) { groups[id] = { title: title, issues: [], acts: [], sev: 9, amt: 0 }; order.push(id); } return groups[id]; };
    var add = function (g, sev, text, act) { g.issues.push({ sev: sev, text: text }); if (sev < g.sev) g.sev = sev; if (act && g.acts.length < 2 && g.acts.every(function (x) { return x.k !== act.k; })) g.acts.push(act); };
    var link = function (r) { return '<a href="#/rental/' + r.id + '">' + esc(flatOf(r).name) + '</a> · ' + esc(r.tenant.name); };
    var rent = allDues(t).filter(function (d) { return d.status === 'overdue' || d.status === 'due' || d.status === 'soon'; });
    rent.forEach(function (d) {
      var g = grp(d.r.id, link(d.r)), pr = C.latestPromise(d.r, t), sev = d.status === 'overdue' ? 0 : d.status === 'due' ? 1 : 2;
      var when = d.status === 'overdue' ? '<span class="badtxt">' + d.daysLate + ' d late</span>' : d.status === 'due' ? 'due today' : 'due ' + esc(C.shortDate(d.dueDate));
      g.amt += d.balance;
      add(g, sev, esc(mshort(d.key)) + ' rent ' + money(d.balance) + ' ' + when + (pr ? ' (promised ' + esc(C.shortDate(pr)) + ')' : ''), { k: 'paid' + d.key, h: '<button class="btn sm olive" data-act="pay" data-r="' + d.r.id + '" data-k="' + d.key + '">Paid</button>' });
      if (!C.phoneDigits(d.r.tenant.phone, S.settings.countryCode)) add(g, sev, 'no phone', null); else add(g, sev, '', { k: 'wa', h: '<button class="btn sm wa" data-act="waNow" data-r="' + d.r.id + '" data-k="' + d.key + '">WhatsApp</button>' });
    });
    S.rentals.forEach(function (r) {
      if (r.end && r.end < t) return;
      var g = grp(r.id, link(r)), ag = r.agreement || {};
      if (+r.deposit > 0 && !r.depositReceived && !r.depositSettlement) add(g, 3, 'deposit ' + money(r.deposit) + ' due', { k: 'dep', h: '<button class="btn sm olive" data-act="depositRecv" data-r="' + r.id + '">Got deposit</button>' });
      if (ag.status === 'sent') add(g, 4, 'agreement unsigned', { k: 'agr', h: '<a class="btn sm ghost" href="#/agreement/' + r.id + '">Agreement</a>' });
      if (r.start > t) add(g, 5, 'moves in ' + esc(C.shortDate(r.start)), null);
      if (r.end && r.start <= t && C.diffDays(r.end, t) <= 60) add(g, 5, 'lease ends ' + esc(C.shortDate(r.end)) + ' (' + C.diffDays(r.end, t) + ' days)', { k: 'ren', h: '<button class="btn sm ghost" data-act="renew" data-r="' + r.id + '">Renew</button>' });
    });
    S.flats.forEach(function (f) {
      if (f.soldDate) return; var r = currentRental(f, t);
      if (!r || r.depositSettlement || (r.end && r.end < t)) add(grp('f' + f.id, '<a href="#/flat/' + f.id + '">' + esc(f.name) + '</a>'), 6, 'vacant', { k: 'vac', h: '<button class="btn sm" data-act="newRental" data-f="' + f.id + '">Rent again</button>' });
    });
    return order.map(function (id) { return groups[id]; }).filter(function (g) { return g.issues.length; }).sort(function (x, y) { return x.sev - y.sev; }).map(function (g) {
      var sub = g.issues.map(function (i) { return i.text; }).filter(Boolean).join(' · ');
      return '<div class="nrow"><div class="grow"><div class="t">' + g.title + '</div><div class="s muted small">' + sub + '</div></div><div class="nact">' + g.acts.map(function (x) { return x.h; }).join('') + '</div></div>';
    });
  }
  function viewDashboard() {
    var t = today(), isY = dashMode === 'year'; if (!dashKey) dashKey = isY ? t.slice(0, 4) : t.slice(0, 7);
    var label = isY ? dashKey : C.monthLabel(dashKey);
    var h = '<div class="pagehead"><div><div class="eyebrow">' + esc(C.longDate(t)) + ' <span class="syncchip" style="text-transform:none;letter-spacing:0;color:var(--muted);margin-left:8px"></span></div><h1>' + esc(label) + '</h1></div><div class="row"><div class="seg"><button data-act="dashMode" data-m="month" class="' + (isY ? '' : 'on') + '">Month</button><button data-act="dashMode" data-m="year" class="' + (isY ? 'on' : '') + '">Year</button></div>' +
      '<button class="btn sm ghost" data-act="dashNav" data-n="-1" aria-label="Previous">‹</button><button class="btn sm ghost" data-act="dashNav" data-n="1" aria-label="Next">›</button></div></div>';
    if (!S.flats.length) return h + '<div class="card empty"><h3>Welcome to Rent Desk</h3><p>Add your flats, set up each rental with the rent and dates, and this page will tell you every morning who to follow up with. Agreements are drafted for you, ready to sign.</p><div class="btns" style="justify-content:center"><button class="btn" data-act="addFlat">Add my first flat</button><button class="btn ghost" data-act="sample">Try with sample data</button></div></div>';
    var nag = S.rentals.length && (!S.settings.lastBackup || C.diffDays(t, S.settings.lastBackup) > 30);
    if (nag && !cfg.url) h += '<div class="notice">Your data is saved on this device only. <button class="btn sm ghost" data-act="backup" style="margin-left:6px">Back up now</button></div>';
    var need = needsList(t), cap = window.innerWidth < 560 ? 3 : 5;
    h += '<div class="card" style="margin-bottom:12px"><h3 style="margin:0 0 4px">Needs you' + (need.length ? ' <span class="pill grey">' + need.length + '</span>' : '') + '</h3>' +
      (need.length ? need.slice(0, cap).join('') + (need.length > cap ? '<details class="more"><summary>' + (need.length - cap) + ' more</summary>' + need.slice(cap).join('') + '</details>' : '') : '<div class="muted small" style="padding:6px 0 2px">Nothing needs you right now.</div>') + '</div>';
    var fig = function (mode, key) { var rg = Money.range(mode, key); return Money.figures(S, rg.from, rg.to, t, grace()); };
    var f = fig(dashMode, dashKey), prevKey = isY ? String(+dashKey - 1) : C.addMonths(dashKey, -1), pf = fig(dashMode, prevKey);
    var pl = isY ? prevKey : C.MONTHS[+prevKey.slice(5, 7) - 1].slice(0, 3);
    function kpi(name, cur, prev, cls) { var d = delta(cur, prev); return '<div class="card kpi ' + (cls || '') + '"><div class="eyebrow">' + name + '</div><div class="n">' + money(cur) + '</div><div class="l">' + (d ? esc(d) + ' vs ' + esc(pl) : '&nbsp;') + '</div></div>'; }
    h += '<div class="grid g3">' + kpi('Income', f.income, pf.income) + kpi('Expenses', f.expenses, pf.expenses) + kpi('Result', f.net, pf.net) + '</div>';
    if (f.waived > 0 || f.kept > 0) h += '<p class="tiny muted incnote" style="margin:8px 2px 0">' + (f.kept > 0 ? 'Income includes ' + money(f.kept) + ' of deposits kept. ' : '') + (f.waived > 0 ? money(f.waived) + ' of rent was settled without payment (not counted as income).' : '') + '</p>';
    var year = dashKey.slice(0, 4), ser = Money.yearSeries(S, year, t, grace()), mx = Math.max.apply(null, ser.map(function (x) { return Math.max(x.income, x.expenses); }).concat([1]));
    h += '<div class="card" style="margin-top:12px"><div class="row between"><h3 style="margin:0">' + esc(year) + ' by month</h3><span class="tiny muted"><span class="dot inc"></span> Income <span class="dot exp"></span> Expenses</span></div><div class="chart">' + ser.map(function (x) {
      var k = year + '-' + C.pad(x.month), on = !isY && k === dashKey;
      return '<button class="bar2' + (on ? ' on' : '') + '" data-act="dashMonth" data-k="' + k + '" aria-label="' + esc(C.monthLabel(k)) + '"><span class="bars" title="Income ' + money(x.income) + ' · Expenses ' + money(x.expenses) + '"><i class="inc" style="height:' + Math.round(x.income / mx * 100) + '%;z-index:' + (x.income >= x.expenses ? 1 : 2) + '"></i><i class="exp" style="height:' + Math.round(x.expenses / mx * 100) + '%;z-index:' + (x.income >= x.expenses ? 2 : 1) + '"></i></span><span class="m">' + C.MONTHS[x.month - 1].charAt(0) + '</span></button>';
    }).join('') + '</div></div>';
    var ids = S.flats.filter(function (x) { return !x.soldDate || (f.byFlat[x.id] && (f.byFlat[x.id].income || f.byFlat[x.id].expenses)); }).map(function (x) { return x.id; }).concat(f.byFlat[''] ? [''] : []), tot = { income: 0, expenses: 0, net: 0, outstanding: 0 };
    h += '<h3 class="sech">By flat</h3><div class="card tablewrap"><table><thead><tr><th>Flat</th><th class="r">Received</th><th class="r">Expenses</th><th class="r">Result</th></tr></thead><tbody>' + ids.map(function (id) {
      var x = f.byFlat[id] || { income: 0, expenses: 0, net: 0, outstanding: 0 }, fl = S.flats.find(function (y) { return y.id === id; });
      Object.keys(tot).forEach(function (k) { tot[k] += x[k]; });
      return '<tr><td>' + (fl ? '<a href="#/flat/' + fl.id + '">' + esc(fl.name) + '</a>' : '<span class="muted">No flat</span>') + '</td><td class="r">' + money(x.income) + '</td><td class="r">' + money(x.expenses) + '</td><td class="r">' + money(x.net) + '</td></tr>';
    }).join('') + '<tr><td><b>Total</b></td><td class="r"><b>' + money(tot.income) + '</b></td><td class="r"><b>' + money(tot.expenses) + '</b></td><td class="r"><b>' + money(tot.net) + '</b></td></tr></tbody></table></div>';
    var cats = Object.keys(f.byCat).sort(function (a, b) { return f.byCat[b] - f.byCat[a]; }), cm = cats.length ? f.byCat[cats[0]] : 1;
    if (cats.length) h += '<details class="card more" style="margin-top:12px"><summary>Where the expenses went</summary><div style="margin-top:10px">' + cats.map(function (c) { return '<div class="catrow"><div class="row between small"><span>' + esc(c) + '</span><b>' + money(f.byCat[c]) + '</b></div><div class="bar"><i style="width:' + Math.round(f.byCat[c] / cm * 100) + '%"></i></div></div>'; }).join('') + '</div></details>';
    return h;
  }

  /* ---------- expenses and recurring bills ---------- */
  var expMonth = null, expFlat = '';
  function viewExpenses() {
    var t = today(); if (!expMonth) expMonth = t.slice(0, 7);
    var rg = Money.range('month', expMonth), list = S.expenses.filter(function (e) { return e.date >= rg.from && e.date <= rg.to && (!expFlat || e.flatId === expFlat); }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    var total = list.reduce(function (s, e) { return s + (+e.amount); }, 0), by = {}; list.forEach(function (e) { by[e.category] = (by[e.category] || 0) + (+e.amount); });
    var flatName = function (id) { var f = S.flats.find(function (x) { return x.id === id; }); return f ? f.name : 'No flat'; };
    var h = '<div class="pagehead"><div><h1>Expenses</h1></div><div class="row"><button class="btn sm ghost" data-act="expNav" data-n="-1" aria-label="Previous month">‹</button><input type="month" id="expPick" value="' + expMonth + '" aria-label="Jump to month" style="width:auto;min-width:150px"><button class="btn sm ghost" data-act="expNav" data-n="1" aria-label="Next month">›</button><button class="btn" data-act="addExpense">+ Add</button><button class="btn ghost" data-act="pastExpenses">Older expenses</button></div></div>';
    h += '<div class="chips" style="margin-bottom:10px"><button class="chip' + (expFlat ? '' : ' on') + '" data-act="expFlat" data-f="">All flats</button>' + S.flats.map(function (f) { return '<button class="chip' + (expFlat === f.id ? ' on' : '') + '" data-act="expFlat" data-f="' + f.id + '">' + esc(f.name) + '</button>'; }).join('') + '</div>';
    var isRec = function (e) { return !!(e.auto || e.billId); }, recT = list.filter(isRec).reduce(function (a, e) { return a + (+e.amount); }, 0), othT = total - recT;
    var tot = function (label, v, n) { return '<div><div class="eyebrow">' + label + '</div><div class="amt">' + money(v) + '</div><div class="tiny muted">' + n + '</div></div>'; };
    h += '<div class="card row between wrapx" style="gap:18px">' + tot('Recurring', recT, list.filter(isRec).length + ' bill(s)') + tot('Other', othT, list.filter(function (e) { return !isRec(e); }).length + ' expense(s)') + tot('Total', total, esc(C.MONTHS[+expMonth.slice(5, 7) - 1]) + ' ' + esc(expMonth.slice(0, 4))) + '</div>';
    h += '<div class="card tablewrap" style="margin-top:12px"><table><tbody>' + (list.length ? list.map(function (e) {
      return '<tr class="click" data-act="editExpense" data-e="' + e.id + '"><td class="nowrap">' + esc(C.shortDate(e.date)) + '</td><td>' + esc(e.description || e.category) + '<div class="tiny muted">' + esc(e.category) + ' · ' + esc(flatName(e.flatId)) + (e.auto ? ' · automatic' : '') + '</div></td><td class="r nowrap"><b>' + money(e.amount) + '</b></td></tr>';
    }).join('') : '<tr><td class="muted">Nothing recorded this month.</td></tr>') + '</tbody></table></div>';
    h += '<div class="row between" style="margin-top:28px"><h3 class="sech" style="margin:0">Recurring bills</h3><button class="btn sm ghost" data-act="addBill">+ New bill</button></div><p class="muted small" style="margin:4px 0 10px">Added to expenses by themselves on their day, when you open the app.</p>';
    h += '<div class="card">' + ((expFlat ? S.bills.filter(function (b) { return b.flatId === expFlat; }) : S.bills).length ? (expFlat ? S.bills.filter(function (b) { return b.flatId === expFlat; }) : S.bills).map(function (b) {
      return '<div class="row between wrapx brw" data-act="editBill" data-b="' + b.id + '"><div class="grow"><b>' + esc(b.name) + '</b>' + (b.active === false ? (b.end ? ' <span class="pill ok">Paid off ' + esc(C.shortDate(b.end)) + '</span>' : ' <span class="pill grey">Paused</span>') : '') + '<div class="tiny muted">' + esc(b.category) + ' · ' + esc(flatName(b.flatId)) + ' · ' + esc(b.freq || 'monthly') + ' on day ' + esc(b.day) + '</div></div><b>' + money(b.amount) + '</b></div>';
    }).join('') : '<div class="muted small">No recurring bills. Add service charges, property tax, insurance or a loan instalment once and they appear every period.</div>') + '</div>';
    return h;
  }
  function flatOptions() { return [['', 'Choose a flat…']].concat(S.flats.map(function (f) { return [f.id, f.name + (f.soldDate ? ' (sold)' : '')]; })); }
  var defFlat = function (id) { return id || (S.flats.length === 1 ? S.flats[0].id : ''); };
  function depositRecvForm(rid) {
    var r = rentalById(rid);
    openForm({ title: 'Security deposit received', intro: flatOf(r).name + ' · ' + r.tenant.name + ' · ' + money(r.deposit), submit: 'Mark received',
      fields: [{ name: 'date', label: 'Date received', type: 'date', required: true, full: true }], values: { date: today() },
      onSave: function (d) { r.depositReceived = d.date; toast('Deposit marked as received.'); } });
  }
  function sellForm(id) {
    var f = S.flats.find(function (x) { return x.id === id; }), t = today(), r = currentRental(f, t);
    if (r && (!r.end || r.end >= t)) { toast(r.start > t ? 'A tenant is booked from ' + C.shortDate(r.start) + '. Delete or end that rental first.' : 'A tenant is still living here. End the tenancy and settle the deposit first.'); return; }
    openForm({ title: 'Flat sold', intro: f.name + '. Recurring bills for this flat are closed on the sale date. Its history stays in your figures.', submit: 'Mark as sold',
      fields: [{ name: 'soldDate', label: 'Sale date', type: 'date', required: true }, { name: 'soldPrice', label: 'Sale price (optional)', type: 'number', step: '0.01', min: 0 }, { name: 'soldNote', label: 'Note (optional)', full: true, hint: 'e.g. buyer, agent, what is still to settle' }],
      values: { soldDate: t, soldPrice: '', soldNote: '' },
      onSave: function (d) {
        f.soldDate = d.soldDate; f.soldPrice = +d.soldPrice || 0; f.soldNote = d.soldNote;
        S.bills.forEach(function (b) { if (b.flatId === f.id && !(b.active === false && b.end)) { b.active = false; if (!b.end || b.end > d.soldDate) b.end = d.soldDate; } });
        toast('Marked as sold.');
      } });
  }
  function expenseForm(id, flatId) {
    var e = id ? S.expenses.find(function (x) { return x.id === id; }) : null;
    openForm({ title: e ? 'Edit expense' : 'Add an expense', del: e ? function () { S.expenses = S.expenses.filter(function (x) { return x.id !== id; }); } : null,
      fields: [{ name: 'date', label: 'Date', type: 'date', required: true }, { name: 'amount', label: 'Amount', type: 'number', step: '0.01', min: 0, required: true },
        { name: 'category', label: 'Category', type: 'select', options: EXP_CATS.map(function (c) { return [c, c]; }) }, { name: 'flatId', label: 'Flat', type: 'select', options: flatOptions(), required: true },
        { name: 'description', label: 'What for', full: true }, { name: 'method', label: 'Paid by', type: 'select', more: true, options: [['', '—'], ['Bank transfer', 'Bank transfer'], ['Cash', 'Cash'], ['Card', 'Card']] }],
      values: e || { date: (expMonth && expMonth < today().slice(0, 7)) ? Money.range('month', expMonth).to : today(), flatId: defFlat(flatId || expFlat), category: EXP_CATS[0] },
      onSave: function (d) { if (!(+d.amount > 0)) { toast('Enter the amount.'); return false; } var o = e || { id: C.uid() }; Object.assign(o, { date: d.date, amount: +d.amount, category: d.category, flatId: d.flatId, description: d.description, method: d.method }); if (!e) S.expenses.push(o); } });
  }
  /* Backfill: the same cost for a run of past months (or a single month), in one go. */
  function pastExpensesForm() {
    var t = today(), m = t.slice(0, 7);
    openForm({ title: 'Add older expenses', intro: 'Enter a cost once and it is recorded for every month in the range. For a one-off, use the same month twice.', submit: 'Save expenses',
      fields: [{ name: 'flatId', label: 'Flat', type: 'select', options: flatOptions(), required: true, full: true }, { name: 'category', label: 'Category', type: 'select', options: EXP_CATS.map(function (c) { return [c, c]; }) }, { name: 'amount', label: 'Amount each month', type: 'number', step: '0.01', min: 0, required: true },
        { name: 'from', label: 'From month', type: 'month', required: true }, { name: 'to', label: 'To month', type: 'month', required: true }, { name: 'day', label: 'On day', type: 'number', min: 1, max: 31 }, { name: 'description', label: 'What for', full: true }],
      values: { flatId: defFlat(expFlat), category: EXP_CATS[0], from: C.addMonths(m, -12), to: C.addMonths(m, -1), day: 1 },
      onSave: function (d) {
        if (!(+d.amount > 0)) { toast('Enter the amount.'); return false; }
        if (d.from > d.to) { toast('The first month must come before the last.'); return false; }
        var k = d.from, n = 0;
        while (k <= d.to && n < 240) { S.expenses.push({ id: C.uid(), date: k + '-' + C.pad(Math.min(Math.max(+d.day || 1, 1), Money.lastDay(k))), category: d.category, flatId: d.flatId, description: d.description, amount: +d.amount, method: '' }); k = C.addMonths(k, 1); n++; }
        expMonth = d.to; toast(n + ' expense(s) added.');
      } });
  }
  function billForm(id) {
    var b = id ? S.bills.find(function (x) { return x.id === id; }) : null;
    openForm({ title: b ? 'Edit recurring bill' : 'New recurring bill', intro: 'It is added to expenses by itself, on its day, each period.', del: b ? function () { S.bills = S.bills.filter(function (x) { return x.id !== id; }); } : null,
      fields: [{ name: 'name', label: 'Name', required: true, full: true, hint: 'e.g. Building service charge' }, { name: 'amount', label: 'Amount', type: 'number', step: '0.01', min: 0, required: true }, { name: 'freq', label: 'How often', type: 'select', options: [['monthly', 'Every month'], ['quarterly', 'Every 3 months'], ['yearly', 'Every year']] },
        { name: 'category', label: 'Category', type: 'select', options: EXP_CATS.map(function (c) { return [c, c]; }) }, { name: 'flatId', label: 'Flat', type: 'select', options: flatOptions(), required: true },
        { name: 'day', label: 'On day', type: 'number', min: 1, max: 31 }, { name: 'start', label: 'Starting', type: 'date', required: true },
        { name: 'count', label: 'Number of payments (loan term, optional)', type: 'number', min: 1, more: true, hint: 'Fills in the end date for you.' }, { name: 'end', label: 'Ends / paid off on (optional)', type: 'date', more: true }, { name: 'active', label: 'Status', type: 'select', options: [['yes', 'Active'], ['no', 'Paused'], ['closed', 'Closed: loan paid off']], hint: 'Choose Closed when the last payment is made. Nothing more is added.' }],
      values: b ? Object.assign({}, b, { active: b.active === false ? (b.end ? 'closed' : 'no') : 'yes' }) : { flatId: defFlat(expFlat), freq: 'monthly', day: 1, start: today().slice(0, 7) + '-01', category: EXP_CATS[0], active: 'yes' },
      onSave: function (d) {
        if (!(+d.amount > 0)) { toast('Enter the amount.'); return false; }
        var o = b || { id: C.uid() }; Object.assign(o, { name: d.name, amount: +d.amount, freq: d.freq, category: d.category, flatId: d.flatId, day: Math.min(31, Math.max(1, +d.day || 1)), start: d.start, end: d.end, active: d.active === 'yes' });
        if (+d.count > 0 && d.start && !d.end) { var stp = { monthly: 1, quarterly: 3, yearly: 12 }[d.freq] || 1; o.end = C.addMonths(d.start.slice(0, 7), (Math.round(+d.count) - 1) * stp) + '-' + C.pad(o.day); }
        if (d.active === 'closed') { o.active = false; if (!o.end) o.end = today(); }
        if (d.active === 'no') o.end = d.end || '';
        if (!b) S.bills.push(o); postBills();
      } });
  }
  function postBills() { var add = Money.billExpenses(S, today()); add.forEach(function (e) { S.expenses.push(e); }); return add.length > 0; }

  /* ---------- amend the plan, settle dues, change rent ---------- */
  function monthSheet(rid, key) {
    var r = rentalById(rid), d = C.schedule(r, today(), grace()).find(function (x) { return x.key === key; }); if (!d) return;
    var pl = (r.plan || {})[key] || {}, pays = (r.payments || []).filter(function (p) { return p.key === key; });
    openDlg('<h3>' + esc(C.monthLabel(key)) + '</h3><p class="muted small" style="margin:6px 0 0">' + esc(flatOf(r).name) + ' · ' + esc(r.tenant.name) + '</p><form id="mf" novalidate><div class="fgrid">' +
      fieldHTML({ name: 'amount', label: 'Rent due this month', type: 'number', step: '0.01', min: 0 }, { amount: d.amount }) + fieldHTML({ name: 'dueDate', label: 'Due date', type: 'date' }, { dueDate: d.dueDate }) +
      fieldHTML({ name: 'note', label: 'Note (optional)', full: true, hint: 'e.g. agreed to pay half now and half next month' }, { note: pl.note || '' }) + '</div>' +
      (pays.length ? '<div class="small" style="margin-top:14px"><b>Payments</b></div>' + pays.map(function (p) { return '<div class="row between small" style="padding:6px 0;border-bottom:1px solid var(--line)"><span>' + esc(C.shortDate(p.date)) + ' · ' + esc(p.method || '') + (p.ref ? ' · ' + esc(p.ref) : '') + '</span><span><b>' + money(p.amount) + '</b> <button type="button" class="btn sm ghost" data-act="delPay" data-r="' + r.id + '" data-p="' + p.id + '">Remove</button></span></div>'; }).join('') : '') +
      '<div class="foot"><button type="button" class="btn ghost" data-act="settleMonth" data-r="' + r.id + '" data-k="' + key + '">Settle without payment…</button><button class="btn" type="submit">Save</button></div></form>');
    $('#mf').addEventListener('submit', function (ev) {
      ev.preventDefault(); var f = ev.target.elements, amt = +f.amount.value, due = f.dueDate.value, note = f.note.value.trim();
      if (amt === d.amount && due === d.dueDate && note === (pl.note || '')) { closeDlg(); return; }
      r.plan = Object.assign({}, r.plan || {}); r.plan[key] = { amount: amt, dueDate: due, note: note };
      save(); closeDlg(); render(); toast('Month updated.');
    });
  }
  function settleMonth(rid, key) {
    var r = rentalById(rid), d = C.schedule(r, today(), grace()).find(function (x) { return x.key === key; }); if (!d || d.balance <= 0) { toast('Nothing left to settle for this month.'); return; }
    openForm({ title: 'Settle ' + C.monthLabel(key) + ' without payment', intro: 'Use this when you agree to let the balance go (waived or settled another way). It is not counted as income.', submit: 'Settle',
      fields: [{ name: 'amount', label: 'Amount to settle', type: 'number', step: '0.01', min: 0, required: true }, { name: 'ref', label: 'Reason', full: true, hint: 'e.g. waived as agreed' }], values: { amount: d.balance, ref: '' },
      onSave: function (x) { if (!(+x.amount > 0)) { toast('Enter an amount.'); return false; } r.payments.push({ id: C.uid(), key: key, amount: Math.min(+x.amount, d.balance), date: today(), method: 'Settled', ref: x.ref, waived: true }); } });
  }
  function settleAll(rid) {
    var r = rentalById(rid), t = today(), ds = C.schedule(r, t, grace()).filter(function (d) { return d.balance > 0 && d.dueDate <= t; });
    if (!ds.length) { toast('No unpaid rent to settle.'); return; }
    var tot = ds.reduce(function (s, d) { return s + d.balance; }, 0);
    openForm({ title: 'Settle all unpaid rent', intro: ds.length + ' month(s), ' + money(tot) + ' in total, will be marked settled without payment. It is not counted as income.', submit: 'Settle all',
      fields: [{ name: 'ref', label: 'Reason', full: true, hint: 'e.g. waived as agreed' }], values: {},
      onSave: function (x) { ds.forEach(function (d) { r.payments.push({ id: C.uid(), key: d.key, amount: d.balance, date: t, method: 'Settled', ref: x.ref, waived: true }); }); } });
  }
  function changeRentForm(rid) {
    var r = rentalById(rid);
    openForm({ title: 'Change the rent', intro: 'New rent from a month on. Earlier months stay as they were. For one month only, use the ⋯ button on that month.', submit: 'Change rent',
      fields: [{ name: 'from', label: 'From', type: 'date', required: true, hint: 'Any date in the first month it applies to.' }, { name: 'rent', label: 'New monthly rent', type: 'number', step: '0.01', min: 0, required: true }], values: { from: today().slice(0, 7) + '-01', rent: r.rent },
      onSave: function (d) { if (!(+d.rent >= 0)) return false; var k = d.from.slice(0, 7) + '-01'; r.revisions = (r.revisions || []).filter(function (x) { return x.from.slice(0, 7) !== k.slice(0, 7); }).concat([{ from: k, rent: +d.rent }]); } });
  }

  /* ---------- end of tenancy: deposit settled against unpaid rent, or forfeited when leaving early ---------- */
  function endForm(rid) {
    var r = rentalById(rid), t = today(), ended = r.end && r.end <= t;
    openDlg('<h3>' + (ended ? 'Settle the deposit' : 'End tenancy') + '</h3><p class="muted small" style="margin:6px 0 0">' + esc(flatOf(r).name) + ' · ' + esc(r.tenant.name) + '</p><form id="ef" novalidate><div class="fgrid">' +
      fieldHTML({ name: 'leave', label: 'Tenant leaves on', type: 'date', full: true }, { leave: ended ? r.end : t }) +
      ((+r.deposit > 0 && !r.depositReceived) ? '<div class="notice" style="grid-column:1/-1">The deposit of ' + money(r.deposit) + ' was never marked as received, so nothing is held against the rent. If it was paid, close this and use Mark received first.</div>' : '') + (+r.deposit > 0 && r.depositReceived ? fieldHTML({ name: 'ded', label: 'Deductions (damage, cleaning)', type: 'number', step: '0.01', min: 0 }, { ded: '' }) + fieldHTML({ name: 'dedLabel', label: 'For' }, { dedLabel: '' }) : '') + '</div>' +
      '<label class="chk hide" id="forfRow"><input type="checkbox" name="forfeit" checked> <span>Left before the agreed end date: the deposit is forfeited</span></label><div class="sumbox" id="sum"></div>' +
      '<div class="foot"><button type="button" class="btn ghost" data-act="close">Cancel</button><button class="btn" type="submit">' + (ended ? 'Settle' : 'End tenancy') + '</button></div></form>');
    var form = $('#ef');
    function opts() { var f = form.elements; return { forfeit: f.forfeit.checked, deductions: f.ded && +f.ded.value > 0 ? [{ label: (f.dedLabel.value || 'Deductions').trim(), amount: +f.ded.value }] : [] }; }
    function calc() {
      var f = form.elements, leave = f.leave.value || t, s = Money.settleDeposit(r, leave, t, grace(), opts()), rows = [];
      $('#forfRow').classList.toggle('hide', !(s.early && s.deposit > 0));
      if (s.owed > 0) rows.push(['Unpaid rent up to ' + C.shortDate(leave), money(s.owed)]);
      if (s.deposit > 0) {
        rows.push(['Security deposit held', money(s.deposit)]);
        if (s.appliedTotal > 0) rows.push(['Settled against unpaid rent', money(s.appliedTotal)]);
        if (s.forfeit) rows.push(['Forfeited (left before ' + C.shortDate(r.agreedEnd || r.end) + ')', money(s.forfeited)]);
        else { if (s.kept > 0) rows.push(['Kept for deductions', money(s.kept)]); rows.push(['Return to tenant', money(s.refund)]); }
      }
      if (s.shortfall > 0) rows.push(['Still owed by tenant', money(s.shortfall)]);
      if (s.extraOwed > 0) rows.push(['Charges beyond the deposit', money(s.extraOwed)]);
      $('#sum').innerHTML = rows.length ? '<table><tbody>' + rows.map(function (x) { return '<tr><td>' + esc(x[0]) + '</td><td class="r"><b>' + x[1] + '</b></td></tr>'; }).join('') + '</tbody></table>' : '<span class="muted small">No unpaid rent and no deposit to settle.</span>';
    }
    form.addEventListener('input', calc); form.addEventListener('change', calc); calc();
    form.addEventListener('submit', function (ev) {
      ev.preventDefault(); var f = form.elements, leave = f.leave.value || t;
      if (leave < r.start) { toast('That is before the start date.'); return; }
      var o = opts(), s = Money.settleDeposit(r, leave, t, grace(), o);
      if (!r.agreedEnd && r.end) r.agreedEnd = r.end;
      r.end = leave;
      var note = 'Tenancy ended on ' + C.longDate(leave) + '.';
      if (s.deposit > 0) {
        s.applied.forEach(function (a) { r.payments.push({ id: C.uid(), key: a.key, amount: a.amount, date: leave, method: 'Deposit', ref: 'Settled from security deposit' }); });
        r.depositSettlement = { date: leave, deposit: s.deposit, owed: s.owed, applied: s.appliedTotal, early: s.early, forfeit: s.forfeit, forfeited: s.forfeited, deductions: o.deductions, kept: s.kept, refund: s.refund, shortfall: s.shortfall, extraOwed: s.extraOwed };
        note += ' Deposit ' + money(s.deposit) + ': ' + money(s.appliedTotal) + ' against rent' + (s.forfeit ? ', ' + money(s.forfeited) + ' forfeited' : ', ' + money(s.refund) + ' to return') + '.';
      }
      r.followups.push({ id: C.uid(), date: t, channel: 'Note', note: note, key: '' });
      save(); closeDlg(); render(); toast(s.deposit > 0 ? 'Deposit settled.' : 'Tenancy ended.');
    });
  }
  function settleMessage(r) {
    var s = r.depositSettlement, L = ['Hello ' + firstName(r.tenant.name) + ', here is the settlement of your security deposit for ' + flatOf(r).name + ':', '', 'Deposit held: ' + money(s.deposit)];
    if (s.applied > 0) L.push('Unpaid rent settled from it: ' + money(s.applied));
    if (s.forfeit) L.push('Deposit forfeited (the tenancy ended before the agreed end date of ' + C.longDate(r.agreedEnd || r.end) + '): ' + money(s.forfeited));
    else { (s.deductions || []).forEach(function (x) { L.push((x.label || 'Deductions') + ': ' + money(x.amount)); }); L.push('Amount returned to you: ' + money(s.refund)); }
    if (s.shortfall > 0) L.push('Rent still owed: ' + money(s.shortfall));
    if (s.extraOwed > 0) L.push('Charges beyond the deposit: ' + money(s.extraOwed));
    L.push('', S.settings.landlord.name || ''); return L.join('\n').trim();
  }
  function settleSheet(rid) { var r = rentalById(rid); remCtx = { r: r, info: true, label: 'Deposit settlement sent' }; remindSheet2(r, null, settleMessage(r), 'Send the deposit settlement'); }

  function viewMore() {
    return '<div class="pagehead"><h1>More</h1></div><div class="stack"><a class="card row between" href="#/agreements" style="text-decoration:none;color:inherit"><span><b>Agreements</b><br><span class="muted small">Draft, sign and send rental agreements</span></span><span>›</span></a><a class="card row between" href="#/settings" style="text-decoration:none;color:inherit"><span><b>Settings</b><br><span class="muted small">Your details, messages, Google Sheet sync, backup</span></span><span>›</span></a></div>' + (cfg.url ? '<p class="muted small" style="margin-top:16px"><span class="syncchip"></span></p>' : '');
  }

  /* ---------- routing ---------- */
  function render() {
    var parts = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('/'), page = parts[0], html, on = page;
    try {
      if (page === 'flats') html = viewFlats('');
      else if (page === 'flat') { html = viewFlats(parts[1], parts[2]); on = 'flats'; }
      else if (page === 'rental') { var rr = rentalById(parts[1]); html = viewFlats(rr ? rr.flatId : '', parts[1]); on = 'flats'; }
      else if (page === 'payments') html = viewPayments();
      else if (page === 'expenses') html = viewExpenses();
      else if (page === 'dashboard') html = viewDashboard();
      else if (page === 'more') html = viewMore();
      else if (page === 'agreements') html = viewAgreements();
      else if (page === 'agreement') { html = viewAgreement(parts[1]); on = 'agreements'; }
      else if (page === 'settings') html = viewSettings();
      else { html = viewDashboard(); on = 'dashboard'; }
    } catch (e) { console.error(e); html = '<div class="card empty"><h3>Something went wrong</h3><p>' + esc(e.message) + '</p><a class="btn" href="#/dashboard">Go to Dashboard</a></div>'; }
    var tabOn = (on === 'agreements' || on === 'settings') ? 'more' : on;
    $('#main').innerHTML = html;
    var link = function (n, cur) { return '<a href="#/' + n[0] + '" class="' + (cur === n[0] ? 'on' : '') + '">' + svg(n[2]) + '<span>' + n[1] + '</span></a>'; };
    $('#tabbar').innerHTML = NAV.map(function (n) { return link(n, tabOn); }).join('');
    $('#side').innerHTML = '<div class="logo">RENT DESK</div>' + SIDE.map(function (n) { return link(n, on); }).join('') + '<div class="grow"></div><div class="tiny muted" style="padding:0 12px"><span class="syncchip"></span><br>' + (cfg.url ? 'Also saved in your Google Sheet.' : 'Saved on this device. Back up in Settings.') + '</div>';
    if (page === 'flats' || page === 'flat' || page === 'rental') applyFlatQ();
    var sf = $('#setf'); if (sf) sf.addEventListener('submit', saveSettings);
    var yf = $('#syncf'); if (yf) yf.addEventListener('submit', connectSheet);
    paintSync();
  }
  window.addEventListener('hashchange', function () { showAll = false; render(); window.scrollTo(0, 0); });

  /* ---------- forms ---------- */
  function flatForm(id) {
    var f = S.flats.find(function (x) { return x.id === id; }) || {};
    openForm({ title: id ? 'Edit flat' : 'Add a flat', fields: [{ name: 'name', label: 'Flat name', required: true, full: true, hint: 'How you refer to it, e.g. "Flat 3B, Rue des Lilas"' }, { name: 'address', label: 'Full address', full: true, type: 'textarea', rows: 2 }, { name: 'furnishing', label: 'Furnishing or inclusions (optional)', full: true, hint: 'e.g. "fully furnished, with parking space 14"' }, { name: 'info', label: 'Flat information for the tenant', type: 'textarea', rows: 7, full: true, hint: 'One item per line, e.g. "Electricity meter code: 4821", "Gas meter: cellar, code 77", "Caretaker: Paul +33 6 00 00 00 00", "Wi-Fi: name / password". You can send it to the tenant on move-in, or any time they lose it.' }], values: f,
      onSave: function (d) { if (id) Object.assign(f, d); else { var nf = { id: C.uid(), name: d.name, address: d.address, furnishing: d.furnishing, info: d.info }; S.flats.push(nf); setTimeout(function () { toast('Flat added. Now set up its rental.'); }, 50); } } });
  }
  function rentalForm(id, flatId, copyFrom) {
    var base = id ? rentalById(id) : copyFrom || null, t = today();
    if (!S.flats.length) { toast('Add a flat first.'); return flatForm(); }
    var prev = !base && flatId ? flatRentals({ id: flatId })[0] : null;
    var tkn = base ? tokenOf(base) : null;
    var v = base ? { depositReceived: copyFrom ? '' : (base.depositReceived || ''), tokenAmt: tkn && !copyFrom ? tkn.amount : '', tokenDate: tkn && !copyFrom ? tkn.date : '', flatId: base.flatId, tname: base.tenant.name, tphone: base.tenant.phone, temail: base.tenant.email, tid: base.tenant.idNo, taddr: base.tenant.address, start: copyFrom ? C.addDays(copyFrom.end || t, 1) : base.start, end: copyFrom ? '' : base.end, rent: base.rent, dueDay: base.dueDay, deposit: base.deposit, noticeDays: base.noticeDays, escalation: base.escalation, trackFrom: copyFrom ? '' : base.trackFrom, utilities: base.utilities, extra: base.extra, pref: base.pref } : { flatId: flatId || S.flats[0].id, start: prev ? t : '', rent: prev ? prev.rent : '', dueDay: prev ? prev.dueDay : 1, noticeDays: prev ? prev.noticeDays : 30, escalation: prev ? prev.escalation : 0, deposit: prev ? prev.deposit : 0, tokenDate: t, pref: 'wa' };
    openForm({ title: id ? 'Edit rental' : copyFrom ? 'Renew rental' : 'New rental', intro: 'This holds the basics of the rental agreement. The agreement and the follow-up dates are made from it.', submit: id ? 'Save' : 'Create rental',
      fields: [
        { name: 'flatId', label: 'Flat', type: 'select', options: S.flats.map(function (f) { return [f.id, f.name]; }), full: true },
        { name: 'tname', label: 'Tenant full name', required: true }, { name: 'tphone', label: 'Tenant phone', type: 'tel' }, { more: true, name: 'temail', label: 'Tenant email (optional)', type: 'email' }, { more: true, name: 'tid', label: 'Tenant ID number (optional)' },
        { more: true, name: 'taddr', label: 'Tenant\'s own address (optional)', full: true, hint: 'Their permanent address, used in the agreement.' },
        { name: 'start', label: 'Rental starts', type: 'date', required: true }, { name: 'end', label: 'Rental ends', type: 'date', hint: 'Leave empty if open-ended.' },
        { name: 'rent', label: 'Monthly rent', type: 'number', step: '0.01', min: 0, required: true }, { name: 'dueDay', label: 'Rent due on day', type: 'number', min: 1, max: 31, required: true, hint: 'Day of the month, 1 to 31.' },
        { name: 'deposit', label: 'Security deposit', type: 'number', step: '0.01', min: 0 }, { name: 'depositReceived', label: 'Deposit received on', type: 'date', hint: 'Leave empty until it is paid. You can also use Mark received later.' }, { name: 'tokenAmt', label: 'Token / advance received', type: 'number', step: '0.01', min: 0, hint: 'Booking money paid before moving in. It is taken off the first rent.' }, { name: 'tokenDate', label: 'Token received on', type: 'date' }, { more: true, name: 'noticeDays', label: 'Notice period (days)', type: 'number', min: 0 },
        { more: true, name: 'escalation', label: 'Yearly rent increase (%)', type: 'number', step: '0.1', min: 0 },
        { more: true, name: 'trackFrom', label: 'Start tracking payments from', type: 'date', full: true, hint: 'Already renting for a while? Pick the first month you want followed up. Empty means this month, or the start date if later.' },
        { more: true, name: 'utilities', label: 'Utilities and charges (optional)', type: 'textarea', rows: 2, full: true, hint: 'Who pays what. Empty uses the standard sentence.' },
        { more: true, name: 'extra', label: 'Additional terms (optional)', type: 'textarea', rows: 2, full: true }
      ], values: v,
      onSave: function (d) {
        if (d.end && d.end < d.start) { toast('The end date is before the start date.'); return false; }
        var monthStart = t.slice(0, 7) + '-01', tf = d.trackFrom || (d.start > monthStart ? d.start : monthStart);
        var o = id ? base : { id: C.uid(), payments: [], followups: [], agreement: { status: 'none' } };
        Object.assign(o, { flatId: d.flatId, tenant: { name: d.tname, phone: d.tphone, email: d.temail, idNo: d.tid, address: d.taddr }, start: d.start, end: d.end, rent: +d.rent, dueDay: +d.dueDay, deposit: +d.deposit || 0, depositReceived: (+d.deposit > 0 && d.depositReceived) ? d.depositReceived : '', noticeDays: +d.noticeDays || 30, escalation: +d.escalation || 0, trackFrom: tf, utilities: d.utilities, extra: d.extra, pref: d.pref });
        o.payments = (o.payments || []).filter(function (p) { return p.method !== 'Token'; });
        if (+d.tokenAmt > 0) {
          var rem = +d.tokenAmt, dd = C.buildDues(Object.assign({}, o, { trackFrom: '' }), t);
          dd.forEach(function (x) { if (rem <= 0) return; var a = Math.min(rem, x.amount); if (a > 0) { o.payments.push({ id: C.uid(), key: x.key, amount: C.round2(a), date: d.tokenDate || t, method: 'Token', ref: 'Token settled against rent' }); rem = C.round2(rem - a); } });
          if (rem > 0 && dd.length) o.payments.push({ id: C.uid(), key: dd[dd.length - 1].key, amount: rem, date: d.tokenDate || t, method: 'Token', ref: 'Token settled against rent' });
        }
        if (!id) { S.rentals.push(o); location.hash = '#/rental/' + o.id; }
      } });
  }
  function payForm(rid, key) {
    var r = rentalById(rid), ds = C.schedule(r, today(), grace()).filter(function (d) { return d.status !== 'paid' && d.status !== 'future'; });
    if (key && !ds.some(function (d) { return d.key === key; })) { var kd = C.schedule(r, today(), grace()).find(function (d) { return d.key === key; }); if (kd) ds.push(kd); }
    if (!ds.length) { toast('Nothing is waiting for payment.'); return; }
    var sel = ds.find(function (d) { return d.key === key; }) || ds[0], bal = {}; ds.forEach(function (d) { bal[d.key] = d.balance; });
    openForm({ title: 'Record a payment', intro: flatOf(r).name + ' · ' + r.tenant.name, submit: 'Save payment',
      fields: [{ name: 'key', label: 'Rent for', type: 'select', options: ds.map(function (d) { return [d.key, C.monthLabel(d.key) + ' (' + money(d.balance) + ' left)']; }), full: true }, { name: 'amount', label: 'Amount received', type: 'number', step: '0.01', min: 0, required: true }, { name: 'date', label: 'Date received', type: 'date', required: true },
        { name: 'method', label: 'Paid by', type: 'select', more: true, options: [['Bank transfer', 'Bank transfer'], ['Cash', 'Cash'], ['Cheque', 'Cheque'], ['Card', 'Card'], ['Other', 'Other']] }, { name: 'ref', label: 'Reference (optional)', more: true }],
      values: { key: sel.key, amount: sel.balance, date: today(), method: 'Bank transfer' },
      onSave: function (d) { if (!(+d.amount > 0)) { toast('Enter the amount received.'); return false; } r.payments.push({ id: C.uid(), key: d.key, amount: +d.amount, date: d.date, method: d.method, ref: d.ref }); toast('Payment saved.'); } });
    var form = $('#frm'); form.elements.key.addEventListener('change', function () { form.elements.amount.value = bal[form.elements.key.value]; });
  }
  /* Record many past months at once (e.g. last year's rent, all paid on time). */
  function bulkPayForm(rid) {
    var r = rentalById(rid), t = today();
    var rows = C.schedule(Object.assign({}, r, { trackFrom: '' }), t, grace()).filter(function (d) { return d.status !== 'paid' && d.dueDate <= t; });
    if (!rows.length) { toast('Every month up to now is already paid.'); return; }
    openDlg('<h3>Record past payments</h3><p class="muted small" style="margin:6px 0 0">' + esc(flatOf(r).name) + ' · ' + esc(r.tenant.name) + '. Tick the months that were paid. Change the amount or date where it was different. Months you leave unticked will show as unpaid.</p>' +
      '<form id="bulkf" novalidate><div class="btns" style="margin:14px 0 6px"><button type="button" class="btn sm ghost" data-act="bulkAll" data-v="1">Tick all</button><button type="button" class="btn sm ghost" data-act="bulkAll" data-v="0">Untick all</button></div>' +
      '<div class="brow bhead"><span></span><span>Month</span><span>Amount</span><span>Date received</span></div>' +
      rows.map(function (d) { return '<div class="brow"><input type="checkbox" name="ck_' + d.key + '" checked aria-label="' + esc(C.monthLabel(d.key)) + ' paid"><span>' + esc(C.monthLabel(d.key)) + '</span><input type="number" step="0.01" min="0" name="am_' + d.key + '" value="' + d.balance + '" aria-label="Amount"><input type="date" name="dt_' + d.key + '" value="' + d.dueDate + '" aria-label="Date received"></div>'; }).join('') +
      '<label for="bm">Paid by</label><select id="bm" name="method"><option>Bank transfer</option><option>Cash</option><option>Cheque</option><option>Card</option><option>Other</option></select>' +
      '<div class="foot"><button type="button" class="btn ghost" data-act="close">Cancel</button><button class="btn" type="submit">Save payments</button></div></form>');
    $('#bulkf').addEventListener('submit', function (ev) {
      ev.preventDefault(); var f = ev.target.elements, n = 0, first = '';
      rows.forEach(function (d) {
        if (!f['ck_' + d.key].checked) return;
        var amt = +f['am_' + d.key].value; if (!(amt > 0)) return;
        r.payments.push({ id: C.uid(), key: d.key, amount: amt, date: f['dt_' + d.key].value || d.dueDate, method: f.method.value, ref: 'Past record' }); n++;
        if (!first || d.key < first) first = d.key;
      });
      if (!n) { toast('Tick at least one month.'); return; }
      if (first && (!r.trackFrom || first < r.trackFrom.slice(0, 7))) r.trackFrom = first + '-01';
      save(); closeDlg(); render(); toast(n + (n === 1 ? ' payment' : ' payments') + ' saved.');
    });
  }
  function logForm(rid, key) {
    var r = rentalById(rid);
    openForm({ title: 'Log a follow-up', intro: flatOf(r).name + ' · ' + r.tenant.name, fields: [{ name: 'channel', label: 'How', type: 'select', options: [['Phone call', 'Phone call'], ['WhatsApp', 'WhatsApp'], ['Email', 'Email'], ['In person', 'In person'], ['Note', 'Note']] }, { name: 'date', label: 'Date', type: 'date' }, { name: 'note', label: 'What was said', type: 'textarea', rows: 3, full: true }, { name: 'promiseDate', label: 'Tenant promised to pay by (optional)', type: 'date', full: true, hint: 'The payment moves down your list until this date.' }],
      values: { channel: 'Phone call', date: today() }, onSave: function (d) { r.followups.push({ id: C.uid(), date: d.date || today(), channel: d.channel, note: d.note, promiseDate: d.promiseDate, key: key }); } });
  }
  var remCtx = null;
  function remindSheet(rid, key) {
    var r = rentalById(rid), d = C.schedule(r, today(), grace()).find(function (x) { return x.key === key; }); if (!d) return;
    remCtx = { r: r, d: d };
    return remindSheet2(r, d, reminderText(r, d));
  }
  function reminderText(r, d) {
    var s = S.settings, late = d.status === 'overdue' || d.status === 'due';
    return C.fill(late ? (s.msgLate || DEFAULT_LATE) : (s.msgSoon || DEFAULT_SOON), { tenant: firstName(r.tenant.name), flat: flatOf(r).name, amount: money(d.balance), period: C.monthLabel(d.key), dueDate: C.longDate(d.dueDate), daysLate: d.daysLate, payInfo: s.payInfo, landlord: s.landlord.name }).replace(/ +\n/g, '\n').replace(/ {2,}/g, ' ').trim();
  }
  /* one tap from the dashboard: open WhatsApp with the standard reminder ready (nothing is sent until you press send there) */
  function waNow(rid, key) {
    var r = rentalById(rid), d = C.schedule(r, today(), grace()).find(function (x) { return x.key === key; }); if (!d) return;
    remCtx = { r: r, d: d }; sendMsg('wa', reminderText(r, d));
  }
  function infoSheet(rid) {
    var r = rentalById(rid), f = flatOf(r);
    if (!(f.info || '').trim()) { toast('Add the flat information first (Flats, then Edit).'); return; }
    var msg = 'Hello ' + firstName(r.tenant.name) + ', welcome to ' + f.name + '! Here is the information you may need:\n\n' + f.info.trim() + '\n\n' + (S.settings.landlord.name || '');
    remCtx = { r: r, info: true };
    remindSheet2(r, null, msg.trim(), 'Send the flat information', 'Keep this message. It is saved in the follow-up log when you send it.');
  }
  function remindSheet2(r, d, msg, title, hintText) {
    var pref = r.pref || 'wa', btn = function (k, label) { return '<button class="btn sm ' + (pref === k ? '' : 'ghost') + '" data-act="sendMsg" data-ch="' + k + '">' + label + '</button>'; };
    openDlg('<h3>' + esc(title || 'Send a reminder') + '</h3><p class="muted small" style="margin:6px 0 0">' + esc(flatOf(r).name) + ' · ' + esc(r.tenant.name) + (d ? ' · ' + esc(C.monthLabel(d.key)) : '') + '</p><label for="msgbox">Message (you can change it)</label><textarea id="msgbox" rows="9">' + esc(msg) + '</textarea>' +
      '<div class="btns" style="margin-top:14px">' + btn('wa', 'Open WhatsApp') + btn('copy', 'Copy') + '</div><p class="hint">WhatsApp opens with the message ready: nothing is sent until you press send there. It is saved in the follow-up log.</p><div class="foot"><button class="btn ghost" data-act="close">Close</button></div>');
  }
  function sendMsg(ch, preMsg) {
    var r = remCtx.r, d = remCtx.d || { key: '' }, info = !!remCtx.info, msg = preMsg !== undefined ? preMsg : $('#msgbox').value, T = r.tenant, ph = C.phoneDigits(T.phone, S.settings.countryCode), name = { wa: 'WhatsApp', copy: 'Copy' }[ch];
    if (ch === 'wa') { if (!ph) return toast('Add a phone number for this tenant first.'); window.open('https://wa.me/' + ph + '?text=' + encodeURIComponent(msg), '_blank', 'noopener'); }
    else { try { navigator.clipboard.writeText(msg); toast('Message copied.'); } catch (e) { toast('Could not copy. Select the text and copy it.'); return; } }
    if (ch !== 'copy') { r.followups.push({ id: C.uid(), date: today(), channel: name, note: info ? (remCtx.label || 'Flat information sent') : 'Reminder sent for ' + C.monthLabel(d.key), key: d.key }); save(); render(); }
  }

  function connectSheet(e) {
    e.preventDefault(); var f = e.target.elements, url = f.url.value.trim(), pin = f.pin.value.trim();
    if (!/^(https:\/\/|http:\/\/localhost)/.test(url)) return toast('Paste the Web app URL (it starts with https://).');
    if (!pin) return toast('Enter the PIN you set in the script.');
    var old = cfg; cfg = { url: url, pin: pin, rev: -1, dirty: true, last: 0 }; toast('Connecting…');
    callSheet({ op: 'ping' }).then(function () { saveCfg(); return syncNow(true); }).then(function () { if (!syncErr) toast('Connected and synced.'); render(); })
      .catch(function (err) { cfg = old; toast(/PIN/.test(err.message) ? err.message : 'Could not connect: check the URL, and that access is set to Anyone.'); });
  }
  function saveSettings(e) {
    e.preventDefault(); var f = e.target.elements, s = S.settings;
    s.landlord = Object.assign(s.landlord, { name: f.lname.value.trim(), phone: f.lphone.value.trim(), email: f.lemail.value.trim(), idNo: f.lid.value.trim(), address: f.laddr.value.trim() });
    s.currency = f.currency.value.trim(); s.countryCode = f.cc.value.trim(); s.graceDays = Math.max(0, +f.grace.value || 0); s.city = f.city.value.trim(); s.governingLaw = f.law.value.trim(); s.payInfo = f.payInfo.value.trim();
    s.msgSoon = f.msgSoon.value.trim() === DEFAULT_SOON ? '' : f.msgSoon.value.trim(); s.msgLate = f.msgLate.value.trim() === DEFAULT_LATE ? '' : f.msgLate.value.trim();
    s.template = f.template.value.trim() === A.DEFAULT_TEMPLATE ? '' : f.template.value.trim();
    save(); toast('Settings saved.');
  }

  /* ---------- agreements: pdf, send, signatures ---------- */
  function buildPdf(r) {
    var ag = r.agreement || {}, L = S.settings.landlord;
    return PDF.build({ blocks: A.toBlocks(agText(r)), footer: 'Rental agreement · ' + flatOf(r).name + ' · ' + r.tenant.name,
      sign: { left: { role: 'Landlord', name: L.name, img: ag.sigL, date: ag.sigLDate ? C.longDate(ag.sigLDate) : '' }, right: { role: 'Tenant', name: r.tenant.name, img: ag.sigT, date: ag.sigTDate ? C.longDate(ag.sigTDate) : '' } } });
  }
  function pdfName(r) { return safeName('Rental agreement - ' + flatOf(r).name + ' - ' + r.tenant.name) + '.pdf'; }
  function sendSheet(rid) {
    var r = rentalById(rid), T = r.tenant, msg = C.fill(DEFAULT_SEND, { tenant: firstName(T.name), flat: flatOf(r).name, landlord: S.settings.landlord.name }).replace(/ +/g, ' ').trim();
    remCtx = { r: r };
    openDlg('<h3>Send the agreement draft</h3><p class="muted small" style="margin:6px 0 0">To ' + esc(T.name) + (T.phone ? ' · ' + esc(T.phone) : '') + (T.email ? ' · ' + esc(T.email) : '') + '</p><label for="msgbox">Message</label><textarea id="msgbox" rows="4">' + esc(msg) + '</textarea>' +
      '<div class="btns" style="margin-top:14px"><button class="btn sm" data-act="sendAgVia" data-ch="share">Share the PDF…</button><button class="btn sm ghost" data-act="sendAgVia" data-ch="wa">WhatsApp</button></div>' +
      '<p class="hint"><strong>Share the PDF</strong> attaches the file directly on phones and recent browsers. With WhatsApp the PDF is saved to your Downloads first, then WhatsApp opens with the message: attach the file there. Nothing is sent until you press send. After you choose, the agreement is marked as sent.</p><div class="foot"><button class="btn ghost" data-act="close">Close</button></div>');
  }
  function sendAgVia(ch) {
    var r = remCtx.r, T = r.tenant, msg = $('#msgbox').value, blob = buildPdf(r), name = pdfName(r), ph = C.phoneDigits(T.phone, S.settings.countryCode), ag = r.agreement;
    function sent(how) { if (ag.status !== 'signed') { ag.status = 'sent'; ag.sentAt = today(); } r.followups.push({ id: C.uid(), date: today(), channel: how, note: 'Agreement sent', key: '' }); save(); closeDlg(); render(); toast('Marked as sent.'); }
    if (ch === 'share') {
      var file = new File([blob], name, { type: 'application/pdf' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { navigator.share({ files: [file], title: name, text: msg }).then(function () { sent('Share'); }).catch(function () { /* cancelled */ }); }
      else { download(blob, name); toast('Sharing files is not supported here. The PDF was downloaded: attach it yourself.'); }
      return;
    }
    if (ch === 'wa') { if (!ph) return toast('Add a phone number for this tenant first.'); download(blob, name); window.open('https://wa.me/' + ph + '?text=' + encodeURIComponent(msg), '_blank', 'noopener'); sent('WhatsApp'); }

  }

  var sigCtx = null;
  function sigSheet(rid, who) {
    var r = rentalById(rid), isL = who === 'L', saved = isL && S.settings.landlord.sig;
    openDlg('<h3>' + (isL ? 'Landlord' : 'Tenant') + ' signature</h3><p class="muted small" style="margin:6px 0 10px">Sign with a finger or the mouse. The signature is added to the agreement and its PDF.</p><canvas id="sigc" class="sigcanvas"></canvas>' +
      '<div class="foot"><button class="btn ghost" data-act="sigClear">Clear</button>' + (saved ? '<button class="btn ghost" data-act="sigUseSaved">Use my saved signature</button>' : '') + ((r.agreement || {})[isL ? 'sigL' : 'sigT'] ? '<button class="btn danger" data-act="sigRemove">Remove</button>' : '') + '<button class="btn ghost" data-act="close">Cancel</button><button class="btn" data-act="sigSave">Save signature</button></div>');
    var c = $('#sigc'), ratio = window.devicePixelRatio || 1; c.width = c.clientWidth * ratio; c.height = c.clientHeight * ratio;
    var g = c.getContext('2d'); g.scale(ratio, ratio); g.lineWidth = 2.4; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#1b2a6b';
    sigCtx = { r: r, who: who, c: c, g: g, drawn: false }; var down = false;
    function pt(e) { var b = c.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; }
    c.addEventListener('pointerdown', function (e) { down = true; c.setPointerCapture(e.pointerId); var p = pt(e); g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(p[0] + .1, p[1] + .1); g.stroke(); sigCtx.drawn = true; });
    c.addEventListener('pointermove', function (e) { if (!down) return; var p = pt(e); g.lineTo(p[0], p[1]); g.stroke(); });
    ['pointerup', 'pointercancel'].forEach(function (n) { c.addEventListener(n, function () { down = false; }); });
  }
  function sigStore(dataUrl) {
    var r = sigCtx.r, ag = r.agreement, isL = sigCtx.who === 'L';
    ag[isL ? 'sigL' : 'sigT'] = dataUrl; ag[isL ? 'sigLDate' : 'sigTDate'] = dataUrl ? today() : '';
    if (isL && dataUrl) S.settings.landlord.sig = dataUrl;
    save(); closeDlg(); render();
  }

  /* ---------- sample data ---------- */
  function sample() {
    var t = today(), mk = t.slice(0, 7), dayOfMonth = +t.slice(8);
    function mkRental(flat, tenant, monthsAgo, dueDay, rent, payCurrent, endInDays, signed) {
      var s = C.addMonths(mk, -monthsAgo) + '-01', r = { id: C.uid(), flatId: flat.id, tenant: tenant, start: s, end: endInDays != null ? C.addDays(t, endInDays) : C.addDays(s, 364 + 365), rent: rent, dueDay: dueDay, deposit: rent * 2, depositReceived: s <= t ? s : '', noticeDays: 30, escalation: 3, trackFrom: s, utilities: '', extra: '', pref: 'wa', payments: [], followups: [], agreement: { status: signed ? 'signed' : 'none', signedAt: signed ? s : '' } };
      C.buildDues(r, t).forEach(function (d) { if (d.key < mk || (d.key === mk && payCurrent && d.dueDate <= t)) r.payments.push({ id: C.uid(), key: d.key, amount: d.amount, date: d.dueDate, method: 'Bank transfer', ref: '' }); });
      S.rentals.push(r); return r;
    }
    var f1 = { id: C.uid(), name: 'Flat 3B, Rue des Lilas', address: '12 Rue des Lilas, 34000 Montpellier' }, f2 = { id: C.uid(), name: 'Apartment 12, Green Park', address: '12 Green Park Road, Pune 411001' }, f3 = { id: C.uid(), name: 'Studio 7, Harbour View', address: '7 Harbour View, Marseille' }, f4 = { id: C.uid(), name: 'Flat 1A, Place Royale', address: '1 Place Royale, Nîmes' };
    S.flats.push(f1, f2, f3, f4);
    var a = mkRental(f1, { name: 'Marie Dupont', phone: '06 12 34 56 78', email: 'marie@example.com', idNo: '', address: '5 Rue Verte, Lyon' }, 7, 1, 850, false, null, true);
    a.followups.push({ id: C.uid(), date: C.addDays(t, -9), channel: 'WhatsApp', note: 'Reminder sent', key: mk });
    mkRental(f2, { name: 'Ravi Kumar', phone: '98765 43210', email: 'ravi@example.com', idNo: '', address: '' }, 5, Math.min(28, dayOfMonth + 4), 620, false, null, false);
    mkRental(f3, { name: 'Elena Rossi', phone: '+39 333 123 4567', email: 'elena@example.com', idNo: '', address: '' }, 10, 5, 540, true, 40, true);
    S.bills.push({ id: C.uid(), name: 'Building service charge', category: 'Service charge / fees', flatId: f1.id, amount: 60, day: 5, freq: 'monthly', start: C.addMonths(mk, -6) + '-01', end: '', active: true });
    S.expenses.push({ id: C.uid(), date: C.addDays(t, -12), category: 'Maintenance & repairs', flatId: f2.id, description: 'Plumber, kitchen tap', amount: 120, method: 'Cash' });
    postBills(); save(); render(); toast('Sample data added. Erase it any time in Settings.');
  }

  /* ---------- actions ---------- */
  var ACT = {
    close: closeDlg,
    addFlat: function () { flatForm(); }, editFlat: function (d) { flatForm(d.f); },
    newRental: function (d) { rentalForm(null, d.f); },
    newRentalPick: function () { if (!S.flats.length) { flatForm(); } else rentalForm(null); },
    editRental: function (d) { rentalForm(d.r); },
    renew: function (d) { rentalForm(null, null, rentalById(d.r)); },
    pay: function (d) { payForm(d.r, d.k); }, remind: function (d) { remindSheet(d.r, d.k); }, waNow: function (d) { waNow(d.r, d.k); }, logfu: function (d) { logForm(d.r, d.k); },
    sendMsg: function (d) { sendMsg(d.ch); },
    addExpense: function (d) { expenseForm(null, d.f); }, editExpense: function (d) { expenseForm(d.e); }, addBill: function () { billForm(); }, editBill: function (d) { billForm(d.b); },
    depositRecv: function (d) { depositRecvForm(d.r); }, depositUndo: function (d) { confirmBox('Mark the deposit as not received?', 'Not received', function () { rentalById(d.r).depositReceived = ''; }); }, sellFlat: function (d) { sellForm(d.f); }, undepositRecv: function (d) { depositRecvForm(d.r); }, depositUndo: function (d) { confirmBox('Mark the deposit as not received?', 'Not received', function () { rentalById(d.r).depositReceived = ''; }); }, sellFlat: function (d) { confirmBox('Undo the sale of this flat? Its closed bills stay closed.', 'Undo sale', function () { var f = S.flats.find(function (x) { return x.id === d.f; }); f.soldDate = ''; f.soldPrice = 0; f.soldNote = ''; }); }, pastExpenses: function () { pastExpensesForm(); }, expFlat: function (d) { expFlat = d.f || ''; render(); }, expNav: function (d) { expMonth = C.addMonths(expMonth, +d.n); render(); },
    dashMode: function (d) { dashMode = d.m; dashKey = null; render(); }, dashMonth: function (d) { dashMode = 'month'; dashKey = d.k; render(); },
    dashNav: function (d) { dashKey = dashMode === 'year' ? String(+dashKey + +d.n) : C.addMonths(dashKey, +d.n); render(); },
    editMonth: function (d) { monthSheet(d.r, d.k); }, settleMonth: function (d) { settleMonth(d.r, d.k); }, settleAll: function (d) { settleAll(d.r); }, changeRent: function (d) { changeRentForm(d.r); }, sendSettle: function (d) { settleSheet(d.r); }, bulkPay: function (d) { bulkPayForm(d.r); },
    bulkAll: function (d) { Array.prototype.forEach.call(document.querySelectorAll('#bulkf input[type=checkbox]'), function (c) { c.checked = d.v === '1'; }); }, sendInfo: function (d) { infoSheet(d.r); },
    delPay: function (d) { confirmBox('Remove this payment record?', 'Remove', function () { var r = rentalById(d.r); r.payments = r.payments.filter(function (p) { return p.id !== d.p; }); }); },
    toggleAll: function () { showAll = !showAll; render(); },
    endRental: function (d) { endForm(d.r); },
    delRental: function (d) { confirmBox('Delete this rental with all its payments, follow-ups and agreement? This cannot be undone.', 'Delete rental', function () { S.rentals = S.rentals.filter(function (r) { return r.id !== d.r; }); location.hash = '#/flats'; }); },
    ry: function (d) { rentYear = String(+rentYear + +d.n); render(); }, rentFlat: function (d) { rentFlat = d.f || ''; render(); }, rentCell: function (d) { var r = rentalById(d.r), x = C.schedule(r, today(), grace()).find(function (y) { return y.key === d.k; }); if (x && x.status === 'paid') monthSheet(d.r, d.k); else payForm(d.r, d.k); },
    sample: sample,
    print: function () { window.print(); },
    pdf: function (d) { var r = rentalById(d.r); download(buildPdf(r), pdfName(r)); toast('PDF saved to your Downloads.'); },
    sendAg: function (d) { sendSheet(d.r); }, sendAgVia: function (d) { sendAgVia(d.ch); },
    sig: function (d) { sigSheet(d.r, d.who); }, sigClear: function () { var c = sigCtx.c; sigCtx.g.clearRect(0, 0, c.width, c.height); sigCtx.drawn = false; },
    sigSave: function () {
      if (!sigCtx.drawn) return toast('Please sign first.');
      var c = sigCtx.c, tmp = document.createElement('canvas'); var sc = Math.min(1, 360 / c.width); tmp.width = Math.round(c.width * sc); tmp.height = Math.round(c.height * sc); var g = tmp.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, tmp.width, tmp.height); g.drawImage(c, 0, 0, tmp.width, tmp.height);
      sigStore(tmp.toDataURL('image/jpeg', 0.8));
    },
    sigUseSaved: function () { sigStore(S.settings.landlord.sig); }, sigRemove: function () { sigStore(''); },
    editAg: function (d) { var r = rentalById(d.r); openForm({ title: 'Edit this agreement\'s text', intro: 'Only this agreement is changed. Use # for the title, ## for headings, - for bullets.', fields: [{ name: 'text', label: 'Agreement text', type: 'textarea', rows: 18, full: true }], values: { text: agText(r) }, onSave: function (x) { r.agreement.text = x.text; } }); },
    resetAg: function (d) { confirmBox('Discard your edits and use the standard wording again?', 'Reset', function () { rentalById(d.r).agreement.text = ''; }); },
    markSigned: function (d) { var r = rentalById(d.r); confirmBox('Mark the agreement as signed by both parties? The wording is locked as it is now.', 'Mark as signed', function () { var ag = r.agreement; ag.text = agText(r); ag.status = 'signed'; ag.signedAt = today(); }); },
    reopenAg: function (d) { confirmBox('Re-open the agreement for changes? It will go back to draft.', 'Re-open', function () { var ag = rentalById(d.r).agreement; ag.status = 'draft'; }); },
    resetTpl: function () { var f = $('#setf'); f.elements.template.value = A.DEFAULT_TEMPLATE; f.elements.msgSoon.value = DEFAULT_SOON; f.elements.msgLate.value = DEFAULT_LATE; toast('Standard wording restored. Press Save settings.'); },
    syncNow: function () { syncNow(true).then(function () { if (!syncErr) toast('Synced.'); }); },
    unsync: function () { confirmBox('Stop syncing with the Google Sheet? Your data stays on this device and in the Sheet.', 'Disconnect', function () { cfg = { url: '', pin: '', rev: -1, dirty: false, last: 0 }; saveCfg(); }); },
    copyGs: function () { fetch('Code.gs').then(function (r) { return r.text(); }).then(function (t) { return navigator.clipboard.writeText(t); }).then(function () { toast('Code copied. Paste it in Apps Script.'); }).catch(function () { toast('Could not copy. Open the link and copy the text.'); }); },
    backup: function () { S.settings.lastBackup = today(); save(); download(new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' }), 'rent-desk-backup-' + today() + '.json'); toast('Backup downloaded.'); render(); },
    restore: function () { $('#restoreFile').click(); },
    ics: function () {
      var t = today(), L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Rent Desk//EN'], n = 0;
      S.rentals.forEach(function (r) {
        var end = r.end || C.addMonths(t.slice(0, 7), 12) + '-28', rr = Object.assign({}, r, { end: end });
        C.schedule(rr, t, grace()).forEach(function (d) { if (d.status === 'paid' || d.dueDate < t) return; n++; var dt = d.dueDate.replace(/-/g, '');
          L.push('BEGIN:VEVENT', 'UID:' + r.id + '-' + d.key + '@rentdesk', 'DTSTAMP:' + t.replace(/-/g, '') + 'T000000Z', 'DTSTART;VALUE=DATE:' + dt, 'DTEND;VALUE=DATE:' + C.addDays(d.dueDate, 1).replace(/-/g, ''), 'SUMMARY:Rent due: ' + flatOf(r).name.replace(/[,;]/g, ' ') + ' (' + r.tenant.name.replace(/[,;]/g, ' ') + ')', 'DESCRIPTION:' + money(d.amount).replace(/,/g, '') + ' for ' + C.monthLabel(d.key), 'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Rent due tomorrow', 'TRIGGER:-P1D', 'END:VALARM', 'END:VEVENT'); });
      });
      L.push('END:VCALENDAR'); if (!n) return toast('No upcoming rent dates to export.');
      download(new Blob([L.join('\r\n')], { type: 'text/calendar' }), 'rent-dates.ics'); toast(n + ' rent dates exported. Open the file to add them to your calendar.');
    },
    wipe: function () { confirmBox('Erase all flats, rentals, payments and settings from this device? Make a backup first if you may need it.', 'Erase everything', function () { S = defaults(); cfg = { url: '', pin: '', rev: -1, dirty: false, last: 0 }; saveCfg(); initSnap(); }); }
  };
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]'); if (!el) return;
    var fn = ACT[el.dataset.act]; if (fn) { e.preventDefault(); fn(el.dataset, el); }
  });
  document.addEventListener('input', function (e) { if (e.target.id === 'flatQ') { flatQ = e.target.value; applyFlatQ(); } });
  document.addEventListener('change', function (e) {
    if (e.target.id === 'expPick') { if (/^d{4}-d{2}$/.test(e.target.value)) { expMonth = e.target.value; render(); } return; }
    if (e.target.id !== 'restoreFile' || !e.target.files[0]) return;
    var fr = new FileReader(); fr.onload = function () {
      try { var d = JSON.parse(fr.result); if (!Array.isArray(d.flats) || !Array.isArray(d.rentals)) throw 0; confirmBox('Replace everything on this device with the backup (' + d.flats.length + ' flats, ' + d.rentals.length + ' rentals)?', 'Restore', function () { var now = Date.now(); S = Object.assign(defaults(), d); S.tomb = d.tomb || []; S.settings = Object.assign(defaults().settings, d.settings || {}); S.settings.u = now; S.flats.forEach(function (f) { f.u = now; }); S.rentals.forEach(function (r) { r.u = now; (r.payments || []).concat(r.followups || []).forEach(function (x) { x.u = now; }); }); cfg.dirty = true; }); } catch (x) { toast('That file is not a Rent Desk backup.'); }
    }; fr.readAsText(e.target.files[0]); e.target.value = '';
  });

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(function () { /* offline mode unavailable */ });
  initSnap(); postBills(); save();
  render();
  if (cfg.url) { schedSync(300); setInterval(function () { if (!document.hidden) syncNow(); }, 60000); }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) schedSync(300); });
  window.addEventListener('online', function () { schedSync(500); });
  window.__rd = { get state() { return S; }, render: render };
})();
