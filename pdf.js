/* Rent Desk – tiny PDF writer for text agreements (A4, Helvetica, optional JPEG signatures). Needs a browser (uses canvas to measure text). */
(function (root) {
  var W = 595.28, H = 841.89, M = 58;
  var WIN = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '™': 0x99, 'Œ': 0x8C, 'œ': 0x9C, 'Š': 0x8A, 'š': 0x9A, 'Ž': 0x8E, 'ž': 0x9E, 'Ÿ': 0x9F };

  function toBytes(str) {
    str = String(str).replace(/₹/g, 'Rs ').replace(/ /g, ' ');
    var out = [];
    for (var ch of str) {
      var c = ch.codePointAt(0);
      if (WIN[ch]) out.push(WIN[ch]); else if (c < 256) out.push(c); else out.push(63);
    }
    return out;
  }
  function pdfStr(str) {
    var b = toBytes(str), s = '';
    for (var i = 0; i < b.length; i++) {
      var c = b[i];
      if (c === 40 || c === 41 || c === 92) s += '\\' + String.fromCharCode(c);
      else if (c < 32 || c > 126) s += '\\' + ('00' + c.toString(8)).slice(-3);
      else s += String.fromCharCode(c);
    }
    return '(' + s + ')';
  }
  function num(n) { return (Math.round(n * 100) / 100).toString(); }

  var ctx = null;
  function width(text, size, bold) {
    if (!ctx) ctx = document.createElement('canvas').getContext('2d');
    ctx.font = (bold ? 'bold ' : '') + '100px Arial, Helvetica, sans-serif';
    return ctx.measureText(String(text).replace(/₹/g, 'Rs ')).width * size / 100 * 1.02;
  }
  function wrap(text, size, bold, maxW) {
    var words = String(text).split(/\s+/), lines = [], cur = '';
    words.forEach(function (w) {
      var t = cur ? cur + ' ' + w : w;
      if (width(t, size, bold) <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; }
    });
    if (cur) lines.push(cur);
    return lines;
  }
  function dataUrlBytes(url) {
    var bin = atob(url.split(',')[1]), a = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  }
  function imageSize(a) { /* read width/height from a JPEG */
    var i = 2;
    while (i < a.length) {
      if (a[i] !== 0xFF) { i++; continue; }
      var mk = a[i + 1];
      if (mk >= 0xC0 && mk <= 0xC3) return { h: (a[i + 5] << 8) | a[i + 6], w: (a[i + 7] << 8) | a[i + 8] };
      i += 2 + ((a[i + 2] << 8) | a[i + 3]);
    }
    return { w: 300, h: 100 };
  }

  /* opts: {blocks, sign:{left:{role,name,img,date}, right:{...}}, footer} → Blob */
  function build(opts) {
    var pages = [], cur = null, y = 0, images = [];
    function newPage() { cur = []; pages.push(cur); y = H - M; }
    function text(s, x, yy, size, bold, gray) {
      cur.push((gray ? '0.45 g ' : '0.13 g ') + 'BT /' + (bold ? 'F2' : 'F1') + ' ' + size + ' Tf ' + num(x) + ' ' + num(yy) + ' Td ' + pdfStr(s) + ' Tj ET');
    }
    function need(h) { if (y - h < M + 20) newPage(); }
    newPage();
    var textW = W - 2 * M;
    opts.blocks.forEach(function (b) {
      if (b.t === 'title') {
        wrap(b.text, 17, true, textW).forEach(function (l) { need(26); y -= 20; text(l, M, y, 17, true); });
        y -= 10;
      } else if (b.t === 'h') {
        y -= 8; need(40); wrap(b.text, 11.5, true, textW).forEach(function (l) { y -= 16; text(l, M, y, 11.5, true); }); y -= 2;
      } else if (b.t === 'li') {
        var ls = wrap(b.text, 10.5, false, textW - 16);
        ls.forEach(function (l, i) { need(16); y -= 15; if (i === 0) text('•', M + 2, y, 10.5, false); text(l, M + 16, y, 10.5, false); });
        y -= 3;
      } else {
        wrap(b.text, 10.5, false, textW).forEach(function (l) { need(16); y -= 15; text(l, M, y, 10.5, false); });
        y -= 5;
      }
    });
    if (opts.sign) {
      need(170); y -= 24;
      text('Signatures', M, y, 11.5, true); y -= 14;
      var colW = (textW - 30) / 2, top = y;
      [opts.sign.left, opts.sign.right].forEach(function (p, i) {
        var x = M + i * (colW + 30), yy = top;
        text(p.role, x, yy - 12, 9.5, false, true);
        if (p.img) {
          var bytes = dataUrlBytes(p.img), sz = imageSize(bytes), hh = 52, ww = Math.min(hh * sz.w / sz.h, colW);
          images.push({ bytes: bytes, w: sz.w, h: sz.h });
          cur.push('q ' + num(ww) + ' 0 0 ' + num(hh) + ' ' + num(x) + ' ' + num(yy - 20 - hh) + ' cm /Im' + images.length + ' Do Q');
        }
        cur.push('0.4 G 0.6 w ' + num(x) + ' ' + num(yy - 78) + ' m ' + num(x + colW) + ' ' + num(yy - 78) + ' l S');
        text(p.name || '', x, yy - 92, 10.5, true);
        text(p.date ? 'Date: ' + p.date : 'Date: ______________', x, yy - 108, 10, false, true);
      });
      y = top - 116;
    }
    /* assemble */
    var chunks = [], offsets = [], pos = 0;
    function put(s) { var a = typeof s === 'string' ? new Uint8Array(toBytes(s)) : s; chunks.push(a); pos += a.length; }
    function obj(n, body) { offsets[n] = pos; put(n + ' 0 obj\n'); put(body); put('\nendobj\n'); }
    var nImg = images.length, firstPageObj = 5 + nImg, total = pages.length;
    put('%PDF-1.4\n');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    var kids = pages.map(function (_, i) { return (firstPageObj + i * 2 + 1) + ' 0 R'; }).join(' ');
    obj(2, '<< /Type /Pages /Kids [' + kids + '] /Count ' + total + ' >>');
    obj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    obj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    var xo = '';
    images.forEach(function (im, i) {
      offsets[5 + i] = pos;
      put((5 + i) + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + im.w + ' /Height ' + im.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + im.bytes.length + ' >>\nstream\n');
      put(im.bytes); put('\nendstream\nendobj\n');
      xo += '/Im' + (i + 1) + ' ' + (5 + i) + ' 0 R ';
    });
    pages.forEach(function (ops, i) {
      if (opts.footer) ops.push('0.5 g BT /F1 8.5 Tf ' + num(M) + ' 30 Td ' + pdfStr(opts.footer + '   ·   Page ' + (i + 1) + ' of ' + total) + ' Tj ET');
      var content = ops.join('\n');
      var c = firstPageObj + i * 2, p = c + 1;
      obj(c, '<< /Length ' + toBytes(content).length + ' >>\nstream\n' + content + '\nendstream');
      obj(p, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] /Contents ' + c + ' 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << ' + xo + '>> >> >>');
    });
    var count = firstPageObj + total * 2, xref = pos;
    put('xref\n0 ' + count + '\n0000000000 65535 f \n');
    for (var n = 1; n < count; n++) put(('0000000000' + offsets[n]).slice(-10) + ' 00000 n \n');
    put('trailer\n<< /Size ' + count + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF');
    return new Blob(chunks, { type: 'application/pdf' });
  }
  root.PDF = { build: build };
})(window);
