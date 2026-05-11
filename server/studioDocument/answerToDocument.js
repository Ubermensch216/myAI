// Convert an AI answer markdown into a template-shaped structured document
// using Ollama. Falls back to a simple "원문 답변" wrapper when the LLM
// response is missing or fails to parse as JSON.

import { createLinkedAbortController, throwIfAborted } from "../abort.js";
import { analysisQueue } from "../modelQueue.js";
import { normalizeDocument, DOCUMENT_LIMITS } from "./documentModel.js";

const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "gemma3n:e2b";
const FALLBACK_MODEL = process.env.STUDIO_DOCUMENT_FALLBACK_MODEL || "gemma3n:e2b";
const TIMEOUT_MS = clampInt(process.env.STUDIO_DOCUMENT_OLLAMA_TIMEOUT_MS, 90_000, 5_000, 600_000);
const MAX_ANSWER_CHARS = Number(process.env.STUDIO_DOCUMENT_ANSWER_MAX_CHARS || 120_000);

export async function convertAnswerToDocument({
  title,
  answerMarkdown,
  template,
  metadata = {},
  source = null,
  model = DEFAULT_MODEL,
  signal
} = {}) {
  throwIfAborted(signal);
  const answer = String(answerMarkdown || "").trim();
  if (!answer) {
    const err = new Error("문서로 보낼 답변 내용이 없습니다.");
    err.code = "EMPTY_ANSWER";
    throw err;
  }
  if (answer.length > MAX_ANSWER_CHARS) {
    const err = new Error(
      `답변이 너무 깁니다. 최대 ${MAX_ANSWER_CHARS.toLocaleString()}자까지 변환할 수 있습니다.`
    );
    err.code = "ANSWER_TOO_LARGE";
    throw err;
  }
  if (!template || typeof template !== "object" || !Array.isArray(template.blocks)) {
    const err = new Error("유효한 템플릿이 필요합니다.");
    err.code = "TEMPLATE_REQUIRED";
    throw err;
  }

  const resolvedTitle = String(title || "").trim() || deriveTitleFromAnswer(answer) || template.name || "문서";
  const warnings = [];

  let parsed = null;
  let llmError = null;
  let usedFallbackModel = false;
  try {
    parsed = await analysisQueue.run(
      () => callOllamaForDocument({ template, answer, metadata, model, signal }),
      { signal, label: "studio_document" }
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    if (isQueueCapacityError(error)) {
      error.statusCode = 429;
      throw error;
    }
    if (isOutOfMemoryError(error) && FALLBACK_MODEL && FALLBACK_MODEL !== model) {
      try {
        parsed = await analysisQueue.run(
          () => callOllamaForDocument({ template, answer, metadata, model: FALLBACK_MODEL, signal }),
          { signal, label: "studio_document_fallback" }
        );
        usedFallbackModel = true;
      } catch (retryError) {
        llmError = retryError;
      }
    } else {
      llmError = error;
    }
  }

  const draftDoc = parsed
    ? {
        title: parsed.title || resolvedTitle,
        templateId: template.id,
        blocks: Array.isArray(parsed.blocks) ? parsed.blocks : [],
        citations: pickCitationsFromMetadata(metadata),
        source
      }
    : buildFallbackDoc({ title: resolvedTitle, template, answer, metadata, source });

  if (llmError) {
    warnings.push({ code: "model_fallback", message: `AI 변환 실패: ${shortReason(llmError.message)}. 원문을 그대로 사용합니다.` });
  } else if (!parsed) {
    warnings.push({ code: "invalid_json", message: "AI 응답이 JSON 형식이 아닙니다. 원문을 그대로 사용합니다." });
  } else if (usedFallbackModel) {
    warnings.push({ code: "model_downgraded", message: `기본 모델 메모리 부족으로 폴백 모델(${FALLBACK_MODEL})로 변환했습니다.` });
  }

  // Ensure templateId is set (LLM might omit it).
  draftDoc.templateId = template.id;

  const normalized = normalizeDocument(draftDoc, { source: draftDoc.source });
  if (!normalized.blocks.length) {
    // Defensive: if normalization wiped everything (e.g., bogus types only),
    // still produce a usable doc.
    const fallback = buildFallbackDoc({ title: resolvedTitle, template, answer, metadata, source });
    fallback.templateId = template.id;
    const extra = warnings.length
      ? warnings
      : [{ code: "empty_blocks", message: "AI 응답에 유효한 블록이 없어 원문으로 대체했습니다." }];
    return { document: normalizeDocument(fallback, { source: fallback.source }), warnings: extra };
  }
  return { document: normalized, warnings };
}

function shortReason(message) {
  const text = String(message || "").trim();
  if (!text) return "원인 미상";
  if (isOutOfMemoryMessage(text)) return "모델 로드에 필요한 메모리가 부족합니다 — 더 작은 모델을 사용하세요";
  if (/fetch failed|ECONNREFUSED|ENOTFOUND/i.test(text)) return "Ollama 서버에 연결할 수 없습니다";
  if (/timed out/i.test(text)) return "응답 시간 초과";
  if (/\b4\d\d\b|\b5\d\d\b/.test(text)) return text.slice(0, 120);
  return text.slice(0, 160);
}

function isOutOfMemoryError(error) {
  return isOutOfMemoryMessage(String(error?.message || ""));
}

function isOutOfMemoryMessage(text) {
  return /requires more system memory|insufficient memory|out of memory|OOM/i.test(text);
}

async function callOllamaForDocument({ template, answer, metadata, model, signal }) {
  const controller = createLinkedAbortController(signal, TIMEOUT_MS, "Studio document conversion timed out.");
  try {
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        format: "json",
        messages: [
          { role: "system", content: buildSystemPrompt() },
          { role: "user", content: buildUserPrompt({ template, answer, metadata }) }
        ],
        options: { temperature: 0.1 }
      })
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Ollama document conversion failed: ${response.status} ${text.slice(0, 160)}`.trim());
    }
    const payload = await response.json();
    const raw = payload?.message?.content || payload?.response || "";
    return parseDocumentJson(raw);
  } finally {
    controller.cleanup();
  }
}

function buildSystemPrompt() {
  return [
    "You convert an AI answer into a structured public-sector work document.",
    "Use the selected template exactly. Do not invent facts or citations.",
    "Preserve citation markers exactly, including [N1], [L1], [P1], [I1], [R1], [O1], [W1].",
    "If a template section has no source content, write \"작성 필요\".",
    "Write Korean unless the source answer is clearly in another language.",
    "Return strict JSON only. No prose, no fences.",
    "",
    "Output schema:",
    "{",
    "  \"title\": string,",
    "  \"blocks\": Array<",
    "    | { \"type\": \"heading\", \"level\": 1|2|3, \"text\": string }",
    "    | { \"type\": \"paragraph\", \"text\": string }",
    "    | { \"type\": \"bullet_list\", \"items\": string[] }",
    "    | { \"type\": \"numbered_list\", \"items\": string[] }",
    "    | { \"type\": \"checklist\", \"items\": { \"text\": string, \"checked\": boolean }[] }",
    "    | { \"type\": \"table\", \"columns\": string[], \"rows\": string[][] }",
    "    | { \"type\": \"quote\", \"text\": string }",
    "  >",
    "}",
    "",
    "Rules:",
    "- For each section in the template, emit a heading block then 1+ content blocks.",
    "- Use the section title exactly as written. Do NOT add extra numbering, prefixes, or parentheses; the title already contains its own numbering (e.g. \"1. 추진 배경\").",
    "- Heading level should be 1 for top-level numbered sections.",
    "- For a template block of type \"table\", emit a real table block with the given columns; rows come from the answer where possible.",
    "- Never add sections not listed in the template.",
    "- Never alter or fabricate citation markers."
  ].join("\n");
}

function buildUserPrompt({ template, answer, metadata }) {
  const sections = template.blocks.map((block) => {
    if (block.type === "table") {
      const cols = (block.columns || []).join(" | ");
      return `- [TABLE] ${block.title}\n    columns: ${cols}\n    instruction: 답변에서 해당 열에 맞는 행을 추출.`;
    }
    return `- ${block.title}\n    instruction: ${block.instruction || "관련 내용을 본문에서 정리."}`;
  }).join("\n");

  const citationHint = describeCitationHint(metadata);

  return [
    `템플릿 이름: ${template.name}`,
    `템플릿 설명: ${template.description || "-"}`,
    "",
    "템플릿 섹션:",
    sections,
    "",
    citationHint,
    "",
    "원본 답변(markdown):",
    "<<<ANSWER",
    answer,
    "ANSWER",
    "",
    "위 템플릿의 모든 섹션을 빠짐없이 채워 JSON으로 출력하세요."
  ].join("\n");
}

function describeCitationHint(metadata) {
  if (!metadata || typeof metadata !== "object") return "참고: 답변에 있는 인용 마커는 변경하지 말고 그대로 보존하세요.";
  const families = [];
  if (metadata.notebook) families.push("[N#] 부서노트북");
  if (metadata.law || metadata.compliance) families.push("[L#] 법령, [P#] 판례, [I#] 해석례, [R#] 행정규칙, [O#] 자치법규");
  if (metadata.webSearch || metadata.web) families.push("[W#] 웹");
  if (!families.length) return "참고: 답변에 있는 인용 마커는 변경하지 말고 그대로 보존하세요.";
  return `참고: 답변에 다음 인용 마커가 등장할 수 있습니다 (${families.join(", ")}). 마커 텍스트는 절대 변경하지 마세요.`;
}

function parseDocumentJson(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (fenced) {
      try {
        parsed = JSON.parse(fenced);
      } catch {
        parsed = null;
      }
    }
    if (!parsed) {
      const first = text.indexOf("{");
      const last = text.lastIndexOf("}");
      if (first >= 0 && last > first) {
        try {
          parsed = JSON.parse(text.slice(first, last + 1));
        } catch {
          parsed = null;
        }
      }
    }
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.blocks)) return null;
  return parsed;
}

function buildFallbackDoc({ title, template, answer, metadata, source }) {
  // PRD §17.2: minimal fallback wrapping the raw answer.
  const trimmed = answer.length > DOCUMENT_LIMITS.maxText ? `${answer.slice(0, DOCUMENT_LIMITS.maxText)}\n\n…(이하 생략)` : answer;
  return {
    title,
    templateId: template.id,
    blocks: [
      { type: "heading", level: 1, text: "원문 답변" },
      { type: "paragraph", text: trimmed }
    ],
    citations: pickCitationsFromMetadata(metadata),
    source
  };
}

function pickCitationsFromMetadata(metadata) {
  const out = {};
  if (!metadata || typeof metadata !== "object") return out;
  for (const key of ["notebook", "law", "precedent", "interpretation", "adminRule", "ordinance", "web"]) {
    const raw = metadata[key];
    if (Array.isArray(raw) && raw.length) {
      out[key] = raw;
    } else if (raw && typeof raw === "object" && Array.isArray(raw.items)) {
      out[key] = raw.items;
    }
  }
  return out;
}

function deriveTitleFromAnswer(answer) {
  const firstHeading = answer.match(/^\s*#{1,6}\s+(.+?)\s*$/m);
  if (firstHeading) return firstHeading[1].trim().slice(0, 160);
  const firstLine = answer.split("\n").map((line) => line.trim()).find(Boolean);
  return firstLine ? firstLine.slice(0, 160) : "";
}

function isQueueCapacityError(error) {
  return /queue is full/i.test(String(error?.message || ""));
}

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}
