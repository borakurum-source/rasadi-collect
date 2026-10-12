/**
 * Rasadi tracker source (v2, D-106) and its once-per-process minified
 * template. Lives outside the route file: Next route modules may only
 * export HTTP handlers and route config.
 */
// Request-specific values are injected into the (minified) template as
// string tokens, so the template is minified once per process (D-106).
export const BAKED_TOKEN = '__RASADI_BAKED_SID__'
export const API_TOKEN = '__RASADI_API_FALLBACK__'

// Universal mode: the site ID comes from the script tag's data-sid
// attribute. document.currentScript is null in async/timing edges and in
// inlined or bundled copies — without a fallback the tracker silently drops
// every event (BUG-021). Chain: baked ?sid= → currentScript → tag scan →
// window.rasadi_sid.
// The collect endpoint is derived from the script tag's own URL, so the
// snippet works behind any path proxy (e.g. /rasadi-api/script → /rasadi-api/collect).
// The match must tolerate a query string: legacy baked snippets load
// /api/script?sid=…, where /script$/ never matches and the beacon URL
// became the 404 "/api/script?sid=…collect" (BUG-005).
export const TRACKER_SOURCE = `/* Rasadi tracker v2 — rasadi.com.tr */
(function () {
  var BAKED = "${BAKED_TOKEN}";
  var SID = BAKED || (function () {
    try {
      var cs = document.currentScript && document.currentScript.getAttribute('data-sid');
      if (cs) return cs;
      var tags = document.getElementsByTagName('script');
      for (var i = tags.length - 1; i >= 0; i--) {
        var v = tags[i].getAttribute && tags[i].getAttribute('data-sid');
        if (v) return v;
      }
      if (typeof window !== 'undefined' && window.rasadi_sid) return window.rasadi_sid;
    } catch (e) {}
    return null;
  })();
  var API_FALLBACK = "${API_TOKEN}";
  var API_FROM_TAG = (function () {
    try {
      var s = document.currentScript && document.currentScript.src;
      if (s && s.indexOf('/script') !== -1) return s.replace(/\\/script([?#].*)?$/, '/collect');
    } catch (e) {}
    return API_FALLBACK;
  })();
  if (!SID) return;
  // Toast language (D-140, Wave 0 contract — docs/tracker-locale-contract.md):
  // the snippet's own data-locale attribute wins, then ?locale= on the
  // script URL, then 'tr'. Only the self-exclusion toasts are localized;
  // no event payload changes.
  var TRACK_LOCALE = (function () {
    try {
      var tag = document.currentScript;
      var dl = tag && tag.getAttribute && tag.getAttribute('data-locale');
      if (dl === 'en' || dl === 'tr') return dl;
      var src = (tag && tag.src) || '';
      var lm = /[?&]locale=(en|tr)\\b/.exec(src);
      if (lm) return lm[1];
    } catch (e) {}
    return 'tr';
  })();
  var w = window;
  // Same snippet installed twice (theme + plugin, copy-paste) must not
  // double-count: a repeat run for the same sid is a no-op (BUG-022).
  // Per-sid so distinct sids on one page still initialize independently.
  w._rasadi_loaded = w._rasadi_loaded || {};
  if (w._rasadi_loaded[SID]) return;
  w._rasadi_loaded[SID] = 1;
  var API = API_FROM_TAG;
  w._rasadi = w._rasadi || { s: SID };

  // Self-exclusion: an excluded browser sends nothing at all (per-site,
  // per-browser — other devices unaffected). The flag MUST be written on the
  // tracked site's own origin: the panel runs on rasadi.com.tr while the
  // tracker reads this site's localStorage, so a panel-side write can never
  // reach it (BUG-026). Instead the owner visits their site once with
  // ?rasadi_exclude=1 (or =0 to undo) — the tracker writes/clears its own
  // flag and confirms with a small toast.
  var EXCLUDE_KEY = 'rasadi_exclude_' + SID;
  function excluded() {
    try { return localStorage.getItem(EXCLUDE_KEY) === '1'; } catch (e) { return false; }
  }
  function excludeToast(msg) {
    try {
      var d = document.createElement('div');
      d.textContent = msg;
      d.setAttribute('style', 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:#102044;color:#fff;font:13px/1.4 system-ui,sans-serif;padding:10px 16px;border-radius:8px;z-index:2147483647;max-width:90vw;text-align:center;');
      if (document.body) document.body.appendChild(d);
      setTimeout(function () { try { d.parentNode.removeChild(d); } catch (e) {} }, 4000);
    } catch (e) {}
  }
  try {
    var exMatch = /[?&]rasadi_exclude=([01])/.exec(location.href || '');
    if (exMatch) {
      if (exMatch[1] === '1') {
        try { localStorage.setItem(EXCLUDE_KEY, '1'); } catch (e) {}
        excludeToast(TRACK_LOCALE === 'en' ? 'This browser is excluded — your visits will not be counted.' : 'Bu tarayıcı hariç tutuldu — ziyaretleriniz sayılmayacak.');
      } else {
        try { localStorage.removeItem(EXCLUDE_KEY); } catch (e) {}
        excludeToast(TRACK_LOCALE === 'en' ? 'Exclusion removed — your visits will be counted.' : 'Hariç tutma kaldırıldı — ziyaretleriniz sayılacak.');
      }
    }
  } catch (e) {}

  // Referrer for the CURRENT view (D-079): document.referrer only for the
  // first pageview of a page load. SPA routers never update document.referrer,
  // so resending it on every pushState credited each in-app view to the
  // landing source (one Google visitor browsing 7 pages = 7 Google views).
  // SPA navigations send the previous in-page URL instead (same host → the
  // server treats it as internal, no source). Query/hash are dropped here so
  // in-page query strings never leave the browser as a referrer.
  // A reload / back-forward keeps the ORIGINAL document.referrer, which
  // re-credited every refresh to the landing source (paid on non-landing
  // views) — such loads send no referrer (D-081).
  var navType = '';
  try {
    var navEntry = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
    navType = (navEntry && navEntry.type) || '';
  } catch (e) {}
  var pageRef = navType === 'reload' || navType === 'back_forward' ? '' : (document.referrer || '');
  function stripUrl(u) {
    try { return String(u || '').split('#')[0].split('?')[0]; } catch (e) { return ''; }
  }

  var MEM_SS = null;
  // 30-minute inactivity timeout (D-081, GA/Plausible convention): a tab
  // reused after a long idle starts a new visit. Engagement pings never
  // rotate the session (they describe the view that just ended).
  var SS_IDLE_MS = 30 * 60 * 1000;
  function ss(keep) {
    try {
      var k = 'rasadi_ss_' + SID;
      var kt = k + '_t';
      var now = Date.now();
      var v = sessionStorage.getItem(k);
      var last = Number(sessionStorage.getItem(kt)) || 0;
      if (!v || (!keep && last && now - last > SS_IDLE_MS)) {
        v = 'ss_' + now + '_' + Math.random().toString(36).slice(2, 8);
        sessionStorage.setItem(k, v);
      }
      if (!keep) sessionStorage.setItem(kt, String(now));
      return v;
    } catch (e) {
      // sessionStorage blocked (Safari private etc.) — fall back to a per-page
      // id so events on one page still share a session instead of collapsing
      // every visitor into a single 'ss_noss' session.
      if (!MEM_SS) MEM_SS = 'ss_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      return MEM_SS;
    }
  }

  function send(type, extra) {
    if (excluded()) return;
    try {
      var payload = Object.assign({
        sid: SID, type: type || 'pageview',
        url: location.href,
        ref: pageRef,
        ss: ss(type === 'engagement')
      }, extra || {});
      payload.v = 2;
      // iPadOS 13+ masquerades as a Mac; a touch-capable "Mac" is an iPad.
      try { if (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1) payload.tp = 1; } catch (e) {}
      // Automation flag (D-105): WebDriver-driven or 0×0-screen browsers are
      // dropped at collect ('bot'). Nothing else about the device is sent.
      try { if (navigator.webdriver || (w.screen && (w.screen.width === 0 || w.screen.height === 0))) payload.bt = 1; } catch (e) {}
      var body = JSON.stringify(payload);
      // text/plain keeps the beacon CORS-safelisted (no preflight) in every
      // browser; the server parses the JSON body regardless of content type.
      if (navigator.sendBeacon) {
        navigator.sendBeacon(API, new Blob([body], { type: 'text/plain;charset=UTF-8' }));
      } else {
        fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true, mode: 'cors' }).catch(function () {});
      }
    } catch (e) {}
  }

  // Manual events / sales:
  //   rasadi.push(['sale', { value: 499.9 }])
  //   rasadi.push(['event', { name: 'iletisim-formu' }])
  w.rasadi = w.rasadi || [];
  if (w.rasadi.push) {
    var origPush = w.rasadi.push.bind(w.rasadi);
    w.rasadi.push = function (item) {
      try {
        if (item && item[0] === 'sale') send('sale', { value: Number(item[1] && item[1].value) || 0, currency: item[1] && item[1].currency });
        else if (item && item[0] === 'event' && item[1] && item[1].name) send('event', { name: String(item[1].name) });
      } catch (e) {}
      return origPush(item);
    };
    for (var i = 0; i < w.rasadi.length; i++) {
      try {
        var it = w.rasadi[i];
        if (it && it[0] === 'sale') send('sale', { value: Number(it[1] && it[1].value) || 0, currency: it[1] && it[1].currency });
        else if (it && it[0] === 'event' && it[1] && it[1].name) send('event', { name: String(it[1].name) });
      } catch (e) {}
    }
  }

  // Route identity (D-081): path + hash only. Query-only changes (filters,
  // sort, replaceState cleanups) are the same page — the server stores
  // path+hash anyway, so they only produced duplicate rows.
  function routeKey(u) {
    var str = String(u || '');
    var h = str.indexOf('#');
    return (h === -1 ? str : str.slice(0, h)).split('?')[0] + (h === -1 ? '' : str.slice(h));
  }

  // Engagement (D-081): visible time on the current view, sent when the tab
  // is hidden or the page unloads, so single-page visits get a real duration
  // instead of "0 s". Cumulative per view; the server keeps the max.
  var visMs = 0;
  var visSince = document.visibilityState === 'hidden' ? 0 : Date.now();
  var lastSig = '';
  var spaNav = 0;

  function slug(v) {
    v = String(v || '').toLowerCase();
    if (/@|\\d{6,}/.test(v)) return '';
    return v.replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  }

  // Scroll depth (D-106): deepest 25 % bucket of the current view.
  var maxSd = 0;
  var scrollT = 0;
  function trackScroll() {
    try {
      var d = document.documentElement, b = document.body;
      if (!d) return;
      var h = Math.max(d.scrollHeight || 0, b ? b.scrollHeight || 0 : 0);
      var vh = w.innerHeight || d.clientHeight || 0;
      if (!h || !vh) return;
      var p = h <= vh + 2 ? 100 : Math.min(100, ((w.pageYOffset || d.scrollTop || 0) + vh) / h * 100);
      var bkt = p >= 99 ? 100 : Math.floor(p / 25) * 25;
      if (bkt > maxSd) maxSd = bkt;
    } catch (e) {}
  }
  try {
    w.addEventListener('scroll', function () {
      if (scrollT) return;
      scrollT = setTimeout(function () { scrollT = 0; trackScroll(); }, 250);
    }, { passive: true });
  } catch (e) {}
  setTimeout(trackScroll, 1000);

  // Web Vitals (D-106): LCP, CLS (session windows) and INP (slowest
  // interaction) of the page load. Timings only — nothing about content.
  var vit = { lcp: 0, inp: 0, cls: 0, hasCls: 0 };
  function observe(type, cb, opts) {
    try {
      var o = new PerformanceObserver(function (l) { var es = l.getEntries(); for (var i = 0; i < es.length; i++) cb(es[i]); });
      o.observe(Object.assign({ type: type, buffered: true }, opts || {}));
      return 1;
    } catch (e) { return 0; }
  }
  if (typeof PerformanceObserver !== 'undefined') {
    observe('largest-contentful-paint', function (e) { vit.lcp = Math.round(e.renderTime || e.startTime || 0); });
    var clsWin = 0, clsFirst = 0, clsLast = 0;
    try { vit.hasCls = (PerformanceObserver.supportedEntryTypes || []).indexOf('layout-shift') !== -1 ? 1 : 0; } catch (e) {}
    observe('layout-shift', function (e) {
      if (e.hadRecentInput) return;
      if (clsWin && e.startTime - clsLast < 1000 && e.startTime - clsFirst < 5000) clsWin += e.value;
      else { clsWin = e.value; clsFirst = e.startTime; }
      clsLast = e.startTime;
      if (clsWin > vit.cls) vit.cls = clsWin;
    });
    observe('event', function (e) { if (e.interactionId && e.duration > vit.inp) vit.inp = Math.round(e.duration); }, { durationThreshold: 40 });
  }

  // Forms (D-106): start / submit / abandon per form — the form key and the
  // NAME of the last field touched. Values are never read. Password,
  // hidden and search fields, search forms and page-wide wrapper forms
  // (ASP.NET, 40+ fields) are skipped.
  var forms = {};
  var SEARCH_RE = /^(q|s|search|kelime|ara|aranan|query|keyword|search_query|txtbxarama)$/i;
  function formKey(f) {
    if (!f || !f.elements || f.elements.length > 40) return '';
    if (f.getAttribute && f.getAttribute('role') === 'search') return '';
    var k = slug(f.id || (f.getAttribute && f.getAttribute('name')) || '');
    if (!k) {
      try {
        var parts = String((f.getAttribute && f.getAttribute('action')) || '').split('?')[0].split('#')[0].split('/');
        k = slug(parts[parts.length - 1] || parts[parts.length - 2] || '');
      } catch (e) {}
    }
    return k || 'form';
  }
  function flushForms() {
    for (var k in forms) {
      var st = forms[k];
      if (st.s && !st.sub && !st.ab) { st.ab = 1; send('form', { name: k, action: 'abandon', field: st.last || '' }); }
    }
  }
  function formSubmit(f) {
    try {
      var k = formKey(f);
      var st = k && forms[k];
      if (!st || st.sub) return;
      st.sub = 1;
      send('form', { name: k, action: 'submit' });
    } catch (e) {}
  }
  document.addEventListener('focusin', function (ev) {
    try {
      var el = ev.target;
      if (!el || !el.form) return;
      var t = String(el.type || '').toLowerCase();
      if (/^(hidden|password|search|submit|button|reset|image)$/.test(t) || SEARCH_RE.test(el.name || '')) return;
      var k = formKey(el.form);
      if (!k) return;
      var st = forms[k] || (forms[k] = {});
      st.last = slug(el.name || el.id || t);
      if (!st.s) { st.s = 1; send('form', { name: k, action: 'start' }); }
    } catch (e) {}
  }, true);
  document.addEventListener('submit', function (ev) { formSubmit(ev.target); }, true);

  // Copy (D-106): only the KIND of what was copied (phone, e-mail, IBAN,
  // price, product code, text) is decided here; the text never leaves.
  var copies = 0;
  function copyKind(t) {
    var s = t.replace(/\\s+/g, ' ').trim();
    if (/^[^\\s@]+@[^\\s@]+\\.[a-z]{2,}$/i.test(s)) return 'e-posta';
    if (/^TR\\d{24}$/i.test(s.replace(/[\\s.-]/g, ''))) return 'iban';
    var digits = s.replace(/\\D/g, '');
    if (/^[+\\d\\s().-]+$/.test(s) && digits.length >= 10 && digits.length <= 13) return 'telefon';
    if (/\\d/.test(s) && /^(\\u20ba|tl|try|\\$|\\u20ac|usd|eur)?\\s?[\\d.,]+\\s?(\\u20ba|tl|try|\\$|\\u20ac|usd|eur)?$/i.test(s) && /\\u20ba|\\$|\\u20ac|tl|try|usd|eur|,\\d{2}$/i.test(s)) return 'fiyat';
    if (s.length >= 3 && s.length <= 24 && !/\\s/.test(s) && /\\d/.test(s) && /[a-z]/i.test(s)) return 'urun-kodu';
    return 'metin';
  }
  document.addEventListener('copy', function () {
    try {
      if (copies >= 5) return;
      var t = String(w.getSelection ? w.getSelection() : '').slice(0, 300);
      if (!t.replace(/\\s+/g, '')) return;
      copies++;
      send('copy', { name: copyKind(t) });
    } catch (e) {}
  }, true);

  // Rage clicks (D-106): 4+ clicks within 1.2 s on one spot → the element's
  // short selector (tag, #id or first .class). No text, no coordinates.
  var clk = [], rageSent = {}, rageN = 0;
  function selOf(el) {
    var tag = String((el && el.tagName) || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 16);
    if (!tag) return '';
    var id = slug(el.id || '');
    if (id && /^[a-z_-]/.test(id) && !/\\d{4,}/.test(id)) return tag + '#' + id;
    var c = slug(String((el.getAttribute && el.getAttribute('class')) || '').split(/\\s+/)[0]);
    return c && /^[a-z_-]/.test(c) && !/\\d{4,}/.test(c) ? tag + '.' + c : tag;
  }
  document.addEventListener('click', function (ev) {
    try {
      var now = Date.now(), x = ev.clientX || 0, y = ev.clientY || 0;
      clk = clk.filter(function (c) { return now - c.t < 1200 && Math.abs(c.x - x) < 30 && Math.abs(c.y - y) < 30; });
      clk.push({ t: now, x: x, y: y });
      if (clk.length >= 4) {
        clk = [];
        var sel = selOf(ev.target);
        if (sel && !rageSent[sel] && rageN < 3) { rageSent[sel] = 1; rageN++; send('rage', { name: sel }); }
      }
      var b = ev.target;
      if (b && b.form && /^(submit|image)$/i.test(String(b.type || '')) && String(b.tagName || '').match(/^(BUTTON|INPUT)$/)) formSubmit(b.form);
    } catch (e) {}
  }, true);

  // JS errors (D-106 + D-143): error class + script host + a scrubbed
  // message fingerprint, 3 per page. URLs, e-mails and long numbers are
  // stripped from the message before it leaves the browser; the server
  // re-scrubs, so a crafted beacon cannot smuggle personal data in.
  var errN = 0, errSeen = {};
  function errMsg(raw) {
    try {
      var v = String(raw || '').slice(0, 400)
        .replace(/https?:\\/\\/\\S+/gi, '[url]')
        .replace(/[\\w.+-]+@[\\w.-]+\\.[A-Za-z]{2,}/g, '[eposta]')
        .replace(/\\d{6,}/g, '[sayı]')
        .replace(/\\s+/g, ' ').trim().slice(0, 160);
      if (!v || v.indexOf('@') !== -1 || /^Script error\\.?$/i.test(v)) return '';
      return v;
    } catch (e) { return ''; }
  }
  function jsErr(kind, host, msg) {
    try {
      var key = kind + '|' + host;
      if (errN >= 3 || errSeen[key]) return;
      errSeen[key] = 1;
      errN++;
      var x = { name: kind, host: host };
      if (msg) x.msg = msg;
      send('jserr', x);
    } catch (e) {}
  }
  function errHost(f) {
    if (!f) return 'sayfa';
    try { return String(new URL(f, location.href).hostname || '').toLowerCase().replace(/^www\\./, '') || 'sayfa'; } catch (e) { return 'harici'; }
  }
  try {
    w.addEventListener('error', function (ev) {
      try {
        if (ev && ev.target && ev.target !== w && ev.target.tagName) return;
        var m = String((ev && ev.message) || '');
        if (/^Script error\\.?$/.test(m)) return jsErr('ScriptError', 'harici', '');
        var k = String((ev && ev.error && ev.error.name) || '');
        jsErr(/^(TypeError|ReferenceError|SyntaxError|RangeError|URIError)$/.test(k) ? k : 'Error', errHost(ev && ev.filename), errMsg(m));
      } catch (e) {}
    }, true);
    w.addEventListener('unhandledrejection', function (ev) {
      var r = '';
      try {
        var v = ev && ev.reason;
        r = typeof v === 'string' ? v : (v && typeof v.message === 'string' ? v.message : '');
      } catch (e) {}
      jsErr('Promise', 'sayfa', errMsg(r));
    });
  } catch (e) {}

  // Shop sales from the platform's own dataLayer (D-106): a GA4 / UA
  // "purchase" push (Ticimax, İdeasoft, Shopify, WooCommerce via GTM) sends
  // one sale with its amount + currency. Order ids and items are not read.
  // D-111: Ticimax's v8 checkout names its GA4 push "purchase-UA4".
  var dlDone = 0;
  function dlScan(e) {
    try {
      if (dlDone || !e) return;
      var val = null, cur = null, hit = 0;
      if (e[0] === 'event' && e[1] === 'purchase' && e[2]) { val = e[2].value; cur = e[2].currency; hit = 1; }
      else if (e.event === 'purchase' || e.event === 'purchase-UA4') { var ec = e.ecommerce || e; val = ec.value != null ? ec.value : ec.revenue; cur = ec.currency || ec.currencyCode; hit = 1; }
      else if (e.ecommerce && e.ecommerce.purchase) { var af = e.ecommerce.purchase.actionField || {}; val = af.revenue; cur = e.ecommerce.currencyCode; hit = 1; }
      if (!hit) return;
      dlDone = 1;
      var n = Number(String(val == null ? '' : val).replace(',', '.'));
      send('sale', { value: isFinite(n) && n > 0 ? n : 0, currency: cur ? String(cur).slice(0, 3) : undefined, src: 'dl' });
    } catch (e2) {}
  }
  function dlHook() {
    try {
      var dl = w.dataLayer;
      if (!dl || !dl.push) return;
      for (var i = 0; i < dl.length; i++) dlScan(dl[i]);
      if (dl._rasadi) return;
      dl._rasadi = 1;
      var op = dl.push;
      dl.push = function () {
        for (var j = 0; j < arguments.length; j++) dlScan(arguments[j]);
        return op.apply(dl, arguments);
      };
    } catch (e) {}
  }
  dlHook();
  setTimeout(dlHook, 1500);
  setTimeout(dlHook, 5000);

  // Engagement (D-081): visible time on the current view, sent when the tab
  // is hidden or the page unloads, so single-page visits get a real duration
  // instead of "0 s". Cumulative per view; the server keeps the max.
  // D-106: the same beacon carries scroll depth, and on the page-load view
  // the Web Vitals; open forms report their abandon here too.
  function flushEngagement() {
    try {
      if (visSince) { visMs += Date.now() - visSince; visSince = 0; }
      var sec = Math.round(visMs / 1000);
      trackScroll();
      var x = { value: Math.min(sec, 1800), sd: maxSd };
      if (!spaNav) {
        if (vit.lcp) x.lcp = vit.lcp;
        if (vit.inp) x.inp = vit.inp;
        if (vit.hasCls) x.cls = Math.round(vit.cls * 1000) / 1000;
      }
      var sig = sec + '|' + maxSd + '|' + (x.inp || 0);
      if (sec >= 1 && sig !== lastSig) {
        lastSig = sig;
        send('engagement', x);
      }
      flushForms();
      dlHook();
    } catch (e) {}
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flushEngagement();
    else if (!visSince) visSince = Date.now();
  });
  window.addEventListener('pagehide', flushEngagement);

  // Pageview extras (D-106): browser language (2 letters) + timezone name.
  // D-139: + server response time (TTFB, ms) on full loads only — SPA navs
  // reuse the initial document (stale entry) and bfcache restores have no
  // meaningful responseStart, so both are skipped.
  function pvExtra() {
    var x = {};
    try { var l = String(navigator.language || '').slice(0, 2).toLowerCase(); if (/^[a-z]{2}$/.test(l)) x.lang = l; } catch (e) {}
    try { var z = Intl.DateTimeFormat().resolvedOptions().timeZone; if (z) x.tz = String(z).slice(0, 40); } catch (e) {}
    try {
      if (!spaNav && navType !== 'back_forward' && navEntry && navEntry.responseStart > 0) {
        var t = Math.round(navEntry.responseStart);
        if (t >= 1 && t <= 60000) x.ttfb = t;
      }
    } catch (e) {}
    return x;
  }

  // First pageview
  var lastPageviewUrl = location.href;
  send('pageview', pvExtra());

  // 404 auto-detection (broken link tracking). Title match is anchored at
  // the START: a mid-title "not found" (e.g. a blog post about lost items)
  // must not count a healthy page as broken. Each URL reports at most once
  // per page load, so the delayed title re-check below can't double-fire.
  var reported404 = {};
  function check404() {
    try {
      var path404 = /^\\/404(\\/|$)/.test(location.pathname);
      var title404 = /^(404|sayfa bulunamad\\u0131|not found)(?![a-zçğıöşü])/i.test((document.title || '').trim());
      if ((path404 || title404) && !reported404[location.href]) {
        reported404[location.href] = 1;
        send('404');
      }
    } catch (e) {}
  }
  check404();

  // Outbound link + file download click tracking
  document.addEventListener('click', function (ev) {
    try {
      var node = ev.target;
      var a = null;
      while (node && node !== document) {
        if (node.tagName === 'A') { a = node; break; }
        node = node.parentNode;
      }
      if (!a) return;
      var href = a.getAttribute('href') || '';
      var low = href.toLowerCase();
      if (!href || href.charAt(0) === '#' || low.indexOf('javascript:') === 0) return;
      // Count the click, never the address (D-099). The server also keeps only the scheme.
      if (low.indexOf('mailto:') === 0) { send('outbound', { url: 'mailto:' }); return; }
      if (low.indexOf('tel:') === 0) { send('outbound', { url: 'tel:' }); return; }
      // WhatsApp chat links carry the number — only the click is sent (D-105).
      if (low.indexOf('whatsapp:') === 0 || /^(https?:)?\\/\\/(www\\.)?(wa\\.me|api\\.whatsapp\\.com|web\\.whatsapp\\.com)([\\/?#]|$)|^(https?:)?\\/\\/(www\\.)?whatsapp\\.com\\/send/.test(low)) { send('outbound', { url: 'https://wa.me' }); return; }
      var clean = href.split('?')[0].split('#')[0];
      // D-105: CAD/GIS/OpenDocument files + any <a download> link.
      if (a.hasAttribute('download') || /\\.(pdf|zip|rar|7z|docx?|xlsx?|pptx?|csv|dmg|exe|apk|epub|mp3|mp4|dwg|dxf|step|stp|kmz|kml|odt|ods|odp)$/i.test(clean)) {
        send('download', { url: href });
        return;
      }
      // Gallery image opens are not exits (D-105).
      if (/\\/cdn-cgi\\/image\\/|\\.(jpe?g|png|gif|webp|avif|svg|bmp|heic)$/i.test(clean)) return;
      if (/^(https?:)?\\/\\//i.test(href)) {
        var target = document.createElement('a');
        target.href = href;
        if (target.host && target.host !== location.host) {
          send('outbound', { url: href });
        }
      }
    } catch (e) {}
  }, true);

  // SPA navigation support (pushState/replaceState + popstate). A pageview
  // fires only when the route (path + hash, D-081) actually changed — routers call pushState with
  // the same URL (scroll resets, query cleanups), which used to multi-count.
  // The 404 check re-runs per navigation (plus one delayed pass, since SPAs
  // often set document.title asynchronously after the route renders).
  function spaNavigate() {
    try {
      if (routeKey(location.href) === routeKey(lastPageviewUrl)) return;
      pageRef = stripUrl(lastPageviewUrl);
      lastPageviewUrl = location.href;
      // New view: restart the engagement clock (the previous view's time is
      // already covered by the pageview gap).
      visMs = 0;
      lastSig = '';
      visSince = document.visibilityState === 'hidden' ? 0 : Date.now();
      // D-106: the previous view's open forms report abandon; per-view
      // counters restart. Vitals describe the page load only.
      flushForms();
      forms = {};
      maxSd = 0;
      rageSent = {};
      spaNav = 1;
      send('pageview', pvExtra());
      check404();
      setTimeout(check404, 800);
    } catch (e) {}
  }
  var push = history.pushState;
  history.pushState = function () {
    push.apply(history, arguments);
    spaNavigate();
  };
  var replace = history.replaceState;
  history.replaceState = function () {
    replace.apply(history, arguments);
    spaNavigate();
  };
  window.addEventListener('popstate', spaNavigate);
})();
`

let minified: Promise<string> | null = null

/** Minified tracker template, built once per process; falls back to the source. */
export function trackerTemplate(): Promise<string> {
  if (!minified) {
    minified = (async () => {
      try {
        const { minify } = await import('next/dist/compiled/terser')
        // compress stays off: the tokens must survive as literal strings.
        const out = await minify(TRACKER_SOURCE, { compress: false, mangle: true, format: { comments: false, preamble: '/* Rasadi tracker v2 — rasadi.com.tr */' } })
        if (out.code && out.code.includes(BAKED_TOKEN) && out.code.includes(API_TOKEN)) return out.code
      } catch (e) {
        console.warn('[script] minify failed, serving source:', e instanceof Error ? e.message : e)
      }
      return TRACKER_SOURCE
    })()
  }
  return minified
}

