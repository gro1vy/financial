import { createHash, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const distDir = join(root, "dist");
const publicDir = join(root, "public");
const dataDir = join(root, "data");
const dataFile = join(dataDir, "db.json");
const port = Number(process.env.PORT || 4173);
const isProd = existsSync(distDir);

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

function ensureDb() {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  if (!existsSync(dataFile)) writeFileSync(dataFile, JSON.stringify({ users: [], sessions: {} }, null, 2));
}

function readDb() {
  ensureDb();
  return JSON.parse(readFileSync(dataFile, "utf8"));
}

function writeDb(db) {
  writeFileSync(dataFile, JSON.stringify(db, null, 2));
}

function json(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(body));
}

function parseCookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || "").split(";").filter(Boolean).map((item) => {
      const [key, ...value] = item.trim().split("=");
      return [key, decodeURIComponent(value.join("="))];
    }),
  );
}

function passwordHash(password, salt = randomBytes(16).toString("hex")) {
  const hash = pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const candidate = passwordHash(password, salt).split(":")[1];
  return timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(candidate, "hex"));
}

function getBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function publicUser(user) {
  return {
    id: user.id,
    login: user.login,
    settings: user.settings || { rememberBudget: false, defaultBudget: null },
    expenseTitles: getExpenseTitles(user),
  };
}

function getExpenseTitles(user) {
  const saved = Array.isArray(user.expenseTitles) ? user.expenseTitles : [];
  const fromExpenses = Object.values(user.weeks || {})
    .flatMap((week) => week.expenses || [])
    .map((expense) => String(expense.title || "").trim())
    .filter(Boolean);
  return [...new Set([...saved, ...fromExpenses])].sort((a, b) => a.localeCompare(b, "ru"));
}

function rememberExpenseTitle(user, title) {
  const value = String(title || "").trim().slice(0, 80);
  if (!value) return "";
  user.expenseTitles = getExpenseTitles(user);
  if (!user.expenseTitles.includes(value)) {
    user.expenseTitles.push(value);
    user.expenseTitles.sort((a, b) => a.localeCompare(b, "ru"));
  }
  return value;
}

function requireUser(req, res, db) {
  const sid = parseCookies(req).sid;
  const userId = sid && db.sessions[sid];
  const user = userId && db.users.find((item) => item.id === userId);
  if (!user) {
    json(res, 401, { error: "Нужна авторизация" });
    return null;
  }
  return user;
}

function weekKey(date = new Date()) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  const day = value.getDay() || 7;
  value.setDate(value.getDate() + 4 - day);
  const yearStart = new Date(value.getFullYear(), 0, 1);
  const week = Math.ceil(((value - yearStart) / 86400000 + 1) / 7);
  return `${value.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

async function api(req, res) {
  const db = readDb();
  const body = req.method === "GET" ? {} : await getBody(req);

  if (req.url === "/api/register" && req.method === "POST") {
    const login = String(body.login || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (login.length < 3 || password.length < 6) return json(res, 400, { error: "Логин от 3 символов, пароль от 6" });
    if (db.users.some((user) => user.login === login)) return json(res, 409, { error: "Такой пользователь уже есть" });

    const user = {
      id: randomBytes(12).toString("hex"),
      login,
      password: passwordHash(password),
      settings: { rememberBudget: false, defaultBudget: null },
      expenseTitles: [],
      weeks: {},
    };
    db.users.push(user);
    const sid = randomBytes(24).toString("hex");
    db.sessions[sid] = user.id;
    writeDb(db);
    return json(res, 201, { user: publicUser(user) }, { "set-cookie": `sid=${sid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000` });
  }

  if (req.url === "/api/login" && req.method === "POST") {
    const login = String(body.login || "").trim().toLowerCase();
    const user = db.users.find((item) => item.login === login);
    if (!user || !verifyPassword(String(body.password || ""), user.password)) return json(res, 401, { error: "Неверный логин или пароль" });
    const sid = randomBytes(24).toString("hex");
    db.sessions[sid] = user.id;
    writeDb(db);
    return json(res, 200, { user: publicUser(user) }, { "set-cookie": `sid=${sid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000` });
  }

  if (req.url === "/api/logout" && req.method === "POST") {
    const sid = parseCookies(req).sid;
    if (sid) delete db.sessions[sid];
    writeDb(db);
    return json(res, 200, { ok: true }, { "set-cookie": "sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0" });
  }

  const user = requireUser(req, res, db);
  if (!user) return;

  if (req.url === "/api/me" && req.method === "GET") {
    return json(res, 200, { user: publicUser(user) });
  }

  if (req.url === "/api/settings" && req.method === "PUT") {
    user.settings = {
      rememberBudget: Boolean(body.rememberBudget),
      defaultBudget: body.defaultBudget === null || body.defaultBudget === "" ? null : Math.max(0, Number(body.defaultBudget)),
    };
    writeDb(db);
    return json(res, 200, { user: publicUser(user) });
  }

  if (req.url.startsWith("/api/week") && req.method === "GET") {
    const url = new URL(req.url, "http://localhost");
    const key = url.searchParams.get("key") || weekKey();
    user.weeks ||= {};
    const week = user.weeks[key] || { budget: user.settings?.rememberBudget ? user.settings.defaultBudget : null, expenses: [] };
    return json(res, 200, { key, week });
  }

  if (req.url === "/api/week/budget" && req.method === "PUT") {
    const key = String(body.key || weekKey());
    user.weeks ||= {};
    user.weeks[key] ||= { budget: null, expenses: [] };
    user.weeks[key].budget = Math.max(0, Number(body.budget || 0));
    if (body.rememberBudget) {
      user.settings = { rememberBudget: true, defaultBudget: user.weeks[key].budget };
    }
    writeDb(db);
    return json(res, 200, { week: user.weeks[key], user: publicUser(user) });
  }

  if (req.url === "/api/expenses" && req.method === "POST") {
    const key = String(body.key || weekKey());
    user.weeks ||= {};
    user.weeks[key] ||= { budget: user.settings?.rememberBudget ? user.settings.defaultBudget : null, expenses: [] };
    const title = rememberExpenseTitle(user, body.title);
    const expense = {
      id: randomBytes(10).toString("hex"),
      date: String(body.date || new Date().toISOString().slice(0, 10)),
      title,
      amount: Math.max(0, Number(body.amount || 0)),
      createdAt: new Date().toISOString(),
    };
    user.weeks[key].expenses.push(expense);
    writeDb(db);
    return json(res, 201, { expense, week: user.weeks[key], user: publicUser(user) });
  }

  if (req.url.startsWith("/api/expenses/") && req.method === "DELETE") {
    const url = new URL(req.url, "http://localhost");
    const key = url.searchParams.get("key") || weekKey();
    const id = req.url.split("/").pop().split("?")[0];
    const week = user.weeks?.[key];
    if (week) week.expenses = week.expenses.filter((expense) => expense.id !== id);
    writeDb(db);
    return json(res, 200, { week });
  }

  json(res, 404, { error: "Не найдено" });
}

function serveStatic(req, res) {
  const base = isProd ? distDir : publicDir;
  const pathname = new URL(req.url, "http://localhost").pathname;
  const requested = pathname === "/" ? "/index.html" : pathname;
  let file = normalize(join(base, requested));
  if (!file.startsWith(base) || !existsSync(file)) {
    file = isProd ? join(distDir, "index.html") : join(root, "index.html");
  }
  res.writeHead(200, { "content-type": mime[extname(file)] || "application/octet-stream" });
  createReadStream(file).pipe(res);
}

createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    api(req, res).catch(() => json(res, 400, { error: "Некорректный запрос" }));
    return;
  }
  serveStatic(req, res);
}).listen(port, () => {
  console.log(`Fin app listening on http://localhost:${port}`);
});
