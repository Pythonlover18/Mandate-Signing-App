const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
const ROOT = __dirname;
const PUBLIC_CANDIDATE = path.join(ROOT, "public");
const PUBLIC_DIR = fs.existsSync(PUBLIC_CANDIDATE) ? PUBLIC_CANDIDATE : ROOT;
const DEFAULT_DATA_DIR = fs.existsSync(path.join(ROOT, "data")) ? path.join(ROOT, "data") : ROOT;
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : DEFAULT_DATA_DIR;
const STORE_FILE = path.join(DATA_DIR, "store.json");

const SESSION_COOKIE = "biz_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const COOKIE_SECURE =
  process.env.COOKIE_SECURE === "true" || process.env.NODE_ENV === "production";
const PASSWORD_POLICY = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
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

function normalizeStore(store) {
  const normalized = {
    users: Array.isArray(store.users) ? store.users : [],
    pipelineItems: Array.isArray(store.pipelineItems) ? store.pipelineItems : [],
    signedMandates: Array.isArray(store.signedMandates) ? store.signedMandates : [],
    counters: typeof store.counters === "object" && store.counters ? store.counters : {}
  };
  normalized.counters.user = Number(normalized.counters.user) || 0;
  normalized.counters.pipeline = Number(normalized.counters.pipeline) || 0;
  normalized.counters.mandate = Number(normalized.counters.mandate) || 0;
  normalized.counters.track = Number(normalized.counters.track) || 0;
  normalized.pipelineItems = normalized.pipelineItems.map((item) => normalizePipelineRecord(item));
  normalized.signedMandates = normalized.signedMandates.map((item) => normalizeMandateRecord(item));
  return normalized;
}

function normalizePipelineRecord(raw) {
  const createdAt = normalizeText(raw.createdAt) || new Date().toISOString();
  const updatedAt = normalizeText(raw.updatedAt) || createdAt;
  return {
    ...raw,
    id: Number(raw.id) || null,
    companyName: normalizeText(raw.companyName),
    requirementType: MANDATE_TYPES.has(normalizeText(raw.requirementType).toLowerCase())
      ? normalizeText(raw.requirementType).toLowerCase()
      : "debt",
    shortNote: normalizeText(raw.shortNote),
    referralSource: normalizeText(raw.referralSource),
    status: PIPELINE_STATUSES.has(normalizeText(raw.status).toLowerCase())
      ? normalizeText(raw.status).toLowerCase()
      : "ongoing",
    currentStatus: normalizeText(raw.currentStatus),
    nextStep: normalizeText(raw.nextStep),
    contacts: Array.isArray(raw.contacts) ? raw.contacts : [],
    ownerId: Number(raw.ownerId) || null,
    signedMandateId: Number(raw.signedMandateId) || null,
    createdAt,
    updatedAt,
    changeLog: Array.isArray(raw.changeLog) ? raw.changeLog : []
  };
}

function normalizeMandateRecord(raw) {
  const mandateType = MANDATE_TYPES.has(normalizeText(raw.mandateType).toLowerCase())
    ? normalizeText(raw.mandateType).toLowerCase()
    : "debt";
  const createdAt = normalizeText(raw.createdAt) || new Date().toISOString();
  const updatedAt = normalizeText(raw.updatedAt) || createdAt;

  let fundraisingAmount = normalizeMoney(raw.fundraisingAmount);
  if (fundraisingAmount === null) {
    fundraisingAmount = normalizeMoney(raw.debtEquityAmount);
  }
  if (mandateType === "ancillary") {
    fundraisingAmount = null;
  }

  let feePercentage = normalizeMoney(raw.feePercentage);
  if (mandateType === "ancillary") {
    feePercentage = null;
  }

  return {
    ...raw,
    id: Number(raw.id) || null,
    clientName: normalizeText(raw.clientName),
    mandateType,
    ancillaryType: mandateType === "ancillary" ? normalizeText(raw.ancillaryType) : "",
    fundraisingAmount,
    feePercentage,
    feeMandateAmount: normalizeMoney(raw.feeMandateAmount),
    referralSource: normalizeText(raw.referralSource),
    contacts: Array.isArray(raw.contacts) ? raw.contacts : [],
    tracks: Array.isArray(raw.tracks)
      ? raw.tracks.map((track) => ({
          ...track,
          id: Number(track.id) || null,
          institution: normalizeText(track.institution),
          currentStatus: normalizeText(track.currentStatus),
          nextStep: normalizeText(track.nextStep)
        }))
      : [],
    ownerId: Number(raw.ownerId) || null,
    sourcePipelineId: Number(raw.sourcePipelineId) || null,
    createdAt,
    updatedAt,
    changeLog: Array.isArray(raw.changeLog) ? raw.changeLog : []
  };
}

function ensureDefaultAdmin() {
  const store = readStore();
  const configuredEmail = normalizeText(process.env.ADMIN_EMAIL).toLowerCase();
  const configuredPassword = String(process.env.ADMIN_PASSWORD || "");
  const configuredName = normalizeText(process.env.ADMIN_FULL_NAME) || "Admin";

  const hasAdmin = store.users.some((u) => u.role === "admin");
  if (!configuredEmail || !configuredPassword) {
    if (!hasAdmin) {
      // eslint-disable-next-line no-console
      console.warn(
        "No admin user found. Set ADMIN_EMAIL and ADMIN_PASSWORD environment variables to bootstrap the first admin account."
      );
    }
    return;
  }

  const existing = store.users.find(
    (u) => normalizeText(u.email).toLowerCase() === configuredEmail
  );
  if (existing) {
    if (existing.role !== "admin") {
      existing.role = "admin";
      writeStore(store);
    }
    return;
  }

  const user = {
    id: nextId(store, "user"),
    fullName: configuredName,
    email: configuredEmail,
    passwordHash: makePasswordHash(configuredPassword),
    role: "admin",
    createdAt: new Date().toISOString()
  };
  store.users.push(user);
  writeStore(store);
}

function readStore() {
  const raw = fs.readFileSync(STORE_FILE, "utf8");
  return normalizeStore(JSON.parse(raw));
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

function isStrongPassword(password) {
  return PASSWORD_POLICY.test(password);
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
  const user = store.users.find((u) => Number(u.id) === Number(session.userId));
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
      } catch (_err) {
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

function addChangeLog(existingLog, action, userId, note) {
  const out = Array.isArray(existingLog) ? existingLog.slice() : [];
  out.push({
    at: new Date().toISOString(),
    action,
    byUserId: Number(userId) || null,
    note: note ? String(note) : ""
  });
  return out;
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

function validateTracks(tracks, errors, options = {}) {
  const allowEmpty = Boolean(options.allowEmpty);
  if (!Array.isArray(tracks) || tracks.length === 0) {
    if (allowEmpty) {
      return [];
    }
    errors.push("At least 1 status row is required.");
    return [];
  }

  const cleaned = [];
  for (let i = 0; i < tracks.length; i += 1) {
    const track = tracks[i] || {};
    const institution = normalizeText(track.institution);
    const currentStatus = normalizeText(track.currentStatus);
    const nextStep = normalizeText(track.nextStep);
    const hasAnyValue = Boolean(institution || currentStatus || nextStep);
    if (!hasAnyValue) {
      continue;
    }
    if (!currentStatus || !nextStep) {
      errors.push(`Status row ${i + 1} requires current status and next step.`);
    }
    cleaned.push({
      id: Number(track.id) || null,
      institution,
      currentStatus,
      nextStep
    });
  }

  if (!allowEmpty && cleaned.length === 0) {
    errors.push("At least 1 status row is required.");
  }

  return cleaned;
}

function validateMandateInput(raw, options = {}) {
  const errors = [];
  const nowIso = new Date().toISOString();
  const mandateType = normalizeText(raw.mandateType).toLowerCase();

  if (!MANDATE_TYPES.has(mandateType)) {
    errors.push("Mandate type must be debt, equity or ancillary.");
  }

  const clientName = normalizeText(raw.clientName);
  if (!clientName) {
    errors.push("Client name is required.");
  }

  const ancillaryType = mandateType === "ancillary" ? normalizeText(raw.ancillaryType) : "";
  if (mandateType === "ancillary" && !ancillaryType) {
    errors.push("Ancillary type is required when mandate type is ancillary.");
  }

  let fundraisingAmount = normalizeMoney(raw.fundraisingAmount);
  if (mandateType !== "ancillary" && fundraisingAmount === null) {
    errors.push("Fundraising amount is required for debt and equity mandates.");
  }
  if (mandateType === "ancillary") {
    fundraisingAmount = null;
  }

  let feePercentage = normalizeMoney(raw.feePercentage);
  if (mandateType !== "ancillary" && feePercentage === null) {
    errors.push("Fee percentage is required for debt and equity mandates.");
  }
  if (mandateType === "ancillary") {
    feePercentage = null;
  }

  const feeMandateAmount = normalizeMoney(raw.feeMandateAmount);
  if (feeMandateAmount === null) {
    errors.push("Fee mandate amount must be a valid non-negative number.");
  }

  const contacts = validateContacts(raw.contacts, errors);
  const tracks = validateTracks(raw.tracks, errors, { allowEmpty: true });
  const referralSource = normalizeText(raw.referralSource);

  const cleaned = {
    id: Number(raw.id) || null,
    clientName,
    mandateType,
    ancillaryType,
    fundraisingAmount,
    feePercentage,
    feeMandateAmount,
    referralSource,
    contacts,
    tracks,
    ownerId: Number(raw.ownerId) || null,
    sourcePipelineId: Number(raw.sourcePipelineId) || null,
    createdAt: options.createdAt || normalizeText(raw.createdAt) || nowIso,
    updatedAt: nowIso,
    changeLog: Array.isArray(raw.changeLog) ? raw.changeLog : []
  };

  return { errors, cleaned };
}

function validatePipelineInput(raw) {
  const errors = [];
  const nowIso = new Date().toISOString();

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
    createdAt: normalizeText(raw.createdAt) || nowIso,
    updatedAt: nowIso,
    changeLog: Array.isArray(raw.changeLog) ? raw.changeLog : []
  };

  return { errors, cleaned };
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;
  const method = req.method || "GET";
  const pipelineMatch = pathname.match(/^\/api\/pipeline\/(\d+)$/);
  const pipelineConvertMatch = pathname.match(/^\/api\/pipeline\/(\d+)\/convert$/);
  const mandateMatch = pathname.match(/^\/api\/mandates\/(\d+)$/);

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

  if (pathname === "/api/admin/export" && method === "GET") {
    const admin = requireAdmin(req, res);
    if (!admin) {
      return;
    }
    const store = readStore();
    writeJson(res, 200, { exportedAt: new Date().toISOString(), store });
    return;
  }

  if (pathname === "/api/users" && method === "GET") {
    const user = requireAuth(req, res);
    if (!user) {
      return;
    }
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

    if (!isStrongPassword(password)) {
      writeJson(res, 400, {
        error:
          "Password must be at least 8 characters and include uppercase, lowercase, number and special character."
      });
      return;
    }

    const store = readStore();
    if (store.users.some((u) => u.email.toLowerCase() === email)) {
      writeJson(res, 409, { error: "Email already exists." });
      return;
    }

    const newUser = {
      id: nextId(store, "user"),
      fullName,
      email,
      passwordHash: makePasswordHash(password),
      role,
      createdAt: new Date().toISOString()
    };
    store.users.push(newUser);
    writeStore(store);
    writeJson(res, 201, { user: pickUserPayload(newUser) });
    return;
  }

  if (pathname === "/api/pipeline" && method === "GET") {
    const user = requireAuth(req, res);
    if (!user) {
      return;
    }
    const store = readStore();
    const all = url.searchParams.get("all") === "1";
    const list =
      user.role === "admin" && all
        ? store.pipelineItems
        : store.pipelineItems.filter((item) => item.ownerId === user.id);
    writeJson(res, 200, { pipeline: list });
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
    cleaned.changeLog = addChangeLog([], "created", user.id, "Pipeline created");
    store.pipelineItems.push(cleaned);
    writeStore(store);
    writeJson(res, 201, { pipelineItem: cleaned });
    return;
  }

  if (pipelineMatch && method === "PUT") {
    const user = requireAuth(req, res);
    if (!user) {
      return;
    }
    const id = Number(pipelineMatch[1]);
    const body = await readJsonBody(req);
    const store = readStore();
    const index = store.pipelineItems.findIndex((item) => Number(item.id) === id);
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
      createdAt: existing.createdAt,
      changeLog: existing.changeLog
    });
    if (errors.length) {
      writeJson(res, 400, { error: errors.join(" ") });
      return;
    }

    cleaned.id = existing.id;
    cleaned.ownerId = existing.ownerId;
    cleaned.signedMandateId = existing.signedMandateId || null;
    cleaned.createdAt = existing.createdAt;
    cleaned.changeLog = addChangeLog(existing.changeLog, "updated", user.id, "Pipeline updated");
    store.pipelineItems[index] = cleaned;
    writeStore(store);
    writeJson(res, 200, { pipelineItem: cleaned });
    return;
  }

  if (pipelineMatch && method === "DELETE") {
    const user = requireAuth(req, res);
    if (!user) {
      return;
    }
    const id = Number(pipelineMatch[1]);
    const store = readStore();
    const index = store.pipelineItems.findIndex((item) => Number(item.id) === id);
    if (index < 0) {
      writeJson(res, 404, { error: "Pipeline item not found." });
      return;
    }
    const existing = store.pipelineItems[index];
    if (user.role !== "admin" && existing.ownerId !== user.id) {
      writeJson(res, 403, { error: "Forbidden." });
      return;
    }
    store.pipelineItems.splice(index, 1);
    writeStore(store);
    writeJson(res, 200, { success: true });
    return;
  }

  if (pipelineConvertMatch && method === "POST") {
    const user = requireAuth(req, res);
    if (!user) {
      return;
    }
    const id = Number(pipelineConvertMatch[1]);
    const body = await readJsonBody(req);
    const store = readStore();
    const pipeline = store.pipelineItems.find((item) => Number(item.id) === id);
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
      mandateType: normalizeText(body.mandateType || pipeline.requirementType),
      ancillaryType: body.ancillaryType,
      fundraisingAmount: body.fundraisingAmount,
      feePercentage: body.feePercentage,
      feeMandateAmount: body.feeMandateAmount,
      referralSource: normalizeText(body.referralSource || pipeline.referralSource),
      contacts: body.contacts || pipeline.contacts,
      tracks: Array.isArray(body.tracks) ? body.tracks : [],
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
      id: track.id || nextId(store, "track")
    }));
    cleaned.changeLog = addChangeLog(
      cleaned.changeLog,
      "created",
      user.id,
      `Converted from pipeline #${pipeline.id}`
    );
    store.signedMandates.push(cleaned);

    pipeline.status = "moved_to_signed";
    pipeline.signedMandateId = cleaned.id;
    pipeline.updatedAt = new Date().toISOString();
    pipeline.changeLog = addChangeLog(
      pipeline.changeLog,
      "moved_to_signed",
      user.id,
      `Converted to signed mandate #${cleaned.id}`
    );
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
      id: track.id || nextId(store, "track")
    }));
    cleaned.changeLog = addChangeLog(cleaned.changeLog, "created", user.id, "Signed mandate created");
    store.signedMandates.push(cleaned);
    writeStore(store);
    writeJson(res, 201, { signedMandate: cleaned });
    return;
  }

  if (mandateMatch && method === "PUT") {
    const user = requireAuth(req, res);
    if (!user) {
      return;
    }
    const id = Number(mandateMatch[1]);
    const body = await readJsonBody(req);
    const store = readStore();
    const index = store.signedMandates.findIndex((item) => Number(item.id) === id);
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
      createdAt: existing.createdAt,
      changeLog: existing.changeLog
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
    cleaned.changeLog = addChangeLog(existing.changeLog, "updated", user.id, "Signed mandate updated");
    store.signedMandates[index] = cleaned;
    writeStore(store);
    writeJson(res, 200, { signedMandate: cleaned });
    return;
  }

  if (mandateMatch && method === "DELETE") {
    const user = requireAuth(req, res);
    if (!user) {
      return;
    }
    const id = Number(mandateMatch[1]);
    const store = readStore();
    const index = store.signedMandates.findIndex((item) => Number(item.id) === id);
    if (index < 0) {
      writeJson(res, 404, { error: "Signed mandate not found." });
      return;
    }
    const existing = store.signedMandates[index];
    if (user.role !== "admin" && existing.ownerId !== user.id) {
      writeJson(res, 403, { error: "Forbidden." });
      return;
    }
    store.signedMandates.splice(index, 1);
    writeStore(store);
    writeJson(res, 200, { success: true });
    return;
  }

  writeJson(res, 404, { error: "Endpoint not found." });
}

async function serveStatic(_req, res, pathname) {
  const safePath = (pathname === "/" ? "/index.html" : pathname).replace(/\\/g, "/");
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
