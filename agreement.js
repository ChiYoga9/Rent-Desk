/* Rent Desk – agreement template, text → blocks, blocks → HTML preview.
   Template markup: "# Title", "## Heading", "- bullet", blank line = new paragraph.
   {placeholders} are filled from the rental. A line starting with {{if name}} is kept only when that value is not empty. */
(function (root) {
  var DEFAULT_TEMPLATE = [
    "# RENT AGREEMENT",
    "This Rent Agreement is made at {city} on this {today}",
    "## BETWEEN",
    "{landlordName}{landlordIdText}, R/O {landlordAddress} (hereinafter called the OWNER being the First Party).",
    "## AND",
    "{tenantName}{tenantIdText}, {tenantAddress} (hereinafter called the TENANT being the Second Party).",
    "(The words and expressions Owner and the Tenant shall mean and include their legal representatives, authorized agents, assignees, successors and legal heirs respectively)",
    "WHEREAS the OWNER is the absolute owner and in possession of the premises situated at",
    "Address: {flatName}, {flatAddress}.",
    "AND WHEREAS on request of the Tenant, the Owner aforesaid has agreed to let out the said property for residential purposes to the Tenant {periodText}. And whereas the second party has agreed to execute and sign this deed of rent agreement, as per the terms and conditions mentioned below:-",
    "## NOW THIS RENT AGREEMENT WITNESSETH AS UNDER:-",
    "@ That the tenure of the rent of the said premises begins on {startDate}. {tenureText}",
    "@ That the monthly rent of {rent}/- ({rentWords}) {utilities}, in respect of the aforesaid premises, shall be paid every month in advance by the Tenant to the Owner on or before the {dueDayOrd} day of each English calendar month.{payInfoText}",
    "{{if deposit}}@ That the Tenant shall pay to the Owner {deposit}/- ({depositWords}) as advance, interest-free security, which is refundable on the expiry of the term of the lease against handing over of vacant possession, after adjustment of dues if any.",
    "{{if noDeposit}}@ That no security deposit is payable under this agreement.",
    "@ That the rent will be based on the prevailing market rate, if agreed mutually between both the parties.",
    "@ That if the Tenant wants to make any changes to the property, the Tenant will have to get permission from the Owner first, and the same shall be restored by the Tenant at the time of vacating the flat.",
    "@ That in the event of any damage caused to the said premises due to the negligence of the Tenant, the Owner is entitled to be compensated. The Tenant undertakes to maintain the premises with due care and caution.",
    "@ That in case the dues of the rent, electricity, water etc. are not paid regularly on the due date to the concerned authorities, the rent deed can be terminated by the Owner even before the expiry of the rent period, and the rent can be recovered through a court of law with compensation, interest and expenses/losses incurred to recover the same, and the Owner will be entitled to evict the Tenant through a court of law.",
    "@ That the original of this agreement will be retained by the Owner.",
    "{{if lockIn}}@ {lockInText}",
    "{{if escalation}}@ That the rent will be increased by {escalation}% after {termMonths} months, if agreed mutually between both the parties.",
    "@ That all day-to-day repairs of a minor nature, such as replacement of fuses, small electrical and plumbing work, will be taken care of by the Tenant. {renewalText}",
    "@ That the Tenant shall peacefully permit the Owner or the Owner's representative to enter the premises at all reasonable times in order to examine the state and condition of the premises.",
    "@ That on the expiry of the rent period, the Tenant shall hand over peaceful and vacant possession of the said premises to the Owner with all the fittings and fixtures intact, in the same good working condition as the Tenant received them.",
    "@ That either party can vacate the premises with {noticePeriod} prior written notice, that is, if the Owner wants to take exclusive possession of the flat the Owner shall give {noticePeriod} prior notice to the Tenant, and if the Tenant wants to vacate the Tenant shall give {noticePeriod} prior notice.",
    "@ That on any illegal activity or misconduct by the Tenant, the Tenant shall leave the property without prior notice as instructed by the Owner.",
    "{{if furnishing}}@ That the flat is let out as follows: {furnishingText}. It shall be returned in the same condition at the end of the lease.",
    "@ That the Tenant shall use the scheduled premises for residential purposes only. The Tenant shall not use the premises for any illegal or objectionable purpose or for any business activities. The Tenant shall use the premises without causing any nuisance or annoyance to the neighbours. The Tenant shall abide by the terms and conditions set by the Residents Association and shall complete the Tenant Registration Form and submit it to the Association office.",
    "@ That the Tenant shall not sub-let, assign, or otherwise part with the possession of the scheduled premises to or in favour of anyone else. The Tenant shall not grant any licence or leave to anyone else to use the premises or any portion thereof. In case any misconduct is observed, the Tenant has to vacate the flat.",
    "@ That both the Owner and the Tenant will be bound by the terms and conditions of this Rent Agreement.",
    "@ That if any illegal activity is carried out in the flat, the Tenant will be responsible; the Owner is not responsible for any illegal activity carried out in the flat.",
    "{{if extra}}@ {extra}",
    "IN WITNESS WHEREOF the parties have signed this agreement on {today}.",
    "Witness: ______________________",
    "ATTESTED (Notary seal): ______________________"
  ].join('\n');

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function money(n, cur) {
    var v = (Math.round(n * 100) / 100), indian = /^(rs\.?|inr|\u20b9)$/i.test(cur || '');
    var s = v.toLocaleString(indian ? 'en-IN' : 'en-GB', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
    return (cur || '') + s;
  }

  /* 13000 → "Rupees Thirteen Thousand Only" (Indian lakh / crore grouping) */
  var ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  var TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  function two(n) { return n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : ''); }
  function three(n) { var h = Math.floor(n / 100), r = n % 100; return (h ? ONES[h] + ' Hundred' + (r ? ' ' : '') : '') + (r ? two(r) : ''); }
  function words(n, cur) {
    n = Math.round(+n || 0);
    var unit = { 'rs.': 'Rupees', 'rs': 'Rupees', 'inr': 'Rupees', '\u20b9': 'Rupees', '\u20ac': 'Euros', '$': 'Dollars', '\u00a3': 'Pounds' }[String(cur || '').toLowerCase()] || '';
    var p = [], cr = Math.floor(n / 1e7), lk = Math.floor(n % 1e7 / 1e5), th = Math.floor(n % 1e5 / 1e3), rest = n % 1e3;
    if (cr) p.push(three(cr) + ' Crore'); if (lk) p.push(two(lk) + ' Lakh'); if (th) p.push(two(th) + ' Thousand'); if (rest) p.push(three(rest));
    return (unit ? unit + ' ' : '') + (p.length ? p.join(' ') : 'Zero') + ' Only';
  }
  function ordinal(n) { n = +n || 1; var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function noticeText(days) { days = +days || 30; var m = { 30: 'one month', 60: 'two months', 90: 'three months' }; return m[days] || days + ' days'; }

  function vars(r, flat, settings) {
    var Core = root.Core, cur = settings.currency || '';
    var L = settings.landlord || {}, T = r.tenant || {};
    var months = r.end ? Math.max(1, Math.round((Core.diffDays(r.end, r.start) + 1) / 30.44)) : 0;
    var esc_ = +r.escalation > 0;
    return {
      today: Core.longDate(Core.todayISO()), city: settings.city || '____________',
      landlordName: L.name || '____________', landlordAddress: L.address || '____________',
      landlordIdText: L.idNo ? ' (Aadhaar: ' + L.idNo + ')' : '',
      tenantName: T.name || '____________', tenantAddress: T.address || '____________',
      tenantIdText: T.idNo ? ' (Aadhaar: ' + T.idNo + ')' : '',
      flatName: (flat && flat.name) || '____________', flatAddress: (flat && flat.address) || '____________',
      furnishing: r.furnishing || (flat && flat.furnishing) || '', furnishingText: r.furnishing || (flat && flat.furnishing) || '',
      startDate: Core.longDate(r.start), endDate: r.end ? Core.longDate(r.end) : '',
      periodText: r.end ? 'for a period of ' + months + ' months from ' + Core.longDate(r.start) : 'from ' + Core.longDate(r.start),
      termMonths: months || 11,
      tenureText: r.end ? 'It will depend on the mutual consent of both the parties whether the said tenure is extended or expires after ' + months + ' months.' : 'It continues month to month until ended as set out below.',
      rent: money(+r.rent, cur), rentWords: words(r.rent, cur), dueDay: r.dueDay || 1, dueDayOrd: ordinal(r.dueDay || 1),
      payInfoText: settings.payInfo ? ' Payment is to be made by: ' + settings.payInfo : '',
      escalation: esc_ ? r.escalation : '',
      renewalText: esc_ ? 'The rent will be increased by ' + r.escalation + '% or as per the market rate on renewal of the agreement.' : 'The rent on renewal will be as per the market rate, if agreed mutually.',
      deposit: (+r.deposit > 0) ? money(+r.deposit, cur) : '', depositWords: words(r.deposit, cur), noDeposit: (+r.deposit > 0) ? '' : 'yes',
      lockIn: +r.lockIn > 0 ? r.lockIn : '',
      lockInText: +r.lockIn > 0 ? (+r.deposit > 0 ? r.lockIn + ' MONTHS LOCK-IN PERIOD, OTHERWISE THE DEPOSIT WILL NOT BE RETURNED UNDER ANY CONDITION.' : 'There is a lock-in period of ' + r.lockIn + ' months.') : '',
      utilities: r.utilities || 'including maintenance, excluding the electricity bill (with meter rent if any), electricity power backup, fixed charges and other charges, which are to be borne by the Tenant',
      noticePeriod: noticeText(r.noticeDays),
      extra: r.extra || ''
    };
  }

  function renderText(tpl, v) {
    var out = [], n = 0;
    String(tpl).split('\n').forEach(function (line) {
      var m = line.match(/^\{\{if (\w+)\}\}(.*)$/);
      if (m) { if (!v[m[1]]) return; line = m[2]; }
      if (!line.trim() && !out.length) return;
      line = line.replace(/\{(\w+)\}/g, function (_, k) { return v[k] == null ? '' : v[k]; });
      if (line.indexOf('@ ') === 0) line = (++n) + '. ' + line.slice(2);
      out.push(line);
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

  root.Agreement = { DEFAULT_TEMPLATE: DEFAULT_TEMPLATE, vars: vars, renderText: renderText, toBlocks: toBlocks, blocksHTML: blocksHTML, money: money, words: words, esc: esc };
})(typeof window !== 'undefined' ? window : globalThis);
