/* Schedule copy buttons — used on every course schedule page.
 *
 * Adds a "Copy full schedule" button at the top of the schedule and a "Copy this
 * block" button above each schedule table. Copies BOTH:
 *   - plain text (tab-separated, one session per line) — pastes cleanly into
 *     WhatsApp, email, notes, Excel and Google Sheets (as columns), and
 *   - an HTML table — pastes as a formatted table into Word, Google Docs and Gmail.
 * Schedule text stays selectable, so people can also highlight and copy by hand.
 */
(function () {
  var TABLES = 'table.cf-table, .acj27 table, table.sched';
  var tables = [].slice.call(document.querySelectorAll(TABLES));
  if (!tables.length) return;

  var css = document.createElement('style');
  css.textContent =
    '.cf-sched, .acj27, .cf-table, .acj27 table, table.sched { -webkit-user-select: text; user-select: text; }' +
    '.sched-copy { display:inline-flex; align-items:center; gap:.4rem; font: 600 14px/1.2 Inter, Jost, Helvetica, Arial, sans-serif;' +
    ' color:#1e3f66; background:#fff; border:1.5px solid #a9c3e0; border-radius:999px; padding:.5rem .95rem; cursor:pointer; margin:0 0 12px; }' +
    '.sched-copy:hover { background:#1e3f66; color:#fff; border-color:#1e3f66; }' +
    '.sched-copy.done { background:#0b8a3b; color:#fff; border-color:#0b8a3b; }' +
    '.sched-copy svg { width:16px; height:16px; }' +
    '.sched-copy-all { margin:0 0 18px; font-size:15px; padding:.6rem 1.1rem; }';
  document.head.appendChild(css);

  var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

  function clean(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
  function esc(s) { return s.replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }

  // Title for a table: the phase/block summary (without its sub-line) or caption.
  function titleOf(t) {
    var d = t.closest('details');
    var sum = d && d.querySelector('summary');
    if (sum) {
      var c = sum.cloneNode(true);
      [].slice.call(c.querySelectorAll('span')).forEach(function (sp) {
        if (/display:\s*block/.test(sp.getAttribute('style') || '')) sp.remove();
      });
      return clean(c.textContent);
    }
    var cap = t.querySelector('caption');
    return cap ? clean(cap.textContent) : '';
  }
  function rowsOf(t) {
    return [].slice.call(t.querySelectorAll('tr')).map(function (tr) {
      return [].slice.call(tr.querySelectorAll('th, td')).map(function (c) { return clean(c.textContent); });
    }).filter(function (r) { return r.length && r.join('') !== ''; });
  }
  function build(list) {
    var text = [], html = [];
    var page = clean((document.querySelector('.cf-title, .acj27 header h2, h1') || {}).textContent || document.title);
    if (list.length > 1 && page) { text.push(page, ''); html.push('<h2>' + esc(page) + '</h2>'); }
    list.forEach(function (t, i) {
      var title = titleOf(t), rows = rowsOf(t);
      if (title) { text.push(title); html.push('<h3>' + esc(title) + '</h3>'); }
      rows.forEach(function (r) { text.push(r.join('\t')); });
      html.push('<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse">' +
        rows.map(function (r, k) {
          var tag = k === 0 ? 'th' : 'td';
          return '<tr>' + r.map(function (c) { return '<' + tag + '>' + esc(c) + '</' + tag + '>'; }).join('') + '</tr>';
        }).join('') + '</table>');
      if (i < list.length - 1) text.push('');
    });
    return { text: text.join('\n'), html: html.join('\n') };
  }
  function fallback(text) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    var ok = false; try { ok = document.execCommand('copy'); } catch (e) {}
    ta.remove(); return ok;
  }
  function copy(payload) {
    if (navigator.clipboard && window.ClipboardItem && window.isSecureContext) {
      try {
        return navigator.clipboard.write([new ClipboardItem({
          'text/plain': new Blob([payload.text], { type: 'text/plain' }),
          'text/html': new Blob([payload.html], { type: 'text/html' })
        })]).then(function () { return true; }, function () {
          return navigator.clipboard.writeText(payload.text).then(function () { return true; }, function () { return fallback(payload.text); });
        });
      } catch (e) { /* fall through */ }
    }
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(payload.text).then(function () { return true; }, function () { return fallback(payload.text); });
    }
    return Promise.resolve(fallback(payload.text));
  }
  function button(label, cls, getTables) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'sched-copy ' + (cls || '');
    b.innerHTML = ICON + '<span>' + label + '</span>';
    b.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      copy(build(getTables())).then(function (ok) {
        var s = b.querySelector('span');
        b.classList.toggle('done', !!ok);
        s.textContent = ok ? 'Copied! Paste anywhere' : 'Press Ctrl/Cmd+C to copy';
        setTimeout(function () { b.classList.remove('done'); s.textContent = label; }, 2200);
      });
    });
    return b;
  }

  tables.forEach(function (t) {
    var anchor = t.closest('[style*="overflow-x"], .scroll, .table-wrap') || t;
    anchor.parentNode.insertBefore(button(tables.length > 1 ? 'Copy this block' : 'Copy schedule', '', function () { return [t]; }), anchor);
  });
  if (tables.length > 1) {
    var first = tables[0].closest('details') || tables[0];
    first.parentNode.insertBefore(button('Copy full schedule', 'sched-copy-all', function () { return tables; }), first);
  }
})();
