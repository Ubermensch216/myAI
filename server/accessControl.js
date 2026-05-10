import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { loadLocalEnv } from "./env.js";
import { extractRequestToken } from "./auth.js";

loadLocalEnv();

const scryptAsync = promisify(crypto.scrypt);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const ACCESS_DIR = path.join(rootDir, "data", "access");
const ACCESS_GROUPS_PATH = path.join(ACCESS_DIR, "access-groups.json");
const ACCESS_TOKEN_SECRET_PATH = path.join(ACCESS_DIR, "access-token-secret");
const ACCESS_LEVELS = new Set([1, 2, 3]);
const TOKEN_TTL_SECONDS = Math.max(60, Number(process.env.ACCESS_TOKEN_TTL_SECONDS || 12 * 60 * 60));
const TOKEN_VERSION = 1;

export const DEFAULT_NOTEBOOK_ACCESS = Object.freeze({
  groups: ["*"],
  minLevel: 1
});

function createEmptyStore() {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    groups: [],
    super: {
      enabled: false,
      passwordHash: ""
    }
  };
}

function normalizeStore(raw) {
  const store = raw && typeof raw === "object" ? raw : createEmptyStore();
  const groups = Array.isArray(store.groups) ? store.groups : [];
  return {
    version: Number(store.version) || 1,
    updatedAt: typeof store.updatedAt === "string" ? store.updatedAt : new Date().toISOString(),
    groups: groups.map(normalizeGroupRecord).filter(Boolean),
    super: {
      enabled: Boolean(store.super?.enabled),
      passwordHash: typeof store.super?.passwordHash === "string" ? store.super.passwordHash : ""
    }
  };
}

function normalizeGroupRecord(group) {
  if (!group || typeof group !== "object") return null;
  const id = normalizeGroupId(group.id);
  if (!id) return null;
  return {
    id,
    name: String(group.name || id).trim().slice(0, 80) || id,
    description: String(group.description || "").trim().slice(0, 400),
    enabled: group.enabled !== false,
    levels: normalizeLevels(group.levels)
  };
}

function normalizeLevels(levels = {}) {
  const normalized = {};
  for (const level of [1, 2, 3]) {
    const source = levels?.[String(level)] || {};
    normalized[String(level)] = {
      enabled: Boolean(source.enabled),
      passwordHash: typeof source.passwordHash === "string" ? source.passwordHash : ""
    };
  }
  return normalized;
}

function touchStore(store) {
  store.updatedAt = new Date().toISOString();
  return store;
}

async function ensureAccessDir() {
  await fs.mkdir(ACCESS_DIR, { recursive: true });
}

async function readStore() {
  await ensureAccessDir();
  try {
    const raw = await fs.readFile(ACCESS_GROUPS_PATH, "utf8");
    return normalizeStore(JSON.parse(raw));
  } catch (error) {
    if (error.code === "ENOENT") {
      const store = createEmptyStore();
      await writeStore(store);
      return store;
    }
    throw error;
  }
}

async function writeStore(store) {
  await ensureAccessDir();
  const normalized = normalizeStore(touchStore(store));
  const tempPath = `${ACCESS_GROUPS_PATH}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, ACCESS_GROUPS_PATH);
  return normalized;
}

function publicGroup(group) {
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    enabled: group.enabled,
    levels: Object.fromEntries([1, 2, 3].map((level) => {
      const record = group.levels[String(level)] || {};
      return [String(level), {
        enabled: Boolean(record.enabled),
        passwordSet: Boolean(record.passwordHash)
      }];
    }))
  };
}

function publicStore(store) {
  return {
    version: store.version,
    updatedAt: store.updatedAt,
    groups: store.groups.map(publicGroup),
    super: {
      enabled: Boolean(store.super?.enabled),
      passwordSet: Boolean(store.super?.passwordHash)
    }
  };
}

export async function getAccessConfiguration() {
  return publicStore(await readStore());
}

export async function getAccessLoginOptions() {
  const store = await readStore();
  return {
    groups: store.groups
      .filter((group) => group.enabled)
      .map((group) => ({
        id: group.id,
        name: group.name,
        description: group.description,
        levels: [1, 2, 3].filter((level) => {
          const record = group.levels[String(level)];
          return record?.enabled && record.passwordHash;
        })
      }))
      .filter((group) => group.levels.length > 0),
    super: {
      enabled: Boolean(store.super?.enabled && store.super?.passwordHash)
    }
  };
}

export async function isAccessControlConfigured() {
  const store = await readStore();
  return isStoreAccessConfigured(store);
}

export async function createAccessGroup(input = {}) {
  const store = await readStore();
  const id = input.id ? normalizeGroupId(input.id) : generateGroupId(store, input.name);
  if (!id) throw new Error("Invalid access group id.");
  if (store.groups.some((group) => group.id === id)) throw new Error("Access group already exists.");

  const name = String(input.name || id).trim().slice(0, 80);
  if (!name) throw new Error("Access group name is required.");

  const group = normalizeGroupRecord({
    id,
    name,
    description: input.description,
    enabled: input.enabled !== false,
    levels: {}
  });
  store.groups.push(group);
  store.groups.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  await writeStore(store);
  return publicGroup(group);
}

export async function updateAccessGroup(groupId, input = {}) {
  const store = await readStore();
  const group = findGroup(store, groupId);
  if (!group) return null;

  if (typeof input.name === "string") {
    const name = input.name.trim().slice(0, 80);
    if (!name) throw new Error("Access group name is required.");
    group.name = name;
  }
  if (typeof input.description === "string") {
    group.description = input.description.trim().slice(0, 400);
  }
  if (typeof input.enabled === "boolean") {
    group.enabled = input.enabled;
  }

  store.groups.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  await writeStore(store);
  return publicGroup(group);
}

export async function deleteAccessGroup(groupId) {
  const store = await readStore();
  const id = normalizeGroupId(groupId);
  const before = store.groups.length;
  store.groups = store.groups.filter((group) => group.id !== id);
  if (store.groups.length === before) return false;
  await writeStore(store);
  return true;
}

export async function setGroupLevelPassword(groupId, level, password) {
  const store = await readStore();
  const group = findGroup(store, groupId);
  if (!group) return null;
  const cleanLevel = normalizeLevel(level);
  const cleanPassword = String(password || "");
  if (cleanPassword.length < 4) throw new Error("Password must be at least 4 characters.");

  const record = group.levels[String(cleanLevel)] || { enabled: false, passwordHash: "" };
  record.passwordHash = await hashPassword(cleanPassword);
  record.enabled = true;
  group.levels[String(cleanLevel)] = record;
  await writeStore(store);
  return publicGroup(group);
}

export async function updateGroupLevel(groupId, level, input = {}) {
  const store = await readStore();
  const group = findGroup(store, groupId);
  if (!group) return null;
  const cleanLevel = normalizeLevel(level);
  const record = group.levels[String(cleanLevel)] || { enabled: false, passwordHash: "" };
  if (typeof input.enabled === "boolean") record.enabled = input.enabled;
  group.levels[String(cleanLevel)] = record;
  await writeStore(store);
  return publicGroup(group);
}

export async function setSuperPassword(password, options = {}) {
  const store = await readStore();
  const cleanPassword = String(password || "");
  if (cleanPassword.length < 4) throw new Error("비밀번호는 4자 이상이어야 합니다.");
  if (options.requireConfirmation === true && cleanPassword !== String(options.confirmPassword || "")) {
    throw new Error("새 Super 비밀번호와 확인 값이 일치하지 않습니다.");
  }
  if (store.super.passwordHash) {
    const currentPassword = String(options.currentPassword || "");
    const currentOk = await verifyPassword(currentPassword, store.super.passwordHash);
    if (!currentOk) throw new Error("기존 Super 비밀번호가 일치하지 않습니다.");
  }
  store.super.passwordHash = await hashPassword(cleanPassword);
  store.super.enabled = true;
  await writeStore(store);
  return publicStore(store).super;
}

export async function updateSuperAccess(input = {}) {
  const store = await readStore();
  if (typeof input.enabled === "boolean") store.super.enabled = input.enabled;
  await writeStore(store);
  return publicStore(store).super;
}

export async function loginAccess(input = {}) {
  const store = await readStore();
  if (input.super === true) {
    const superRecord = store.super || {};
    const ok = superRecord.enabled && superRecord.passwordHash
      ? await verifyPassword(String(input.password || ""), superRecord.passwordHash)
      : false;
    if (!ok) return null;
    const access = {
      super: true,
      groupId: null,
      groupName: "Super",
      level: 3
    };
    return { access, token: await signAccessToken(access) };
  }

  const group = findGroup(store, input.groupId);
  const level = normalizeLevel(input.level);
  const record = group?.levels?.[String(level)];
  const ok = Boolean(group?.enabled && record?.enabled && record?.passwordHash)
    ? await verifyPassword(String(input.password || ""), record.passwordHash)
    : false;
  if (!ok) return null;

  const access = {
    super: false,
    groupId: group.id,
    groupName: group.name,
    level
  };
  return { access, token: await signAccessToken(access) };
}

export async function getAccessFromRequest(request) {
  const token = extractRequestToken(request);
  if (!token) return null;
  return verifyAccessToken(token).catch(() => null);
}

export async function requireNotebookAccess(request, response, notebook) {
  if (!await isAccessControlConfigured()) return null;
  const access = await getAccessFromRequest(request);
  if (canAccessNotebook(access, notebook)) return access;
  response.status(access ? 403 : 401).json({
    error: access ? "Notebook access denied." : "Notebook access authentication required."
  });
  return null;
}

export async function canReadNotebookFromRequest(request, notebook) {
  if (!await isAccessControlConfigured()) return true;
  const access = await getAccessFromRequest(request);
  return canAccessNotebook(access, notebook);
}

export function normalizeNotebookAccessPolicy(policy) {
  const groups = Array.isArray(policy?.groups)
    ? policy.groups.map((groupId) => String(groupId || "").trim()).filter(Boolean)
    : DEFAULT_NOTEBOOK_ACCESS.groups;
  const uniqueGroups = Array.from(new Set(groups.length ? groups : DEFAULT_NOTEBOOK_ACCESS.groups))
    .map((groupId) => groupId === "*" ? "*" : normalizeGroupId(groupId))
    .filter(Boolean);
  const minLevel = normalizePolicyLevel(policy?.minLevel);
  return {
    groups: uniqueGroups.length ? uniqueGroups : [...DEFAULT_NOTEBOOK_ACCESS.groups],
    minLevel
  };
}

export function canAccessNotebook(access, notebook) {
  if (access?.super) return true;
  const policy = normalizeNotebookAccessPolicy(notebook?.access);
  const groups = Array.isArray(policy.groups) ? policy.groups : [...DEFAULT_NOTEBOOK_ACCESS.groups];
  const minLevel = normalizePolicyLevel(policy.minLevel);
  const groupAllowed = groups.includes("*") || groups.includes(access?.groupId);
  const levelAllowed = Number(access?.level || 0) >= minLevel;
  return Boolean(groupAllowed && levelAllowed);
}

export function isNotebookPublic(notebook) {
  const policy = normalizeNotebookAccessPolicy(notebook?.access);
  return policy.groups.includes("*") && policy.minLevel <= 1;
}

export function redactNotebookAccessForClient(notebook, { includeAccess = false } = {}) {
  if (!notebook || typeof notebook !== "object") return notebook;
  if (includeAccess) {
    return { ...notebook, access: normalizeNotebookAccessPolicy(notebook.access) };
  }
  const { access: _access, ...rest } = notebook;
  return rest;
}

function findGroup(store, groupId) {
  const id = normalizeGroupId(groupId);
  if (!id) return null;
  return store.groups.find((group) => group.id === id) || null;
}

function isStoreAccessConfigured(store) {
  if (store.super?.enabled && store.super?.passwordHash) return true;
  return store.groups.some((group) => (
    group.enabled &&
    [1, 2, 3].some((level) => {
      const record = group.levels[String(level)];
      return record?.enabled && record.passwordHash;
    })
  ));
}

function normalizeGroupId(value) {
  const id = String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!id || id === "*" || id === "admin" || id === "super") return null;
  return id.slice(0, 64);
}

function generateGroupId(store, name) {
  const base = normalizeGroupId(name) || `group-${crypto.randomBytes(3).toString("hex")}`;
  let candidate = base;
  let suffix = 2;
  while (store.groups.some((group) => group.id === candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function normalizeLevel(value) {
  const level = Number(value);
  if (!ACCESS_LEVELS.has(level)) throw new Error("Invalid access level.");
  return level;
}

function normalizePolicyLevel(value) {
  const level = Number(value);
  return ACCESS_LEVELS.has(level) ? level : DEFAULT_NOTEBOOK_ACCESS.minLevel;
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const hash = await scryptAsync(password, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt}$${Buffer.from(hash).toString("base64url")}`;
}

async function verifyPassword(password, storedHash) {
  if (!storedHash || typeof storedHash !== "string") return false;
  const parts = storedHash.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, salt, expectedHash] = parts;
  const hash = await scryptAsync(password, salt, 32, {
    N: Number(n),
    r: Number(r),
    p: Number(p)
  });
  return timingSafeEqual(Buffer.from(hash), Buffer.from(expectedHash, "base64url"));
}

async function signAccessToken(access) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    v: TOKEN_VERSION,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
    access
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = await hmac(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

async function verifyAccessToken(token) {
  const [encodedPayload, providedSignature] = String(token || "").split(".");
  if (!encodedPayload || !providedSignature) return null;
  const expectedSignature = await hmac(encodedPayload);
  if (!timingSafeEqual(Buffer.from(providedSignature), Buffer.from(expectedSignature))) return null;

  let payload = null;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (payload?.v !== TOKEN_VERSION) return null;
  if (Number(payload.exp || 0) < Math.floor(Date.now() / 1000)) return null;

  const access = payload.access || {};
  if (access.super) {
    return {
      super: true,
      groupId: null,
      groupName: "Super",
      level: 3,
      expiresAt: new Date(Number(payload.exp) * 1000).toISOString()
    };
  }
  const groupId = normalizeGroupId(access.groupId);
  const level = Number(access.level || 0);
  if (!groupId || !ACCESS_LEVELS.has(level)) return null;
  return {
    super: false,
    groupId,
    groupName: String(access.groupName || groupId).slice(0, 80),
    level,
    expiresAt: new Date(Number(payload.exp) * 1000).toISOString()
  };
}

async function hmac(value) {
  const secret = await getTokenSecret();
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

async function getTokenSecret() {
  const envSecret = String(process.env.ACCESS_TOKEN_SECRET || "").trim();
  if (envSecret) return envSecret;
  await ensureAccessDir();
  try {
    const secret = (await fs.readFile(ACCESS_TOKEN_SECRET_PATH, "utf8")).trim();
    if (secret) return secret;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const secret = crypto.randomBytes(32).toString("base64url");
  await fs.writeFile(ACCESS_TOKEN_SECRET_PATH, `${secret}\n`, { encoding: "utf8", mode: 0o600 });
  return secret;
}

function timingSafeEqual(a, b) {
  if (!Buffer.isBuffer(a)) a = Buffer.from(String(a || ""));
  if (!Buffer.isBuffer(b)) b = Buffer.from(String(b || ""));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
