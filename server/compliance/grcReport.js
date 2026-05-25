import PDFDocument from "pdfkit";
import { resolvePdfFontPath } from "../exportFiles.js";

const PAGE = {
  margin: 42,
  width: 595.28,
  height: 841.89
};

const COLORS = {
  ink: "#172033",
  muted: "#647084",
  line: "#d9e0ea",
  surface: "#f7f9fc",
  accent: "#2a6fdb",
  high: "#b91c1c",
  highBg: "#fee2e2",
  medium: "#92400e",
  mediumBg: "#fef3c7",
  low: "#166534",
  lowBg: "#dcfce7",
  info: "#475569",
  infoBg: "#f1f5f9"
};

export function createGrcReportPdf({ artifact } = {}) {
  const report = normalizeArtifact(artifact);
  const fontPath = resolvePdfFontPath();
  if (!fontPath) {
    const error = new Error("PDF 한글 폰트를 찾을 수 없습니다. EXPORT_PDF_FONT_PATH를 설정하거나 Malgun/Noto/Nanum 폰트를 설치해 주세요.");
    error.code = "PDF_FONT_MISSING";
    error.statusCode = 500;
    throw error;
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({
      size: "A4",
      margin: PAGE.margin,
      bufferPages: true,
      info: {
        Title: report.title,
        Author: "myAI",
        Creator: "myAI"
      }
    });
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    doc.registerFont("body", fontPath);
    doc.registerFont("bold", fontPath);
    doc.font("body");

    drawHeader(doc, report);
    drawSummary(doc, report);
    drawKpis(doc, report);
    drawFindings(doc, report);
    drawRoadmap(doc, report);
    drawMissing(doc, report);
    drawOpinion(doc, report);
    drawPageNumbers(doc);
    doc.end();
  });
}

export function grcReportFilename(artifact = {}) {
  const base = sanitizeFilename(artifact.title || `${artifact.targetDocName || "내부검토"} 보고서`);
  return `${base.endsWith(".pdf") ? base.slice(0, -4) : base}.pdf`;
}

export function contentDispositionForFilename(filename) {
  const safeAscii = sanitizeFilename(filename || "grc-report.pdf").replace(/[^\x20-\x7E]/g, "_");
  return `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(filename || "grc-report.pdf")}`;
}

function normalizeArtifact(artifact = {}) {
  const results = Array.isArray(artifact.results) ? artifact.results : [];
  const counts = artifact.counts && typeof artifact.counts === "object"
    ? artifact.counts
    : countStatuses(results);
  const risk = ["High", "Medium", "Low"].includes(artifact.overallRisk) ? artifact.overallRisk : "Low";
  return {
    title: clean(artifact.title) || "내부검토 보고서",
    targetDocName: clean(artifact.targetDocName) || "대상 문서",
    policyDocName: clean(artifact.policyDocName) || "검토 기준",
    generatedAt: clean(artifact.generatedAt) || new Date().toISOString(),
    summary: clean(artifact.summary) || "검토 결과 요약이 충분히 생성되지 않았습니다.",
    overallRisk: risk,
    riskLabel: clean(artifact.riskLabel) || riskLabel(risk),
    counts: {
      high: number(counts.high),
      medium: number(counts.medium),
      low: number(counts.low),
      info: number(counts.info)
    },
    results,
    actionItems: Array.isArray(artifact.actionItems) ? artifact.actionItems : results.filter((item) => statusLevel(item.status) !== "low" && clean(item.remediation)),
    missingInformation: Array.isArray(artifact.missingInformation) ? artifact.missingInformation.map(clean).filter(Boolean) : [],
    draftOpinion: clean(artifact.draftOpinion) || "의견서 초안이 생성되지 않았습니다."
  };
}

function drawHeader(doc, report) {
  const startX = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.roundedRect(startX, doc.y, width, 100, 8).fill(COLORS.ink);
  doc.fillColor("#ffffff").font("bold").fontSize(9).text("INTERNAL REVIEW REPORT", startX + 18, doc.y + 18);
  doc.font("bold").fontSize(22).text("내부검토 보고서", startX + 18, doc.y + 8, { width: width - 180 });
  doc.font("body").fontSize(10).fillColor("#dce8ff").text(report.targetDocName, startX + 18, doc.y + 8, { width: width - 180 });

  const badge = riskPalette(report.overallRisk);
  doc.roundedRect(startX + width - 132, 24 + PAGE.margin, 104, 32, 6).fill(badge.bg);
  doc.fillColor(badge.fg).font("bold").fontSize(10).text(`위험도 ${report.riskLabel}`, startX + width - 122, 34 + PAGE.margin, { width: 84, align: "center" });
  doc.y = PAGE.margin + 118;
}

function drawSummary(doc, report) {
  sectionTitle(doc, "검토 개요");
  const rows = [
    ["검토 대상", report.targetDocName],
    ["검토 기준", report.policyDocName],
    ["생성일", formatDate(report.generatedAt)]
  ];
  drawKeyValueGrid(doc, rows);
  doc.moveDown(0.7);
  paragraph(doc, report.summary, { size: 10.5 });
}

function drawKpis(doc, report) {
  sectionTitle(doc, "핵심 지표");
  const cards = [
    ["충돌 가능성", report.counts.high, COLORS.high, COLORS.highBg],
    ["보완 필요", report.counts.medium, COLORS.medium, COLORS.mediumBg],
    ["적합", report.counts.low, COLORS.low, COLORS.lowBg],
    ["확인 불가", report.counts.info, COLORS.info, COLORS.infoBg]
  ];
  const gap = 8;
  const width = (contentWidth(doc) - gap * 3) / 4;
  const y = doc.y;
  cards.forEach(([label, value, fg, bg], index) => {
    const x = doc.page.margins.left + index * (width + gap);
    doc.roundedRect(x, y, width, 58, 7).fill(bg);
    doc.fillColor(fg).font("bold").fontSize(20).text(String(value), x, y + 11, { width, align: "center" });
    doc.font("bold").fontSize(9).text(label, x, y + 37, { width, align: "center" });
  });
  doc.y = y + 72;
}

function drawFindings(doc, report) {
  sectionTitle(doc, "쟁점별 판단 매트릭스");
  if (!report.results.length) {
    paragraph(doc, "상세 진단 항목이 없습니다.");
    return;
  }
  report.results.forEach((item, index) => {
    ensureSpace(doc, 78);
    const level = statusLevel(item.status);
    const palette = levelPalette(level);
    const x = doc.page.margins.left;
    const width = contentWidth(doc);
    const y = doc.y;
    doc.roundedRect(x, y, width, 70, 6).strokeColor(COLORS.line).lineWidth(1).stroke();
    doc.rect(x, y, 5, 70).fill(palette.fg);
    doc.fillColor(COLORS.ink).font("bold").fontSize(10.5)
      .text(`${index + 1}. ${clean(item.ruleTitle) || "검토 항목"}`, x + 12, y + 10, { width: width - 124 });
    doc.roundedRect(x + width - 104, y + 9, 88, 18, 5).fill(palette.bg);
    doc.fillColor(palette.fg).font("bold").fontSize(8).text(clean(item.status) || "확인 불가", x + width - 98, y + 14, { width: 76, align: "center" });
    doc.fillColor(COLORS.muted).font("body").fontSize(9)
      .text(`검토 의견: ${clean(item.reason) || "검토 의견 없음"}`, x + 12, y + 32, { width: width - 24, height: 18, ellipsis: true });
    doc.fillColor(COLORS.ink).font("body").fontSize(9)
      .text(`조치 권고: ${clean(item.remediation) || (level === "low" ? "별도 조치 없음" : "조치 권고 없음")}`, x + 12, y + 50, { width: width - 24, height: 14, ellipsis: true });
    doc.y = y + 82;
  });
}

function drawRoadmap(doc, report) {
  sectionTitle(doc, "우선 조치 로드맵");
  if (!report.actionItems.length) {
    paragraph(doc, "즉시 조치가 필요한 보완 권고는 별도로 식별되지 않았습니다.");
    return;
  }
  report.actionItems.forEach((item, index) => {
    ensureSpace(doc, 42);
    doc.fillColor(COLORS.accent).font("bold").fontSize(10)
      .text(`${index + 1}. ${clean(item.ruleTitle) || "검토 항목"}`, { continued: false });
    paragraph(doc, clean(item.remediation), { size: 9.5, indent: 12 });
  });
}

function drawMissing(doc, report) {
  sectionTitle(doc, "추가 확인 필요 자료");
  const items = report.missingInformation.length
    ? report.missingInformation
    : ["추가 확인 필요 정보가 별도로 식별되지 않았습니다."];
  items.forEach((item) => bullet(doc, item));
}

function drawOpinion(doc, report) {
  sectionTitle(doc, "LLM 의견서 초안 전문");
  writeMarkdownLikeText(doc, report.draftOpinion);
}

function sectionTitle(doc, title) {
  ensureSpace(doc, 38);
  doc.moveDown(0.35);
  doc.fillColor(COLORS.accent).font("bold").fontSize(13).text(title);
  doc.moveDown(0.25);
  doc.strokeColor(COLORS.line).moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).stroke();
  doc.moveDown(0.55);
}

function drawKeyValueGrid(doc, rows) {
  const gap = 8;
  const width = (contentWidth(doc) - gap * (rows.length - 1)) / rows.length;
  const y = doc.y;
  rows.forEach(([label, value], index) => {
    const x = doc.page.margins.left + index * (width + gap);
    doc.roundedRect(x, y, width, 48, 6).fill(COLORS.surface).strokeColor(COLORS.line).stroke();
    doc.fillColor(COLORS.muted).font("bold").fontSize(8).text(label, x + 9, y + 9, { width: width - 18 });
    doc.fillColor(COLORS.ink).font("bold").fontSize(9.5).text(value, x + 9, y + 25, { width: width - 18, height: 14, ellipsis: true });
  });
  doc.y = y + 58;
}

function writeMarkdownLikeText(doc, text) {
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      doc.moveDown(0.35);
      continue;
    }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      ensureSpace(doc, 24);
      doc.fillColor(COLORS.ink).font("bold").fontSize(heading[1].length <= 2 ? 11.5 : 10.5).text(stripMarkdown(heading[2]));
      doc.moveDown(0.15);
      continue;
    }
    const item = /^[-*+]\s+(.+)$/.exec(line) || /^\d+[.)]\s+(.+)$/.exec(line);
    if (item) {
      bullet(doc, stripMarkdown(item[1]));
      continue;
    }
    paragraph(doc, stripMarkdown(line), { size: 9.5 });
  }
}

function paragraph(doc, text, { size = 10, indent = 0 } = {}) {
  ensureSpace(doc, 28);
  doc.fillColor(COLORS.ink).font("body").fontSize(size).text(clean(text), {
    width: contentWidth(doc) - indent,
    indent,
    lineGap: 3
  });
}

function bullet(doc, text) {
  ensureSpace(doc, 24);
  doc.fillColor(COLORS.ink).font("body").fontSize(9.5).text(`• ${clean(text)}`, {
    indent: 10,
    width: contentWidth(doc) - 10,
    lineGap: 2
  });
}

function drawPageNumbers(doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    doc.fillColor(COLORS.muted).font("body").fontSize(8)
      .text(`myAI 내부검토 보고서 · ${i + 1}/${range.count}`, PAGE.margin, PAGE.height - 34, {
        width: PAGE.width - PAGE.margin * 2,
        align: "center"
      });
  }
}

function ensureSpace(doc, needed) {
  if (doc.y + needed > doc.page.height - doc.page.margins.bottom - 24) {
    doc.addPage();
  }
}

function contentWidth(doc) {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

function statusLevel(status) {
  const text = String(status || "").toLowerCase();
  if (text === "high") return "high";
  if (text === "medium") return "medium";
  if (text === "low") return "low";
  if (text.includes("충돌") || text.includes("위반") || text.includes("부적합") || text.includes("conflict") || text.includes("non-compliant")) return "high";
  if (text.includes("보완") || text.includes("주의") || text.includes("warn")) return "medium";
  if (text.includes("적합") || text.includes("통과") || text.includes("compliant") || text.includes("pass")) return "low";
  return "info";
}

function countStatuses(items) {
  return {
    high: items.filter((item) => statusLevel(item.status) === "high").length,
    medium: items.filter((item) => statusLevel(item.status) === "medium").length,
    low: items.filter((item) => statusLevel(item.status) === "low").length,
    info: items.filter((item) => statusLevel(item.status) === "info").length
  };
}

function levelPalette(level) {
  if (level === "high") return { fg: COLORS.high, bg: COLORS.highBg };
  if (level === "medium") return { fg: COLORS.medium, bg: COLORS.mediumBg };
  if (level === "low") return { fg: COLORS.low, bg: COLORS.lowBg };
  return { fg: COLORS.info, bg: COLORS.infoBg };
}

function riskPalette(risk) {
  if (risk === "High") return { fg: COLORS.high, bg: COLORS.highBg };
  if (risk === "Medium") return { fg: COLORS.medium, bg: COLORS.mediumBg };
  return { fg: COLORS.low, bg: COLORS.lowBg };
}

function riskLabel(value) {
  if (value === "High") return "높음";
  if (value === "Medium") return "보통";
  return "낮음";
}

function clean(value) {
  return String(value ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return clean(value);
  return date.toLocaleString("ko-KR", { hour12: false });
}

function sanitizeFilename(value) {
  const text = String(value || "내부검토 보고서")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  return text || "내부검토 보고서";
}

function stripMarkdown(value) {
  return String(value || "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .trim();
}
