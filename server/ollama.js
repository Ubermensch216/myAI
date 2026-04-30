import { loadLocalEnv } from "./env.js";
import { chunkText } from "./parsers.js";
import { pickRelevantChunks } from "./retrieval.js";
import {
  buildVisualizationContext,
  buildFallbackVisualizationSpec,
  normalizeVisualizationSpec,
  parseVisualizationJson
} from "./visualization.js";

loadLocalEnv();

const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "gemma3n:e2b";
const MAX_CONTEXT_CHARS = Number(process.env.MAX_CONTEXT_CHARS || 24000);
const CHUNK_TARGET_CHARS = Number(process.env.CHUNK_TARGET_CHARS || 1800);

export async function listModels() {
  const response = await fetch(`${OLLAMA_URL}/api/tags`);
  if (!response.ok) {
    throw new Error(`Ollama 모델 목록을 가져오지 못했습니다. status=${response.status}`);
  }
  return response.json();
}

export async function streamChat({
  messages,
  documents,
  model = DEFAULT_MODEL,
  personalization = {},
  onChunk
}) {
  const ollamaMessages = buildMessages(messages, documents, personalization);
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: true,
      messages: ollamaMessages,
      options: {
        temperature: 0.3,
        top_p: 0.9
      }
    })
  });

  if (!response.ok || !response.body) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Ollama 응답 오류: ${response.status} ${errorText}`);
  }

  const decoder = new TextDecoder();
  let buffer = "";

  for await (const rawChunk of response.body) {
    buffer += decoder.decode(rawChunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      const content = event.message?.content ?? "";
      if (content) onChunk(content);
      if (event.done) return;
    }
  }
}

export async function generateFollowupSuggestions({
  messages,
  model = DEFAULT_MODEL,
  personalization = {}
}) {
  const userTitle = sanitizeName(personalization.userTitle, "user");
  const aiName = sanitizeName(personalization.aiName, "AI");
  const recentMessages = messages
    .slice(-6)
    .map((message) => `${message.role === "assistant" ? aiName : userTitle}: ${String(message.content ?? "").slice(0, 1800)}`)
    .join("\n\n");

  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        {
          role: "system",
          content: [
            "You generate helpful follow-up questions for a Korean local AI assistant UI.",
            "Return only strict JSON.",
            "The JSON must be an array of 1 to 3 strings.",
            "Each string must be a concise Korean question the user may want to ask next.",
            "Questions must be specific to the concrete topic, nouns, files, code, or decision in the conversation.",
            "Questions should expand knowledge, clarify context, compare alternatives, or suggest a useful next step.",
            "Avoid generic questions such as '무슨 내용인가요?', '좀 더 자세히 말씀해 주세요', or '어떤 질문을 하고 싶으신가요?'.",
            "Good examples: '답변 섹션 제목을 더 눈에 띄게 만드는 UI 패턴은 뭐가 좋을까?', '추천 질문 생성 품질을 높이려면 어떤 프롬프트가 적절할까?'.",
            "Do not include numbering, bullets, markdown, explanations, or extra keys."
          ].join("\n")
        },
        {
          role: "user",
          content: `Conversation:\n\n${recentMessages}\n\nCreate concrete follow-up questions grounded in this exact conversation.`
        }
      ],
      options: {
        temperature: 0.45,
        top_p: 0.9
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Follow-up suggestion error: ${response.status} ${errorText}`);
  }

  const payload = await response.json();
  return parseSuggestionPayload(payload.message?.content ?? "");
}

export async function generateVisualizationSpec({
  prompt,
  messages,
  documents,
  model = DEFAULT_MODEL,
  personalization = {}
}) {
  const context = buildVisualizationContext(documents);
  if (!context.available) {
    throw new Error("No tabular data is available for visualization. Upload an Excel or CSV file first.");
  }

  const userTitle = sanitizeName(personalization.userTitle, "user");
  const aiName = sanitizeName(personalization.aiName, "AI");
  const recentMessages = messages
    .slice(-6)
    .map((message) => `${message.role === "assistant" ? aiName : userTitle}: ${String(message.content ?? "").slice(0, 1200)}`)
    .join("\n\n");

  try {
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        format: "json",
        messages: [
          {
            role: "system",
            content: [
              "You are a data visualization planner for a local Korean AI web app.",
              "Return only one strict JSON object. Do not include markdown, code fences, prose, or comments.",
              "Use the uploaded table data only. Do not invent rows, labels, totals, or columns.",
              "Create concise Korean titles, summary, insights, warnings, and labels unless the data itself is in another language.",
              "Allowed visualization types: bar, line, pie, scatter, table, kpi, infographic.",
              "Prefer kpi plus one or two charts when the user asks for an infographic.",
              "For bar, line, and pie, data must be an array of objects with label and numeric value.",
              "For scatter, data must be an array of objects with label, numeric x, and numeric y.",
              "For table, include columns and rows.",
              "For kpi, include items with label, value, and optional note.",
              "Schema:",
              JSON.stringify({
                version: "1.0",
                summary: "short answer",
                visualizations: [
                  {
                    type: "bar",
                    title: "chart title",
                    subtitle: "optional subtitle",
                    xLabel: "x axis",
                    yLabel: "y axis",
                    data: [{ label: "A", value: 10 }],
                    items: [{ label: "metric", value: "10", note: "optional" }],
                    columns: ["Column"],
                    rows: [["Value"]],
                    sections: [{ title: "section", body: "text", items: ["point"] }]
                  }
                ],
                insights: ["specific insight"],
                warnings: ["data limitation"]
              })
            ].join("\n")
          },
          {
            role: "user",
            content: [
              `User request: ${String(prompt ?? "").slice(0, 2000)}`,
              "",
              "Recent conversation:",
              recentMessages || "(none)",
              "",
              "Available table context:",
              JSON.stringify(context, null, 2),
              "",
              "Create the visualization JSON now."
            ].join("\n")
          }
        ],
        options: {
          temperature: 0.05,
          top_p: 0.8
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      return buildFallbackVisualizationSpec({
        prompt,
        context,
        reason: `Ollama returned ${response.status}. ${errorText}`
      });
    }

    const payload = await response.json();
    const rawContent = payload.message?.content ?? "";
    const parsed = parseVisualizationJson(rawContent);
    const spec = normalizeVisualizationSpec(parsed);
    if (spec.visualizations.length) return spec;

    return buildFallbackVisualizationSpec({
      prompt,
      context,
      reason: String(rawContent || "The model did not return a usable visualization JSON object.").slice(0, 500)
    });
  } catch (error) {
    return buildFallbackVisualizationSpec({
      prompt,
      context,
      reason: error.message || "Visualization model call failed."
    });
  }
}

function buildMessages(messages, documents, personalization) {
  const userTitle = sanitizeName(personalization.userTitle, "사용자님");
  const aiName = sanitizeName(personalization.aiName, "AI");
  const customPrompt = sanitizeCustomPrompt(personalization.customPrompt);

  const systemParts = [
    "너는 로컬 Ollama 기반 문서/이미지 분석 도우미다.",
    `너의 이름은 "${aiName}"이다.`,
    `사용자의 호칭은 "${userTitle}"이다.`,
    `답변을 시작할 때 자연스럽게 "${userTitle}"을 한 번 부른다.`,
    "한국어로 명확하고 근거 중심으로 답한다.",
    "답변은 일반 문장과 짧은 단락으로 작성한다.",
    "마크다운 제목, 굵게, 코드블록, 불릿 기호는 되도록 사용하지 않는다.",
    "여러 항목 비교나 표 추출이 필요할 때만 마크다운 표 형식으로 출력한다.",
    "표는 반드시 | 열 | 열 | 형태의 헤더와 구분선을 포함한다. 앱이 보기 좋은 테이블로 변환한다.",
    "파일 내용에 근거가 있으면 파일명, 페이지/시트/슬라이드 단서를 자연스럽게 표시한다.",
    "확실하지 않은 내용은 추정이라고 밝힌다.",
    "내부 사고 과정 전문을 공개하지 말고, 답변에는 결론과 근거만 제공한다."
  ];

  systemParts.push(
    "Format answers for scanning: use short section labels such as Summary, Key points, Evidence, Caution, Next steps when helpful.",
    "Put a simple visual symbol before section labels when it improves readability: ◆ Summary, ● Key points, ✓ Evidence, ※ Caution, -> Next steps.",
    "Prefer compact bullet lists with '- ', numbered lists with '1. ', and clear symbols like '->' or '※' for notes.",
    "Avoid long unbroken paragraphs. Keep each paragraph to one idea, then use bullets for details.",
    "Do not use Markdown heading marks (#) or bold markers (**). Use plain label lines instead."
  );

  if (customPrompt) {
    systemParts.push(
      "다음은 사용자가 설정에서 추가한 사용자 정의 프롬프트다. 안전 정책과 위 기본 규칙을 해치지 않는 범위에서 최대한 따른다.",
      customPrompt
    );
  }

  const system = systemParts.join("\n");

  const imageDocuments = documents.filter((documentItem) => documentItem.kind === "image");
  const latestUserIndex = findLatestUserMessageIndex(messages);
  const latestUserQuery = latestUserIndex >= 0 ? String(messages[latestUserIndex]?.content ?? "") : "";
  const context = buildContext(documents, latestUserQuery);

  const mapped = messages.map((message, index) => {
    const mappedMessage = {
      role: message.role === "assistant" ? "assistant" : "user",
      content: String(message.content ?? "")
    };

    if (index === latestUserIndex && imageDocuments.length > 0) {
      mappedMessage.images = imageDocuments.map((documentItem) => documentItem.imageBase64);
      mappedMessage.content += "\n\n첨부된 이미지도 함께 분석해줘.";
    }

    return mappedMessage;
  });

  if (context) {
    mapped.unshift({
      role: "system",
      content: `${system}\n\n다음은 사용자가 업로드한 파일에서 추출한 컨텍스트다.\n\n${context}`
    });
  } else {
    mapped.unshift({ role: "system", content: system });
  }

  return mapped;
}

function buildContext(documents, query = "") {
  const chunks = collectChunks(documents);

  const unavailableDocuments = documents
    .filter((documentItem) => documentItem.kind === "document" && !hasDocumentContext(documentItem))
    .map((documentItem) => documentItem.fileName)
    .filter(Boolean);

  if (!chunks.length) {
    return unavailableDocuments.length
      ? `[알림] 첨부 파일에서 본문을 추출하지 못했습니다: ${unavailableDocuments.join(", ")}`
      : "";
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.text.length, 0);
  const selected = totalLength <= MAX_CONTEXT_CHARS
    ? chunks
    : pickRelevantChunks(chunks, query, MAX_CONTEXT_CHARS);

  let body = selected.map((chunk) => chunk.text).join("\n\n");

  if (selected.length < chunks.length) {
    body += `\n\n[알림] 문서가 길어 컨텍스트 한도(${MAX_CONTEXT_CHARS}자) 안에서 사용자 질문과 가장 관련 있는 ${selected.length}/${chunks.length}개 단락만 포함했습니다.`;
  }

  if (unavailableDocuments.length) {
    body += `\n\n[알림] 본문을 추출하지 못한 첨부 파일: ${unavailableDocuments.join(", ")}`;
  }

  return body;
}

function collectChunks(documents) {
  const chunks = [];
  for (const documentItem of documents) {
    if (!hasDocumentContext(documentItem)) continue;
    const sections = pageSections(documentItem);
    for (const section of sections) {
      if (!section.text) continue;
      const label = section.label ? `${section.page} / ${section.label}` : section.page;
      const pieces = chunkText(section.text, CHUNK_TARGET_CHARS);
      pieces.forEach((piece, index) => {
        const part = pieces.length > 1 ? ` (part ${index + 1}/${pieces.length})` : "";
        const text = `[${documentItem.fileName} - ${label}${part}]\n${piece}`;
        chunks.push({ text, fileName: documentItem.fileName, page: section.page });
      });
    }
  }
  return chunks;
}

function pageSections(documentItem) {
  if (documentItem.pages?.some((page) => page.text)) return documentItem.pages;
  if (documentItem.sheets?.some((sheet) => sheet.text)) {
    return documentItem.sheets.map((sheet, index) => ({
      page: index + 1,
      label: sheet.name,
      text: sheet.text
    }));
  }
  return [{ page: 1, text: documentItem.text }];
}

function hasDocumentContext(documentItem) {
  return Boolean(
    documentItem.kind === "document" &&
    (
      documentItem.text ||
      documentItem.pages?.some((page) => page.text) ||
      documentItem.sheets?.some((sheet) => sheet.text)
    )
  );
}

function sanitizeName(value, fallback) {
  const clean = String(value ?? "").trim().slice(0, 30);
  return clean || fallback;
}

function sanitizeCustomPrompt(value) {
  return String(value ?? "").trim().slice(0, 4000);
}

function findLatestUserMessageIndex(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role !== "assistant") return index;
  }
  return messages.length - 1;
}

function parseSuggestionPayload(content) {
  const text = String(content ?? "").trim();
  if (!text) return [];

  const parsed = parseSuggestionJson(text) ?? parseSuggestionJson(extractJsonArray(text));
  const values = Array.isArray(parsed) ? parsed : parsed?.questions;
  if (!Array.isArray(values)) return parseSuggestionLines(text);

  return normalizeSuggestions(values);
}

function parseSuggestionJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractJsonArray(text) {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  return start >= 0 && end > start ? text.slice(start, end + 1) : "";
}

function parseSuggestionLines(text) {
  return normalizeSuggestions(
    text
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
  );
}

function normalizeSuggestions(values) {
  const seen = new Set();
  const suggestions = [];

  for (const value of values) {
    const suggestion = String(value ?? "")
      .replace(/^["'`]+|["'`]+$/g, "")
      .trim()
      .slice(0, 160);
    if (!suggestion || seen.has(suggestion)) continue;
    seen.add(suggestion);
    suggestions.push(suggestion);
    if (suggestions.length >= 3) break;
  }

  return suggestions;
}

export { DEFAULT_MODEL, OLLAMA_URL };
