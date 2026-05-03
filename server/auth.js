import { loadLocalEnv } from "./env.js";

loadLocalEnv();

export function isAdminConfigured() {
  return Boolean(getAdminToken());
}

function getAdminToken() {
  const token = String(process.env.ADMIN_TOKEN ?? "").trim();
  return token || null;
}

function extractRequestToken(request) {
  const header = request.get?.("authorization") || request.headers?.authorization || "";
  if (typeof header !== "string") return "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (match) return match[1].trim();
  return header.trim();
}

export function requireAdmin(request, response, next) {
  const expected = getAdminToken();
  if (!expected) {
    response.status(503).json({
      error: "관리자 토큰이 서버에 설정되지 않았습니다. .env에 ADMIN_TOKEN을 설정하세요."
    });
    return;
  }

  const provided = extractRequestToken(request);
  if (!provided || !timingSafeEqual(provided, expected)) {
    response.status(401).json({ error: "관리자 인증에 실패했습니다." });
    return;
  }

  next();
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}
