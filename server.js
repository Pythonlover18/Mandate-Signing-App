const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
const ROOT = __dirname;
const PUBLIC_DIR = fs.existsSync(path.join(ROOT, "public"))
  ? path.join(ROOT, "public")
  : ROOT;
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT, "data");
const STORE_FILE = path.join(DATA_DIR, "store.json");

const SESSION_COOKIE = "biz_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const COOKIE_SECURE =
  process.env.COOKIE_SECURE === "true" || process.env.NODE_ENV === "production";
const sessions = new Map();

const MANDATE_TYPES = new Set(["debt", "equity", "ancillary"]);
const PIPELINE_STATUSES = new Set(["ongoing", "closed", "dropped", "moved_to_signed"]);

ensureStorage();
ensureDefaultAdmin();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
    const pathname = url.pathname;

    if (pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    await serveStatic(req, res, pathname);
  } catch (err) {
    writeJson(res, 500, { error: "Internal server error", details: String(err.message || err) });
  }
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`Business CRM running on http://${HOST}:${PORT}`);
});

function ensureStorage() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(STORE_FILE)) {
    const initial = {
      users: [],
      pipelineItems: [],
      signedMandates: [],
      counters: {
        user: 0,
        pipeline: 0,
        mandate: 0,
        track: 0
      }
    };
    fs.writeFileSync(STORE_FILE, JSON.stringify(initial, null, 2), "utf8");
  }
}

function ensureDefaultAdmin() {
  const store = readStore();
  if (store.users.some((u) => u.role === "admin")) {
    return;
  }

  const adminName = process.env.ADMIN_FULL_NAME || "System Admin";
  const adminEmail = (process.env.ADMIN_EMAIL || "admin@crm.local").toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || "admin123";
  const user = {
    id: nextId(store, "user"),
    fullName: adminName,
    email: adminEmail,
    passwordHash: makePasswordHash(adminPassword),
    role: "admin",
    createdAt: new Date().toISOString()
  };
  store.users.push(user);
  writeStore(store);
}

function readStore() {
  const raw = fs.readFileSync(STORE_FILE, "utf8");
  return JSON.parse(raw);
}

function writeStore(store) {
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), "utf8");
}

function nextId(store, key) {
  const current = Number(store.counters[key] || 0) + 1;
  store.counters[key] = current;
  return current;
}

function makePasswordHash(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, combined) {
  const [salt, expected] = String(combined || "").split(":");
  if (!salt || !expected) {
    return false;
  }
  const actual = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

function cleanupSessions() {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (session.expiresAt < now) {
      sessions.delete(token);
    }
  }
}

function getCookies(req) {
  const header = req.headers.cookie || "";
  const cookies = {};
  for (const segment of header.split(";")) {
    const trimmed = segment.trim();
    if (!trimmed) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    const value = decodeURIComponent(trimmed.slice(eq + 1).trim());
    cookies[key] = value;
  }
  return cookies;
}

function setSessionCookie(res, token) {
  const securePart = COOKIE_SECURE ? "; Secure" : "";
  const value = `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${Math.floor(
    SESSION_TTL_MS / 1000
  )}; SameSite=Lax${securePart}`;
  res.setHeader("Set-Cookie", value);
}

function clearSessionCookie(res) {
  const securePart = COOKIE_SECURE ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${securePart}`
  );
}

function getCurrentUser(req) {
  cleanupSessions();
  const cookies = getCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) {
    return null;
  }
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  const store = readStore();
  const user = store.users.find((u) => u.id === session.userId);
  if (!user) {
    sessions.delete(token);
    return null;
  }
  return user;
}

function requireAuth(req, res) {
  const user = getCurrentUser(req);
  if (!user) {
    writeJson(res, 401, { error: "Unauthorized" });
    return null;
  }
  return user;
}

function requireAdmin(req, res) {
  const user = requireAuth(req, res);
  if (!user) {
    return null;
  }
  if (user.role !== "admin") {
    writeJson(res, 403, { error: "Admin access required" });
    return null;
  }
  return user;
}

function pickUserPayload(user) {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    role: user.role
  };
}

function writeJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  res.end(body);
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk.toString("utf8");
      if (raw.length > 2 * 1024 * 1024) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeMoney(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    return null;
  }
  return num;
}

function validateContacts(contacts, errors) {
  if (!Array.isArray(contacts) || contacts.length < 2) {
    errors.push("At least 2 contacts are required.");
    return [];
  }
  return contacts.map((contact, index) => {
    const name = normalizeText(contact.name);
    const email = normalizeText(contact.email);
    const mobile = normalizeText(contact.mobile);
    if (!name || !email || !mobile) {
      errors.push(`Contact ${index + 1} requires name, email and mobile.`);
    }
    return { name, email, mobile };
  });
}

function validateTracks(tracks, errors) {
  if (!Array.isArray(tracks) || tracks.length === 0) {
    errors.push("At least 1 bank/investor status row is required.");
    return [];
  }
  return tracks.map((track, index) => {
    const institution = normalizeText(track.institution);
    const currentStatus = normalizeText(track.currentStatus);
    const nextStep = normalizeText(track.nextStep);
    if (!institution || !currentStatus || !nextStep) {
      errors.push(`Track ${index + 1} requires bank/investor, current status and next step.`);
    }
    return {
      id: Number(track.id) || null,
      institution,
      currentStatus,
      nextStep
    };
  });
}

function validateMandateInput(raw, options = {}) {
  const errors = [];
  const mandateType = normalizeText(raw.mandateType).toLowerCase();
  if (!MANDATE_TYPES.has(mandateType)) {
    errors.push("Mandate type must be debt, equity or ancillary.");
  }

  const clientName = normalizeText(raw.clientName);
  if (!clientName) {
    errors.push("Client name is required.");
  }

  const fundraisingAmount = normalizeMoney(raw.fundraisingAmount);
  if (fundraisingAmount === null) {
    errors.push("Fundraising amount must be a valid non-negative number.");
  }

  const debtEquityAmount = normalizeMoney(raw.debtEquityAmount);
  if (["debt", "equity"].includes(mandateType) && debtEquityAmount === null) {
    errors.push("Debt/Equity amount is required for debt or equity mandates.");
  }

  const feePercentage = normalizeMoney(raw.feePercentage);
  if (feePercentage === null) {
    errors.push("Fee percentage must be a valid non-negative number.");
  }

  const feeMandateAmount = normalizeMoney(raw.feeMandateAmount);
  if (feeMandateAmount === null) {
    errors.push("Fee mandate amount must be a valid non-negative number.");
  }

  const contacts = validateContacts(raw.contacts, errors);
  const tracks = validateTracks(raw.tracks, errors);
  const nowIso = new Date().toISOString();

  const cleaned = {
    id: Number(raw.id) || null,
    clientName,
    fundraisingAmount,
    mandateType,
    debtEquityAmount,
    feePercentage,
    feeMandateAmount,
    contacts,
    tracks,
    ownerId: Number(raw.ownerId) || null,
    sourcePipelineId: Number(raw.sourcePipelineId) || null,
    createdAt: options.createdAt || nowIso,
    updatedAt: nowIso
  };
  return { errors, cleaned };
}

function validatePipelineInput(raw) {
  const errors = [];
  const companyName = normalizeText(raw.companyName);
  if (!companyName) {
    errors.push("Company name is required.");
  }

  const requirementType = normalizeText(raw.requirementType).toLowerCase();
  if (!MANDATE_TYPES.has(requirementType)) {
    errors.push("Requirement type must be debt, equity or ancillary.");
  }

  const status = normalizeText(raw.status).toLowerCase();
  if (!PIPELINE_STATUSES.has(status)) {
    errors.push("Pipeline status must be ongoing, closed, dropped or moved_to_signed.");
  }

  const currentStatus = normalizeText(raw.currentStatus);
  if (!currentStatus) {
    errors.push("Current status is required.");
  }

  const nextStep = normalizeText(raw.nextStep);
  if (!nextStep) {
    errors.push("Next step is required.");
  }

  const shortNote = normalizeText(raw.shortNote);
  const referralSource = normalizeText(raw.referralSource);
  const contacts = validateContacts(raw.contacts, errors);
  const nowIso = new Date().toISOString();

  const cleaned = {
    id: Number(raw.id) || null,
    companyName,
    requirementType,
    shortNote,
    referralSource,
    status,
    currentStatus,
    nextStep,
    contacts,
    ownerId: Number(raw.ownerId) || null,
    signedMandateId: Number(raw.signedMandateId) || null,
    createdAt: raw.createdAt || nowIso,
    updatedAt: nowIso
  };

  return { errors, cleaned };
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;
  const method = req.method || "GET";

  if (pathname === "/api/login" && method === "POST") {
    const body = await readJsonBody(req);
    const email = normalizeText(body.email).toLowerCase();
    const password = String(body.password || "");

    const store = readStore();
    const user = store.users.find((u) => u.email.toLowerCase() === email);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      writeJson(res, 401, { error: "Invalid email or password." });
      return;
    }

    const token = crypto.randomBytes(30).toString("hex");
    sessions.set(token, { userId: user.id, expiresAt: Date.now() + SESSION_TTL_MS });
    setSessionCookie(res, token);
    writeJson(res, 200, { user: pickUserPayload(user) });
    return;
  }

  if (pathname === "/api/logout" && method === "POST") {
    const cookies = getCookies(req);
    const token = cookies[SESSION_COOKIE];
    if (token) {
      sessions.delete(token);
    }
    clearSessionCookie(res);
    writeJson(res, 200, { success: true });
    return;
  }

  if (pathname === "/api/me" && method === "GET") {
    const user = requireAuth(req, res);
    if (!user) {
      return;
    }
    writeJson(res, 200, { user: pickUserPayload(user) });
    return;
  }

  if (pathname === "/api/health" && method === "GET") {
    writeJson(res, 200, { ok: true, now: new Date().toISOString() });
    return;
  }

  if (pathname === "/api/users" && method === "GET") {
    requireAuth(req, res);
    const store = readStore();
    writeJson(res, 200, {
      users: store.users.map(pickUserPayload)
    });
    return;
  }

  if (pathname === "/api/users" && method === "POST") {
    const admin = requireAdmin(req, res);
    if (!admin) {
      return;
    }

    const body = await readJsonBody(req);
    const fullName = normalizeText(body.fullName);
    const email = normalizeText(body.email).toLowerCase();
    const password = String(body.password || "");
    const role = normalizeText(body.role).toLowerCase() || "employee";
    const allowedRoles = new Set(["employee", "admin"]);

    if (!fullName || !email || !password || !allowedRoles.has(role)) {
      writeJson(res, 400, { error: "fullName, email, password and valid role are required." });
      return;
    }
    if (password.length < 6) {
      writeJson(res, 400, { error: "Password must be at least 6 characters." });
      return;
    }

    const store = readStore();
    if (store.users.some((u) => u.email.toLowerCase() === email)) {
      writeJson(res, 409, { error: "Email already exists." });
      return;
    }

    const user = {
      id: nextId(store, "user"),
      fullName,
      email,
      passwordHash: makePasswordHash(password),
      role,
      createdAt: new Date().toISOString()
    };
    store.users.push(user);
    writeStore(store);
    writeJson(res, 201, { user: pickUserPayload(user) });
    return;
  }

  if (pathname === "/api/pipeline" && method === "GET") {
    const user = requireAuth(req, res);
    if (!user) {
      return;
    }
    const store = readStore();
    const all = url.searchParams.get("all") === "1";
    const filtered = user.role === "admin" && all
      ? store.pipelineItems
      : store.pipelineItems.filter((item) => item.ownerId === user.id);
    writeJson(res, 200, { pipeline: filtered });
    return;
  }

  if (pathname === "/api/pipeline" && method === "POST") {
    const user = requireAuth(req, res);
    if (!user) {
      return;
    }
    const body = await readJsonBody(req);
    const { errors, cleaned } = validatePipelineInput(body);
    if (errors.length) {
      writeJson(res, 400, { error: errors.join(" ") });
      return;
    }

    const store = readStore();
    cleaned.id = nextId(store, "pipeline");
    cleaned.ownerId = user.role === "admin" && Number(body.ownerId) ? Number(body.ownerId) : user.id;
    cleaned.signedMandateId = null;
    store.pipelineItems.push(cleaned);
    writeStore(store);
    writeJson(res, 201, { pipelineItem: cleaned });
    return;
  }

  if (pathname.startsWith("/api/pipeline/") && method === "PUT") {
    const user = requireAuth(req, res);
    if (!user) {
      return;
    }
    const id = Number(pathname.split("/")[3]);
    if (!id) {
      writeJson(res, 400, { error: "Invalid pipeline id." });
      return;
    }
    const body = await readJsonBody(req);
    const store = readStore();
    const index = store.pipelineItems.findIndex((i) => i.id === id);
    if (index < 0) {
      writeJson(res, 404, { error: "Pipeline item not found." });
      return;
    }
    const existing = store.pipelineItems[index];
    if (user.role !== "admin" && existing.ownerId !== user.id) {
      writeJson(res, 403, { error: "Forbidden." });
      return;
    }

    const { errors, cleaned } = validatePipelineInput({
      ...existing,
      ...body,
      id: existing.id,
      ownerId: existing.ownerId,
      signedMandateId: existing.signedMandateId,
      createdAt: existing.createdAt
    });
    if (errors.length) {
      writeJson(res, 400, { error: errors.join(" ") });
      return;
    }
    cleaned.id = existing.id;
    cleaned.ownerId = existing.ownerId;
    cleaned.signedMandateId = existing.signedMandateId || null;
    cleaned.createdAt = existing.createdAt;
    store.pipelineItems[index] = cleaned;
    writeStore(store);
    writeJson(res, 200, { pipelineItem: cleaned });
    return;
  }

  if (pathname.startsWith("/api/pipeline/") && pathname.endsWith("/convert") && method === "POST") {
    const user = requireAuth(req, res);
    if (!user) {
      return;
    }
    const segments = pathname.split("/");
    const id = Number(segments[3]);
    if (!id) {
      writeJson(res, 400, { error: "Invalid pipeline id." });
      return;
    }
    const body = await readJsonBody(req);
    const store = readStore();
    const pipeline = store.pipelineItems.find((p) => p.id === id);
    if (!pipeline) {
      writeJson(res, 404, { error: "Pipeline item not found." });
      return;
    }
    if (user.role !== "admin" && pipeline.ownerId !== user.id) {
      writeJson(res, 403, { error: "Forbidden." });
      return;
    }
    if (pipeline.signedMandateId) {
      writeJson(res, 409, { error: "This pipeline entry has already been moved to signed mandate." });
      return;
    }

    const mandateInput = {
      clientName: normalizeText(body.clientName || pipeline.companyName),
      fundraisingAmount: body.fundraisingAmount,
      mandateType: normalizeText(body.mandateType || pipeline.requirementType),
      debtEquityAmount: body.debtEquityAmount,
      feePercentage: body.feePercentage,
      feeMandateAmount: body.feeMandateAmount,
      contacts: body.contacts || pipeline.contacts,
      tracks: body.tracks,
      sourcePipelineId: pipeline.id,
      ownerId: pipeline.ownerId
    };
    const { errors, cleaned } = validateMandateInput(mandateInput);
    if (errors.length) {
      writeJson(res, 400, { error: errors.join(" ") });
      return;
    }

    cleaned.id = nextId(store, "mandate");
    cleaned.ownerId = pipeline.ownerId;
    cleaned.sourcePipelineId = pipeline.id;
    cleaned.tracks = cleaned.tracks.map((track) => ({
      ...track,
      id: nextId(store, "track")
    }));
    store.signedMandates.push(cleaned);

    pipeline.status = "moved_to_signed";
    pipeline.signedMandateId = cleaned.id;
    pipeline.updatedAt = new Date().toISOString();
    writeStore(store);

    writeJson(res, 201, { signedMandate: cleaned, pipelineItem: pipeline });
    return;
  }

  if (pathname === "/api/mandates" && method === "GET") {
    const user = requireAuth(req, res);
    if (!user) {
      return;
    }
    const store = readStore();
    let list = store.signedMandates.slice();
    if (user.role !== "admin") {
      list = list.filter((item) => item.ownerId === user.id);
    } else {
      const ownerId = Number(url.searchParams.get("ownerId") || 0);
      const type = normalizeText(url.searchParams.get("type")).toLowerCase();
      if (ownerId) {
        list = list.filter((item) => item.ownerId === ownerId);
      }
      if (MANDATE_TYPES.has(type)) {
        list = list.filter((item) => item.mandateType === type);
      }
    }
    writeJson(res, 200, { signedMandates: list });
    return;
  }

  if (pathname === "/api/mandates" && method === "POST") {
    const user = requireAuth(req, res);
    if (!user) {
      return;
    }
    const body = await readJsonBody(req);
    const { errors, cleaned } = validateMandateInput(body);
    if (errors.length) {
      writeJson(res, 400, { error: errors.join(" ") });
      return;
    }

    const store = readStore();
    cleaned.id = nextId(store, "mandate");
    cleaned.ownerId = user.role === "admin" && Number(body.ownerId) ? Number(body.ownerId) : user.id;
    cleaned.tracks = cleaned.tracks.map((track) => ({
      ...track,
      id: nextId(store, "track")
    }));
    store.signedMandates.push(cleaned);
    writeStore(store);
    writeJson(res, 201, { signedMandate: cleaned });
    return;
  }

  if (pathname.startsWith("/api/mandates/") && method === "PUT") {
    const user = requireAuth(req, res);
    if (!user) {
      return;
    }
    const id = Number(pathname.split("/")[3]);
    if (!id) {
      writeJson(res, 400, { error: "Invalid mandate id." });
      return;
    }
    const body = await readJsonBody(req);
    const store = readStore();
    const index = store.signedMandates.findIndex((i) => i.id === id);
    if (index < 0) {
      writeJson(res, 404, { error: "Signed mandate not found." });
      return;
    }
    const existing = store.signedMandates[index];
    if (user.role !== "admin" && existing.ownerId !== user.id) {
      writeJson(res, 403, { error: "Forbidden." });
      return;
    }

    const { errors, cleaned } = validateMandateInput({
      ...existing,
      ...body,
      id: existing.id,
      ownerId: existing.ownerId,
      sourcePipelineId: existing.sourcePipelineId,
      createdAt: existing.createdAt
    });
    if (errors.length) {
      writeJson(res, 400, { error: errors.join(" ") });
      return;
    }

    cleaned.id = existing.id;
    cleaned.ownerId = existing.ownerId;
    cleaned.sourcePipelineId = existing.sourcePipelineId || null;
    cleaned.createdAt = existing.createdAt;
    cleaned.tracks = cleaned.tracks.map((track) => ({
      ...track,
      id: track.id || nextId(store, "track")
    }));
    store.signedMandates[index] = cleaned;
    writeStore(store);
    writeJson(res, 200, { signedMandate: cleaned });
    return;
  }

  writeJson(res, 404, { error: "Endpoint not found." });
}

async function serveStatic(req, res, pathname) {
  let safePath = pathname === "/" ? "/index.html" : pathname;
  safePath = safePath.replace(/\\/g, "/");
  const resolved = path.resolve(path.join(PUBLIC_DIR, `.${safePath}`));
  if (!resolved.startsWith(PUBLIC_DIR)) {
    writeJson(res, 400, { error: "Invalid path." });
    return;
  }

  try {
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      writeJson(res, 404, { error: "Not found." });
      return;
    }
    const ext = path.extname(resolved).toLowerCase();
    const contentType =
      ext === ".html"
        ? "text/html; charset=utf-8"
        : ext === ".css"
          ? "text/css; charset=utf-8"
          : ext === ".js"
            ? "application/javascript; charset=utf-8"
            : "application/octet-stream";
    const content = fs.readFileSync(resolved);
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": content.length
    });
    res.end(content);
  } catch (_err) {
    writeJson(res, 404, { error: "File not found." });
  }
}
