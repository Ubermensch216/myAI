import { loadLocalEnv } from "./env.js";

loadLocalEnv();

const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "gemma3n:e2b";

const VALID_INTENTS = new Set([
  "chat",
  "calendar.propose",
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
    "- calendar.propose: user is discussing or asking to confirm a possible new calendar event, but has not clearly asked to save it yet",
    "- calendar.create: user wants to add an event/appointment/meeting/reminder",
    "- calendar.list: user wants to view/search their schedule",
    "- calendar.delete: user wants to remove an existing event",
    "- calendar.update: user wants to modify or remove a field of an existing event (time, title, location, notes, etc.)",
    "",
    "Output STRICTLY this JSON object (no markdown, no commentary):",
    '{"intent":"<one of above>","payload":{...}}',
    "",
    "Payload schemas:",
    "- calendar.propose: same payload shape as calendar.create. Use this for tentative requests such as '일정 잡을 수 있나?', '가능할까?', or '추가할까요?' context.",
    "- calendar.create: { title (string, required), start (\"YYYY-MM-DDTHH:mm\" or all-day \"YYYY-MM-DD\"), end (same shape, must be >= start; default = start + 1 hour), allDay (boolean), location (optional string), notes (optional string), reminders (optional array of { minutesBefore: number }), repeat (optional { frequency:\"daily\", from:\"YYYY-MM-DD\", to:\"YYYY-MM-DD\" }) }",
    "- calendar.list: { from (\"YYYY-MM-DD\", optional), to (\"YYYY-MM-DD\", optional), query (optional string for title search) }",
    "- calendar.delete: { matchTitle (optional partial title; OMIT when the user does NOT name a specific event), from (optional date), to (optional date) }. At least one of matchTitle, from, to MUST be present.",
    "- calendar.update: { matchTitle (string), changes (object with any subset of create payload fields) }",
    "- chat: {}",
    "",
    "Date resolution rules:",
    `- "오늘" -> ${todayISO}`,
    `- "내일" -> ${tomorrowISO}`,
    `- "이번 주" -> from ${weekStartISO} to ${weekEndISO}`,
    `- "이번 달"/"이달" -> from ${yyyy}-${mm}-01 to the last day of ${yyyy}-${mm}.`,
    "- A request like \"5월 전체 일정\" means the full calendar month, not the current week.",
    "- A request like \"5월 전체 일정에 ... 등록\" or \"5월 매일 ... 등록\" means create one event per day for the full month. Use repeat.frequency=\"daily\" with from/to.",
    "- Default duration when only start time is given: 1 hour.",
    "- If the user says 점심/점심 식사/lunch without an exact time, use 12:00 and a 1 hour duration.",
    "- If the user does NOT specify a time, set allDay=true and use date-only ISO.",
    "- Reminder rules: \"시작할 때\" -> 0, \"30분 전\" -> 30, \"1시간 전\" -> 60, \"하루 전\" -> 1440, \"이틀 전\" -> 2880, \"일주일 전\" -> 10080.",
    "- Korean weekday names map: 일요일=Sun ... 토요일=Sat (week starts Sunday).",
    "",
    "Examples:",
    `User: "5월 4일에 일정 잡을 수 있나? 거래처 김부장님하고 점심 식사하고자 하는데?"`,
    `→ {"intent":"calendar.propose","payload":{"title":"거래처 김부장님 점심 식사","start":"${yyyy}-05-04T12:00","end":"${yyyy}-05-04T13:00","allDay":false}}`,
    "",
    `User: "내일 오후 3시에 영업팀 회의 잡아줘"`,
    `→ {"intent":"calendar.create","payload":{"title":"영업팀 회의","start":"${tomorrowISO}T15:00","end":"${tomorrowISO}T16:00","allDay":false}}`,
    "",
    `User: "내일 오후 3시에 영업팀 회의 잡고 하루 전에 알려줘"`,
    `→ {"intent":"calendar.create","payload":{"title":"영업팀 회의","start":"${tomorrowISO}T15:00","end":"${tomorrowISO}T16:00","allDay":false,"reminders":[{"minutesBefore":1440}]}}`,
    "",
    `User: "이번 주 일정 보여줘"`,
    `→ {"intent":"calendar.list","payload":{"from":"${weekStartISO}","to":"${weekEndISO}"}}`,
    "",
    `User: "5월 전체 일정 보고해"`,
    `→ {"intent":"calendar.list","payload":{"from":"${yyyy}-05-01","to":"${yyyy}-05-31"}}`,
    "",
    `User: "6월부터 12월까지 일정 알려줘"`,
    `→ {"intent":"calendar.list","payload":{"from":"${yyyy}-06-01","to":"${yyyy}-12-31"}}`,
    "",
    `User: "${yyyy}년도 일정 모두 알려줘"`,
    `→ {"intent":"calendar.list","payload":{"from":"${yyyy}-01-01","to":"${yyyy}-12-31"}}`,
    "",
    `User: "5월 전체 일정에 오전 9시부터 10분간 스트레칭을 등록해"`,
    `→ {"intent":"calendar.create","payload":{"title":"스트레칭","start":"${yyyy}-05-01T09:00","end":"${yyyy}-05-01T09:10","allDay":false,"repeat":{"frequency":"daily","from":"${yyyy}-05-01","to":"${yyyy}-05-31"}}}`,
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
    `User: "공모전 공문 제출 일정에서 장소는 삭제해"`,
    `→ {"intent":"calendar.update","payload":{"matchTitle":"공모전 공문 제출","changes":{"location":""}}}`,
    "",
    `User: "영업팀 회의 메모 빼줘"`,
    `→ {"intent":"calendar.update","payload":{"matchTitle":"영업팀 회의","changes":{"notes":""}}}`,
    "",
    `User: "안녕하세요"`,
    `→ {"intent":"chat","payload":{}}`,
    "",
    "Conversation rules:",
    "- You may use the recent conversation and pending calendar action supplied by the user prompt.",
    "- If there is a pending calendar action and the current user message confirms it (예, 응, 좋아, 추가해줘, 등록해줘, 진행해), return calendar.create using the pending payload.",
    "- If the confirmation message adds details such as 거래처명, 장소, 참석자, or 메모, merge those details into title/location/notes before returning calendar.create.",
    "- If a user asks whether an event can be scheduled and gives enough event details, return calendar.propose, not chat.",
    "If the request is ambiguous or not about calendar, default to chat."
  ].join("\n");
}

export async function classifyIntent({ prompt, model = DEFAULT_MODEL, currentDate, messages = [], pendingAction = null }) {
  const trimmed = String(prompt ?? "").trim();
  if (!trimmed) return { intent: "chat", payload: {} };

  const systemPrompt = buildSystemPrompt(currentDate || new Date().toISOString());
  const userPrompt = buildUserPrompt({ prompt: trimmed, messages, pendingAction });

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
          { role: "user", content: userPrompt }
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

  return applyDeterministicCorrections(
    validateIntent(parsed),
    trimmed,
    currentDate || new Date().toISOString()
  );
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

  if (intent === "calendar.propose") return normalizeCreateLike("calendar.propose", payload);
  if (intent === "calendar.create") return normalizeCreate(payload);
  if (intent === "calendar.list") return normalizeList(payload);
  if (intent === "calendar.delete") return normalizeDelete(payload);
  if (intent === "calendar.update") return normalizeUpdate(payload);
  return { intent: "chat", payload: {} };
}

function applyDeterministicCorrections(result, prompt, currentDate) {
  if (result?.intent === "calendar.list") {
    const dateRange = extractCalendarListDateRange(prompt, currentDate);
    if (dateRange) {
      return {
        ...result,
        payload: {
          ...result.payload,
          from: dateRange.from,
          to: dateRange.to
        }
      };
    }
  }
  if (result?.intent === "calendar.create" || result?.intent === "calendar.propose") {
    const dailyRange = extractDailyCreateRange(prompt, currentDate);
    if (dailyRange && result.payload?.start) {
      const start = moveIsoDate(result.payload.start, dailyRange.from, result.payload.allDay);
      const end = moveIsoDate(result.payload.end || result.payload.start, dailyRange.from, result.payload.allDay);
      return {
        ...result,
        payload: {
          ...result.payload,
          start,
          end,
          repeat: {
            frequency: "daily",
            from: dailyRange.from,
            to: dailyRange.to
          }
        }
      };
    }
  }
  return result;
}

function extractCalendarListDateRange(prompt, currentDate) {
  const text = String(prompt || "").replace(/\s+/g, " ").trim();
  if (!text) return null;

  const baseDate = new Date(currentDate);
  const baseYear = Number.isFinite(baseDate.getTime()) ? baseDate.getFullYear() : new Date().getFullYear();

  // Multi-month range: "6월부터 12월까지", "6월~12월", "6월에서 12월"
  const multiMonth = /(\d{1,2})\s*월\s*(?:부터|에서|~|-)\s*(?:\d{4}\s*년\s*)?(\d{1,2})\s*월/.exec(text);
  if (multiMonth) {
    const fromMonth = Number(multiMonth[1]);
    const toMonth = Number(multiMonth[2]);
    if (fromMonth >= 1 && fromMonth <= 12 && toMonth >= 1 && toMonth <= 12) {
      const toYear = toMonth < fromMonth ? baseYear + 1 : baseYear;
      return {
        from: buildMonthRange(baseYear, fromMonth).from,
        to: buildMonthRange(toYear, toMonth).to
      };
    }
  }

  // Year-only: "2026년도", "2026년" with no specific month following
  const yearMatch = /(\d{4})\s*년(?:도)?/.exec(text);
  if (yearMatch) {
    const year = Number(yearMatch[1]);
    const afterYear = text.slice(yearMatch.index + yearMatch[0].length);
    if (year >= 2000 && year <= 2100 && !/^\s*\d{1,2}\s*월/.test(afterYear)) {
      return { from: `${year}-01-01`, to: `${year}-12-31` };
    }
  }

  // Fall back to single-month detection
  return extractCalendarMonthRange(prompt, currentDate);
}

function extractDailyCreateRange(prompt, currentDate) {
  const text = String(prompt || "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const hasCreateVerb = /(등록|추가|잡아|예약|넣어|생성)/.test(text);
  const hasDailyScope = /(전체\s*일정에|전체\s*기간|매일|날마다|매\s*일)/.test(text);
  if (!hasCreateVerb || !hasDailyScope) return null;
  return extractCalendarMonthRange(text, currentDate);
}

function extractCalendarMonthRange(prompt, currentDate) {
  const text = String(prompt || "").replace(/\s+/g, " ").trim();
  if (!text) return null;

  const baseDate = new Date(currentDate);
  const baseYear = Number.isFinite(baseDate.getTime()) ? baseDate.getFullYear() : new Date().getFullYear();
  const baseMonthIndex = Number.isFinite(baseDate.getTime()) ? baseDate.getMonth() : new Date().getMonth();

  if (/(이번|이)\s*달|이번달|이달/.test(text)) {
    return buildMonthRange(baseYear, baseMonthIndex + 1);
  }
  if (/다음\s*달|다음달|내달/.test(text)) {
    const date = new Date(baseYear, baseMonthIndex + 1, 1);
    return buildMonthRange(date.getFullYear(), date.getMonth() + 1);
  }
  if (/지난\s*달|지난달|전월/.test(text)) {
    const date = new Date(baseYear, baseMonthIndex - 1, 1);
    return buildMonthRange(date.getFullYear(), date.getMonth() + 1);
  }

  const explicitMonth = /(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월/.exec(text);
  if (!explicitMonth) return null;

  const month = Number(explicitMonth[2]);
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  const year = explicitMonth[1] ? Number(explicitMonth[1]) : baseYear;
  return buildMonthRange(year, month);
}

function buildMonthRange(year, month) {
  const lastDay = new Date(year, month, 0).getDate();
  const mm = String(month).padStart(2, "0");
  return {
    from: `${year}-${mm}-01`,
    to: `${year}-${mm}-${String(lastDay).padStart(2, "0")}`
  };
}

function moveIsoDate(value, dateISO, allDay) {
  const normalizedDate = normalizeDateOnly(dateISO);
  if (!normalizedDate) return value;
  if (allDay) return normalizedDate;
  const time = /T(\d{2}:\d{2})/.exec(String(value || ""))?.[1] || "09:00";
  return `${normalizedDate}T${time}`;
}

function buildUserPrompt({ prompt, messages, pendingAction }) {
  const parts = [];
  const recentMessages = Array.isArray(messages) ? messages : [];
  const previousMessages = recentMessages
    .slice(-8)
    .filter((message, index, list) => {
      const content = String(message?.content ?? "").trim();
      if (!content) return false;
      return !(index === list.length - 1 && content === prompt);
    })
    .map((message) => {
      const role = message.role === "assistant" ? "assistant" : "user";
      const content = String(message.content ?? "").replace(/\s+/g, " ").slice(0, 900);
      return `${role}: ${content}`;
    });

  if (previousMessages.length) {
    parts.push(`Recent conversation:\n${previousMessages.join("\n")}`);
  }

  if (pendingAction?.intent && pendingAction?.payload) {
    parts.push(`Pending calendar action JSON:\n${JSON.stringify(pendingAction)}`);
  }

  parts.push(`Current user message:\n${prompt}`);
  return parts.join("\n\n");
}

function normalizeCreate(payload) {
  return normalizeCreateLike("calendar.create", payload);
}

function normalizeCreateLike(intent, payload) {
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
  const repeat = normalizeRepeat(payload.repeat);
  if (repeat) out.repeat = repeat;
  const location = String(payload.location ?? "").trim();
  if (location) out.location = location;
  const notes = String(payload.notes ?? "").trim();
  if (notes) out.notes = notes;
  return { intent, payload: out };
}

function normalizeRepeat(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.frequency !== "daily") return null;
  const from = normalizeDateOnly(value.from);
  const to = normalizeDateOnly(value.to);
  if (!from || !to || compareIso(to, from) < 0) return null;
  return { frequency: "daily", from, to };
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
  else if (rawChanges.location === null) changes.location = "";
  if (typeof rawChanges.notes === "string") changes.notes = rawChanges.notes.trim();
  else if (rawChanges.notes === null) changes.notes = "";
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
