/* Rent Desk – agreement template, text → blocks, blocks → HTML preview.
   Template markup: "# Title", "## Heading", "- bullet", blank line = new paragraph.
   {placeholders} are filled from the rental. A line starting with {{if name}} is kept only when that value is not empty. */
(function (root) {
  var DEFAULT_TEMPLATE = [
    '# RESIDENTIAL RENTAL AGREEMENT',
    'This agreement is made on {today} at {city} between:',
    '- {landlordName}, residing at {landlordAddress}{landlordIdText} (the "Landlord"), and',
    '- {tenantName}, residing at {tenantAddress}{tenantIdText} (the "Tenant").',
    '## 1. The property',
    'The Landlord lets to the Tenant, and the Tenant takes on rent, the residential property known as {flatName}, situated at {flatAddress} (the "Property"){furnishing}.',
    '## 2. Term',
    'The tenancy starts on {startDate} and {endClause}.',
    '## 3. Rent',
    'The monthly rent is {rent}, payable in advance on or before day {dueDay} of each month, by the following means: {payInfo}',
    '{{if escalationText}}{escalationText}',
    '## 4. Security deposit',
    '{{if deposit}}The Tenant pays a security deposit of {deposit} on signing this agreement. The Landlord holds it as security for unpaid rent and for damage beyond normal wear and tear, and returns it, less any justified deductions, within one month after the Tenant has vacated and handed back the keys.',
    '{{if noDeposit}}No security deposit is payable under this agreement.',
    '## 5. Late payment',
    'If rent is not received within {graceDays} days of the due date, the Landlord may send a written reminder and may take the steps the law allows to recover the arrears.',
    '## 6. Utilities and charges',
    '{utilities}',
    '## 7. Use of the Property',
    'The Tenant shall use the Property only as a private residence for the persons named in this agreement, shall keep it clean and in good condition, shall not cause nuisance to neighbours, and shall not carry on any unlawful activity or any business that receives visitors at the Property.',
    '## 8. Maintenance and repairs',
    'The Tenant shall report any defect or damage to the Landlord promptly and shall bear the cost of repairs caused by the Tenant or the Tenant\'s guests. The Landlord shall carry out repairs to the structure, plumbing, wiring and fixed appliances that are not caused by the Tenant.',
    '## 9. Alterations and subletting',
    'The Tenant shall not make structural alterations, and shall not sublet, assign or share the Property with others, without the Landlord\'s prior written consent.',
    '## 10. Access',
    'The Landlord may enter the Property to inspect it or carry out repairs after giving reasonable notice, except in an emergency.',
    '## 11. Ending the tenancy',
    'Either party may end this agreement by giving the other at least {noticeDays} days\' written notice. On leaving, the Tenant shall return the Property and all keys in the same condition as received, allowing for normal wear and tear, and shall pay all rent and charges due up to the day of handover.',
    '## 12. Renewal',
    'Any renewal or extension must be agreed in writing by both parties before the end date.',
    '## 13. Governing law',
    'This agreement is governed by the laws of {governingLaw}.',
    '## 14. Inventory and condition',
    'The Tenant confirms having inspected the Property and accepts it in its present condition. Any inventory or photographs signed by both parties form part of this agreement.',
    '{{if extra}}## 15. Additional terms',
    '{{if extra}}{extra}',
    'Signed by both parties on the dates shown below, in two copies, one for each party.'
  ].join('\n');

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function money(n, cur) {
    var v = (Math.round(n * 100) / 100);
    var s = v.toLocaleString('en-GB', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
    return (cur || '') + s;
  }

  function vars(r, flat, settings) {
    var Core = root.Core, cur = settings.currency || '';
    var L = settings.landlord || {}, T = r.tenant || {};
    var term = r.end ? 'continues until ' + Core.longDate(r.end) + ' (unless ended earlier as set out below)' : 'continues month to month until ended as set out below';
    return {
      today: Core.longDate(Core.todayISO()), city: settings.city || '____________',
      landlordName: L.name || '____________', landlordAddress: L.address || '____________',
      landlordIdText: L.idNo ? ', ID no. ' + L.idNo : '',
      tenantName: T.name || '____________', tenantAddress: T.address || '____________',
      tenantIdText: T.idNo ? ', ID no. ' + T.idNo : '',
      flatName: (flat && flat.name) || '____________', flatAddress: (flat && flat.address) || '____________',
      furnishing: r.furnishing ? ', ' + r.furnishing : '',
      startDate: Core.longDate(r.start), endDate: Core.longDate(r.end), endClause: term,
      rent: money(+r.rent, cur), dueDay: r.dueDay || 1,
      payInfo: settings.payInfo || 'bank transfer to the account the Landlord indicates',
      escalationText: (+r.escalation > 0) ? 'After each full year of the tenancy the rent increases by ' + r.escalation + '%.' : '',
      deposit: (+r.deposit > 0) ? money(+r.deposit, cur) : '', noDeposit: (+r.deposit > 0) ? '' : 'yes',
      graceDays: settings.graceDays != null ? settings.graceDays : 3,
      utilities: r.utilities || 'The Tenant pays for electricity, water, gas, internet and any other services used at the Property, unless stated otherwise in writing.',
      noticeDays: r.noticeDays || 30, governingLaw: settings.governingLaw || '____________',
      extra: r.extra || ''
    };
  }

  function renderText(tpl, v) {
    var out = [];
    String(tpl).split('\n').forEach(function (line) {
      var m = line.match(/^\{\{if (\w+)\}\}(.*)$/);
      if (m) { if (!v[m[1]]) return; line = m[2]; }
      if (!line.trim() && !out.length) return;
      out.push(line.replace(/\{(\w+)\}/g, function (_, k) { return v[k] == null ? '' : v[k]; }));
    });
    return out.join('\n');
  }

  /* text → [{t:'title'|'h'|'p'|'li', text}] */
  function toBlocks(text) {
    var blocks = [];
    String(text).split('\n').forEach(function (line) {
      if (!line.trim()) return;
      if (line.indexOf('# ') === 0) blocks.push({ t: 'title', text: line.slice(2) });
      else if (line.indexOf('## ') === 0) blocks.push({ t: 'h', text: line.slice(3) });
      else if (line.indexOf('- ') === 0) blocks.push({ t: 'li', text: line.slice(2) });
      else blocks.push({ t: 'p', text: line });
    });
    return blocks;
  }

  function blocksHTML(blocks) {
    var html = '', inList = false;
    blocks.forEach(function (b) {
      if (b.t !== 'li' && inList) { html += '</ul>'; inList = false; }
      if (b.t === 'title') html += '<h1>' + esc(b.text) + '</h1>';
      else if (b.t === 'h') html += '<h2>' + esc(b.text) + '</h2>';
      else if (b.t === 'li') { if (!inList) { html += '<ul>'; inList = true; } html += '<li>' + esc(b.text) + '</li>'; }
      else html += '<p>' + esc(b.text) + '</p>';
    });
    return html + (inList ? '</ul>' : '');
  }

  root.Agreement = { DEFAULT_TEMPLATE: DEFAULT_TEMPLATE, vars: vars, renderText: renderText, toBlocks: toBlocks, blocksHTML: blocksHTML, money: money, esc: esc };
})(typeof window !== 'undefined' ? window : globalThis);
