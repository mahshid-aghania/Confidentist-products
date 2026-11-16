/* ============================================================================
   ConfiDentist — shared site navigation behavior  (confi-nav v1)
   Powers the primary navbar on EVERY page. Self-initializing, defensive
   (null-checked), safe to load once per page. Edit here only.
   ============================================================================ */
(function () {
  'use strict';

  /* Header: transparent -> solid on scroll */
  function initHeader() {
    var header = document.getElementById('siteHeader');
    if (!header) return;
    var onScroll = function () { header.classList.toggle('solid', window.scrollY > 40); };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* Desktop mega menu (one per dropdown item) */
  function initMega(itemId, triggerId) {
    var item = document.getElementById(itemId);
    var trigger = document.getElementById(triggerId);
    if (!item || !trigger) return;
    var closeTimer;
    var open = function (state) { clearTimeout(closeTimer); item.classList.toggle('open', state); trigger.setAttribute('aria-expanded', String(state)); };
    var scheduleClose = function () { clearTimeout(closeTimer); closeTimer = setTimeout(function () { open(false); }, 180); };
    trigger.addEventListener('click', function (e) { e.stopPropagation(); open(!item.classList.contains('open')); });
    item.addEventListener('mouseenter', function () { open(true); });
    item.addEventListener('mouseleave', scheduleClose);
    document.addEventListener('click', function (e) { if (!item.contains(e.target)) open(false); });
    item.addEventListener('keyup', function (e) { if (e.key === 'Escape') { open(false); trigger.focus(); } });
  }

  /* Mobile slide-in menu */
  function initMobile() {
    var body = document.body;
    var btn = document.getElementById('hamburger');
    var panel = document.getElementById('mobilePanel');
    var backdrop = document.getElementById('backdrop');
    if (!btn || !panel || !backdrop) return;
    var lastFocus = null;

    var close = function () {
      body.classList.remove('mobile-open', 'no-scroll');
      btn.setAttribute('aria-expanded', 'false');
      panel.setAttribute('aria-hidden', 'true');
      if (lastFocus) lastFocus.focus();
    };
    var open = function () {
      lastFocus = document.activeElement;
      body.classList.add('mobile-open', 'no-scroll');
      btn.setAttribute('aria-expanded', 'true');
      panel.setAttribute('aria-hidden', 'false');
      var first = panel.querySelector('a');
      if (first) first.focus();
    };
    btn.addEventListener('click', function () { body.classList.contains('mobile-open') ? close() : open(); });
    backdrop.addEventListener('click', close);
    panel.querySelectorAll('a').forEach(function (a) { a.addEventListener('click', close); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && body.classList.contains('mobile-open')) close();
      if (e.key === 'Tab' && body.classList.contains('mobile-open')) {
        var f = panel.querySelectorAll('a, button');
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
  }

  function init() {
    initHeader();
    initMega('equivItem', 'equivTrigger');
    initMega('ceItem', 'ceTrigger');
    initMega('resItem', 'resTrigger');
    initMega('aboutItem', 'aboutTrigger');
    initMobile();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
