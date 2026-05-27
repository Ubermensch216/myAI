import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..", "..");
const LOGS_DIR = path.join(rootDir, "data", "logs");

const QUERY_TYPES = new Set(["chat_query", "law_query", "compliance_run"]);

function dateString(daysAgo) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function readUsageLogs({ days = 7 } = {}) {
  const records = [];
  for (let i = 0; i < days; i++) {
    const file = path.join(LOGS_DIR, `usage-${dateString(i)}.jsonl`);
    try {
      const text = await fs.readFile(file, "utf8");
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          records.push(JSON.parse(trimmed));
        } catch {
          // skip malformed lines
        }
      }
    } catch {
      // file doesn't exist for that day — normal
    }
  }
  return records;
}

export function aggregateSummary(records) {
  const sessions = new Set();
  const groups = new Set();
  const queryRecords = [];
  const latencies = [];
  let lawCount = 0;
  let complianceCount = 0;
  let studioOpenSessions = new Set();
  let studioExportSessions = new Set();
  let errorCount = 0;

  const sessionQueryTimes = {};

  for (const r of records) {
    sessions.add(r.sessionId);
    if (r.groupId && r.groupId !== "anon") groups.add(r.groupId);
    if (r.success === false) errorCount++;

    if (QUERY_TYPES.has(r.eventType)) {
      queryRecords.push(r);
      if (r.features?.law) lawCount++;
      if (r.features?.compliance) complianceCount++;
      if (r.latencyMs != null) latencies.push(r.latencyMs);

      // track query times per session for re-query rate
      if (!sessionQueryTimes[r.sessionId]) sessionQueryTimes[r.sessionId] = [];
      sessionQueryTimes[r.sessionId].push(r.ts);
    }

    if (r.eventType === "studio_open") studioOpenSessions.add(r.sessionId);
    if (r.eventType === "studio_export") studioExportSessions.add(r.sessionId);
  }

  const totalSessions = sessions.size;
  const totalQueries = queryRecords.length;
  const activeGroups = groups.size;
  const avgLatencyMs = latencies.length
    ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
    : 0;
  const lawUsageRatio = totalQueries ? lawCount / totalQueries : 0;
  const complianceUsageRatio = totalQueries ? complianceCount / totalQueries : 0;

  // sessions that opened studio AND exported
  let studioConversionCount = 0;
  for (const sid of studioOpenSessions) {
    if (studioExportSessions.has(sid)) studioConversionCount++;
  }
  const studioConversionRate = studioOpenSessions.size
    ? studioConversionCount / studioOpenSessions.size
    : 0;

  const errorRate = records.length ? errorCount / records.length : 0;

  // re-query rate: sessions with >1 query within 3 minutes at any point
  let reQuerySessions = 0;
  for (const times of Object.values(sessionQueryTimes)) {
    if (times.length < 2) continue;
    const sorted = times.slice().sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] - sorted[i - 1] <= 3 * 60 * 1000) {
        reQuerySessions++;
        break;
      }
    }
  }
  const reQueryRate = totalSessions ? reQuerySessions / totalSessions : 0;

  return {
    totalSessions,
    totalQueries,
    activeGroups,
    avgLatencyMs,
    lawUsageRatio: +lawUsageRatio.toFixed(4),
    complianceUsageRatio: +complianceUsageRatio.toFixed(4),
    studioConversionRate: +studioConversionRate.toFixed(4),
    errorRate: +errorRate.toFixed(4),
    reQueryRate: +reQueryRate.toFixed(4),
    featureUsage: {
      rag: records.filter((r) => r.features?.rag).length,
      law: lawCount,
      compliance: complianceCount,
      kg: records.filter((r) => r.features?.kg).length,
      calendar: records.filter((r) => r.features?.calendar).length,
      documentStudio: records.filter((r) => r.features?.documentStudio).length
    }
  };
}

export function aggregateByGroup(records) {
  const map = {};
  for (const r of records) {
    const g = r.groupId || "anon";
    if (!map[g]) map[g] = { groupId: g, queryCount: 0, sessionCount: 0, sessions: new Set(), latencies: [] };
    if (QUERY_TYPES.has(r.eventType)) {
      map[g].queryCount++;
      if (r.latencyMs != null) map[g].latencies.push(r.latencyMs);
    }
    map[g].sessions.add(r.sessionId);
  }
  return Object.values(map)
    .map(({ sessions, latencies, ...rest }) => ({
      ...rest,
      sessionCount: sessions.size,
      avgLatencyMs: latencies.length
        ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
        : 0
    }))
    .sort((a, b) => b.queryCount - a.queryCount);
}

/**
 * 지식팩 메뉴 관련 지표를 집계한다.
 *  - pageViews:        pack_page_view 이벤트 수
 *  - roomsStarted:     pack_room_started 이벤트 수
 *  - accessDenied:     access_denied 이벤트 수
 *  - conversionRate:   roomsStarted / pageViews (페이지 → 새 대화 전환율)
 *  - perPack:          지식팩별 roomsStarted 누적 (top N은 호출 측에서 자름)
 */
export function aggregateKnowledgePackKpis(records) {
  let pageViews = 0;
  let roomsStarted = 0;
  let accessDenied = 0;
  const perPack = {};
  for (const r of records) {
    if (r.eventType === "pack_page_view") pageViews++;
    if (r.eventType === "pack_room_started") {
      roomsStarted++;
      if (r.notebookId) {
        if (!perPack[r.notebookId]) perPack[r.notebookId] = { notebookId: r.notebookId, roomsStarted: 0 };
        perPack[r.notebookId].roomsStarted++;
      }
    }
    if (r.eventType === "access_denied") accessDenied++;
  }
  const conversionRate = pageViews ? roomsStarted / pageViews : 0;
  return {
    pageViews,
    roomsStarted,
    accessDenied,
    conversionRate: +conversionRate.toFixed(4),
    perPack: Object.values(perPack).sort((a, b) => b.roomsStarted - a.roomsStarted)
  };
}

export function aggregateByNotebook(records) {
  const map = {};
  for (const r of records) {
    if (!r.notebookId) continue;
    const nb = r.notebookId;
    if (!map[nb]) map[nb] = { notebookId: nb, queryCount: 0, sessions: new Set() };
    if (QUERY_TYPES.has(r.eventType)) map[nb].queryCount++;
    map[nb].sessions.add(r.sessionId);
  }
  return Object.values(map)
    .map(({ sessions, ...rest }) => ({ ...rest, uniqueSessions: sessions.size }))
    .sort((a, b) => b.queryCount - a.queryCount);
}

export function aggregateSessions(records, { page = 1, pageSize = 50 } = {}) {
  const map = {};
  for (const r of records) {
    const sid = r.sessionId;
    if (!map[sid]) {
      map[sid] = {
        sessionId: sid,
        groupId: r.groupId || "anon",
        level: r.level || "anon",
        eventCount: 0,
        firstSeen: r.ts,
        lastSeen: r.ts,
        features: { rag: false, law: false, compliance: false, kg: false, calendar: false, documentStudio: false },
        latencies: []
      };
    }
    const s = map[sid];
    s.eventCount++;
    if (r.ts < s.firstSeen) s.firstSeen = r.ts;
    if (r.ts > s.lastSeen) s.lastSeen = r.ts;
    if (r.features) {
      for (const k of Object.keys(s.features)) {
        if (r.features[k]) s.features[k] = true;
      }
    }
    if (r.latencyMs != null) s.latencies.push(r.latencyMs);
  }

  const all = Object.values(map)
    .map(({ latencies, ...rest }) => ({
      ...rest,
      avgLatencyMs: latencies.length
        ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
        : 0
    }))
    .sort((a, b) => b.lastSeen - a.lastSeen);

  const total = all.length;
  const offset = (page - 1) * pageSize;
  return { sessions: all.slice(offset, offset + pageSize), total, page, pageSize };
}
