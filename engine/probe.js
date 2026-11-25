// The in-page probe: one self-contained function that runs INSIDE a loaded web page.
// Used in two places, with the same code:
//   1. Cloudflare Browser Run (server): injected with addScriptTag after the page loads; consent is accepted
//      automatically (a throwaway robot session, no person behind it).
//   2. The visitor's own browser (bookmarklet or console snippet): passes any firewall because it is a real
//      visit; consent is accepted only if the visitor ticks that option.
// It looks at what the page actually requested, so it works whatever loaded the Google tag: GTM, gtag.js,
// Tealium, Adobe Launch, Segment, Zaraz or hand-written code.
//
// Keep gtgPageProbe self-contained: no imports, no outside variables. Its source text is shipped as is.

export const PROBE_VERSION = 1;

export async function gtgPageProbe(opts) {
  opts = opts || {};
  var started = Date.now();
  var w = window, d = document;
  var TAG_ID = /^(GTM-[A-Z0-9]{4,10}|G-[A-Z0-9]{6,12}|AW-\d{6,12}|DC-\d{6,12}|GT-[A-Z0-9]{6,12})$/i;
  var LOADER_PATH = /\/(gtm\.js|gtag\/js|gtag\/destination)$/;
  var MEASURE_PATH = /\/(g\/collect|j\/collect|collect|ccm\/collect|pagead\/conversion\/[^/]+|pagead\/viewthroughconversion\/[^/]+|activityi[^/]*|activity[^/]*)$/;
  var GOOGLE_HOST = /(^|\.)(googletagmanager\.com|google-analytics\.com|analytics\.google\.com|googleadservices\.com|doubleclick\.net|google\.com|googlesyndication\.com)$/i;
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  try { performance.setResourceTimingBufferSize(2000); } catch (e) {}

  function allUrls() {
    var out = {};
    try { performance.getEntriesByType('resource').forEach(function (e) { out[e.name] = 1; }); } catch (e) {}
    d.querySelectorAll('script[src]').forEach(function (s) { out[s.src] = 1; });
    return Object.keys(out);
  }

  // Google tag loaders and Google measurement requests, without query values except the tag ID and consent state.
  function snapshot() {
    var loaders = {}, measure = {};
    allUrls().forEach(function (raw) {
      var u;
      try { u = new URL(raw, location.href); } catch (e) { return; }
      if (!/^https?:$/.test(u.protocol)) return;
      var id = (u.searchParams.get('id') || '').toUpperCase();
      var tid = (u.searchParams.get('tid') || '').toUpperCase();
      var p = u.pathname;
      var isLoader = LOADER_PATH.test(p) || (TAG_ID.test(id) && !MEASURE_PATH.test(p));
      if (isLoader) {
        var key = u.host + p + '|' + id;
        loaders[key] = { url: u.origin + p + (TAG_ID.test(id) ? '?id=' + id : ''), host: u.hostname, path: p, id: TAG_ID.test(id) ? id : '', sameHost: u.hostname === location.hostname };
        return;
      }
      if (MEASURE_PATH.test(p) && (GOOGLE_HOST.test(u.hostname) || u.hostname === location.hostname || TAG_ID.test(tid))) {
        var gcs = (u.searchParams.get('gcs') || '').slice(0, 8);
        var mkey = u.host + p;
        if (!measure[mkey]) measure[mkey] = { host: u.hostname, path: p.slice(0, 80), sameHost: u.hostname === location.hostname, id: TAG_ID.test(tid) ? tid : '', gcs: gcs, count: 0 };
        measure[mkey].count++;
      }
    });
    return { loaders: Object.values(loaders).slice(0, 40), measurement: Object.values(measure).slice(0, 40), resources: allUrls().length };
  }

  function visible(el) { try { return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); } catch (e) { return false; } }

  function detectCmp() {
    var q = function (s) { return d.querySelector(s); };
    if (w.OneTrust || w.Optanon || q('#onetrust-banner-sdk,#onetrust-consent-sdk')) return 'OneTrust';
    if (w.Cookiebot || q('#CybotCookiebotDialog')) return 'Cookiebot';
    if (w.Didomi || q('#didomi-host')) return 'Didomi';
    if (w.UC_UI || w.__ucCmp || q('#usercentrics-root,#usercentrics-cmp-ui')) return 'Usercentrics';
    if (w.truste || q('#truste-consent-track,#consent_blackbar')) return 'TrustArc';
    if (w.getCkyConsent || q('.cky-consent-container')) return 'CookieYes';
    if (w.Osano || q('.osano-cm-window')) return 'Osano';
    if (w._iub || q('#iubenda-cs-banner')) return 'iubenda';
    if (w.complianz || q('#cmplz-cookiebanner-container,.cmplz-cookiebanner')) return 'Complianz';
    if (w._sp_ || w._sp_queue || q('iframe[id^="sp_message_iframe"]')) return 'Sourcepoint';
    if (q('.qc-cmp2-container')) return 'Quantcast Choice';
    if (w.Termly || q('#termly-code-snippet-support')) return 'Termly';
    if (w.axeptioSDK || w.openAxeptioCookies || q('#axeptio_overlay')) return 'Axeptio';
    if (w.klaro || q('.klaro')) return 'Klaro';
    if (w.CookieFirst || q('[data-cookiefirst-widget]')) return 'CookieFirst';
    if (w.CookieScript || q('#cookiescript_injected')) return 'Cookie Script';
    if (w.utag && w.utag.gdpr) return 'Tealium Consent Manager';
    if (w.adobe && w.adobe.optIn) return 'Adobe Opt-In';
    if (typeof w.__tcfapi === 'function') return 'IAB TCF banner';
    return null;
  }

  var BUTTONS = [
    '#onetrust-accept-btn-handler', '#accept-recommended-btn-handler',
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll', '#CybotCookiebotDialogBodyButtonAccept',
    '#didomi-notice-agree-button', '[data-testid="uc-accept-all-button"]', '#truste-consent-button',
    '.cky-btn-accept', '.osano-cm-accept-all', '.iubenda-cs-accept-btn', '.cmplz-btn.cmplz-accept',
    '.qc-cmp2-summary-buttons button[mode="primary"]', '#axeptio_btn_acceptAll', '.cm-btn-accept-all',
    '[data-cookiefirst-action="accept"]', '#cookiescript_accept', '.cc-allow', '.cc-accept-all'
  ];
  var ACCEPT_TEXT = /^(accept|accept all|accept all cookies|accept cookies|allow all|allow all cookies|allow cookies|i accept|i agree|agree|agree and continue|agree and close|yes, i agree|got it|alle akzeptieren|akzeptieren|tout accepter|accepter|accepter et fermer|aceptar|aceptar todo|aceptar todas|accetta|accetta tutti|aceitar|aceitar todos|alles accepteren|accepteren|قبول|قبول الكل|قبول جميع ملفات تعريف الارتباط|موافق)$/i;
  var BANNER_HINT = /cookie|consent|gdpr|privacy|cmp|banner|notice/i;

  function inBanner(el) {
    for (var n = el, i = 0; n && i < 8; n = n.parentElement, i++) {
      if (BANNER_HINT.test((n.id || '') + ' ' + (typeof n.className === 'string' ? n.className : ''))) return true;
    }
    return false;
  }

  function acceptAll() {
    var apis = [
      ['OneTrust', function () { return w.OneTrust && typeof w.OneTrust.AllowAll === 'function' && (w.OneTrust.AllowAll(), true); }],
      ['Cookiebot', function () { return w.Cookiebot && typeof w.Cookiebot.submitCustomConsent === 'function' && (w.Cookiebot.submitCustomConsent(true, true, true), true); }],
      ['Didomi', function () { return w.Didomi && typeof w.Didomi.setUserAgreeToAll === 'function' && (w.Didomi.setUserAgreeToAll(), true); }],
      ['Usercentrics', function () { return w.UC_UI && typeof w.UC_UI.acceptAllConsents === 'function' && (w.UC_UI.acceptAllConsents(), true); }],
      ['Usercentrics', function () { return w.__ucCmp && typeof w.__ucCmp.acceptAllConsents === 'function' && (w.__ucCmp.acceptAllConsents(), true); }],
      ['Tealium Consent Manager', function () { return w.utag && w.utag.gdpr && typeof w.utag.gdpr.setConsentValue === 'function' && (w.utag.gdpr.setConsentValue(true), true); }]
    ];
    for (var i = 0; i < apis.length; i++) { try { if (apis[i][1]()) return { method: 'api', by: apis[i][0] }; } catch (e) {} }
    for (var j = 0; j < BUTTONS.length; j++) {
      var b = d.querySelector(BUTTONS[j]);
      if (b && visible(b)) { try { b.click(); return { method: 'button', by: BUTTONS[j] }; } catch (e) {} }
    }
    var els = d.querySelectorAll('button,[role="button"],a,input[type="button"],input[type="submit"]');
    for (var k = 0; k < els.length; k++) {
      var el = els[k];
      var t = String(el.innerText || el.value || el.textContent || '').trim().replace(/\s+/g, ' ');
      if (t.length < 40 && ACCEPT_TEXT.test(t) && visible(el) && inBanner(el)) {
        try { el.click(); return { method: 'text', by: t }; } catch (e) {}
      }
    }
    return null;
  }

  function consentMode() {
    var out = [];
    var dl = Array.isArray(w.dataLayer) ? w.dataLayer : [];
    for (var i = 0; i < dl.length && out.length < 8; i++) {
      var e = dl[i];
      if (e && typeof e === 'object' && e[0] === 'consent' && (e[1] === 'default' || e[1] === 'update') && e[2] && typeof e[2] === 'object') {
        var s = {};
        ['ad_storage', 'analytics_storage', 'ad_user_data', 'ad_personalization'].forEach(function (k) { if (typeof e[2][k] === 'string') s[k] = e[2][k].slice(0, 10); });
        out.push({ type: e[1], state: s });
      }
    }
    return out;
  }

  function tagManagers() {
    var src = Array.prototype.map.call(d.querySelectorAll('script[src]'), function (s) { return s.src; }).join(' ');
    var tm = [];
    var gtm = Object.keys(w.google_tag_manager || {}).filter(function (k) { return /^GTM-/.test(k); });
    if (gtm.length || /googletagmanager\.com\/gtm\.js|\/gtm\.js\?id=GTM-/.test(src)) tm.push('Google Tag Manager');
    if (w.utag || w.utag_data || /tiqcdn\.com|\/utag\.js/.test(src)) tm.push('Tealium iQ');
    if (w._satellite || /assets\.adobedtm\.com/.test(src)) tm.push('Adobe Experience Platform Tags (Launch)');
    if ((w.analytics && typeof w.analytics.track === 'function' && w.analytics.VERSION) || /cdn\.segment\.com/.test(src)) tm.push('Segment');
    if (w.Bootstrapper || /ensighten\.com/.test(src)) tm.push('Ensighten');
    if (w.tC || /tagcommander\.com|commander1\.com/.test(src)) tm.push('Commanders Act');
    if (w.zaraz || /\/cdn-cgi\/zaraz\//.test(src)) tm.push('Cloudflare Zaraz');
    if (w.ppms || /piwik\.pro/.test(src)) tm.push('Piwik PRO Tag Manager');
    if (w._mtm || /container_[A-Za-z0-9]+\.js/.test(src)) tm.push('Matomo Tag Manager');
    if (w.Signal || /signal\.co|btstatic\.com/.test(src)) tm.push('Signal');
    return tm;
  }

  function googleIds() {
    return Object.keys(w.google_tag_manager || {}).filter(function (k) { return TAG_ID.test(k); }).slice(0, 20);
  }

  var HEADER_KEYS = ['server', 'via', 'x-cache', 'cf-cache-status', 'cf-ray', 'x-served-by', 'x-amz-cf-id', 'x-amz-cf-pop', 'akamai-cache-status', 'x-akamai-transformed', 'x-akamai-request-id', 'x-vercel-cache', 'x-vercel-id', 'x-nf-request-id', 'x-azure-ref', 'x-goog-generation', 'x-cache-status', 'eo-cache-status', 'x-cdn', 'x-powered-by', 'x-iinfo', 'x-sucuri-id', 'x-fastly-request-id'];

  async function checkPaths(loaders) {
    var dirs = {}, out = [];
    loaders.forEach(function (l) {
      if (!l.sameHost) return;
      var dir = l.path.replace(LOADER_PATH, '/');
      if (!/\/$/.test(dir)) dir = dir.slice(0, dir.lastIndexOf('/') + 1);
      if (dir && dir !== '/' && !dirs[dir]) dirs[dir] = l;
    });
    var keys = Object.keys(dirs).slice(0, 3);
    for (var i = 0; i < keys.length; i++) {
      var dir = keys[i], l = dirs[dir], r = { path: dir, healthStatus: 0, healthy: false, loaderStatus: 0, servesGoogleJs: false, headers: {} };
      try {
        var hr = await fetch(dir + 'healthy', { cache: 'no-store', credentials: 'same-origin' });
        r.healthStatus = hr.status;
        r.healthy = hr.ok && (await hr.text()).trim().slice(0, 20) === 'ok';
      } catch (e) {}
      try {
        var lr = await fetch(l.url.replace(/^https?:\/\/[^/]+/, ''), { cache: 'no-store', credentials: 'same-origin' });
        r.loaderStatus = lr.status;
        HEADER_KEYS.forEach(function (k) { var v = lr.headers.get(k); if (v) r.headers[k] = String(v).slice(0, 80); });
        var body = (await lr.text()).slice(0, 200000);
        r.servesGoogleJs = lr.ok && /google_tag_manager|googletagmanager|gtag\(|__TAGGY|google_tag_data/.test(body);
      } catch (e) {}
      out.push(r);
    }
    return out;
  }

  // ---- run ----
  var before = snapshot();
  var cmp = detectCmp();
  var consent = { cmp: cmp, requested: !!opts.acceptConsent, action: null, consentMode: [] };

  if (opts.acceptConsent) {
    // Banners load late: look for one for a few seconds.
    var waitCmp = Math.min(Number(opts.cmpWaitMs) || 4000, 10000);
    for (var t = 0; t <= waitCmp; t += 500) {
      var a = acceptAll();
      if (a) { consent.action = a; break; }
      await sleep(500);
      if (!cmp) cmp = consent.cmp = detectCmp();
    }
    if (!consent.action) consent.action = { method: 'none_found', by: null };
  }

  await sleep(Math.min(Number(opts.waitMs) || 4000, 15000));
  var after = snapshot();
  consent.consentMode = consentMode();

  var allLoaders = {};
  before.loaders.concat(after.loaders).forEach(function (l) { allLoaders[l.url] = l; });
  var loaders = Object.values(allLoaders);
  var beforeKeys = before.loaders.map(function (l) { return l.url; });

  var result = {
    v: 1,
    mode: opts.mode === 'visitor' ? 'visitor' : 'server',
    url: location.origin + location.pathname,
    host: location.hostname,
    title: String(d.title || '').slice(0, 120),
    resources: after.resources,
    loaders: loaders.map(function (l) { return Object.assign({}, l, { afterConsent: beforeKeys.indexOf(l.url) < 0 }); }),
    measurement: after.measurement,
    ids: googleIds(),
    tagManagers: tagManagers(),
    consent: consent,
    checks: await checkPaths(loaders),
    ms: Date.now() - started
  };

  if (opts.mode === 'visitor') {
    try { showOverlay(result, opts); } catch (e) {}
  }
  return result;

  // ---- visitor overlay (only in the visitor's own browser) ----
  function showOverlay(res, o) {
    var old = d.getElementById('dh-gtg-overlay');
    if (old) old.remove();
    var ok = res.checks.filter(function (c) { return c.healthy; });
    var fromGoogle = res.loaders.filter(function (l) { return /googletagmanager\.com$/i.test(l.host); });
    var title, body;
    if (ok.length && !fromGoogle.length) { title = 'Google tag gateway is set up'; body = 'Your Google tag loads from ' + ok[0].path + ' on your own domain, and its health check answers ok.'; }
    else if (ok.length) { title = 'Google tag gateway is partly set up'; body = 'One tag loads through ' + ok[0].path + ', but others still load from googletagmanager.com.'; }
    else if (res.loaders.some(function (l) { return l.sameHost; })) { title = 'A first-party tag path was found'; body = 'A Google tag loads from your domain, but its health check did not answer ok.'; }
    else if (fromGoogle.length) { title = 'Google tag gateway is not set up'; body = 'Your Google tags load straight from googletagmanager.com.'; }
    else if (res.loaders.length) { title = 'Google tags load from another domain'; body = 'This looks like server-side tagging, which is not Google tag gateway.'; }
    else { title = 'No Google tag loaded on this page'; body = res.consent.requested ? 'Even after accepting cookies, no Google tag request was made.' : 'Tags may wait for cookie consent. Run the check again and allow accepting cookies.'; }
    var box = d.createElement('div');
    box.id = 'dh-gtg-overlay';
    box.setAttribute('role', 'dialog');
    box.style.cssText = 'position:fixed;z-index:2147483647;right:16px;bottom:16px;max-width:360px;background:#fff;color:#111;border:1px solid #ccc;border-radius:10px;padding:16px;font:14px/1.45 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.25)';
    var h = d.createElement('strong'); h.textContent = title; h.style.cssText = 'display:block;font-size:16px;margin-bottom:6px';
    var p = d.createElement('p'); p.textContent = body; p.style.margin = '0 0 12px';
    var tm = d.createElement('p'); tm.style.cssText = 'margin:0 0 12px;color:#555;font-size:13px';
    tm.textContent = 'Tag manager: ' + (res.tagManagers.join(', ') || 'none found') + '. Cookie banner: ' + (res.consent.cmp || 'none found') + '.';
    var btn = d.createElement('button'); btn.type = 'button'; btn.textContent = 'See the full report';
    btn.style.cssText = 'background:#1a56db;color:#fff;border:0;border-radius:6px;padding:8px 12px;font:inherit;cursor:pointer;margin-right:8px';
    btn.onclick = function () {
      var json = JSON.stringify(res);
      var b64 = btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      window.open(String(o.reportUrl || 'https://adilmeman94.github.io/gtg-checker/') + '#probe=' + b64, '_blank', 'noopener');
    };
    var close = d.createElement('button'); close.type = 'button'; close.textContent = 'Close';
    close.style.cssText = 'background:none;border:1px solid #ccc;border-radius:6px;padding:8px 12px;font:inherit;cursor:pointer;color:#111';
    close.onclick = function () { box.remove(); };
    box.append(h, p, tm, btn, close);
    d.body.appendChild(box);
  }
}

// Start screen for the visitor's browser: asks whether to accept cookies, then runs the probe.
// Separate from gtgPageProbe so the server never shows it.
export function gtgVisitorStart(reportUrl) {
  var d = document;
  var old = d.getElementById('dh-gtg-overlay');
  if (old) old.remove();
  var box = d.createElement('div');
  box.id = 'dh-gtg-overlay';
  box.setAttribute('role', 'dialog');
  box.style.cssText = 'position:fixed;z-index:2147483647;right:16px;bottom:16px;max-width:360px;background:#fff;color:#111;border:1px solid #ccc;border-radius:10px;padding:16px;font:14px/1.45 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.25)';
  box.innerHTML = '<strong style="display:block;font-size:16px;margin-bottom:6px">Google tag gateway check</strong>' +
    '<p style="margin:0 0 10px">Some tags only load after cookies are accepted. To see them, this check can accept all cookies on this site for you.</p>' +
    '<p style="margin:0 0 12px;color:#555;font-size:13px">This changes the cookie choice saved in your browser for this site. You can change it back in the site\'s cookie settings or by clearing its cookies.</p>';
  var yes = d.createElement('button'); yes.type = 'button'; yes.textContent = 'Accept cookies and check';
  yes.style.cssText = 'background:#1a56db;color:#fff;border:0;border-radius:6px;padding:8px 12px;font:inherit;cursor:pointer;margin:0 8px 8px 0';
  var no = d.createElement('button'); no.type = 'button'; no.textContent = 'Check without changing cookies';
  no.style.cssText = 'background:none;border:1px solid #ccc;border-radius:6px;padding:8px 12px;font:inherit;cursor:pointer;color:#111;margin:0 8px 8px 0';
  function run(accept) {
    box.innerHTML = '<strong style="display:block;font-size:16px">Checking…</strong><p style="margin:6px 0 0">This takes about 10 seconds.</p>';
    gtgPageProbe({ mode: 'visitor', acceptConsent: accept, reportUrl: reportUrl, waitMs: 5000 });
  }
  yes.onclick = function () { run(true); };
  no.onclick = function () { run(false); };
  box.append(yes, no);
  d.body.appendChild(box);
}

// Source text the server injects into Browser Run. Writes the result into the page as JSON so the
// Worker can read it from the rendered HTML. "<" is escaped so the JSON can never close the script tag.
// Bundlers (esbuild in wrangler) may add __name(fn, "name") calls inside functions. The page has no such
// helper, so every shipped script defines a harmless one first.
const NAME_SHIM = 'var __name=function(f){return f;};';

export function serverProbeScript() {
  return `(function(){${NAME_SHIM}return (${gtgPageProbe.toString()})({mode:'server',acceptConsent:true,cmpWaitMs:4000,waitMs:4000});})()` +
    `.then(function(r){return r;},function(e){return {v:1,error:String(e&&e.message||e).slice(0,200)};})` +
    `.then(function(r){var s=document.createElement('script');s.type='application/json';s.id='dh-gtg-probe';` +
    `s.textContent=JSON.stringify(r).replace(/</g,'\\\\u003c');document.documentElement.appendChild(s);});`;
}

// Source text for the visitor's bookmarklet and console snippet.
export function visitorProbeScript(reportUrl) {
  return `(function(){${NAME_SHIM}var gtgPageProbe=${gtgPageProbe.toString()};(${gtgVisitorStart.toString()})(${JSON.stringify(String(reportUrl || ''))});})();`;
}
