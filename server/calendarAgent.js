import { loadLocalEnv } from "./env.js";

loadLocalEnv();

const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "gemma3n:e2b";

const VALID_INTENTS = new Set([
  "chat",
  "calendar.create",
  "calendar.list",
  "calendar.delete",
  "calendar.update"
]);

const KOREAN_WEEKDAYS = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];

function buildSystemPrompt(currentDate) {
  const today = new Date(currentDate);
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const weekday = KOREAN_WEEKDAYS[today.getDay()];
  const todayISO = `${yyyy}-${mm}-${dd}`;

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowISO = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;

  const sundayOffset = today.getDay();
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - sundayOffset);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  const weekStartISO = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, "0")}-${String(weekStart.getDate()).padStart(2, "0")}`;
  const weekEndISO = `${weekEnd.getFullYear()}-${String(weekEnd.getMonth() + 1).padStart(2, "0")}-${String(weekEnd.getDate()).padStart(2, "0")}`;

  return [
    "You are an intent classifier for a Korean calendar assistant.",
    `Today is ${todayISO} (${weekday}). Time zone: Asia/Seoul.`,
    "Classify the user's message into ONE of these intents and extract structured fields.",
    "",
    "Intents:",
    "- chat: general conversation or questions unrelated to managing the user's calendar",
    "- calendar.create: user wants to add an event/appointment/meeting/reminder",
    "- calendar.list: user wants to view/search their schedule",
    "- calendar.delete: user wants to remove an existing event",
    "- calendar.update: user wants to modify an existing event (time, title, etc.)",
    "",
    "Output STRICTLY this JSON object (no markdown, no commentary):",
    '{"intent":"<one of above>","payload":{...}}',
    "",
    "Payload schemas:",
    "- calendar.create: { title (string, required), start (\"YYYY-MM-DDTHH:mm\" or all-day \"YYYY-MM-DD\"), end (same shape, must be >= start; default = start + 1 hour), allDay (boolean), location (optional string), notes (optional string), reminders (optional array of { minutesBefore: number }) }",
    "- calendar.list: { from (\"YYYY-MM-DD\", optional), to (\"YYYY-MM-DD\", optional), query (optional string for title search) }",
    "- calendar.delete: { matchTitle (optional partial title; OMIT when the user does NOT name a specific event), from (optional date), to (optional date) }. At least one of matchTitle, from, to MUST be present.",
    "- calendar.update: { matchTitle (string), changes (object with any subset of create payload fields) }",
    "- chat: {}",
    "",
    "Date resolution rules:",
    `- "오늘" -> ${todayISO}`,
    `- "내일" -> ${tomorrowISO}`,
    `- "이번 주" -> from ${weekStartISO} to ${weekEndISO}`,
    "- Default duration when only start time is given: 1 hour.",
    "- If the user does NOT specify a time, set allDay=true and use date-only ISO.",
    "- Reminder rules: \"시작할 때\" -> 0, \"30분 전\" -> 30, \"1시간 전\" -> 60, \"하루 전\" -> 1440, \"이틀 전\" -> 2880, \"일주일 전\" -> 10080.",
    "- Korean weekday names map: 일요일=Sun ... 토요일=Sat (week starts Sunday).",
    "",
    "Examples:",
    `User: "내일 오후 3시에 영업팀 회의 잡아줘"`,
    `→ {"intent":"calendar.create","payload":{"title":"영업팀 회의","start":"${tomorrowISO}T15:00","end":"${tomorrowISO}T16:00","allDay":false}}`,
    "",
    `User: "내일 오후 3시에 영업팀 회의 잡고 하루 전에 알려줘"`,
    `→ {"intent":"calendar.create","payload":{"title":"영업팀 회의","start":"${tomorrowISO}T15:00","end":"${tomorrowISO}T16:00","allDay":false,"reminders":[{"minutesBefore":1440}]}}`,
    "",
    `User: "이번 주 일정 보여줘"`,
    `→ {"intent":"calendar.list","payload":{"from":"${weekStartISO}","to":"${weekEndISO}"}}`,
    "",
    `User: "내일 일정 알려줘"`,
    `→ {"intent":"calendar.list","payload":{"from":"${tomorrowISO}","to":"${tomorrowISO}"}}`,
    "",
    `User: "영업팀 회의 취소해줘"`,
    `→ {"intent":"calendar.delete","payload":{"matchTitle":"영업팀 회의"}}`,
    "",
    `User: "${tomorrowISO.slice(5).replace("-", "월 ")}일 일정 모두 취소해"  // delete every event on a date — no title given`,
    `→ {"intent":"calendar.delete","payload":{"from":"${tomorrowISO}","to":"${tomorrowISO}"}}`,
    "",
    `User: "이번 주 일정 다 지워"  // delete every event in a date range`,
    `→ {"intent":"calendar.delete","payload":{"from":"${weekStartISO}","to":"${weekEndISO}"}}`,
    "",
    `User: "내일 회의 시간을 4시로 바꿔줘"`,
    `→ {"intent":"calendar.update","payload":{"matchTitle":"회의","changes":{"start":"${tomorrowISO}T16:00","end":"${tomorrowISO}T17:00"}}}`,
    "",
    `User: "안녕하세요"`,
    `→ {"intent":"chat","payload":{}}`,
    "",
    "If the request is ambiguous or not about calendar, default to chat."
  ].join("\n");
}

export async function classifyIntent({ prompt, model = DEFAULT_MODEL, currentDate }) {
  const trimmed = String(prompt ?? "").trim();
  if (!trimmed) return { intent: "chat", payload: {} };

  const systemPrompt = buildSystemPrompt(currentDate || new Date().toISOString());

  let response;
  try {
    response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        format: "json",
        think: false,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: trimmed }
        ],
        options: {
          temperature: 0.1,
          top_p: 0.9,
          num_predict: 800
        }
      })
    });
  } catch (error) {
    return { intent: "chat", payload: {}, fallbackReason: `ollama_unreachable: ${error.message}` };
  }

  if (!response.ok) {
    return { intent: "chat", payload: {}, fallbackReason: `ollama_status_${response.status}` };
  }

  let body;
  try {
    body = await response.json();
  } catch (error) {
    return { intent: "chat", payload: {}, fallbackReason: `non_json_response: ${error.message}` };
  }

  const content = body?.message?.content ?? "";
  const parsed = parseClassifierJson(content);
  if (!parsed) {
    return { intent: "chat", payload: {}, fallbackReason: "parse_failure" };
  }

  return validateIntent(parsed);
}

function parseClassifierJson(text) {
  if (!text || typeof text !== "string") return null;
  try {
    return JSON.parse(text);
  } catch {
    // Models occasionally wrap JSON with surrounding text. Extract the first {...} block.
    const match = /\{[\s\S]*\}/.exec(text);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function validateIntent(raw) {
  const intent = typeof raw?.intent === "string" ? raw.intent : "chat";
  if (!VALID_INTENTS.has(intent)) {
    return { intent: "chat", payload: {}, fallbackReason: "unknown_intent" };
  }
  const payload = raw?.payload && typeof raw.payload === "object" && !Array.isArray(raw.payload) ? raw.payload : {};

  if (intent === "calendar.create") return normalizeCreate(payload);
  if (intent === "calendar.list") return normalizeList(payload);
  if (intent === "calendar.delete") return normalizeDelete(payload);
  if (intent === "calendar.update") return normalizeUpdate(payload);
  return { intent: "chat", payload: {} };
}

function normalizeCreate(payload) {
  const title = String(payload.title ?? "").trim();
  if (!title) return { intent: "chat", payload: {}, fallbackReason: "create_missing_title" };

  const allDay = Boolean(payload.allDay);
  let start = normalizeDateTime(payload.start, allDay);
  let end = normalizeDateTime(payload.end, allDay);
  if (!start) return { intent: "chat", payload: {}, fallbackReason: "create_missing_start" };

  if (!end) {
    end = allDay ? start : addOneHour(start);
  }
  if (compareIso(end, start) < 0) {
    end = allDay ? start : addOneHour(start);
  }

  const out = {
    title,
    allDay,
    start,
    end,
    reminders: normalizeReminders(payload.reminders ?? payload.reminderMinutesBefore)
  };
  const location = String(payload.location ?? "").trim();
  if (location) out.location = location;
  const notes = String(payload.notes ?? "").trim();
  if (notes) out.notes = notes;
  return { intent: "calendar.create", payload: out };
}

function normalizeList(payload) {
  const out = {};
  const from = normalizeDateOnly(payload.from);
  const to = normalizeDateOnly(payload.to);
  if (from) out.from = from;
  if (to) out.to = to;
  const query = String(payload.query ?? "").trim();
  if (query) out.query = query;
  return { intent: "calendar.list", payload: out };
}

function normalizeDelete(payload) {
  const matchTitle = String(payload.matchTitle ?? "").trim();
  const from = normalizeDateOnly(payload.from);
  const to = normalizeDateOnly(payload.to);
  if (!matchTitle && !from && !to) {
    return { intent: "chat", payload: {}, fallbackReason: "delete_missing_match" };
  }
  const out = {};
  if (matchTitle) out.matchTitle = matchTitle;
  if (from) out.from = from;
  if (to) out.to = to;
  return { intent: "calendar.delete", payload: out };
}

function normalizeUpdate(payload) {
  const matchTitle = String(payload.matchTitle ?? "").trim();
  if (!matchTitle) return { intent: "chat", payload: {}, fallbackReason: "update_missing_match" };
  const rawChanges = payload.changes && typeof payload.changes === "object" ? payload.changes : {};
  const changes = {};
  if (typeof rawChanges.title === "string" && rawChanges.title.trim()) changes.title = rawChanges.title.trim();
  if (typeof rawChanges.location === "string") changes.location = rawChanges.location.trim();
  if (typeof rawChanges.notes === "string") changes.notes = rawChanges.notes.trim();
  if (typeof rawChanges.allDay === "boolean") changes.allDay = rawChanges.allDay;
  if (rawChanges.reminders !== undefined || rawChanges.reminderMinutesBefore !== undefined) {
    changes.reminders = normalizeReminders(rawChanges.reminders ?? rawChanges.reminderMinutesBefore);
  }
  const allDay = changes.allDay ?? false;
  const start = normalizeDateTime(rawChanges.start, allDay);
  const end = normalizeDateTime(rawChanges.end, allDay);
  if (start) changes.start = start;
  if (end) changes.end = end;
  if (!Object.keys(changes).length) return { intent: "chat", payload: {}, fallbackReason: "update_no_changes" };
  return { intent: "calendar.update", payload: { matchTitle, changes } };
}

function normalizeDateTime(value, allDay) {
  if (!value) return null;
  const text = String(value).trim();
  if (allDay) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})/.exec(text);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (dateOnly) return `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}T09:00`;
  return null;
}

function normalizeDateOnly(value) {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value).trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function normalizeReminders(value) {
  const rawValues = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  const seen = new Set();
  const reminders = [];
  for (const item of rawValues) {
    const minutes = typeof item === "object" && item
      ? Number(item.minutesBefore ?? item.minutes)
      : Number(item);
    if (!Number.isFinite(minutes)) continue;
    const normalized = Math.max(0, Math.min(60 * 24 * 30, Math.round(minutes)));
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    reminders.push({ minutesBefore: normalized });
  }
  return reminders.sort((left, right) => right.minutesBefore - left.minutesBefore);
}

function addOneHour(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return iso;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  date.setHours(date.getHours() + 1);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

function compareIso(a, b) {
  return String(a).localeCompare(String(b));
}
