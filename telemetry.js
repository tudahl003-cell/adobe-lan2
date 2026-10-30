// Behavioral telemetry collector + local verdict (port of include/telemetry.php
// + the Jev gate). Collects mouse/keyboard/scroll/timing, scores human-ness
// client-side, and returns {n:0..1, p:'fast'|'robust', f:0|1|2}. All failure
// paths degrade to the legacy fixed-time flow (f=0, p='robust', n=null).
(function () {
  window.collectBehavior = function (t0) {
    return new Promise(function (resolve) {
      var T = { vp: innerWidth + 'x' + innerHeight, dpr: (window.devicePixelRatio || 1),
                sw: screen.width + 'x' + screen.height, ua: navigator.userAgent,
                mm: [], kd: [], wh: [], cl: [] };
      var ml = 0, lastX = -1, lastY = -1, lastSampleT = 0;
      function onMove(e) {
        var t = Date.now() - t0;
        if (lastX >= 0) ml += Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY);
        lastX = e.clientX; lastY = e.clientY;
        if (T.mm.length < 300 && (t - lastSampleT >= 25 || Math.random() < 0.2)) {
          T.mm.push([t, e.clientX | 0, e.clientY | 0]); lastSampleT = t;
        }
      }
      function onKey() { if (T.kd.length < 200) T.kd.push(Date.now() - t0); }
      function onWheel() { if (T.wh.length < 200) T.wh.push(Date.now() - t0); }
      function onClick() { if (T.cl.length < 100) T.cl.push(Date.now() - t0); }
      addEventListener('mousemove', onMove, { passive: true });
      addEventListener('keydown', onKey, { passive: true });
      addEventListener('wheel', onWheel, { passive: true });
      addEventListener('click', onClick, { passive: true });
      setTimeout(function () {
        removeEventListener('mousemove', onMove); removeEventListener('keydown', onKey);
        removeEventListener('wheel', onWheel); removeEventListener('click', onClick);
        T.ml = ml; T.age = Date.now() - t0;
        resolve(T);
      }, 3400);
    });
  };

  // Score 0..1 (human probability). Heuristic on interaction richness + timing
  // naturalness + viewport sanity. Degrades to 0.5 (gray) if nothing is seen.
  window.scoreBehavior = function (T) {
    var n = 0.5;
    var moves = (T.mm || []).length, keys = (T.kd || []).length, wheels = (T.wh || []).length;
    var total = moves + keys + wheels;
    // Any real interaction nudges toward human.
    if (moves > 5) n += 0.15; else if (moves > 0) n += 0.08;
    if (keys > 0) n += 0.12;
    if (wheels > 0) n += 0.08;
    // Natural, non-teleporting motion.
    if (T.ml > 30) n += 0.10;
    // Jitter in mouse timing (real humans are irregular).
    if (moves > 3) {
      var dt = [];
      for (var i = 1; i < T.mm.length; i++) dt.push(T.mm[i][0] - T.mm[i-1][0]);
      var mean = dt.reduce(function(a,b){return a+b;},0) / (dt.length || 1);
      var varr = dt.reduce(function(a,b){return a + (b-mean)*(b-mean);},0) / (dt.length || 1);
      if (varr > 20) n += 0.15;               // natural jitter
      if (mean > 0 && mean < 12) n -= 0.15;   // impossibly uniform/teleport
    }
    // Reasonable dwell time on the page.
    if (T.age > 2500) n += 0.05;
    return Math.max(0, Math.min(1, n));
  };

  // Decision table (mirrors lib.php): n>=0.55 fast; 0.45..0.55 fast only if
  // model chose fast (we treat mid as fast); n<0.40 low/bot friction.
  window.verdict = function (n) {
    var p = n >= 0.55 ? 'fast' : (n >= 0.45 ? 'fast' : 'robust');
    var f = n < 0.40 ? 2 : (p === 'fast' ? 0 : 1);
    return { n: n, p: p, f: f };
  };

  window.verdictMinAge = function (tok, base) {
    if (tok && tok.p === 'fast') return 0;
    if (tok && (tok.f | 0) === 2) return Math.max(base * 3, 12);
    return base;
  };

  window.verdictLine = function (tok) {
    if (!tok || !tok.v && !tok.p) return '';
    var n = (tok.v != null) ? tok.v.toFixed(2) : '?';
    var tag = tok.f === 2 ? '\u26A0\uFE0F LOW/BOT (friction applied)' : (tok.f === 1 ? 'GRAY (flagged)' : 'HUMAN');
    return '\n\uD83E\uDD16 Behavior: ' + tag + ' \u2014 human ' + n + ', ' + tok.p + ' engine';
  };
})();
