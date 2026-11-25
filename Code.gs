/* Rent Desk – Google Sheet sync.
   Put this in the Sheet's own script (Extensions > Apps Script), set a PIN in Project Settings > Script properties
   (name PIN), then Deploy > New deployment > Web app > Execute as: Me, Who has access: Anyone.
   The app sends the PIN with every request. Data is written as readable tabs: Flats, Rentals, Payments, Followups, ... */

var SCHEMA = {
  Flats: ['id', 'name', 'address', 'furnishing', 'info', 'u'],
  Rentals: ['id', 'flatId', 'tenantName', 'tenantPhone', 'tenantEmail', 'tenantId', 'tenantAddress', 'start', 'end', 'rent', 'dueDay', 'deposit', 'noticeDays', 'escalation', 'trackFrom', 'pref', 'utilities', 'extra', 'agreement', 'u', 'plan', 'revisions', 'depositSettlement', 'agreedEnd'],
  Payments: ['id', 'rentalId', 'key', 'amount', 'date', 'method', 'ref', 'u', 'waived'],
  Expenses: ['id', 'date', 'category', 'flatId', 'description', 'amount', 'method', 'auto', 'billId', 'u'],
  Bills: ['id', 'name', 'category', 'flatId', 'amount', 'day', 'freq', 'start', 'end', 'method', 'active', 'u'],
  Followups: ['id', 'rentalId', 'date', 'channel', 'note', 'promiseDate', 'key', 'u'],
  Signatures: ['rentalId', 'who', 'image'],
  Deleted: ['id', 'u'],
  Settings: ['key', 'value'],
  Meta: ['key', 'value']
};
var NUMS = { rent: 1, dueDay: 1, deposit: 1, noticeDays: 1, escalation: 1, amount: 1, day: 1, u: 1 };
var BOOLS = { waived: 1, auto: 1, active: 1 };

function doGet() { return ContentService.createTextOutput('Rent Desk sync is running.'); }

function doPost(e) {
  var out;
  try {
    var req = JSON.parse(e.postData.contents);
    var pin = PropertiesService.getScriptProperties().getProperty('PIN');
    if (!pin) throw new Error('No PIN is set in the script yet (setup step 3).');
    var cache = CacheService.getScriptCache(), fails = Number(cache.get('fails')) || 0;
    if (fails >= 10) throw new Error('Too many wrong PINs. Try again in 15 minutes.');
    if (String(req.pin) !== String(pin)) { cache.put('fails', String(fails + 1), 900); throw new Error('Wrong PIN.'); }
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try { out = handle_(req); } finally { lock.releaseLock(); }
  } catch (err) { out = { error: String(err && err.message || err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function handle_(req) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensure_(ss);
  var rev = getRev_(ss);
  if (req.op === 'ping') return { ok: true, rev: rev };
  if (req.op === 'pull') return { ok: true, rev: rev, data: req.baseRev === rev ? null : readAll_(ss) };
  if (req.op === 'push') {
    if (req.baseRev !== rev) return { conflict: true, rev: rev, data: readAll_(ss) };
    writeAll_(ss, req.data || {});
    setRev_(ss, rev + 1);
    return { ok: true, rev: rev + 1 };
  }
  throw new Error('Unknown request.');
}

function ensure_(ss) {
  Object.keys(SCHEMA).forEach(function (name) {
    if (ss.getSheetByName(name)) return;
    var sh = ss.insertSheet(name), h = SCHEMA[name];
    sh.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight('bold');
    sh.setFrozenRows(1);
  });
}
function getRev_(ss) {
  var rows = readTab_(ss, 'Meta');
  for (var i = 0; i < rows.length; i++) if (rows[i].key === 'rev') return Number(rows[i].value) || 0;
  return 0;
}
function setRev_(ss, rev) { setRows_(ss, 'Meta', [['rev', String(rev)]]); }

function readTab_(ss, name) {
  var vals = ss.getSheetByName(name).getDataRange().getValues(), h = SCHEMA[name], out = [];
  for (var r = 1; r < vals.length; r++) {
    var o = {}, any = false;
    for (var c = 0; c < h.length; c++) {
      var v = vals[r][c];
      if (v instanceof Date) v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      if (v !== '' && v != null) any = true;
      o[h[c]] = NUMS[h[c]] ? (Number(v) || 0) : BOOLS[h[c]] ? (String(v) === 'true') : (v == null ? '' : String(v));
    }
    if (any) out.push(o);
  }
  return out;
}
function setRows_(ss, name, rows) {
  var sh = ss.getSheetByName(name), h = SCHEMA[name], n = rows.length + 1;
  sh.clearContents();
  if (sh.getMaxRows() < n) sh.insertRowsAfter(sh.getMaxRows(), n - sh.getMaxRows());
  var rg = sh.getRange(1, 1, n, h.length);
  rg.setNumberFormat('@');
  rg.setValues([h].concat(rows.map(function (r) { return r.map(function (v) { return v == null ? '' : String(v); }); })));
  sh.getRange(1, 1, 1, h.length).setFontWeight('bold');
}

function readAll_(ss) {
  var sigs = readTab_(ss, 'Signatures'), pays = readTab_(ss, 'Payments'), fus = readTab_(ss, 'Followups');
  var sigOf = function (rid, who) { for (var i = 0; i < sigs.length; i++) if (sigs[i].rentalId === rid && sigs[i].who === who) return sigs[i].image; return ''; };
  var settings = {};
  readTab_(ss, 'Settings').forEach(function (r) { try { settings[r.key] = JSON.parse(r.value); } catch (e) { /* skip */ } });
  if (settings.landlord) settings.landlord.sig = sigOf('_landlord', 'L');
  var rentals = readTab_(ss, 'Rentals').map(function (r) {
    var ag = {}; try { ag = JSON.parse(r.agreement || '{}'); } catch (e) { /* keep empty */ }
    var sl = sigOf(r.id, 'L'), st = sigOf(r.id, 'T'); if (sl) ag.sigL = sl; if (st) ag.sigT = st;
    var plan = {}, revs = []; try { plan = JSON.parse(r.plan || '{}'); } catch (e) { /* none */ } try { revs = JSON.parse(r.revisions || '[]'); } catch (e) { /* none */ }
    var dep = null; try { dep = r.depositSettlement ? JSON.parse(r.depositSettlement) : null; } catch (e) { /* none */ }
    return {
      id: r.id, flatId: r.flatId, tenant: { name: r.tenantName, phone: r.tenantPhone, email: r.tenantEmail, idNo: r.tenantId, address: r.tenantAddress },
      start: r.start, end: r.end, rent: r.rent, dueDay: r.dueDay, deposit: r.deposit, noticeDays: r.noticeDays, escalation: r.escalation, trackFrom: r.trackFrom, pref: r.pref, utilities: r.utilities, extra: r.extra,
      agreement: ag, plan: plan, revisions: revs, depositSettlement: dep, agreedEnd: r.agreedEnd, u: r.u,
      payments: pays.filter(function (p) { return p.rentalId === r.id; }).map(function (p) { return { id: p.id, key: p.key, amount: p.amount, date: p.date, method: p.method, ref: p.ref, waived: p.waived, u: p.u }; }),
      followups: fus.filter(function (f) { return f.rentalId === r.id; }).map(function (f) { return { id: f.id, date: f.date, channel: f.channel, note: f.note, promiseDate: f.promiseDate, key: f.key, u: f.u }; })
    };
  });
  return { settings: settings, flats: readTab_(ss, 'Flats'), expenses: readTab_(ss, 'Expenses'), bills: readTab_(ss, 'Bills'), rentals: rentals, tomb: readTab_(ss, 'Deleted') };
}

function writeAll_(ss, d) {
  var flats = [], rentals = [], pays = [], fus = [], sigs = [], settings = [], exps = [], bills = [];
  (d.flats || []).forEach(function (f) { flats.push([f.id, f.name, f.address, f.furnishing, f.info, f.u]); });
  (d.expenses || []).forEach(function (e) { exps.push([e.id, e.date, e.category, e.flatId, e.description, e.amount, e.method, !!e.auto, e.billId, e.u]); });
  (d.bills || []).forEach(function (b) { bills.push([b.id, b.name, b.category, b.flatId, b.amount, b.day, b.freq, b.start, b.end, b.method, b.active !== false, b.u]); });
  (d.rentals || []).forEach(function (r) {
    var T = r.tenant || {}, ag = Object.assign({}, r.agreement || {});
    if (ag.sigL) sigs.push([r.id, 'L', ag.sigL]); if (ag.sigT) sigs.push([r.id, 'T', ag.sigT]);
    delete ag.sigL; delete ag.sigT;
    rentals.push([r.id, r.flatId, T.name, T.phone, T.email, T.idNo, T.address, r.start, r.end, r.rent, r.dueDay, r.deposit, r.noticeDays, r.escalation, r.trackFrom, r.pref, r.utilities, r.extra, JSON.stringify(ag), r.u, JSON.stringify(r.plan || {}), JSON.stringify(r.revisions || []), r.depositSettlement ? JSON.stringify(r.depositSettlement) : '', r.agreedEnd]);
    (r.payments || []).forEach(function (p) { pays.push([p.id, r.id, p.key, p.amount, p.date, p.method, p.ref, p.u, !!p.waived]); });
    (r.followups || []).forEach(function (f) { fus.push([f.id, r.id, f.date, f.channel, f.note, f.promiseDate, f.key, f.u]); });
  });
  var s = Object.assign({}, d.settings || {});
  if (s.landlord) { s.landlord = Object.assign({}, s.landlord); if (s.landlord.sig) sigs.push(['_landlord', 'L', s.landlord.sig]); delete s.landlord.sig; }
  Object.keys(s).forEach(function (k) { settings.push([k, JSON.stringify(s[k])]); });
  setRows_(ss, 'Flats', flats); setRows_(ss, 'Rentals', rentals); setRows_(ss, 'Payments', pays); setRows_(ss, 'Followups', fus);
  setRows_(ss, 'Expenses', exps); setRows_(ss, 'Bills', bills);
  setRows_(ss, 'Signatures', sigs); setRows_(ss, 'Settings', settings);
  setRows_(ss, 'Deleted', (d.tomb || []).map(function (t) { return [t.id, t.u]; }));
}
