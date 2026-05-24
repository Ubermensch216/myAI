import { createLinkedAbortController } from "../abort.js";
import { analysisQueue } from "../modelQueue.js";
import { DEFAULT_MODEL, OLLAMA_URL } from "../ollama.js";
import { getNotebook, loadAllNotebookChunks } from "../notebooks.js";

const MAX_SOURCE_GUIDE_INPUT_CHARS = Number(process.env.SOURCE_GUIDE_INPUT_MAX_CHARS || 36_000);
const SOURCE_GUIDE_TIMEOUT_MS = Number(process.env.SOURCE_GUIDE_TIMEOUT_MS || 75_000);

export async function buildSourceGuide({
  title,
  documents = [],
  notebookId = "",
  model = DEFAULT_MODEL,
  signal
} = {}) {
  const sourcePack = await collectSourceGuideInputs({ documents, notebookId });
  if (!sourcePack.items.length) {
    throw new Error("자료 브리핑을 만들 자료가 없습니다.");
  }

  const requestedTitle = sanitizeInline(title, 120) || "자료 브리핑";
  const fallback = buildFallbackGuide({ title: requestedTitle, sourcePack });

  try {
    const parsed = await analysisQueue.run(
      () => callOllamaForGuide({ title: requestedTitle, sourcePack, model, signal }),
      { signal, label: "source_guide" }
    );
    const guide = normalizeGuide(parsed, fallback);
    return {
      ...guide,
      id: `source_guide_${Date.now()}_${randomSuffix()}`,
      kind: "source_guide",
      title: guide.title || requestedTitle,
      markdown: renderGuideMarkdown(guide),
      sourceScope: sourcePack.scope,
      createdAt: new Date().toISOString()
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    return {
      ...fallback,
      id: `source_guide_${Date.now()}_${randomSuffix()}`,
      kind: "source_guide",
      markdown: renderGuideMarkdown(fallback),
      sourceScope: sourcePack.scope,
      warnings: [{ code: "source_guide_fallback", message: `AI 생성 실패: ${String(error.message || error).slice(0, 160)}` }],
      createdAt: new Date().toISOString()
    };
  }
}

export async function collectSourceGuideInputs({ documents = [], notebookId = "" } = {}) {
  const items = [];
  for (const doc of Array.isArray(documents) ? documents : []) {
    const text = extractDocumentText(doc);
    if (!text) continue;
    items.push({
      type: doc?.trustLevel === "generated" || doc?.origin === "assistant_answer" ? "generated_source" : "uploaded_file",
      title: sanitizeInline(doc.fileName || doc.name || "자료", 160),
      summary: sanitizeMultiline(doc.summary || "", 700),
      topics: cleanList(doc.topics, 10, 60),
      text
    });
  }

  let notebook = null;
  if (notebookId) {
    notebook = await getNotebook(notebookId);
    if (!notebook) throw new Error("프로젝트를 찾을 수 없습니다.");
    const chunks = await loadAllNotebookChunks(notebookId);
    const chunkText = sampleChunks(chunks);
    const docSummaries = (notebook.documents || [])
      .map((doc) => [
        `문서: ${doc.name || "문서"}`,
        doc.summary ? `요약: ${doc.summary}` : "",
        Array.isArray(doc.topics) && doc.topics.length ? `토픽: ${doc.topics.join(", ")}` : ""
      ].filter(Boolean).join("\n"))
      .filter(Boolean)
      .join("\n\n");
    const text = [docSummaries, chunkText].filter(Boolean).join("\n\n");
    if (text.trim()) {
      items.push({
        type: "department_notebook",
        title: notebook.name || "부서 프로젝트",
        summary: notebook.description || "",
        topics: [],
        text
      });
    }
  }

  const sampled = [];
  let remaining = MAX_SOURCE_GUIDE_INPUT_CHARS;
  for (const item of items) {
    if (remaining <= 0) break;
    const text = String(item.text || "").trim();
    const take = text.length > remaining ? `${text.slice(0, remaining)}\n\n[이하 생략]` : text;
    sampled.push({ ...item, text: take });
    remaining -= take.length;
  }

  return {
    items: sampled,
    scope: {
      documentCount: sampled.filter((item) => item.type !== "department_notebook").length,
      notebook: notebook ? { id: notebook.id, name: notebook.name } : null
    }
  };
}

async function callOllamaForGuide({ title, sourcePack, model, signal }) {
  const controller = createLinkedAbortController(signal, SOURCE_GUIDE_TIMEOUT_MS, "Source guide generation timed out.");
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
          {
            role: "system",
            content: [
              "You create source guides for a Korean public-sector assistant.",
              "Use only the supplied source excerpts. Do not invent facts.",
              "Return strict JSON only with keys: title, summary, keyIssues, relatedLaws, recommendedQuestions, possibleOutputs.",
              "summary: Korean 3-5 sentences.",
              "keyIssues, relatedLaws, recommendedQuestions, possibleOutputs: arrays of concise Korean strings.",
              "If laws are not explicit in the sources, relatedLaws must contain cautious candidates or say 법령 확인 필요."
            ].join("\n")
          },
          {
            role: "user",
            content: [
              `가이드 제목: ${title}`,
              "",
              "자료:",
              ...sourcePack.items.map((item, index) => [
                `## SOURCE ${index + 1}: ${item.title}`,
                `type: ${item.type}`,
                item.summary ? `summary: ${item.summary}` : "",
                item.topics?.length ? `topics: ${item.topics.join(", ")}` : "",
                "excerpt:",
                item.text
              ].filter(Boolean).join("\n")),
              "",
              "위 자료로 소스 가이드를 JSON으로 작성하세요."
            ].join("\n\n")
          }
        ],
        options: { temperature: 0.15, top_p: 0.9 }
      })
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Source guide model call failed: ${response.status} ${text.slice(0, 160)}`.trim());
    }
    const payload = await response.json();
    return parseGuideJson(payload?.message?.content || payload?.response || "");
  } finally {
    controller.cleanup();
  }
}

function parseGuideJson(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try { return JSON.parse(text.slice(first, last + 1)); } catch { return null; }
    }
    return null;
  }
}

function normalizeGuide(parsed, fallback) {
  const source = parsed && typeof parsed === "object" ? parsed : {};
  return {
    title: sanitizeInline(source.title, 120) || fallback.title,
    summary: sanitizeMultiline(source.summary, 1800) || fallback.summary,
    keyIssues: cleanList(source.keyIssues, 12, 240, fallback.keyIssues),
    relatedLaws: cleanList(source.relatedLaws, 12, 240, fallback.relatedLaws),
    recommendedQuestions: cleanList(source.recommendedQuestions, 12, 240, fallback.recommendedQuestions),
    possibleOutputs: cleanList(source.possibleOutputs, 12, 240, fallback.possibleOutputs),
    warnings: []
  };
}

function buildFallbackGuide({ title, sourcePack }) {
  const names = sourcePack.items.map((item) => item.title).filter(Boolean);
  const summaries = sourcePack.items.map((item) => item.summary).filter(Boolean);
  return {
    title,
    summary: summaries.length
      ? summaries.slice(0, 4).join(" ")
      : `${names.join(", ") || "선택한 자료"}를 기반으로 정리한 자료 브리핑입니다. 핵심 쟁점과 후속 질문은 원문 검토를 전제로 사용하세요.`,
    keyIssues: sourcePack.items.map((item) => `${item.title}: 주요 사실관계와 근거 확인`).slice(0, 8),
    relatedLaws: ["법령 확인 필요"],
    recommendedQuestions: [
      "이 자료에서 의사결정에 필요한 핵심 근거는 무엇인가?",
      "추가 확인이 필요한 원문, 법령, 내부 기준은 무엇인가?",
      "보고서나 검토의견서로 전환할 때 빠진 쟁점은 무엇인가?"
    ],
    possibleOutputs: ["요약 보고서", "검토 의견서", "쟁점 목록", "질의응답 초안"],
    warnings: []
  };
}

function renderGuideMarkdown(guide) {
  const sections = [
    ["요약", guide.summary],
    ["핵심 쟁점", listMarkdown(guide.keyIssues)],
    ["관련 법령/기준", listMarkdown(guide.relatedLaws)],
    ["추천 질문", listMarkdown(guide.recommendedQuestions)],
    ["가능한 산출물", listMarkdown(guide.possibleOutputs)]
  ];
  return [
    `# ${guide.title || "자료 브리핑"}`,
    "",
    ...sections.flatMap(([heading, body]) => [`## ${heading}`, "", body || "- 작성 필요", ""])
  ].join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function listMarkdown(items) {
  return cleanList(items, 20, 300).map((item) => `- ${item}`).join("\n");
}

function extractDocumentText(doc) {
  if (!doc || typeof doc !== "object") return "";
  if (typeof doc.text === "string" && doc.text.trim()) return doc.text.trim();
  const pageText = Array.isArray(doc.pages)
    ? doc.pages.map((page) => String(page?.text || "").trim()).filter(Boolean).join("\n\n")
    : "";
  if (pageText) return pageText;
  return Array.isArray(doc.sheets)
    ? doc.sheets.map((sheet) => String(sheet?.text || "").trim()).filter(Boolean).join("\n\n")
    : "";
}

function sampleChunks(chunks) {
  const parts = [];
  let total = 0;
  for (const chunk of Array.isArray(chunks) ? chunks : []) {
    const text = String(chunk?.text || "").trim();
    if (!text) continue;
    const header = chunk?.documentName ? `[${chunk.documentName}]` : "";
    const piece = [header, text].filter(Boolean).join("\n");
    if (total + piece.length > MAX_SOURCE_GUIDE_INPUT_CHARS) break;
    parts.push(piece);
    total += piece.length;
  }
  return parts.join("\n\n");
}

function cleanList(value, maxItems, maxLen, fallback = []) {
  const raw = Array.isArray(value) ? value : value ? [value] : fallback;
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const text = sanitizeInline(item, maxLen);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
}

function sanitizeInline(value, maxLen) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLen);
}

function sanitizeMultiline(value, maxLen) {
  return String(value ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim().slice(0, maxLen);
}

function randomSuffix() {
  return Math.random().toString(36).slice(2, 8);
}
