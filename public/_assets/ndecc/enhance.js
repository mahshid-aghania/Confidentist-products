/* ConfiDentist NDECC page — interaction & scroll-motion layer (no dependencies).
 * Modules: reveals · card light/tilt · magnetic buttons + arrows · table column
 * highlight · FAQ accordion · particle-field backgrounds · hero parallax ·
 * deferred loading of the WebGL hero. Each module is independent and optional;
 * nothing here changes text, links or behaviour of the page. */
(function () {
  'use strict';
  var root = document.documentElement;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var $$ = function (sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); };

  /* ── 1 · Scroll reveals ───────────────────────────────────────────── */
  function reveals() {
    var groups = [
      '.section-head', '.program-card', '.compare-wrap tbody tr', '.cmp-card',
      '.decision-card', '.decision-actions', '.trust-card', '.faq details', '.final-inner > *'
    ];
    var targets = [];
    groups.forEach(function (sel) {
      var byParent = new Map();
      $$(sel).forEach(function (el) {
        var i = byParent.get(el.parentNode) || 0; byParent.set(el.parentNode, i + 1);
        el.style.setProperty('--nd-d', Math.min(i * 90, 450) + 'ms');
        targets.push(el);
      });
    });
    if (!('IntersectionObserver' in window)) { targets.forEach(function (el) { el.classList.add('nd-in'); }); return; }
    var fold = window.innerHeight * 0.92;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('nd-in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    targets.forEach(function (el) {
      // Only hide what is below the fold at load — never hide what the visitor already sees.
      if (!reduce && el.getBoundingClientRect().top > fold) el.classList.add('nd-reveal');
      io.observe(el);
    });
    root.classList.add('nd-js');
  }

  /* ── 2 · Program cards: cursor light + subtle 3D tilt ─────────────── */
  function cards() {
    if (!finePointer || reduce) return;
    $$('.program-card').forEach(function (card) {
      var raf = 0, ev = null;
      function apply() {
        raf = 0; if (!ev) return;
        var r = card.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height;
        card.style.setProperty('--nd-mx', (x * 100).toFixed(1) + '%');
        card.style.setProperty('--nd-my', (y * 100).toFixed(1) + '%');
        card.style.setProperty('--nd-ry', ((x - .5) * 5).toFixed(2) + 'deg');
        card.style.setProperty('--nd-rx', ((.5 - y) * 4).toFixed(2) + 'deg');
      }
      card.addEventListener('pointerenter', function () { card.classList.add('nd-tilting'); });
      card.addEventListener('pointermove', function (e) { ev = e; if (!raf) raf = requestAnimationFrame(apply); }, { passive: true });
      card.addEventListener('pointerleave', function () {
        card.classList.remove('nd-tilting'); ev = null;
        card.style.setProperty('--nd-rx', '0deg'); card.style.setProperty('--nd-ry', '0deg');
      });
    });
  }

  /* ── 3 · Buttons: magnetic pull (desktop) + animated arrows ────────── */
  function buttons() {
    var btns = $$('.btn-gold, .btn-outline-white, .btn-navy, .btn-ghost, .compare-cta-row a');
    // Wrap a trailing "→" in a span so it can glide; the visible text is unchanged.
    btns.forEach(function (b) {
      var n = b.lastChild;
      if (n && n.nodeType === 3 && /→\s*$/.test(n.nodeValue)) {
        var txt = n.nodeValue.replace(/\s*→\s*$/, ''), sp = document.createElement('span');
        sp.className = 'nd-arrow'; sp.textContent = '→';
        n.nodeValue = txt + ' '; b.appendChild(sp);
      }
      var last = b.querySelector(':scope > span[aria-hidden="true"]');
      if (last && /→/.test(last.textContent)) last.classList.add('nd-arrow');
    });
    if (!finePointer || reduce) return;
    btns.forEach(function (b) {
      if (b.closest('table')) return;
      b.classList.add('nd-mag');
      b.addEventListener('pointermove', function (e) {
        var r = b.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        b.style.setProperty('--nd-bx', Math.max(-6, Math.min(6, dx * .16)).toFixed(1) + 'px');
        b.style.setProperty('--nd-by', Math.max(-4, Math.min(4, dy * .22)).toFixed(1) + 'px');
      }, { passive: true });
      b.addEventListener('pointerleave', function () { b.style.setProperty('--nd-bx', '0px'); b.style.setProperty('--nd-by', '0px'); });
    });
  }

  /* ── 4 · Comparison table: column highlight ─────────────────────────── */
  function table() {
    var t = document.querySelector('table.compare'); if (!t) return;
    var lastCol = -1;
    function set(col) {
      if (col === lastCol) return; lastCol = col;
      $$('.nd-col', t).forEach(function (c) { c.classList.remove('nd-col'); });
      if (col < 1) return;
      $$('tr', t).forEach(function (tr) { var c = tr.children[col]; if (c) c.classList.add('nd-col'); });
    }
    t.addEventListener('pointerover', function (e) { var c = e.target.closest('td, th'); if (c && t.contains(c)) set(c.cellIndex); });
    t.addEventListener('pointerleave', function () { set(-1); });
    t.addEventListener('focusin', function (e) { var c = e.target.closest('td, th'); if (c) set(c.cellIndex); });
    t.addEventListener('focusout', function () { set(-1); });
  }

  /* ── 5 · FAQ: smooth accordion on native <details> ──────────────────── */
  function faq() {
    if (reduce || !('animate' in Element.prototype)) return;
    $$('.faq details').forEach(function (d) {
      var s = d.querySelector('summary'), anim = null;
      s.addEventListener('click', function (e) {
        e.preventDefault();
        if (anim) anim.cancel();
        var start = d.offsetHeight;
        if (!d.open) {
          d.open = true;
          var end = d.offsetHeight;
          anim = d.animate({ height: [start + 'px', end + 'px'] }, { duration: 380, easing: 'cubic-bezier(.2,.7,.2,1)' });
        } else {
          d.classList.add('nd-closing');
          var endC = s.offsetHeight + (d.offsetHeight - d.clientHeight);
          anim = d.animate({ height: [start + 'px', endC + 'px'] }, { duration: 300, easing: 'cubic-bezier(.4,0,.2,1)' });
          anim.onfinish = function () { d.open = false; d.classList.remove('nd-closing'); };
        }
        anim.oncancel = function () { d.classList.remove('nd-closing'); };
        var a = anim; a.addEventListener('finish', function () { if (anim === a) anim = null; });
      });
    });
  }

  /* ── 6 · Particle-field backgrounds (fine connecting lines) ─────────── */
  function fields() {
    var sections = [];
    $$('.section-title').forEach(function (h) {
      if (/Two Components|Which NDECC Program/.test(h.textContent)) sections.push(h.closest('section'));
    });
    sections.forEach(function (sec) {
      if (!sec) return;
      sec.classList.add('nd-field');
      var c = document.createElement('canvas'); c.className = 'nd-field-canvas'; c.setAttribute('aria-hidden', 'true');
      sec.insertBefore(c, sec.firstChild);
      var ctx = c.getContext('2d'); if (!ctx) return;
      var dpr = Math.min(window.devicePixelRatio || 1, 1.5), W = 0, H = 0, pts = [], running = false, raf = 0, last = 0;
      function size() {
        var r = sec.getBoundingClientRect(); W = r.width; H = r.height;
        c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        var n = Math.max(18, Math.min(56, Math.round(W * H / 26000)));
        pts = []; for (var i = 0; i < n; i++) pts.push({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - .5) * 10, vy: (Math.random() - .5) * 8, r: .8 + Math.random() * 1.4 });
        draw(0);
      }
      function draw(dt) {
        ctx.clearRect(0, 0, W, H);
        var maxD = Math.min(170, W / 6), i, j, p, q;
        for (i = 0; i < pts.length; i++) {
          p = pts[i]; p.x += p.vx * dt; p.y += p.vy * dt;
          if (p.x < -10) p.x = W + 10; if (p.x > W + 10) p.x = -10; if (p.y < -10) p.y = H + 10; if (p.y > H + 10) p.y = -10;
        }
        ctx.lineWidth = .6;
        for (i = 0; i < pts.length; i++) for (j = i + 1; j < pts.length; j++) {
          p = pts[i]; q = pts[j]; var dx = p.x - q.x, dy = p.y - q.y, d = Math.sqrt(dx * dx + dy * dy);
          if (d < maxD) { ctx.strokeStyle = 'rgba(15,122,229,' + (0.10 * (1 - d / maxD)).toFixed(3) + ')'; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); }
        }
        for (i = 0; i < pts.length; i++) { p = pts[i]; ctx.fillStyle = i % 5 === 0 ? 'rgba(59,175,191,.35)' : 'rgba(15,122,229,.28)'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.2832); ctx.fill(); }
      }
      function tick(now) { raf = 0; var dt = Math.min((now - last) / 1000, .05); last = now; draw(dt); if (running) raf = requestAnimationFrame(tick); }
      function start() { if (running || reduce || document.hidden) return; running = true; last = performance.now(); raf = requestAnimationFrame(tick); }
      function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }
      size();
      if ('ResizeObserver' in window) new ResizeObserver(function () { size(); }).observe(sec);
      if ('IntersectionObserver' in window) new IntersectionObserver(function (en) { en[0].isIntersecting ? start() : stop(); }).observe(sec);
      document.addEventListener('visibilitychange', function () { document.hidden ? stop() : start(); });
    });
  }

  /* ── 7 · Hero background parallax ──────────────────────────────────── */
  function parallax() {
    var hero = document.querySelector('.nd-hero'); if (!hero || reduce) return;
    var ticking = false;
    window.addEventListener('scroll', function () {
      if (ticking) return; ticking = true;
      requestAnimationFrame(function () {
        ticking = false; var y = window.scrollY;
        if (y < hero.offsetHeight + 200) hero.style.setProperty('--nd-par', (y * 0.22).toFixed(1) + 'px');
      });
    }, { passive: true });
  }

  /* ── 8 · Lazy-load the WebGL hero after first paint ────────────────── */
  function heroGL() {
    if (reduce || !document.getElementById('ndHeroVisual')) return;
    var load = function () { var s = document.createElement('script'); s.src = '/_assets/ndecc/hero-particles.js'; s.async = true; document.body.appendChild(s); };
    var idle = window.requestIdleCallback || function (cb) { return setTimeout(cb, 300); };
    if (document.readyState === 'complete') idle(load, { timeout: 1200 });
    else window.addEventListener('load', function () { idle(load, { timeout: 1200 }); });
  }

  function run(fn) { try { fn(); } catch (e) { if (window.console) console.warn('[ndecc enhance]', e); } }
  [reveals, cards, buttons, table, faq, fields, parallax, heroGL].forEach(run);
})();
