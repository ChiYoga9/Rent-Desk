/* Rent Desk – money figures for the dashboard, and automatic bills. Pure logic (testable in Node). */
(function (root) {
  var C = root.Core || require('./core.js');
  var round2 = C.round2;

  function lastDay(key) { return new Date(+key.slice(0, 4), +key.slice(5, 7), 0).getDate(); }
  /* ('month','2026-11') or ('year','2026') → {from,to} */
  function range(mode, key) {
    return mode === 'year' ? { from: key + '-01-01', to: key + '-12-31' } : { from: key + '-01', to: key + '-' + C.pad(lastDay(key)) };
  }

  /* All the numbers for dates from..to. Income = money actually received (settled-without-payment amounts are listed apart).
     Outstanding = rent already due in the period that is still unpaid today. */
  function figures(S, from, to, today, grace) {
    var o = { kept: 0, income: 0, waived: 0, expenses: 0, net: 0, due: 0, outstanding: 0, byFlat: {}, byCat: {} };
    var inR = function (d) { return d >= from && d <= to; };
    var row = function (id) { return o.byFlat[id] || (o.byFlat[id] = { flatId: id, income: 0, expenses: 0, due: 0, outstanding: 0 }); };
    (S.rentals || []).forEach(function (r) {
      (r.payments || []).forEach(function (p) {
        if (!inR(p.date)) return;
        if (p.waived) o.waived += +p.amount; else { o.income += +p.amount; row(r.flatId).income += +p.amount; }
      });
      var ds = r.depositSettlement;
      if (ds && ds.date && inR(ds.date) && +ds.kept > 0) { o.kept += +ds.kept; o.income += +ds.kept; row(r.flatId).income += +ds.kept; }
      C.schedule(r, today, grace).forEach(function (d) {
        if (!inR(d.dueDate) || d.dueDate > today) return;
        o.due += d.amount; row(r.flatId).due += d.amount;
        if (d.balance > 0) { o.outstanding += d.balance; row(r.flatId).outstanding += d.balance; }
      });
    });
    (S.expenses || []).forEach(function (e) {
      if (!inR(e.date)) return;
      o.expenses += +e.amount; row(e.flatId || '').expenses += +e.amount;
      var k = e.category || 'Other'; o.byCat[k] = (o.byCat[k] || 0) + +e.amount;
    });
    ['income', 'waived', 'expenses', 'due', 'outstanding', 'kept'].forEach(function (k) { o[k] = round2(o[k]); });
    o.net = round2(o.income - o.expenses);
    Object.keys(o.byFlat).forEach(function (k) { var r = o.byFlat[k]; ['income', 'expenses', 'due', 'outstanding'].forEach(function (x) { r[x] = round2(r[x]); }); r.net = round2(r.income - r.expenses); });
    Object.keys(o.byCat).forEach(function (k) { o.byCat[k] = round2(o.byCat[k]); });
    return o;
  }

  /* 12 months of income and expenses for a year */
  function yearSeries(S, year, today, grace) {
    var out = [];
    for (var m = 1; m <= 12; m++) { var rg = range('month', year + '-' + C.pad(m)), f = figures(S, rg.from, rg.to, today, grace); out.push({ month: m, income: f.income, expenses: f.expenses }); }
    return out;
  }

  /* The expense records that automatic bills should have created by now and that do not exist yet.
     Same bill + same month always gives the same id, so two devices never create it twice, and an expense you deleted stays deleted. */
  function billExpenses(S, today) {
    var tomb = {}, have = {}, out = [], cur = today.slice(0, 7);
    (S.tomb || []).forEach(function (t) { tomb[t.id] = 1; });
    (S.expenses || []).forEach(function (e) { have[e.id] = 1; });
    (S.bills || []).forEach(function (b) {
      if ((b.active === false && !b.end) || !(+b.amount > 0) || !b.start) return;
      var step = { monthly: 1, quarterly: 3, yearly: 12 }[b.freq || 'monthly'] || 1, key = b.start.slice(0, 7), i = 0;
      while (key <= cur && i < 600) {
        if (!b.end || key <= b.end.slice(0, 7)) {
          var date = key + '-' + C.pad(Math.min(Math.max(+b.day || 1, 1), lastDay(key))), id = 'x_' + b.id + '_' + key;
          if (date <= today && !have[id] && !tomb[id]) out.push({ id: id, date: date, category: b.category || 'Other', flatId: b.flatId || '', description: b.name, amount: round2(+b.amount), method: b.method || '', auto: true, billId: b.id });
        }
        key = C.addMonths(key, step); i++;
      }
    });
    return out;
  }

  /* What happens to the security deposit when a tenant leaves on `leave`.
     Unpaid rent up to the leaving date is settled from the deposit, oldest month first.
     Leaving before the agreed end date forfeits the rest of the deposit (unless opts.forfeit === false).
     Otherwise the landlord may keep deductions (damage, cleaning) and the rest is refunded.
     opts: { forfeit: bool, deductions: [{label, amount}] } */
  function settleDeposit(r, leave, today, grace, opts) {
    opts = opts || {};
    var t = Object.assign({}, r, { end: leave });
    var dues = C.schedule(t, today, grace).filter(function (d) { return d.dueDate <= leave && d.balance > 0; });
    var owed = round2(dues.reduce(function (s, d) { return s + d.balance; }, 0)), deposit = round2(+r.deposit || 0), rem = deposit, applied = [];
    dues.forEach(function (d) { var a = round2(Math.min(rem, d.balance)); if (a > 0) { applied.push({ key: d.key, amount: a }); rem = round2(rem - a); } });
    var appliedTotal = round2(applied.reduce(function (s, a) { return s + a.amount; }, 0));
    var agreed = r.agreedEnd || r.end, early = !!(agreed && leave < agreed);
    var forfeit = early && opts.forfeit !== false && deposit > 0;
    var ded = round2((opts.deductions || []).reduce(function (s, x) { return s + (+x.amount || 0); }, 0));
    var out = { leave: leave, early: early, deposit: deposit, owed: owed, applied: applied, appliedTotal: appliedTotal, shortfall: round2(owed - appliedTotal), forfeit: forfeit, deductions: ded, forfeited: 0, kept: 0, refund: 0, extraOwed: 0 };
    if (forfeit) { out.forfeited = rem; out.kept = rem; }
    else { var use = round2(Math.min(ded, rem)); out.kept = use; out.refund = round2(rem - use); out.extraOwed = round2(ded - use); }
    return out;
  }

  var api = { settleDeposit: settleDeposit, range: range, figures: figures, yearSeries: yearSeries, billExpenses: billExpenses, lastDay: lastDay };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Money = api;
})(typeof window !== 'undefined' ? window : globalThis);
