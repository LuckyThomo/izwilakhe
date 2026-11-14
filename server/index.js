import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { q, migrate } from "./db.js";
import { parsePassage } from "./bible.js";
import { runStudy, totalCost } from "./pipeline.js";

if (!config.ownerPassword || config.sessionSecret.length < 16) {
  console.error("Set OWNER_PASSWORD and a SESSION_SECRET of at least 16 characters in .env");
  process.exit(1);
}

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "2mb" }));

// ---------- sessions (owner only) ----------
const sign = (v) => crypto.createHmac("sha256", config.sessionSecret).update(v).digest("hex");
const ipHash = (req) => sign("ip:" + (req.ip || ""));
function isOwner(req) {
  const m = /(?:^|;\s*)sid=(\d+)\.([a-f0-9]{64})/.exec(req.headers.cookie || "");
  if (!m || Number(m[1]) < Date.now()) return false;
  return crypto.timingSafeEqual(Buffer.from(m[2]), Buffer.from(sign("owner:" + m[1])));
}
const owner = (req, res, next) => (isOwner(req) ? next() : res.status(401).json({ error: "Please sign in." }));
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => { console.error(e); res.status(500).json({ error: "Something went wrong. Please try again." }); });

const attempts = new Map();
app.post("/api/login", (req, res) => {
  const key = req.ip, now = Date.now();
  const a = (attempts.get(key) || []).filter((t) => now - t < 15 * 60 * 1000);
  if (a.length >= 8) return res.status(429).json({ error: "Too many attempts. Try again in 15 minutes." });
  const given = sign("pw:" + String(req.body?.password || ""));
  if (!crypto.timingSafeEqual(Buffer.from(given), Buffer.from(sign("pw:" + config.ownerPassword)))) {
    attempts.set(key, [...a, now]);
    return res.status(401).json({ error: "That password is not correct." });
  }
  const exp = String(now + 30 * 24 * 3600 * 1000);
  res.setHeader("Set-Cookie", `sid=${exp}.${sign("owner:" + exp)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 24 * 3600}${req.secure ? "; Secure" : ""}`);
  res.json({ ok: true });
});
app.post("/api/logout", (req, res) => {
  res.setHeader("Set-Cookie", "sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  res.json({ ok: true });
});

async function visitorUsedToday(req) {
  const [{ n }] = await q("SELECT COUNT(*) AS n FROM runs WHERE requester='visitor' AND ip_hash=? AND created_at >= CURDATE()", [ipHash(req)]);
  return n;
}
app.get("/api/me", wrap(async (req, res) => {
  const o = isOwner(req);
  res.json({
    owner: o,
    publicAccess: config.publicAccess,
    remaining: o ? null : Math.max(0, config.visitorDailyLimit - (await visitorUsedToday(req))),
    limit: config.visitorDailyLimit,
    testMode: config.mockAi,
  });
}));

// ---------- studies ----------
const jobs = new Map(); // id -> { status, stage, result, itemId, error, who }
const body = (result) => JSON.stringify({ type: "study", ...result });

app.post("/api/studies", wrap(async (req, res) => {
  const o = isOwner(req);
  if (!o && !config.publicAccess) return res.status(401).json({ error: "Please sign in." });
  const passage = parsePassage(req.body?.reference);
  if (!passage) return res.status(400).json({ error: "Please enter one Bible passage, for example: Acts 10:20-48" });
  if (passage.verses > config.maxVerses) return res.status(400).json({ error: `That passage is too long. Please choose ${config.maxVerses} verses or fewer.` });
  const who = o ? "owner" : ipHash(req);
  if ([...jobs.values()].some((j) => j.who === who && j.status === "running")) return res.status(429).json({ error: "A study is already being prepared. Please wait for it to finish." });

  let folderId = null;
  if (o && req.body?.folderId) {
    const [f] = await q("SELECT id FROM folders WHERE id=? AND kind='history'", [req.body.folderId]);
    if (!f) return res.status(400).json({ error: "That folder no longer exists." });
    folderId = f.id;
  }
  if (!o) {
    if ((await visitorUsedToday(req)) >= config.visitorDailyLimit) return res.status(429).json({ error: `You have used your ${config.visitorDailyLimit} studies for today. Please come back tomorrow.` });
    if (config.visitorDailyBudgetUsd != null) {
      const [{ spent }] = await q("SELECT COALESCE(SUM(cost_usd),0) AS spent FROM runs WHERE requester='visitor' AND created_at >= CURDATE()");
      if (Number(spent) >= config.visitorDailyBudgetUsd) return res.status(429).json({ error: "The site has reached its limit for today. Please come back tomorrow." });
    }
  }

  const id = crypto.randomUUID();
  const job = { status: "running", stage: "Starting", who };
  jobs.set(id, job);
  setTimeout(() => jobs.delete(id), 3600 * 1000);
  res.json({ jobId: id });

  const started = Date.now();
  const requester = o ? "owner" : "visitor";
  const record = (fields) => q(
    "INSERT INTO runs (ref_osis, ref_en, requester, ip_hash, cached, status, result, steps, cost_usd, duration_ms, error) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    [passage.osis, passage.en, requester, ipHash(req), fields.cached ? 1 : 0, fields.status, fields.result ?? null, JSON.stringify(fields.steps || []), fields.cost ?? null, Date.now() - started, fields.error ?? null]);
  try {
    let result;
    const fresh = o && req.body?.fresh;
    const [hit] = fresh ? [] : await q("SELECT result FROM runs WHERE ref_osis=? AND status='ok' AND cached=0 AND result IS NOT NULL ORDER BY id DESC LIMIT 1", [passage.osis]);
    if (hit) {
      result = JSON.parse(hit.result);
      await record({ cached: true, status: "ok", cost: 0 });
    } else {
      const out = await runStudy(passage, (s) => (job.stage = s));
      result = out.result;
      await record({ status: "ok", result: JSON.stringify(result), steps: out.steps, cost: totalCost(out.steps) });
    }
    if (folderId) {
      const r = await q("INSERT INTO items (folder_id, title, body) VALUES (?,?,?)", [folderId, passage.en, body(result)]);
      job.itemId = r.insertId;
    }
    job.result = result;
    job.status = "done";
  } catch (err) {
    console.error(err);
    const steps = err.steps || [];
    await record({ status: "error", steps, cost: totalCost(steps), error: String(err.message || err).slice(0, 500) }).catch(() => {});
    job.status = "error";
    job.error = /Please try again|declined|incomplete/.test(err.message || "") ? err.message : "The study could not be completed. Please try again.";
  }
}));

app.get("/api/studies/:id", (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j || j.who !== (isOwner(req) ? "owner" : ipHash(req))) return res.status(404).json({ error: "Not found." });
  res.json({ status: j.status, stage: j.stage, result: j.result, itemId: j.itemId, error: j.error });
});

// ---------- folders & items (owner only; kind = history | programs) ----------
const KIND = (v) => (v === "programs" ? "programs" : "history");
const clean = (v, max) => String(v ?? "").trim().slice(0, max);

app.get("/api/folders", owner, wrap(async (req, res) => {
  res.json(await q(
    "SELECT f.id, f.name, COUNT(i.id) AS count FROM folders f LEFT JOIN items i ON i.folder_id=f.id WHERE f.kind=? GROUP BY f.id ORDER BY f.name", [KIND(req.query.kind)]));
}));
app.post("/api/folders", owner, wrap(async (req, res) => {
  const name = clean(req.body?.name, 120);
  if (!name) return res.status(400).json({ error: "Please give the folder a name." });
  const r = await q("INSERT INTO folders (kind, name) VALUES (?,?)", [KIND(req.body?.kind), name]);
  res.json({ id: r.insertId });
}));
app.patch("/api/folders/:id", owner, wrap(async (req, res) => {
  const name = clean(req.body?.name, 120);
  if (!name) return res.status(400).json({ error: "Please give the folder a name." });
  await q("UPDATE folders SET name=? WHERE id=?", [name, req.params.id]);
  res.json({ ok: true });
}));
app.delete("/api/folders/:id", owner, wrap(async (req, res) => {
  await q("DELETE FROM folders WHERE id=?", [req.params.id]);
  res.json({ ok: true });
}));
app.post("/api/folders/:id/copy", owner, wrap(async (req, res) => {
  const [f] = await q("SELECT * FROM folders WHERE id=?", [req.params.id]);
  if (!f) return res.status(404).json({ error: "Not found." });
  const r = await q("INSERT INTO folders (kind, name) VALUES (?,?)", [f.kind, (f.name + " (copy)").slice(0, 120)]);
  await q("INSERT INTO items (folder_id, title, body) SELECT ?, title, body FROM items WHERE folder_id=?", [r.insertId, f.id]);
  res.json({ id: r.insertId });
}));

app.get("/api/items", owner, wrap(async (req, res) => {
  const term = clean(req.query.q, 100);
  const like = "%" + term.replace(/[\\%_]/g, "\\$&") + "%";
  if (req.query.folder) {
    return res.json(await q(
      "SELECT id, folder_id, title, updated_at FROM items WHERE folder_id=? AND (?='' OR title LIKE ? OR body LIKE ?) ORDER BY title", [req.query.folder, term, like, like]));
  }
  res.json(await q(
    "SELECT i.id, i.folder_id, i.title, i.updated_at, f.name AS folder FROM items i JOIN folders f ON f.id=i.folder_id WHERE f.kind=? AND (title LIKE ? OR body LIKE ?) ORDER BY i.title LIMIT 200",
    [KIND(req.query.kind), like, like]));
}));
app.get("/api/items/:id", owner, wrap(async (req, res) => {
  const [i] = await q("SELECT id, folder_id, title, body, updated_at FROM items WHERE id=?", [req.params.id]);
  if (!i) return res.status(404).json({ error: "Not found." });
  res.json({ ...i, body: JSON.parse(i.body) });
}));
app.post("/api/items", owner, wrap(async (req, res) => {
  const [f] = await q("SELECT id FROM folders WHERE id=?", [req.body?.folderId]);
  if (!f) return res.status(400).json({ error: "That folder no longer exists." });
  const title = clean(req.body?.title, 200) || "Untitled";
  const r = await q("INSERT INTO items (folder_id, title, body) VALUES (?,?,?)", [f.id, title, JSON.stringify(req.body?.body ?? { type: "doc", text: "" })]);
  res.json({ id: r.insertId });
}));
app.patch("/api/items/:id", owner, wrap(async (req, res) => {
  const b = req.body || {};
  if (b.title !== undefined) {
    const title = clean(b.title, 200);
    if (!title) return res.status(400).json({ error: "Please give it a name." });
    await q("UPDATE items SET title=? WHERE id=?", [title, req.params.id]);
  }
  if (b.body !== undefined) await q("UPDATE items SET body=? WHERE id=?", [JSON.stringify(b.body), req.params.id]);
  if (b.folderId !== undefined) {
    const [it] = await q("SELECT f.kind FROM items i JOIN folders f ON f.id=i.folder_id WHERE i.id=?", [req.params.id]);
    const [f] = await q("SELECT id, kind FROM folders WHERE id=?", [b.folderId]);
    if (!it || !f || f.kind !== it.kind) return res.status(400).json({ error: "That folder no longer exists." });
    await q("UPDATE items SET folder_id=? WHERE id=?", [f.id, req.params.id]);
  }
  res.json({ ok: true });
}));
app.post("/api/items/:id/copy", owner, wrap(async (req, res) => {
  const [it] = await q("SELECT i.*, f.kind FROM items i JOIN folders f ON f.id=i.folder_id WHERE i.id=?", [req.params.id]);
  const [f] = await q("SELECT id, kind FROM folders WHERE id=?", [req.body?.folderId ?? it?.folder_id]);
  if (!it || !f || f.kind !== it.kind) return res.status(400).json({ error: "That folder no longer exists." });
  const title = f.id === it.folder_id ? (it.title + " (copy)").slice(0, 200) : it.title;
  const r = await q("INSERT INTO items (folder_id, title, body) VALUES (?,?,?)", [f.id, title, it.body]);
  res.json({ id: r.insertId });
}));
app.delete("/api/items/:id", owner, wrap(async (req, res) => {
  await q("DELETE FROM items WHERE id=?", [req.params.id]);
  res.json({ ok: true });
}));

// ---------- costs (owner only) ----------
app.get("/api/costs", owner, wrap(async (req, res) => {
  const runs = await q("SELECT id, ref_en, requester, cached, status, steps, cost_usd, duration_ms, error, created_at FROM runs ORDER BY id DESC LIMIT 200");
  const [totals] = await q(
    `SELECT COUNT(*) AS studies, SUM(cached) AS cached, COALESCE(SUM(cost_usd),0) AS total,
            COALESCE(SUM(CASE WHEN created_at >= CURDATE() THEN cost_usd END),0) AS today,
            COALESCE(SUM(CASE WHEN created_at >= DATE_FORMAT(CURDATE(),'%Y-%m-01') THEN cost_usd END),0) AS month,
            AVG(CASE WHEN cached=0 AND status='ok' THEN cost_usd END) AS average,
            SUM(cached=0 AND cost_usd IS NULL) AS unpriced
     FROM runs`);
  res.json({ totals, runs: runs.map((r) => ({ ...r, steps: JSON.parse(r.steps || "[]") })) });
}));

// ---------- static ----------
const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
app.use(express.static(pub, { maxAge: "1h" }));
app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(pub, "index.html")));

await migrate();
app.listen(config.port, "0.0.0.0", () => console.log(`IzwiLakhe listening on ${config.port}${config.mockAi ? " (TEST MODE: no AI is called)" : ""}`));
