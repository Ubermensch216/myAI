import {
  state, elements,
  KOREAN_SHORT_WEEKDAYS,
  formatLocalDate, normalizeCalendarViewMode, normalizeReminderList, normalizeRecurrence,
  DEFAULT_FAVICON_HREF, getActiveRoom
} from "./state.js";
import { scheduleSave } from "./persistence.js";

const RECURRENCE_LABELS = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly"
};

// ===== Date helpers =====

export function parseDateISO(value) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function addMonths(date, months) {
  const next = new Date(date);
  const day = next.getDate();
  next.setDate(1);
  next.setMonth(next.getMonth() + months);
  next.setDate(Math.min(day, new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()));
  return next;
}

export function startOfWeek(date) {
  return addDays(date, -date.getDay());
}

export function formatCalendarRangeLabel(cursor, viewMode) {
  if (viewMode === "day") {
    return `${cursor.getFullYear()}년 ${cursor.getMonth() + 1}월 ${cursor.getDate()}일 (${KOREAN_SHORT_WEEKDAYS[cursor.getDay()]})`;
  }
  if (viewMode === "week") {
    const start = startOfWeek(cursor);
    const end = addDays(start, 6);
    return `${formatShortDate(start)} ~ ${formatShortDate(end)}`;
  }
  return `${cursor.getFullYear()}년 ${cursor.getMonth() + 1}월`;
}

export function formatShortDate(date) {
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
}

export function formatDateTime(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

export function toLocalInputValue(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

export function formatKoreanDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return String(iso || "");
  return `${Number(m[2])}월 ${Number(m[3])}일`;
}

export function formatDateRangeLabel(fromISO, toISO) {
  if (fromISO && toISO && fromISO === toISO) return formatKoreanDate(fromISO);
  if (fromISO && toISO) return `${formatKoreanDate(fromISO)} ~ ${formatKoreanDate(toISO)}`;
  if (fromISO) return `${formatKoreanDate(fromISO)} 이후`;
  if (toISO) return `${formatKoreanDate(toISO)} 이전`;
  return "범위";
}

export function extractTimePart(value) {
  return /T(\d{2}:\d{2})/.exec(String(value || ""))?.[1] || null;
}

// ===== Event time helpers =====

export function parseEventStart(event) {
  if (!event?.start) return null;
  const value = event.allDay ? `${String(event.start).slice(0, 10)}T00:00` : event.start;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseEventEnd(event) {
  if (!event?.end) return null;
  const value = event.allDay ? `${String(event.end).slice(0, 10)}T23:59` : event.end;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addOneHourIso(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  d.setHours(d.getHours() + 1);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatEventChipLabel(event) {
  if (event.allDay) return event.title || "(제목 없음)";
  const start = parseEventStart(event);
  if (!start) return event.title || "(제목 없음)";
  const hh = String(start.getHours()).padStart(2, "0");
  const mm = String(start.getMinutes()).padStart(2, "0");
  return `${hh}:${mm} ${event.title || "(제목 없음)"}`;
}

export function formatEventChipTitle(event) {
  const lines = [event.title || "(제목 없음)"];
  if (event.allDay) {
    lines.push(`종일 · ${String(event.start).slice(0, 10)}`);
  } else {
    const start = parseEventStart(event);
    const end = parseEventEnd(event);
    if (start && end) lines.push(`${formatDateTime(start)} – ${formatDateTime(end)}`);
  }
  if (event.location) lines.push(`장소: ${event.location}`);
  if (event.recurrence) lines.push(`Repeat: ${formatRecurrenceSummary(event.recurrence)}`);
  return lines.join("\n");
}

export function formatUpcomingTime(event) {
  const start = parseEventStart(event);
  if (!start) return "";
  const dateLabel = `${start.getMonth() + 1}월 ${start.getDate()}일`;
  if (event.allDay) return `${dateLabel} · 종일`;
  const hh = String(start.getHours()).padStart(2, "0");
  const mm = String(start.getMinutes()).padStart(2, "0");
  return `${dateLabel} ${hh}:${mm}`;
}

export function formatAgendaEventTime(event) {
  if (event.allDay) return "종일";
  const start = parseEventStart(event);
  const end = parseEventEnd(event);
  if (!start) return "";
  const startText = `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`;
  if (!end) return startText;
  const endText = `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`;
  return `${startText} - ${endText}`;
}

export function formatReminderLabel(reminder) {
  const minutes = Number(typeof reminder === "object" ? reminder.minutesBefore : reminder);
  if (minutes === 0) return "시작 시";
  if (minutes < 60) return `${minutes}분 전`;
  if (minutes % 10080 === 0) return `${minutes / 10080}주 전`;
  if (minutes % 1440 === 0) return `${minutes / 1440}일 전`;
  if (minutes % 60 === 0) return `${minutes / 60}시간 전`;
  return `${minutes}분 전`;
}

export function formatReminderSummary(reminders) {
  const values = normalizeReminderList(reminders).map((r) => r.minutesBefore);
  if (!values.length) return "";
  return values.map((minutes) => {
    if (minutes === 0) return "시작 시";
    if (minutes < 60) return `${minutes}분 전`;
    if (minutes % 1440 === 0) return `${minutes / 1440}일 전`;
    if (minutes % 60 === 0) return `${minutes / 60}시간 전`;
    return `${minutes}분 전`;
  }).join(", ");
}

export function formatEventOneLine(event) {
  const start = parseEventStart(event);
  if (!start) return event.title || "(제목 없음)";
  const dateLabel = `${start.getMonth() + 1}월 ${start.getDate()}일`;
  if (event.allDay) return `${dateLabel} 종일 · ${event.title || "(제목 없음)"}`;
  const hh = String(start.getHours()).padStart(2, "0");
  const mm = String(start.getMinutes()).padStart(2, "0");
  return `${dateLabel} ${hh}:${mm} · ${event.title || "(제목 없음)"}`;
}

export function formatRecurrenceSummary(recurrence) {
  const normalized = normalizeRecurrence(recurrence);
  if (!normalized) return "";
  const label = RECURRENCE_LABELS[normalized.frequency] || normalized.frequency;
  return normalized.until ? `${label} until ${normalized.until}` : label;
}

// ===== Event data helpers =====

export function groupEventsByDate(events) {
  const map = new Map();
  for (const event of events) {
    const startISO = (event.start ?? "").slice(0, 10);
    if (!startISO) continue;
    const endISO = (event.end ?? "").slice(0, 10);
    const spanEnd = endISO && endISO > startISO ? endISO : startISO;
    let current = startISO;
    while (current <= spanEnd) {
      if (!map.has(current)) map.set(current, []);
      map.get(current).push(event);
      if (current === spanEnd) break;
      const [y, m, d] = current.split("-").map(Number);
      current = formatLocalDate(new Date(y, m - 1, d + 1));
    }
  }
  for (const list of map.values()) list.sort(compareEventsByStart);
  return map;
}

export function getCalendarEventsForDate(dateISO) {
  const date = parseDateISO(dateISO);
  if (!date) return [];
  const events = [];
  for (const event of state.calendar.events) {
    const occurrences = expandEventOccurrences(event, dateISO, dateISO);
    events.push(...occurrences);
  }
  return events.sort(compareEventsByStart);
}

export function getCalendarEventsForRange(fromISO, toISO) {
  const events = [];
  for (const event of state.calendar.events) {
    events.push(...expandEventOccurrences(event, fromISO, toISO));
  }
  return events.sort(compareEventsByStart);
}

export function expandEventOccurrences(event, fromISO, toISO) {
  const recurrence = normalizeRecurrence(event.recurrence);
  if (!recurrence) {
    const startISO = String(event.start || "").slice(0, 10);
    const endISO = String(event.end || event.start || "").slice(0, 10) || startISO;
    if (fromISO && endISO < fromISO) return [];
    if (toISO && startISO > toISO) return [];
    return [event];
  }
  const baseStart = parseEventStart(event);
  const baseEnd = parseEventEnd(event) || baseStart;
  if (!baseStart) return [];
  const rangeStart = parseDateISO(fromISO || String(event.start).slice(0, 10)) || baseStart;
  const rangeEnd = parseDateISO(toISO || recurrence.until || fromISO || String(event.start).slice(0, 10)) || rangeStart;
  const untilDate = parseDateISO(recurrence.until || "");
  const exceptions = new Set(event.recurrenceExceptions || []);
  const durationMs = baseEnd ? Math.max(0, baseEnd.getTime() - baseStart.getTime()) : 0;
  const out = [];
  let cursor = new Date(baseStart);
  let index = 0;
  const max = Math.min(recurrence.count || 730, 730);
  while (index < max) {
    const occurrenceISO = formatLocalDate(cursor);
    if (untilDate && cursor > addDays(untilDate, 1)) break;
    if (cursor > addDays(rangeEnd, 1)) break;
    if (cursor >= rangeStart && !exceptions.has(occurrenceISO)) {
      const start = event.allDay ? occurrenceISO : toLocalInputValue(cursor);
      const endAt = new Date(cursor.getTime() + durationMs);
      const end = event.allDay ? formatLocalDate(endAt) : toLocalInputValue(endAt);
      out.push({
        ...event,
        id: `${event.id}#${occurrenceISO}`,
        masterEventId: event.id,
        occurrenceDate: occurrenceISO,
        start,
        end
      });
    }
    cursor = nextRecurrenceDate(cursor, recurrence);
    index += 1;
  }
  return out;
}

function nextRecurrenceDate(date, recurrence) {
  const interval = recurrence.interval || 1;
  if (recurrence.frequency === "weekly") return addDays(date, 7 * interval);
  if (recurrence.frequency === "monthly") return addMonths(date, interval);
  if (recurrence.frequency === "yearly") return addMonths(date, 12 * interval);
  return addDays(date, interval);
}

export function getEventsForDate(dateISO) {
  return getCalendarEventsForDate(dateISO);
}

export function compareEventsByStart(a, b) {
  return String(a.start).localeCompare(String(b.start)) || String(a.title || "").localeCompare(String(b.title || ""));
}

export function getHolidaysForDate(dateISO) {
  const year = String(dateISO || "").slice(0, 4);
  const holidays = state.calendar.holidaysByYear[year] ?? [];
  return holidays.filter((h) => h.date === dateISO);
}

export function getCalendarVisibleYears() {
  const cursor = parseDateISO(state.calendar.cursorISO) ?? new Date();
  if (state.calendar.viewMode === "week") {
    const start = startOfWeek(cursor);
    const end = addDays(start, 6);
    return Array.from(new Set([start.getFullYear(), end.getFullYear()]));
  }
  if (state.calendar.viewMode === "day") return [cursor.getFullYear()];
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const gridStart = new Date(year, month, 1 - firstOfMonth.getDay());
  const gridEnd = addDays(gridStart, 41);
  return Array.from(new Set([gridStart.getFullYear(), year, gridEnd.getFullYear()]));
}

export function ensureHolidaysForCalendarRange() {
  for (const year of getCalendarVisibleYears()) loadHolidaysForYear(year);
}

export async function loadHolidaysForYear(year) {
  const key = String(year);
  if (state.calendar.holidaysByYear[key] || state.calendar.holidayRequests.has(key)) return;
  state.calendar.holidayRequests.add(key);
  try {
    const response = await fetch(`/api/holidays?year=${encodeURIComponent(key)}`);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "공휴일 정보를 불러오지 못했습니다.");
    state.calendar.holidaysByYear[key] = Array.isArray(result.holidays) ? result.holidays : [];
    if (result.warning) state.calendar.holidayWarnings[key] = result.warning;
  } catch (error) {
    console.warn("Holiday data could not be loaded.", error);
    state.calendar.holidaysByYear[key] = [];
    state.calendar.holidayWarnings[key] = error.message;
  } finally {
    state.calendar.holidayRequests.delete(key);
    renderCalendar();
  }
}

// ===== Conflict / format helpers =====

export function findConflictingEvents({ start, end, allDay }, excludeId) {
  if (!start) return [];
  const newStartMs = (allDay ? new Date(`${String(start).slice(0, 10)}T00:00`) : new Date(start)).getTime();
  const newEndRaw = end || start;
  let newEndMs = (allDay ? new Date(`${String(newEndRaw).slice(0, 10)}T23:59`) : new Date(newEndRaw)).getTime();
  if (Number.isNaN(newStartMs) || Number.isNaN(newEndMs)) return [];
  if (newEndMs < newStartMs) newEndMs = newStartMs;
  const fromISO = String(start).slice(0, 10);
  const toISO = String(newEndRaw).slice(0, 10) || fromISO;
  return getCalendarEventsForRange(fromISO, toISO).filter((event) => {
    if (event.id === excludeId || event.masterEventId === excludeId) return false;
    const existingStart = parseEventStart(event);
    const existingEnd = parseEventEnd(event) || existingStart;
    if (!existingStart || !existingEnd) return false;
    const exStartMs = existingStart.getTime();
    let exEndMs = existingEnd.getTime();
    if (exEndMs < exStartMs) exEndMs = exStartMs;
    // Point-on-either-side: inclusive coincidence counts as conflict so legacy
    // zero-width events (end == start) at the same start time are detected.
    if (exEndMs === exStartMs || newEndMs === newStartMs) {
      return exStartMs <= newEndMs && exEndMs >= newStartMs;
    }
    // Standard half-open overlap preserves back-to-back (e.g. 14-15 vs 15-16 → no conflict).
    return exStartMs < newEndMs && exEndMs > newStartMs;
  });
}

export function buildConflictWarning(conflicts) {
  return conflicts.slice(0, 3).map((e) => `· ${formatEventOneLine(e)}`).join("\n");
}

export function formatEventPreviewList(events, limit = 5) {
  const visible = events.slice(0, limit).map((e) => `· ${formatEventOneLine(e)}`);
  if (events.length > limit) visible.push(`· 외 ${events.length - limit}건`);
  return visible.join("\n");
}

export function dedupeEvents(events) {
  const seen = new Set();
  const out = [];
  for (const event of events) {
    if (!event?.id || seen.has(event.id)) continue;
    seen.add(event.id);
    out.push(event);
  }
  return out;
}

export async function confirmCalendarDelete(candidates, payload, fromISO, toISO) {
  const count = candidates.length;
  const scope = payload?.matchTitle ? `"${payload.matchTitle}"` : formatDateRangeLabel(fromISO, toISO);
  const preview = formatEventPreviewList(candidates, 6);
  return await showCalendarConfirm({
    title: "Delete calendar events",
    body: [
    `${scope} 조건과 일치하는 일정 ${count}건을 삭제합니다.`,
    preview,
    "계속할까요?"
    ].filter(Boolean).join("\n\n"),
    okText: "Delete",
    danger: true
  });
}

export async function confirmCalendarUpdate(target, merged, changes, conflicts) {
  const sections = [
    `다음 일정을 수정합니다:\n${formatEventOneLine(target)}`,
    `변경 내용:\n${formatCalendarChangeList(target, merged, changes)}`
  ];
  if (conflicts.length) {
    sections.push(`다만 아래 기존 일정과 시간이 겹칩니다:\n${buildConflictWarning(conflicts)}`);
  }
  sections.push("계속할까요?");
  return await showCalendarConfirm({
    title: "Update calendar event",
    body: sections.join("\n\n"),
    okText: "Update"
  });
}

export function hasCalendarTimeChange(changes) {
  return Object.prototype.hasOwnProperty.call(changes, "start")
    || Object.prototype.hasOwnProperty.call(changes, "end")
    || Object.prototype.hasOwnProperty.call(changes, "allDay");
}

export function formatCalendarChangeList(before, after, changes) {
  const rows = [];
  const addRow = (label, prev, next) => rows.push(`· ${label}: ${prev || "-"} → ${next || "-"}`);
  if (Object.prototype.hasOwnProperty.call(changes, "title")) addRow("제목", before.title, after.title);
  if (hasCalendarTimeChange(changes)) addRow("시간", formatEventOneLine(before), formatEventOneLine(after));
  if (Object.prototype.hasOwnProperty.call(changes, "location")) addRow("장소", before.location, after.location);
  if (Object.prototype.hasOwnProperty.call(changes, "notes")) addRow("메모", before.notes, after.notes);
  if (Object.prototype.hasOwnProperty.call(changes, "reminders")) {
    addRow("알림", formatReminderSummary(before.reminders), formatReminderSummary(after.reminders));
  }
  return rows.length ? rows.join("\n") : "· 세부 항목 변경";
}

export function showCalendarConfirm({ title = "Confirm", body = "", okText = "Continue", cancelText = "Cancel", danger = false } = {}) {
  const dialog = elements.calendarConfirmDialog;
  if (!dialog || typeof dialog.showModal !== "function") return Promise.resolve(window.confirm(body || title));
  return new Promise((resolve) => {
    elements.calendarConfirmTitle.textContent = title;
    elements.calendarConfirmBody.innerHTML = "";
    const lines = Array.isArray(body) ? body : String(body || "").split("\n");
    for (const line of lines.filter(Boolean)) {
      const row = document.createElement(line.startsWith("•") || line.startsWith("쨌") ? "li" : "p");
      row.textContent = line;
      elements.calendarConfirmBody.append(row);
    }
    elements.calendarConfirmOkButton.textContent = okText;
    elements.calendarConfirmCancelButton.textContent = cancelText;
    elements.calendarConfirmOkButton.classList.toggle("danger-action", !!danger);

    const cleanup = () => {
      elements.calendarConfirmOkButton.removeEventListener("click", onOk);
      elements.calendarConfirmCancelButton.removeEventListener("click", onCancel);
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("close", onClose);
    };
    const finish = (value) => {
      cleanup();
      if (dialog.open) dialog.close(value ? "ok" : "cancel");
      resolve(value);
    };
    const onOk = (event) => { event.preventDefault(); finish(true); };
    const onCancel = (event) => { event.preventDefault(); finish(false); };
    const onClose = () => { cleanup(); resolve(dialog.returnValue === "ok"); };

    elements.calendarConfirmOkButton.addEventListener("click", onOk);
    elements.calendarConfirmCancelButton.addEventListener("click", onCancel);
    dialog.addEventListener("cancel", onCancel);
    dialog.addEventListener("close", onClose);
    dialog.showModal();
  });
}

// ===== Calendar event CRUD =====

export function createCalendarEventFromPayload(payload, nowIso = new Date().toISOString()) {
  const normalizedEnd = payload.allDay
    ? (payload.end || payload.start)
    : (payload.end && payload.end !== payload.start ? payload.end : addOneHourIso(payload.start));
  return {
    id: crypto.randomUUID(),
    title: payload.title,
    allDay: !!payload.allDay,
    start: payload.start,
    end: normalizedEnd,
    location: payload.location || "",
    notes: payload.notes || "",
    recurrence: normalizeRecurrence(payload.recurrence || payload.repeat),
    recurrenceExceptions: [],
    reminders: normalizeReminderList(payload.reminders),
    notifiedReminders: [],
    color: "accent",
    createdAt: nowIso,
    updatedAt: nowIso
  };
}

export function applyCalendarCreate(payload) {
  if (!payload?.title || !payload?.start) {
    return { text: "일정 정보를 이해하지 못했습니다. 제목과 시간을 다시 알려주세요.", eventCards: [] };
  }
  const nowIso = new Date().toISOString();
  const event = createCalendarEventFromPayload(payload, nowIso);
  state.calendar.events.push(event);
  state.calendar.cursorISO = String(event.start).slice(0, 10);
  maybeRequestNotificationPermission(event.reminders);
  return {
    mutated: true,
    text: `✓ 일정을 추가했습니다: ${formatEventOneLine(event)}`,
    eventCards: [event]
  };
}

export function applyCalendarList(payload) {
  const fromISO = payload?.from ? String(payload.from).slice(0, 10) : null;
  const toISO = payload?.to ? String(payload.to).slice(0, 10) : null;
  const query = (payload?.query || "").toLowerCase();
  const matches = getCalendarEventsForRange(fromISO || "1900-01-01", toISO || "2999-12-31")
    .filter((event) => {
      const d = String(event.start).slice(0, 10);
      if (fromISO && d < fromISO) return false;
      if (toISO && d > toISO) return false;
      if (query && !(event.title || "").toLowerCase().includes(query)) return false;
      return true;
    })
    .sort((a, b) => String(a.start).localeCompare(String(b.start)));
  if (!matches.length) {
    const range = fromISO || toISO ? `${fromISO || "?"} ~ ${toISO || "?"} 범위` : "조건";
    return { text: `해당 ${range}에서 일정을 찾지 못했습니다.`, eventCards: [] };
  }
  return { text: `${matches.length}개의 일정을 찾았습니다.`, eventCards: matches.slice(0, 20) };
}

export async function applyCalendarDelete(payload) {
  const matchTitle = (payload?.matchTitle || "").toLowerCase();
  const fromISO = payload?.from ? String(payload.from).slice(0, 10) : null;
  const toISO = payload?.to ? String(payload.to).slice(0, 10) : null;
  if (!matchTitle && !fromISO && !toISO) {
    return { text: "삭제할 일정의 제목 또는 날짜를 알려주세요.", eventCards: [] };
  }
  const sourceEvents = fromISO || toISO
    ? getCalendarEventsForRange(fromISO || "1900-01-01", toISO || "2999-12-31")
    : state.calendar.events;
  const candidates = sourceEvents.filter((event) => {
    if (matchTitle && !(event.title || "").toLowerCase().includes(matchTitle)) return false;
    const d = String(event.start).slice(0, 10);
    if (fromISO && d < fromISO) return false;
    if (toISO && d > toISO) return false;
    return true;
  });
  if (!candidates.length) {
    const desc = matchTitle ? `"${payload.matchTitle}"` : formatDateRangeLabel(fromISO, toISO);
    return { text: `${desc} 와 일치하는 일정을 찾지 못했습니다.`, eventCards: [] };
  }
  if (!matchTitle) {
    const confirmed = await confirmCalendarDelete(candidates, payload, fromISO, toISO);
    if (!confirmed) return { text: "삭제를 취소했습니다.", kind: "warning", eventCards: candidates.slice(0, 10) };
    const ids = new Set(candidates.map((e) => e.masterEventId || e.id));
    state.calendar.events = state.calendar.events.filter((e) => !ids.has(e.id));
    return {
      mutated: true,
      text: `✓ ${formatDateRangeLabel(fromISO, toISO)}의 일정 ${candidates.length}건을 삭제했습니다.`,
      eventCards: candidates.slice(0, 10)
    };
  }
  if (candidates.length > 1) {
    return {
      text: `"${payload.matchTitle}" 와 일치하는 일정이 ${candidates.length}건 있습니다. 좀 더 구체적으로 (날짜 등) 알려주세요.`,
      eventCards: candidates.slice(0, 10)
    };
  }
  const target = candidates[0];
  const confirmed = await confirmCalendarDelete(candidates, payload, fromISO, toISO);
  if (!confirmed) return { text: "삭제를 취소했습니다.", kind: "warning", eventCards: [target] };
  state.calendar.events = state.calendar.events.filter((e) => e.id !== (target.masterEventId || target.id));
  return { mutated: true, text: `✓ 일정을 삭제했습니다: ${formatEventOneLine(target)}`, eventCards: [] };
}

export async function applyCalendarUpdate(payload) {
  const matchTitle = (payload?.matchTitle || "").toLowerCase();
  const changes = payload?.changes || {};
  if (!matchTitle) return { text: "수정할 일정의 제목을 알려주세요.", eventCards: [] };
  if (!Object.keys(changes).length) return { text: "어떤 항목을 바꿀지 알려주세요.", eventCards: [] };
  const candidates = state.calendar.events.filter((e) =>
    (e.title || "").toLowerCase().includes(matchTitle)
  );
  if (!candidates.length) return { text: `"${payload.matchTitle}" 와 일치하는 일정을 찾지 못했습니다.`, eventCards: [] };
  if (candidates.length > 1) {
    return {
      text: `"${payload.matchTitle}" 와 일치하는 일정이 ${candidates.length}건 있습니다. 좀 더 구체적으로 알려주세요.`,
      eventCards: candidates.slice(0, 10)
    };
  }
  const target = candidates[0];
  const index = state.calendar.events.findIndex((item) => item.id === target.id);
  const merged = {
    ...target,
    ...changes,
    reminders: changes.reminders !== undefined ? normalizeReminderList(changes.reminders) : target.reminders,
    updatedAt: new Date().toISOString()
  };
  if (changes.location === "") delete merged.location;
  if (changes.notes === "") delete merged.notes;
  const conflicts = hasCalendarTimeChange(changes)
    ? findConflictingEvents({ start: merged.start, end: merged.end || merged.start, allDay: !!merged.allDay }, target.id)
    : [];
  const confirmed = await confirmCalendarUpdate(target, merged, changes, conflicts);
  if (!confirmed) {
    return { text: "일정 수정을 취소했습니다.", kind: "warning", eventCards: [target, ...conflicts.slice(0, 3)] };
  }
  state.calendar.events[index] = merged;
  state.calendar.cursorISO = String(merged.start).slice(0, 10);
  maybeRequestNotificationPermission(merged.reminders);
  const result = {
    mutated: true,
    text: `✓ 일정을 수정했습니다: ${formatEventOneLine(merged)}`,
    eventCards: [merged]
  };
  if (conflicts.length) {
    result.kind = "warning";
    result.text = `${result.text} (기존 일정과 시간이 겹칩니다)`;
    result.eventCards = [merged, ...conflicts.slice(0, 3)];
  }
  return result;
}

export async function applyCalendarCreateAsync(payload) {
  if (!payload?.title || !payload?.start) {
    return { text: "일정 정보를 이해하지 못했습니다. 제목과 시간을 다시 알려주세요.", eventCards: [] };
  }
  if (isDailyRepeatCreatePayload(payload)) {
    payload = {
      ...payload,
      start: moveEventPayloadDate(payload.start, payload.repeat.from, !!payload.allDay),
      end: moveEventPayloadDate(payload.end || payload.start, payload.repeat.from, !!payload.allDay),
      recurrence: { frequency: "daily", interval: 1, until: payload.repeat.to },
      repeat: undefined
    };
  }
  const conflicts = findConflictingEvents({ start: payload.start, end: payload.end || payload.start, allDay: !!payload.allDay });
  if (conflicts.length && !payload._conflictConfirmed) {
    const proceed = await showCalendarConfirm({
      title: "Conflicting event",
      body: `기존 일정과 시간이 겹칩니다:\n${buildConflictWarning(conflicts)}\n\n그래도 추가할까요?`,
      okText: "Add anyway"
    });
    if (!proceed) return { text: "기존 일정과 겹쳐 추가하지 않았습니다.", kind: "warning", eventCards: conflicts.slice(0, 3) };
  }
  const result = applyCalendarCreate(payload);
  if (conflicts.length && result.mutated) {
    result.text = `${result.text} (⚠️ 기존 일정과 시간이 겹칩니다)`;
    result.kind = "warning";
  }
  return result;
}

export function isDailyRepeatCreatePayload(payload) {
  return payload?.repeat?.frequency === "daily"
    && /^\d{4}-\d{2}-\d{2}$/.test(String(payload.repeat.from || ""))
    && /^\d{4}-\d{2}-\d{2}$/.test(String(payload.repeat.to || ""));
}

export function moveEventPayloadDate(value, dateISO, allDay) {
  const date = String(dateISO || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return value;
  if (allDay) return date;
  const time = extractTimePart(value) || "09:00";
  return `${date}T${time}`;
}

export async function applyDailyRepeatCalendarCreateAsync(payload) {
  const eventPayloads = expandDailyRepeatPayloads(payload);
  if (!eventPayloads.length) return { text: "반복 등록할 날짜 범위를 이해하지 못했습니다.", eventCards: [] };
  const conflicts = [];
  for (const ep of eventPayloads) {
    conflicts.push(...findConflictingEvents({ start: ep.start, end: ep.end || ep.start, allDay: !!ep.allDay }));
  }
  if (conflicts.length) {
    const unique = dedupeEvents(conflicts);
    const proceed = await showCalendarConfirm({
      title: "Conflicts in repeated events",
      body: `반복 등록 중 기존 일정과 겹치는 항목이 ${unique.length}건 있습니다:\n${buildConflictWarning(unique)}\n\n그래도 모두 추가할까요?`,
      okText: "Add all"
    });
    if (!proceed) {
      return { text: "기존 일정과 겹쳐 반복 일정을 추가하지 않았습니다.", kind: "warning", eventCards: unique.slice(0, 5) };
    }
  }
  const nowIso = new Date().toISOString();
  const events = eventPayloads.map((ep) => createCalendarEventFromPayload(ep, nowIso));
  state.calendar.events.push(...events);
  state.calendar.cursorISO = payload.repeat.from;
  maybeRequestNotificationPermission(payload.reminders);
  const rangeLabel = formatDateRangeLabel(payload.repeat.from, payload.repeat.to);
  const result = {
    mutated: true,
    text: `✓ ${rangeLabel}에 ${payload.title} 일정 ${events.length}건을 추가했습니다.`,
    eventCards: events.slice(0, 20)
  };
  if (conflicts.length) {
    result.kind = "warning";
    result.text = `${result.text} (⚠️ 기존 일정과 겹치는 항목이 있습니다)`;
  }
  return result;
}

export function expandDailyRepeatPayloads(payload) {
  const from = parseDateISO(payload.repeat?.from);
  const to = parseDateISO(payload.repeat?.to);
  if (!from || !to || from.getTime() > to.getTime()) return [];
  const startDate = parseEventStart(payload);
  const endDate = parseEventEnd(payload) || startDate;
  const durationMs = startDate && endDate ? Math.max(0, endDate.getTime() - startDate.getTime()) : 0;
  const startTime = extractTimePart(payload.start) || "09:00";
  const maxDays = 370;
  const payloads = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  while (cursor.getTime() <= to.getTime() && payloads.length < maxDays) {
    const dateISO = formatLocalDate(cursor);
    const start = payload.allDay ? dateISO : `${dateISO}T${startTime}`;
    let end = start;
    if (!payload.allDay) {
      const startAt = new Date(start);
      const endAt = new Date(startAt.getTime() + durationMs);
      end = `${formatLocalDate(endAt)}T${String(endAt.getHours()).padStart(2, "0")}:${String(endAt.getMinutes()).padStart(2, "0")}`;
    }
    payloads.push({ ...payload, repeat: undefined, start, end });
    cursor.setDate(cursor.getDate() + 1);
  }
  return payloads;
}

export async function executeCalendarIntent(intentResult) {
  const { intent, payload } = intentResult;
  if (intent === "calendar.create") return await applyCalendarCreateAsync(payload);
  if (intent === "calendar.list") return applyCalendarList(payload);
  if (intent === "calendar.delete") return await applyCalendarDelete(payload);
  if (intent === "calendar.update") return await applyCalendarUpdate(payload);
  return { text: "처리할 수 없는 일정 의도입니다.", eventCards: [] };
}

// ===== Calendar intent detection =====

const CALENDAR_KEYWORD_PATTERN = /(일정|약속|회의|미팅|캘린더|스케줄|예약|행사|모임|이번\s*주|다음\s*주|지난\s*주|\d+\s*시)/;
const CALENDAR_CONFIRMATION_PATTERN = /^(응|네|예|그래|좋아|오케이|ㅇㅋ|확인|진행|해줘|추가|등록|잡아|잡아줘|추가해줘|등록해줘)(\b|[,.!?\s]|$)/i;
const CALENDAR_REJECTION_PATTERN = /^(아니|아니요|취소|그만|하지마|하지\s*마|보류|됐어|괜찮아)(\b|[,.!?\s]|$)/i;
const CALENDAR_ACTION_PATTERN = /(잡아|잡을|등록|추가|예약|취소|삭제|지워|빼|없애|옮겨|변경|바꿔|미뤄|미루|조회|검색)/;

export function hasCalendarKeyword(prompt) {
  return CALENDAR_KEYWORD_PATTERN.test(String(prompt || ""));
}

export function isCalendarConfirmation(prompt) {
  return CALENDAR_CONFIRMATION_PATTERN.test(String(prompt || "").trim());
}

export function isCalendarRejection(prompt) {
  return CALENDAR_REJECTION_PATTERN.test(String(prompt || "").trim());
}

export function isLikelyCalendarActionPrompt(prompt) {
  return CALENDAR_ACTION_PATTERN.test(String(prompt || ""));
}

export function isExplicitCalendarListRequest(prompt) {
  const text = String(prompt || "").trim();
  if (!text) return false;
  return /(일정|스케줄|캘린더|calendar|schedule)/i.test(text)
      && /(보고|보여|알려|조회|검색|목록|list|show|view)/i.test(text);
}

const CALENDAR_INQUIRY_PATTERN = /(가능\s*[?？하한할까]?|괜찮\s*[?？하한할까]?|비어\s*(있|있나|있어|있냐)|여유\s*(있|있나|있어)|할\s*수\s*있|잡을\s*수\s*있|되\s*나요|되\s*냐|되\s*(나|냐)|있어\s*[?？]?|있나\s*[?？]?|있냐\s*[?？]?|확인해\s*(줘|주세요|볼까|줄)|등록\s*(가능|할 수 있|돼|되)|available)/i;

export function isCalendarAvailabilityInquiry(prompt) {
  const text = String(prompt || "").trim();
  if (!text) return false;
  return CALENDAR_INQUIRY_PATTERN.test(text);
}

function parseKoreanTimes(text) {
  const results = [];
  const re = /(오전|오후|아침|점심|저녁|밤|새벽)?\s*(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?/g;
  let m;
  while ((m = re.exec(text))) {
    const period = m[1] || "";
    let hour = Number(m[2]);
    const minute = m[3] ? Number(m[3]) : 0;
    if (hour < 0 || hour > 24 || minute < 0 || minute > 59) continue;
    if (period === "오후" || period === "저녁" || period === "밤") {
      if (hour < 12) hour += 12;
    } else if (period === "점심") {
      if (hour < 8) hour += 12;
    } else if (period === "새벽") {
      if (hour === 12) hour = 0;
    } else if (period === "오전" || period === "아침") {
      if (hour === 12) hour = 0;
    }
    if (hour === 24) hour = 0;
    if (hour >= 0 && hour <= 23) results.push({ hour, minute });
  }
  return results;
}

export function extractCalendarTimeSlot(prompt, baseDate = new Date()) {
  const text = String(prompt || "").trim();
  if (!text) return null;
  const dateRange = extractCalendarListDateRange(prompt, baseDate);
  if (!dateRange) return null;
  const dateISO = dateRange.from;
  const sameDay = dateRange.from === dateRange.to;
  const times = parseKoreanTimes(text);
  const pad = (n) => String(n).padStart(2, "0");
  if (!times.length || !sameDay) {
    return { date: dateISO, range: dateRange, allDay: true };
  }
  const startISO = `${dateISO}T${pad(times[0].hour)}:${pad(times[0].minute)}`;
  let endISO;
  if (times[1]) {
    endISO = `${dateISO}T${pad(times[1].hour)}:${pad(times[1].minute)}`;
  } else {
    const d = new Date(startISO);
    d.setHours(d.getHours() + 1);
    endISO = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  return { date: dateISO, start: startISO, end: endISO, allDay: false };
}

export function extractCalendarListDateRange(prompt, baseDate = new Date()) {
  const text = String(prompt || "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const today = baseDate instanceof Date && Number.isFinite(baseDate.getTime()) ? baseDate : new Date();
  const baseYear = today.getFullYear();
  const baseMonth = today.getMonth() + 1;
  const pad = (n) => String(n).padStart(2, "0");
  const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const monthRange = (y, m) => {
    const lastDay = new Date(y, m, 0).getDate();
    return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDay)}` };
  };

  if (/(오늘|금일)/.test(text)) {
    const iso = isoOf(today);
    return { from: iso, to: iso };
  }
  if (/(내일|명일)/.test(text)) {
    const d = new Date(today); d.setDate(today.getDate() + 1);
    const iso = isoOf(d);
    return { from: iso, to: iso };
  }
  if (/(이번\s*주|이번주)/.test(text)) {
    const ws = new Date(today); ws.setDate(today.getDate() - today.getDay());
    const we = new Date(ws); we.setDate(ws.getDate() + 6);
    return { from: isoOf(ws), to: isoOf(we) };
  }
  if (/(이번\s*달|이번달|이달)/.test(text)) return monthRange(baseYear, baseMonth);
  // Specific day: "5월 14일", "2026년 5월 14일"
  const specificDay = /(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일/.exec(text);
  if (specificDay) {
    const y = specificDay[1] ? Number(specificDay[1]) : baseYear;
    const m = Number(specificDay[2]);
    const d = Number(specificDay[3]);
    const lastDay = new Date(y, m, 0).getDate();
    if (m >= 1 && m <= 12 && d >= 1 && d <= lastDay) {
      const iso = `${y}-${pad(m)}-${pad(d)}`;
      return { from: iso, to: iso };
    }
  }
  if (/(다음\s*달|다음달)/.test(text)) {
    const d = new Date(baseYear, baseMonth, 1);
    return monthRange(d.getFullYear(), d.getMonth() + 1);
  }
  if (/(지난\s*달|지난달|전월)/.test(text)) {
    const d = new Date(baseYear, baseMonth - 2, 1);
    return monthRange(d.getFullYear(), d.getMonth() + 1);
  }

  const multiMonth = /(\d{1,2})\s*월\s*(?:부터|에서|~|-)\s*(?:\d{4}\s*년\s*)?(\d{1,2})\s*월/.exec(text);
  if (multiMonth) {
    const fm = Number(multiMonth[1]);
    const tm = Number(multiMonth[2]);
    if (fm >= 1 && fm <= 12 && tm >= 1 && tm <= 12) {
      const ty = tm < fm ? baseYear + 1 : baseYear;
      return { from: monthRange(baseYear, fm).from, to: monthRange(ty, tm).to };
    }
  }
  const yearMatch = /(\d{4})\s*년(?:도)?/.exec(text);
  if (yearMatch) {
    const y = Number(yearMatch[1]);
    const after = text.slice(yearMatch.index + yearMatch[0].length);
    if (y >= 2000 && y <= 2100 && !/^\s*\d{1,2}\s*월/.test(after)) {
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    }
  }
  const explicitMonth = /(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월/.exec(text);
  if (explicitMonth) {
    const m = Number(explicitMonth[2]);
    const y = explicitMonth[1] ? Number(explicitMonth[1]) : baseYear;
    if (Number.isInteger(m) && m >= 1 && m <= 12) return monthRange(y, m);
  }
  return null;
}

export async function classifyMessageIntent(prompt, room = getActiveRoom()) {
  try {
    const response = await fetch("/api/agent/intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        model: elements.modelInput.value.trim() || "gemma3n:e2b",
        currentDate: new Date().toISOString(),
        messages: room ? room.messages.slice(-8).map(({ role, content }) => ({ role, content })) : [],
        pendingAction: room?.pendingCalendarAction || null
      })
    });
    if (!response.ok) return { intent: "chat", payload: {} };
    return await response.json();
  } catch {
    return { intent: "chat", payload: {} };
  }
}

export function clearPendingCalendarAction(room) {
  if (!room?.pendingCalendarAction) return;
  room.pendingCalendarAction = null;
  scheduleSave();
}

export function buildCalendarProposalText(payload, conflicts) {
  const summary = formatEventOneLine(payload);
  if (conflicts.length) {
    return [
      `일정 후보를 확인했습니다: ${summary}`,
      "다만 아래 기존 일정과 시간이 겹칩니다.",
      buildConflictWarning(conflicts),
      "그래도 이 일정으로 추가할까요?"
    ].join("\n");
  }
  return `일정 후보를 확인했습니다: ${summary}\n이 일정으로 추가할까요?`;
}

// ===== Calendar rendering =====

export function renderCalendar() {
  if (!elements.calendarGrid) return;
  renderCalendarHeader();
  renderCalendarViewToggle();
  renderCalendarGrid();
  renderUpcomingEvents();
  ensureHolidaysForCalendarRange();
}

function renderCalendarHeader() {
  const cursor = parseDateISO(state.calendar.cursorISO) ?? new Date();
  if (elements.calendarMonthLabel) {
    elements.calendarMonthLabel.textContent = formatCalendarRangeLabel(cursor, state.calendar.viewMode);
  }
  const unit = state.calendar.viewMode === "day" ? "일" : state.calendar.viewMode === "week" ? "주" : "달";
  if (elements.calendarPrevButton) {
    elements.calendarPrevButton.title = `이전 ${unit}`;
    elements.calendarPrevButton.setAttribute("aria-label", `이전 ${unit}`);
  }
  if (elements.calendarNextButton) {
    elements.calendarNextButton.title = `다음 ${unit}`;
    elements.calendarNextButton.setAttribute("aria-label", `다음 ${unit}`);
  }
}

function renderCalendarViewToggle() {
  const viewMode = normalizeCalendarViewMode(state.calendar.viewMode);
  for (const option of elements.calendarViewOptions) {
    const isActive = option.dataset.calendarView === viewMode;
    option.classList.toggle("active", isActive);
    option.setAttribute("aria-pressed", isActive ? "true" : "false");
  }
}

function renderCalendarGrid() {
  const grid = elements.calendarGrid;
  if (!grid) return;
  grid.innerHTML = "";
  grid.className = "calendar-grid";
  grid.dataset.viewMode = state.calendar.viewMode;
  if (state.calendar.viewMode === "week") { renderWeekCalendarGrid(grid); return; }
  if (state.calendar.viewMode === "day") { renderDayCalendarGrid(grid); return; }

  const cursor = parseDateISO(state.calendar.cursorISO) ?? new Date();
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const startOffset = firstOfMonth.getDay();
  const gridStart = new Date(year, month, 1 - startOffset);
  const gridEnd = addDays(gridStart, 41);
  const todayISO = formatLocalDate(new Date());
  const eventsByDate = groupEventsByDate(getCalendarEventsForRange(formatLocalDate(gridStart), formatLocalDate(gridEnd)));

  for (let cellIndex = 0; cellIndex < 42; cellIndex += 1) {
    const cellDate = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + cellIndex);
    const cellISO = formatLocalDate(cellDate);
    const isOutside = cellDate.getMonth() !== month;
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "calendar-day-cell";
    if (isOutside) cell.classList.add("outside");
    if (cellISO === todayISO) cell.classList.add("today");
    cell.dataset.date = cellISO;
    cell.dataset.weekday = String(cellDate.getDay());
    cell.addEventListener("click", (event) => {
      if (event.target !== cell && event.target.closest(".calendar-event-chip")) return;
      openEventDialogForCreate(cellISO);
    });

    const number = document.createElement("div");
    number.className = "calendar-day-number";
    number.textContent = String(cellDate.getDate());
    cell.append(number);
    appendHolidayBadges(cell, cellISO);

    const eventList = eventsByDate.get(cellISO) ?? [];
    if (eventList.length) {
      const eventsContainer = document.createElement("div");
      eventsContainer.className = "calendar-day-events";
      const visibleCount = Math.min(eventList.length, 3);
      for (let i = 0; i < visibleCount; i += 1) {
        const ev = eventList[i];
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "calendar-event-chip";
        if (ev.done) chip.classList.add("done");
        chip.dataset.color = ev.color || "accent";
        chip.title = formatEventChipTitle(ev);
        chip.textContent = formatEventChipLabel(ev);
        chip.addEventListener("click", (evt) => { evt.stopPropagation(); openEventDialogForEdit(ev.id); });
        eventsContainer.append(chip);
      }
      if (eventList.length > visibleCount) {
        const more = document.createElement("div");
        more.className = "calendar-event-more";
        more.textContent = `+${eventList.length - visibleCount}`;
        more.addEventListener("click", (evt) => {
          evt.stopPropagation();
          state.calendar.cursorISO = cellISO;
          setCalendarViewMode("day");
        });
        eventsContainer.append(more);
      }
      cell.append(eventsContainer);
    }
    grid.append(cell);
  }
}

function renderWeekCalendarGrid(grid) {
  grid.classList.add("calendar-grid-week");
  const cursor = parseDateISO(state.calendar.cursorISO) ?? new Date();
  const weekStart = startOfWeek(cursor);
  for (let i = 0; i < 7; i += 1) grid.append(createAgendaDayColumn(addDays(weekStart, i), { compact: false }));
}

function renderDayCalendarGrid(grid) {
  grid.classList.add("calendar-grid-day");
  const cursor = parseDateISO(state.calendar.cursorISO) ?? new Date();
  grid.append(createAgendaDayColumn(cursor, { compact: false, fullDay: true }));
}

export function createAgendaDayColumn(date, { compact = false, fullDay = false } = {}) {
  const dateISO = formatLocalDate(date);
  const events = getEventsForDate(dateISO);
  const holidays = getHolidaysForDate(dateISO);
  const column = document.createElement("section");
  column.className = fullDay ? "calendar-agenda-day full-day" : "calendar-agenda-day";
  column.dataset.weekday = String(date.getDay());

  const header = document.createElement("button");
  header.type = "button";
  header.className = "calendar-agenda-day-header";
  header.addEventListener("click", () => openEventDialogForCreate(dateISO));

  const dayName = document.createElement("span");
  dayName.className = "calendar-agenda-weekday";
  dayName.textContent = KOREAN_SHORT_WEEKDAYS[date.getDay()];
  const dayNumber = document.createElement("span");
  dayNumber.className = "calendar-agenda-date";
  dayNumber.textContent = `${date.getMonth() + 1}/${date.getDate()}`;
  header.append(dayName, dayNumber);
  column.append(header);

  if (holidays.length) {
    const holidayList = document.createElement("div");
    holidayList.className = "calendar-agenda-holidays";
    for (const holiday of holidays) {
      const badge = document.createElement("span");
      badge.className = "calendar-holiday-badge";
      badge.textContent = holiday.name;
      holidayList.append(badge);
    }
    column.append(holidayList);
  }

  const list = document.createElement("div");
  list.className = "calendar-agenda-event-list";
  if (!events.length) {
    if (compact) {
      const empty = document.createElement("div");
      empty.className = "calendar-agenda-empty";
      empty.textContent = "일정 없음";
      list.append(empty);
    }
  } else {
    for (const ev of events) list.append(createAgendaEventCard(ev));
  }
  column.append(list);
  return column;
}

function createAgendaEventCard(event) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "calendar-agenda-event";
  if (event.done) card.classList.add("done");
  card.dataset.color = event.color || "accent";
  card.addEventListener("click", () => openEventDialogForEdit(event.id));

  const time = document.createElement("div");
  time.className = "calendar-agenda-event-time";
  time.textContent = formatAgendaEventTime(event);
  const title = document.createElement("div");
  title.className = "calendar-agenda-event-title";
  title.textContent = event.title || "(제목 없음)";
  card.append(time, title);

  if (event.location) {
    const location = document.createElement("div");
    location.className = "calendar-agenda-event-location";
    location.textContent = event.location;
    card.append(location);
  }
  if (normalizeReminderList(event.reminders).length) {
    const remindersEl = document.createElement("div");
    remindersEl.className = "calendar-agenda-event-reminders";
    remindersEl.textContent = normalizeReminderList(event.reminders).map(formatReminderLabel).join(", ");
    card.append(remindersEl);
  }
  if (event.recurrence) {
    const repeatEl = document.createElement("div");
    repeatEl.className = "calendar-agenda-event-reminders";
    repeatEl.textContent = formatRecurrenceSummary(event.recurrence);
    card.append(repeatEl);
  }
  return card;
}

export function renderUpcomingEvents() {
  const list = elements.upcomingEventsList;
  if (!list) return;
  list.innerHTML = "";
  const now = new Date();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + 7);
  cutoff.setHours(23, 59, 59, 999);
  const upcoming = getCalendarEventsForRange(formatLocalDate(now), formatLocalDate(cutoff))
    .filter((event) => {
      const start = parseEventStart(event);
      if (!start) return false;
      if (start > cutoff) return false;
      if (event.allDay) {
        const endOfDay = new Date(start);
        endOfDay.setHours(23, 59, 59, 999);
        return endOfDay >= now;
      }
      return start >= now;
    })
    .sort((a, b) => String(a.start).localeCompare(String(b.start)));

  if (!upcoming.length) {
    const empty = document.createElement("div");
    empty.className = "upcoming-event-empty";
    empty.textContent = "7일 이내 예정된 일정이 없습니다.";
    list.append(empty);
    return;
  }
  for (const event of upcoming) {
    const item = document.createElement("div");
    item.className = "upcoming-event-item";
    if (event.done) item.classList.add("done");

    const checkBtn = document.createElement("button");
    checkBtn.type = "button";
    checkBtn.className = "upcoming-check-btn";
    checkBtn.setAttribute("aria-label", event.done ? "완료 취소" : "완료 표시");
    checkBtn.innerHTML = event.done
      ? `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="1.5"/><path d="M5 8l2.2 2.2L11 5.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`
      : `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5"/></svg>`;
    checkBtn.addEventListener("click", () => toggleEventDone(event.id));

    const content = document.createElement("button");
    content.type = "button";
    content.className = "upcoming-event-content";
    content.addEventListener("click", () => openEventDialogForEdit(event.id));
    const title = document.createElement("div");
    title.className = "upcoming-event-title";
    title.textContent = event.title || "(제목 없음)";
    const time = document.createElement("div");
    time.className = "upcoming-event-time";
    time.textContent = formatUpcomingTime(event);
    content.append(title, time);

    const dot = document.createElement("span");
    dot.className = "calendar-event-chip";
    dot.dataset.color = event.color || "accent";
    dot.style.cssText = "width:10px;height:10px;padding:0;border-radius:50%;flex-shrink:0";
    dot.setAttribute("aria-hidden", "true");
    item.append(checkBtn, content, dot);
    list.append(item);
  }
}

export async function toggleEventDone(eventId) {
  const masterId = String(eventId || "").split("#")[0];
  const event = state.calendar.events.find((e) => e.id === masterId);
  if (!event) return;
  event.done = !event.done;
  renderCalendar();
  scheduleSave();
}

function appendHolidayBadges(container, dateISO) {
  const holidays = getHolidaysForDate(dateISO);
  if (!holidays.length) return;
  container.classList.add("holiday");
  const wrapper = document.createElement("div");
  wrapper.className = "calendar-holiday-list";
  for (const holiday of holidays.slice(0, 2)) {
    const badge = document.createElement("span");
    badge.className = "calendar-holiday-badge";
    badge.textContent = holiday.name;
    wrapper.append(badge);
  }
  container.append(wrapper);
}

export function renderEventCardList(events) {
  const wrapper = document.createElement("div");
  wrapper.className = "message-event-list";
  for (const event of events) {
    if (!event) continue;
    const card = document.createElement("button");
    card.type = "button";
    card.className = "message-event-card";
    card.dataset.color = event.color || "accent";
    card.title = "일정에서 편집";
    card.addEventListener("click", () => {
      const targetId = event.masterEventId || event.id;
      const exists = state.calendar.events.some((item) => item.id === targetId);
      if (!exists) return;
      state.calendar.cursorISO = String(event.start).slice(0, 10);
      window.dispatchEvent(new CustomEvent("myai:setview", { detail: "calendar" }));
      openEventDialogForEdit(targetId);
    });
    const title = document.createElement("div");
    title.className = "message-event-title";
    title.textContent = event.title || "(제목 없음)";
    const time = document.createElement("div");
    time.className = "message-event-time";
    time.textContent = formatEventOneLine(event).replace(` · ${event.title || "(제목 없음)"}`, "");
    card.append(title, time);
    if (event.location) {
      const loc = document.createElement("div");
      loc.className = "message-event-location";
      loc.textContent = `📍 ${event.location}`;
      card.append(loc);
    }
    wrapper.append(card);
  }
  return wrapper;
}

// ===== Calendar controls =====

export function shiftCalendarMonth(delta) {
  const cursor = parseDateISO(state.calendar.cursorISO) ?? new Date();
  const next = state.calendar.viewMode === "week"
    ? addDays(cursor, delta * 7)
    : state.calendar.viewMode === "day"
      ? addDays(cursor, delta)
      : new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1);
  state.calendar.cursorISO = formatLocalDate(next);
  scheduleSave();
  renderCalendar();
}

export function jumpCalendarToToday() {
  state.calendar.cursorISO = formatLocalDate(new Date());
  scheduleSave();
  renderCalendar();
}

export function setCalendarViewMode(viewMode) {
  const next = normalizeCalendarViewMode(viewMode);
  if (state.calendar.viewMode === next) return;
  state.calendar.viewMode = next;
  scheduleSave();
  renderCalendar();
}

export function setEventColor(color) {
  state.calendar.selectedColor = color || "accent";
  for (const option of elements.eventColorOptions) {
    option.classList.toggle("active", option.dataset.color === state.calendar.selectedColor);
  }
}

export function setReminderPicker(reminders) {
  const selected = new Set(normalizeReminderList(reminders).map((r) => String(r.minutesBefore)));
  for (const input of elements.eventReminderInputs) input.checked = selected.has(input.value);
}

export function getSelectedReminderList() {
  return normalizeReminderList(
    elements.eventReminderInputs.filter((i) => i.checked).map((i) => Number(i.value))
  );
}

export function setRecurrencePicker(recurrence) {
  const normalized = normalizeRecurrence(recurrence);
  if (elements.eventRecurrenceSelect) elements.eventRecurrenceSelect.value = normalized?.frequency || "";
  if (elements.eventRecurrenceUntilInput) elements.eventRecurrenceUntilInput.value = normalized?.until || "";
}

export function getSelectedRecurrence() {
  const frequency = elements.eventRecurrenceSelect?.value || "";
  if (!frequency) return null;
  return normalizeRecurrence({
    frequency,
    interval: 1,
    until: elements.eventRecurrenceUntilInput?.value || undefined
  });
}

export function applyAllDayUiState(allDay) {
  const startValue = elements.eventStartInput.value;
  const endValue = elements.eventEndInput.value;
  if (allDay) {
    elements.eventStartInput.type = "date";
    elements.eventEndInput.type = "date";
    elements.eventStartInput.value = (startValue || "").slice(0, 10);
    elements.eventEndInput.value = (endValue || "").slice(0, 10);
  } else {
    elements.eventStartInput.type = "datetime-local";
    elements.eventEndInput.type = "datetime-local";
    if (startValue && startValue.length === 10) elements.eventStartInput.value = `${startValue}T09:00`;
    if (endValue && endValue.length === 10) elements.eventEndInput.value = `${endValue}T10:00`;
  }
}

// ===== Event dialog =====

export function openEventDialogForCreate(dateISO) {
  state.calendar.editingEventId = null;
  elements.eventDialogTitle.textContent = "새 일정";
  elements.eventForm.reset();
  elements.eventAllDayInput.checked = false;
  elements.eventStartInput.type = "datetime-local";
  elements.eventEndInput.type = "datetime-local";
  const baseDate = parseDateISO(dateISO) ?? new Date();
  const start = new Date(baseDate);
  start.setHours(9, 0, 0, 0);
  const end = new Date(start);
  end.setHours(start.getHours() + 1);
  elements.eventStartInput.value = toLocalInputValue(start);
  elements.eventEndInput.value = toLocalInputValue(end);
  setRecurrencePicker(null);
  setEventColor("accent");
  setReminderPicker([]);
  elements.deleteEventButton.hidden = true;
  elements.eventDoneRow.hidden = true;
  showEventDialog();
}

export function openEventDialogForEdit(eventId) {
  const masterId = String(eventId || "").split("#")[0];
  const event = state.calendar.events.find((item) => item.id === masterId);
  if (!event) return;
  state.calendar.editingEventId = event.id;
  elements.eventDialogTitle.textContent = "일정 편집";
  elements.eventForm.reset();
  elements.eventTitleInput.value = event.title || "";
  elements.eventAllDayInput.checked = !!event.allDay;
  if (event.allDay) {
    elements.eventStartInput.type = "date";
    elements.eventEndInput.type = "date";
    elements.eventStartInput.value = String(event.start || "").slice(0, 10);
    elements.eventEndInput.value = String(event.end || event.start || "").slice(0, 10);
  } else {
    elements.eventStartInput.type = "datetime-local";
    elements.eventEndInput.type = "datetime-local";
    elements.eventStartInput.value = String(event.start || "").slice(0, 16);
    elements.eventEndInput.value = String(event.end || event.start || "").slice(0, 16);
  }
  elements.eventLocationInput.value = event.location || "";
  elements.eventNotesInput.value = event.notes || "";
  setRecurrencePicker(event.recurrence);
  setReminderPicker(event.reminders);
  setEventColor(event.color || "accent");
  elements.deleteEventButton.hidden = false;
  elements.eventDoneRow.hidden = false;
  elements.eventDoneInput.checked = !!event.done;
  showEventDialog();
}

function showEventDialog() {
  if (typeof elements.eventDialog.showModal === "function") {
    elements.eventDialog.showModal();
  } else {
    elements.eventDialog.setAttribute("open", "");
  }
  setTimeout(() => elements.eventTitleInput.focus(), 0);
}

export function closeEventDialog() {
  if (typeof elements.eventDialog.close === "function") {
    elements.eventDialog.close();
  } else {
    elements.eventDialog.removeAttribute("open");
  }
  state.calendar.editingEventId = null;
}

export async function submitEventForm(formEvent) {
  formEvent.preventDefault();
  const title = elements.eventTitleInput.value.trim();
  if (!title) { elements.eventTitleInput.focus(); return; }
  const allDay = elements.eventAllDayInput.checked;
  const startRaw = elements.eventStartInput.value;
  const endRaw = elements.eventEndInput.value;
  if (!startRaw || !endRaw) { elements.eventStartInput.focus(); return; }
  const startDate = new Date(allDay ? `${startRaw}T00:00` : startRaw);
  const endDate = new Date(allDay ? `${endRaw}T23:59` : endRaw);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) { elements.eventStartInput.focus(); return; }
  if (endDate < startDate) { elements.eventEndInput.focus(); return; }

  const editingId = state.calendar.editingEventId;
  const payload = {
    title,
    allDay,
    start: allDay ? startRaw.slice(0, 10) : startRaw.slice(0, 16),
    end: allDay ? endRaw.slice(0, 10) : endRaw.slice(0, 16),
    location: elements.eventLocationInput.value.trim(),
    notes: elements.eventNotesInput.value.trim(),
    recurrence: getSelectedRecurrence(),
    reminders: getSelectedReminderList(),
    color: state.calendar.selectedColor || "accent",
    done: editingId ? elements.eventDoneInput.checked : false
  };

  const conflicts = findConflictingEvents(payload, editingId);
  if (conflicts.length) {
    const proceed = await showCalendarConfirm({
      title: "Conflicting event",
      body: `기존 일정과 시간이 겹칩니다:\n${buildConflictWarning(conflicts)}\n\n그래도 저장할까요?`,
      okText: "Save anyway"
    });
    if (!proceed) return;
  }

  const nowIso = new Date().toISOString();
  if (editingId) {
    const index = state.calendar.events.findIndex((item) => item.id === editingId);
    if (index >= 0) {
      state.calendar.events[index] = {
        ...state.calendar.events[index],
        ...payload,
        reminders: normalizeReminderList(payload.reminders),
        updatedAt: nowIso
      };
    }
  } else {
    state.calendar.events.push({
      id: crypto.randomUUID(),
      ...payload,
      reminders: normalizeReminderList(payload.reminders),
      notifiedReminders: [],
      createdAt: nowIso,
      updatedAt: nowIso
    });
  }
  state.calendar.cursorISO = String(payload.start).slice(0, 10);
  closeEventDialog();
  maybeRequestNotificationPermission(payload.reminders);
  scheduleSave();
  renderCalendar();
}

export async function deleteCurrentEvent() {
  const editingId = state.calendar.editingEventId;
  if (!editingId) return;
  const target = state.calendar.events.find((item) => item.id === editingId);
  if (!target) return;
  const ok = await showCalendarConfirm({
    title: target.recurrence ? "Delete repeated event" : "Delete event",
    body: target.recurrence
      ? `이 반복 일정을 모두 삭제합니다.\n${formatEventOneLine(target)}`
      : `이 일정을 삭제할까요?\n${formatEventOneLine(target)}`,
    okText: "Delete",
    danger: true
  });
  if (!ok) return;
  state.calendar.events = state.calendar.events.filter((item) => item.id !== editingId);
  closeEventDialog();
  scheduleSave();
  renderCalendar();
}

// ===== ICS import / export =====

export function exportCalendarIcs() {
  const ics = buildIcsCalendar(state.calendar.events);
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `myai-calendar-${formatLocalDate(new Date())}.ics`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

export async function importCalendarIcsFile(file) {
  if (!file) return;
  const text = await file.text();
  const events = parseIcsCalendar(text);
  if (!events.length) {
    showCalendarCommandResult({ text: "ICS file has no supported events.", kind: "warning", events: [] });
    return;
  }
  const ok = await showCalendarConfirm({
    title: "Import ICS events",
    body: `Import ${events.length} event(s)?\n${formatEventPreviewList(events, 8)}`,
    okText: "Import"
  });
  if (!ok) return;
  state.calendar.events.push(...events);
  state.calendar.cursorISO = String(events[0].start).slice(0, 10);
  scheduleSave();
  renderCalendar();
  showCalendarCommandResult({ text: `Imported ${events.length} event(s).`, kind: "info", events: events.slice(0, 10) });
}

function buildIcsCalendar(events) {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//myAI//Local Calendar//EN",
    ...events.flatMap(formatIcsEvent),
    "END:VCALENDAR",
    ""
  ].join("\r\n");
}

function formatIcsEvent(event) {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(event.uid || event.id || crypto.randomUUID())}`,
    `DTSTAMP:${formatIcsUtc(new Date())}`,
    `SUMMARY:${escapeIcsText(event.title || "(untitled)")}`
  ];
  if (event.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${toIcsDate(event.start)}`);
    lines.push(`DTEND;VALUE=DATE:${toIcsDate(addDays(parseDateISO(event.end || event.start), 1))}`);
  } else {
    lines.push(`DTSTART;TZID=Asia/Seoul:${toIcsLocal(event.start)}`);
    lines.push(`DTEND;TZID=Asia/Seoul:${toIcsLocal(event.end || event.start)}`);
  }
  if (event.location) lines.push(`LOCATION:${escapeIcsText(event.location)}`);
  if (event.notes) lines.push(`DESCRIPTION:${escapeIcsText(event.notes)}`);
  const recurrence = normalizeRecurrence(event.recurrence);
  if (recurrence) lines.push(`RRULE:${formatIcsRRule(recurrence)}`);
  lines.push("END:VEVENT");
  return lines;
}

function parseIcsCalendar(text) {
  const blocks = unfoldIcsLines(text).join("\n").split("BEGIN:VEVENT").slice(1);
  const nowIso = new Date().toISOString();
  return blocks.map((block) => parseIcsEvent(block, nowIso)).filter(Boolean);
}

function parseIcsEvent(block, nowIso) {
  const props = new Map();
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line === "END:VEVENT") continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).toUpperCase();
    const name = key.split(";")[0];
    props.set(name, { key, value: line.slice(idx + 1) });
  }
  const startProp = props.get("DTSTART");
  if (!startProp) return null;
  const allDay = /VALUE=DATE/.test(startProp.key);
  const start = parseIcsDateValue(startProp.value, allDay);
  let end = parseIcsDateValue(props.get("DTEND")?.value || startProp.value, allDay);
  if (allDay && props.get("DTEND")?.value) {
    const endDate = parseDateISO(end);
    if (endDate) end = formatLocalDate(addDays(endDate, -1));
  }
  if (!start) return null;
  return {
    id: crypto.randomUUID(),
    uid: unescapeIcsText(props.get("UID")?.value || ""),
    title: unescapeIcsText(props.get("SUMMARY")?.value || "(untitled)"),
    allDay,
    start,
    end,
    location: unescapeIcsText(props.get("LOCATION")?.value || ""),
    notes: unescapeIcsText(props.get("DESCRIPTION")?.value || ""),
    recurrence: parseIcsRRule(props.get("RRULE")?.value || ""),
    recurrenceExceptions: [],
    reminders: [],
    notifiedReminders: [],
    color: "accent",
    done: false,
    createdAt: nowIso,
    updatedAt: nowIso
  };
}

function unfoldIcsLines(text) {
  const lines = String(text || "").split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line) && out.length) out[out.length - 1] += line.slice(1);
    else out.push(line);
  }
  return out;
}

function parseIcsDateValue(value, allDay) {
  const text = String(value || "");
  if (allDay) return text.replace(/(\d{4})(\d{2})(\d{2}).*/, "$1-$2-$3");
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/.exec(text);
  if (!match) return "";
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}`;
}

function parseIcsRRule(value) {
  const parts = Object.fromEntries(String(value || "").split(";").map((part) => {
    const [key, val] = part.split("=");
    return [key, val];
  }));
  const frequency = String(parts.FREQ || "").toLowerCase();
  return normalizeRecurrence({
    frequency,
    interval: Number(parts.INTERVAL || 1),
    until: parts.UNTIL ? parseIcsDateValue(parts.UNTIL, true) : undefined,
    count: parts.COUNT ? Number(parts.COUNT) : undefined
  });
}

function formatIcsRRule(recurrence) {
  const parts = [`FREQ=${String(recurrence.frequency).toUpperCase()}`];
  if (recurrence.interval && recurrence.interval !== 1) parts.push(`INTERVAL=${recurrence.interval}`);
  if (recurrence.until) parts.push(`UNTIL=${toIcsDate(recurrence.until)}T235959Z`);
  if (recurrence.count) parts.push(`COUNT=${recurrence.count}`);
  return parts.join(";");
}

function toIcsDate(value) {
  if (value instanceof Date) return `${value.getFullYear()}${String(value.getMonth() + 1).padStart(2, "0")}${String(value.getDate()).padStart(2, "0")}`;
  return String(value || "").slice(0, 10).replaceAll("-", "");
}

function toIcsLocal(value) {
  return String(value || "").replace(/[-:]/g, "").slice(0, 13) + "00";
}

function formatIcsUtc(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeIcsText(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function unescapeIcsText(value) {
  return String(value || "").replace(/\\n/g, "\n").replace(/\\([\\,;])/g, "$1");
}

// ===== Reminders =====

export function startReminderWatcher() {
  if (state.calendar.reminderTimer) return;
  checkDueReminders();
  state.calendar.reminderTimer = window.setInterval(checkDueReminders, 60 * 1000);
}

function checkDueReminders() {
  const now = Date.now();
  let changed = false;
  for (const event of state.calendar.events) {
    const reminders = normalizeReminderList(event.reminders);
    if (!reminders.length) continue;
    const start = getReminderBaseDate(event);
    if (!start) continue;
    if (!Array.isArray(event.notifiedReminders)) event.notifiedReminders = [];
    for (const reminder of reminders) {
      const fireAt = start.getTime() - reminder.minutesBefore * 60 * 1000;
      const key = `${event.start}:${reminder.minutesBefore}`;
      const isDue = fireAt <= now && now - fireAt < 10 * 60 * 1000;
      if (!isDue || event.notifiedReminders.includes(key)) continue;
      event.notifiedReminders.push(key);
      changed = true;
      showReminderNotification(event, reminder);
    }
  }
  if (changed) scheduleSave();
}

function getReminderBaseDate(event) {
  if (!event?.start) return null;
  const value = event.allDay ? `${String(event.start).slice(0, 10)}T09:00` : event.start;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function showReminderNotification(event, reminder) {
  const title = event.title || "일정";
  const body = `${formatReminderLabel(reminder)} · ${formatEventOneLine(event)}`;
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(title, { body, icon: DEFAULT_FAVICON_HREF });
  }
  showReminderToast(title, body);
}

function showReminderToast(title, body) {
  if (!elements.reminderToastContainer) {
    if (elements.uploadProgress) elements.uploadProgress.textContent = `${title}: ${body}`;
    return;
  }
  const toast = document.createElement("div");
  toast.className = "reminder-toast";
  const titleEl = document.createElement("div");
  titleEl.className = "reminder-toast-title";
  titleEl.textContent = title;
  const bodyEl = document.createElement("div");
  bodyEl.className = "reminder-toast-body";
  bodyEl.textContent = body;
  toast.append(titleEl, bodyEl);
  elements.reminderToastContainer.append(toast);
  window.setTimeout(() => toast.remove(), 10000);
}

export function maybeRequestNotificationPermission(reminders) {
  if (!normalizeReminderList(reminders).length) return;
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") {
    const request = Notification.requestPermission();
    if (request?.catch) request.catch(() => {});
  }
}
