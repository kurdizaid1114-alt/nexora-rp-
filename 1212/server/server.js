/* NEXORA • RP — سيرفر الملتي بلاير (WebSocket) + لوحة إدارة ويب على /admin */
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto");
const { WebSocketServer } = require("ws");
const PORT = +process.env.PORT || 8080;
const OWNER_USER = (process.env.OWNER_USER || "zaid").toLowerCase();
const OWNER_PASS = process.env.OWNER_PASS || "123123123z";
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data.json");
const SERVERS = { colma: { n: "COLMA", cap: 40, start: 18.5 }, medley: { n: "MEDLEY", cap: 40, start: 7.5 } };
const STAFF_NAMES = ["", "Helper", "Moderator", "Responsible", "Lead Admin", "Community Manager", "Founder"];

/* ---------- التخزين ---------- */
let db = { accounts: {}, bans: {}, profiles: {} };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DATA_FILE, "utf8"))); } catch (e) {}
let saveT = null;
const persist = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { fs.writeFileSync(DATA_FILE, JSON.stringify(db)); } catch (e) { console.error("save failed", e.message); } }, 800); };
const hash = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString("hex");
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

/* ---------- الغرف ---------- */
const rooms = {}; for (const id in SERVERS) rooms[id] = { id, players: new Map(), t0: Date.now() };
let nextId = 1;
const hourOf = (r) => (SERVERS[r.id].start + (Date.now() - r.t0) / 60000) % 24;
const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const bcast = (r, o, except) => { const s = JSON.stringify(o); for (const p of r.players.values()) if (p !== except && p.ws.readyState === 1) p.ws.send(s); };
const pub = (p) => ({ id: p.id, n: p.name, look: p.look, staff: p.staff });
const num = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);
const clean = (s, n) => String(s == null ? "" : s).replace(/[\u0000-\u001f<>]/g, "").slice(0, n);

function findPlayer(srv, id) { const r = rooms[srv]; return r && r.players.get(+id); }
function kick(p, reason) { send(p.ws, { t: "kick", reason }); setTimeout(() => p.ws.close(), 100); }
function online() { const o = {}; for (const id in rooms) o[id] = rooms[id].players.size; return o; }

/* ---------- WebSocket ---------- */
const server = http.createServer(handleHttp);
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 400 * 1024 });
wss.on("connection", (ws) => {
  let me = null; ws.isAlive = true; ws.on("pong", () => (ws.isAlive = true));
  ws.on("message", (raw) => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.t !== "string") return;
    if (m.t === "join") return join(ws, m, (p) => (me = p));
    if (!me) return;
    const r = rooms[me.srv];
    switch (m.t) {
      case "st": { const s = me.st; s.x = num(m.x, s.x); s.z = num(m.z, s.z); s.ry = num(m.ry, s.ry); s.sp = num(m.sp, 0); s.in = m.in ? clean(m.in, 12) : null; s.jb = clean(m.jb, 12); s.dt = !!m.dt; s.hp = num(m.hp, 100); s.wp = clean(m.wp, 10);
        s.car = m.car && typeof m.car === "object" ? { k: clean(m.car.k, 12), c: num(m.car.c, 0xcccccc), h: num(m.car.h, 0) } : null; break; }
      case "chat": {
        const now = Date.now(); if (now - me.lastChat < 600) return; me.lastChat = now;
        if (me.muted) return send(ws, { t: "sys", text: "أنت مكتوم من الإدارة." });
        const k = ["say", "me", "do", "ooc"].includes(m.k) ? m.k : "say", text = clean(m.text, 140).trim(); if (!text) return;
        bcast(r, { t: "chat", k, n: me.name, id: me.id, text, staff: me.staff }); break; }
      case "save": { if (m.prof && typeof m.prof === "object") { const s = JSON.stringify(m.prof); if (s.length < 300000) { db.profiles[me.srv + ":" + me.key] = m.prof; persist(); } } break; }
      case "adm": adminCmd(me, m); break;
      case "ping": send(ws, { t: "pong", c: m.c, online: r.players.size }); break;
    }
  });
  ws.on("close", () => { if (!me) return; const r = rooms[me.srv]; if (r.players.get(me.id) === me) { r.players.delete(me.id); bcast(r, { t: "pl", id: me.id }); } });
});
setInterval(() => { for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); } }, 20000);

function join(ws, m, setMe) {
  const err = (c, text) => send(ws, { t: "err", code: c, text });
  const srv = SERVERS[m.srv] ? m.srv : null; if (!srv) return err("srv", "سيرفر غير موجود");
  const name = clean(m.name, 18).replace(/\s+/g, " ").trim(), key = name.toLowerCase(), pw = String(m.pw || "").slice(0, 64);
  if (name.length < 2 || /["&]/.test(name)) return err("name", "اسم غير صالح");
  if (db.bans[key]) return err("ban", "هذا الحساب محظور. السبب: " + (db.bans[key].reason || "—"));
  let staff = 0;
  if (key === OWNER_USER) { if (!safeEq(pw, OWNER_PASS)) return err("pw", "هذا الاسم محجوز للمالك. كلمة المرور غير صحيحة."); staff = 6; }
  else {
    let a = db.accounts[key];
    if (a && a.hash) { if (!safeEq(hash(pw, a.salt), a.hash)) return err("pw", "هذا الاسم محمي بكلمة مرور. اكتبها أو اختر اسماً آخر."); }
    else if (a && pw) { a.salt = crypto.randomBytes(8).toString("hex"); a.hash = hash(pw, a.salt); persist(); }
    if (!a) { a = db.accounts[key] = { name, staff: 0, created: Date.now() }; if (pw) { a.salt = crypto.randomBytes(8).toString("hex"); a.hash = hash(pw, a.salt); } persist(); }
    staff = a.staff || 0;
  }
  for (const r of Object.values(rooms)) { const o = [...r.players.values()].find((p) => p.key === key); if (o) return err("dup", "هذا الاسم متصل حالياً من جهاز آخر."); }
  const r = rooms[srv]; if (r.players.size >= SERVERS[srv].cap) return err("full", "السيرفر " + SERVERS[srv].n + " ممتلئ (" + SERVERS[srv].cap + "/" + SERVERS[srv].cap + ").");
  const look = m.look && typeof m.look === "object" ? { skin: clean(m.look.skin, 9), shirt: clean(m.look.shirt, 9), pant: clean(m.look.pant, 9), hair: clean(m.look.hair, 9), style: clean(m.look.style, 8), female: !!m.look.female } : {};
  const p = { id: nextId++, key, name, srv, ws, staff, look, muted: false, lastChat: 0, st: { x: 0, z: 0, ry: 0, sp: 0, in: null, jb: "citizen", dt: false, hp: 100, car: null, wp: "fists" } };
  r.players.set(p.id, p); setMe(p);
  send(ws, { t: "joined", id: p.id, staff, name, hour: hourOf(r), players: [...r.players.values()].filter((o) => o !== p).map(pub), prof: db.profiles[srv + ":" + key] || null, online: r.players.size, cap: SERVERS[srv].cap });
  bcast(r, { t: "pj", p: pub(p) }, p);
  bcast(r, { t: "sys", text: name + " دخل السيرفر" }, p);
}

/* ---------- أوامر الإدارة (داخل اللعبة) ---------- */
function adminCmd(me, m) {
  const r = rooms[me.srv], need = (n) => me.staff >= n || (send(me.ws, { t: "sys", text: "لا تملك الصلاحية" }), false);
  const target = () => r.players.get(+m.id);
  switch (m.cmd) {
    case "kick": { if (!need(2)) return; const p = target(); if (p && p.staff < me.staff) { kick(p, "تم طردك من الإدارة"); bcast(r, { t: "sys", text: p.name + " تم طرده بواسطة " + me.name }); } break; }
    case "mute": { if (!need(2)) return; const p = target(); if (p && p.staff < me.staff) { p.muted = !!m.on; send(me.ws, { t: "sys", text: p.name + (p.muted ? " مكتوم" : " فُك كتمه") }); } break; }
    case "ban": { if (!need(4)) return; const p = target(); if (p && p.staff < me.staff) { db.bans[p.key] = { reason: clean(m.reason, 80) || "مخالفة القوانين", by: me.name, t: Date.now() }; persist(); kick(p, "تم حظرك"); } break; }
    case "announce": { if (!need(3)) return; const text = clean(m.text, 140); if (text) bcast(r, { t: "ann", text, n: me.name }); send(me.ws, { t: "ann", text, n: me.name }); break; }
    case "time": { if (!need(4)) return; const h = Math.max(0, Math.min(23.9, num(m.hour, 12))); r.t0 = Date.now() - ((h - SERVERS[r.id].start + 24) % 24) * 60000; const o = { t: "time", hour: h }; bcast(r, o); send(me.ws, o); break; }
  }
}

/* ---------- بث الحالة 10 مرات بالثانية ---------- */
setInterval(() => {
  for (const r of Object.values(rooms)) {
    if (r.players.size < 2) continue;
    const arr = [...r.players.values()].map((p) => ({ id: p.id, x: p.st.x, z: p.st.z, ry: p.st.ry, sp: p.st.sp, in: p.st.in, jb: p.st.jb, dt: p.st.dt, car: p.st.car, wp: p.st.wp }));
    const s = JSON.stringify({ t: "snap", p: arr, online: r.players.size });
    for (const p of r.players.values()) if (p.ws.readyState === 1) p.ws.send(s);
  }
}, 100);

/* ---------- HTTP: لوحة الإدارة وواجهتها ---------- */
const tokens = new Map();
function body(req) { return new Promise((res) => { let d = ""; req.on("data", (c) => { d += c; if (d.length > 20000) req.destroy(); }); req.on("end", () => { try { res(JSON.parse(d || "{}")); } catch (e) { res({}); } }); }); }
function handleHttp(req, res) {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type,x-token", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" };
  const json = (code, o) => { res.writeHead(code, Object.assign({ "Content-Type": "application/json; charset=utf-8" }, cors)); res.end(JSON.stringify(o)); };
  const url = req.url.split("?")[0];
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  if (url === "/" || url === "/health") return json(200, { ok: true, game: "NEXORA • RP", online: online() });
  if (url === "/admin") { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); return res.end(fs.readFileSync(path.join(__dirname, "admin.html"))); }
  if (url === "/api/servers") return json(200, Object.keys(SERVERS).map((id) => ({ id, n: SERVERS[id].n, cap: SERVERS[id].cap, online: rooms[id].players.size })));
  if (!url.startsWith("/api/")) return json(404, { error: "not found" });
  (async () => {
    const b = req.method === "POST" ? await body(req) : {};
    if (url === "/api/login") { if (safeEq(b.user || "", OWNER_USER) && safeEq(b.pass || "", OWNER_PASS)) { const t = crypto.randomBytes(24).toString("hex"); tokens.set(t, Date.now() + 12 * 3600e3); return json(200, { token: t }); } return json(401, { error: "بيانات خاطئة" }); }
    const tk = req.headers["x-token"]; if (!tk || !tokens.has(tk) || tokens.get(tk) < Date.now()) return json(401, { error: "غير مصرح" });
    switch (url) {
      case "/api/state": return json(200, { servers: Object.keys(SERVERS).map((id) => ({ id, n: SERVERS[id].n, cap: SERVERS[id].cap, hour: hourOf(rooms[id]), players: [...rooms[id].players.values()].map((p) => ({ id: p.id, name: p.name, staff: p.staff, muted: p.muted, jb: p.st.jb, dt: p.st.dt, x: Math.round(p.st.x), z: Math.round(p.st.z), car: !!p.st.car })) })), accounts: Object.entries(db.accounts).map(([k, a]) => ({ key: k, name: a.name, staff: a.staff || 0, hasPw: !!a.hash, banned: !!db.bans[k] })), bans: db.bans, staffNames: STAFF_NAMES });
      case "/api/kick": { const p = findPlayer(b.srv, b.id); if (p) kick(p, "تم طردك من الإدارة"); return json(200, { ok: !!p }); }
      case "/api/mute": { const p = findPlayer(b.srv, b.id); if (p) p.muted = !!b.on; return json(200, { ok: !!p }); }
      case "/api/ban": { const key = clean(b.name, 18).toLowerCase(); if (!key || key === OWNER_USER) return json(400, { error: "غير مسموح" }); db.bans[key] = { reason: clean(b.reason, 80) || "مخالفة القوانين", by: "web", t: Date.now() }; persist(); for (const r of Object.values(rooms)) for (const p of r.players.values()) if (p.key === key) kick(p, "تم حظرك"); return json(200, { ok: true }); }
      case "/api/unban": delete db.bans[clean(b.name, 18).toLowerCase()]; persist(); return json(200, { ok: true });
      case "/api/announce": { const text = clean(b.text, 140); if (!text) return json(400, { error: "نص فارغ" }); for (const id in rooms) if (!b.srv || b.srv === "all" || b.srv === id) bcast(rooms[id], { t: "ann", text, n: "الإدارة" }); return json(200, { ok: true }); }
      case "/api/staff": { const key = clean(b.name, 18).toLowerCase(), a = db.accounts[key], lv = Math.max(0, Math.min(5, +b.level | 0)); if (!a) return json(404, { error: "حساب غير موجود" }); a.staff = lv; persist(); for (const r of Object.values(rooms)) for (const p of r.players.values()) if (p.key === key) { p.staff = lv; send(p.ws, { t: "staff", staff: lv }); } return json(200, { ok: true }); }
      case "/api/delete": { const key = clean(b.name, 18).toLowerCase(); delete db.accounts[key]; for (const k of Object.keys(db.profiles)) if (k.endsWith(":" + key)) delete db.profiles[k]; persist(); for (const r of Object.values(rooms)) for (const p of r.players.values()) if (p.key === key) kick(p, "تم حذف حسابك"); return json(200, { ok: true }); }
      case "/api/time": { const r = rooms[b.srv]; if (!r) return json(404, {}); const h = Math.max(0, Math.min(23.9, +b.hour || 0)); r.t0 = Date.now() - ((h - SERVERS[r.id].start + 24) % 24) * 60000; bcast(r, { t: "time", hour: h }); return json(200, { ok: true }); }
    }
    json(404, { error: "not found" });
  })();
}
server.listen(PORT, () => console.log("NEXORA • RP server on :" + PORT + " · admin: /admin"));
