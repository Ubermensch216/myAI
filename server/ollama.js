import { loadLocalEnv } from "./env.js";
import { throwIfAborted } from "./abort.js";
import { chunkDocumentSections } from "./chunking.js";
import { multiQueryHybridSelect } from "./retrieval.js";
import { embedTexts } from "./embeddings.js";
import { expandQuery } from "./queryExpansion.js";
import { queryNotebook, loadAllNotebookChunks, getNotebookManifestSummary } from "./notebooks.js";
import { streamMapReduceAnalysis, MAP_REDUCE_MAX_CHUNKS } from "./mapReduce.js";
import {
  buildVisualizationContext,
  executeVisualizationPlan,
  buildFallbackVisualizationSpec,
  normalizeVisualizationPlan,
  parseVisualizationJson
} from "./visualization.js";

loadLocalEnv();

const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "gemma3n:e2b";
const MAX_CONTEXT_CHARS = Number(process.env.MAX_CONTEXT_CHARS || 24000);

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
  notebookId = null,
  mode = "chat",
  onChunk,
  onMeta,
  signal
}) {
  throwIfAborted(signal);
  if (mode === "map_reduce") {
    await runMapReduceChat({
      messages,
      documents,
      model,
      personalization,
      notebookId,
      onChunk,
      onMeta,
      signal
    });
    return;
  }

  const notebookContext = await loadNotebookContext(notebookId, messages, { signal });
  throwIfAborted(signal);

  if (typeof onMeta === "function") {
    onMeta({
      notebook: notebookContext?.notebook ?? null,
      citations: notebookContext?.chunks ?? []
    });
  }

  const ollamaMessages = await buildMessages(messages, documents, personalization, notebookContext, { signal });
  throwIfAborted(signal);
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    signal,
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
    throwIfAborted(signal);
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

async function runMapReduceChat({ messages, documents, model, personalization, notebookId, onChunk, onMeta, signal }) {
  throwIfAborted(signal);
  const userTitle = sanitizeName(personalization.userTitle, "사용자님");
  const aiName = sanitizeName(personalization.aiName, "AI");

  const latestUserIndex = findLatestUserMessageIndex(messages);
  const userQuery = latestUserIndex >= 0 ? String(messages[latestUserIndex]?.content ?? "").trim() : "";

  let chunks = [];
  let notebookSummary = null;
  if (notebookId) {
    const [allChunks, summary] = await Promise.all([
      loadAllNotebookChunks(notebookId).catch(() => []),
      getNotebookManifestSummary(notebookId).catch(() => null)
    ]);
    chunks = allChunks;
    notebookSummary = summary;
  } else {
    chunks = collectChunks(documents).map((chunk, index) => ({
      text: chunk.text,
      documentName: chunk.fileName,
      page: chunk.page,
      chunkIndex: index,
      locator: chunk.page != null ? `${chunk.page}쪽` : ""
    }));
  }

  if (typeof onMeta === "function") {
    onMeta({
      notebook: notebookSummary,
      citations: [],
      analysisMode: "map_reduce"
    });
  }

  if (!chunks.length) {
    onChunk(`${userTitle}, 분석할 자료를 먼저 업로드하거나 부서노트북을 선택해 주세요.`);
    return;
  }

  let progressLineActive = false;
  const emitProgress = (message) => {
    const prefix = progressLineActive ? "\n" : "";
    onChunk(`${prefix}[분석 진행] ${message}`);
    progressLineActive = true;
  };

  emitProgress(`총 ${chunks.length}청크. ${notebookSummary ? `노트북 "${notebookSummary.name}"` : "첨부 파일"} 전체를 Map-Reduce로 분석합니다.`);

  let reduceStarted = false;
  const directive = [
    `사용자의 호칭은 "${userTitle}"이며, 답변 첫 문장에 자연스럽게 한 번 부른다.`,
    `너의 이름은 "${aiName}"이다.`,
    "한국어로 명확하고 근거 중심으로 답한다.",
    "내부 사고 과정 전문을 공개하지 말고, 답변에는 결론과 근거만 제공한다."
  ].join("\n");

  try {
    const result = await streamMapReduceAnalysis({
      chunks,
      query: userQuery || "이 자료의 핵심을 정리해주세요.",
      model,
      systemDirective: directive,
      signal,
      onProgress: ({ stage, current, total, message }) => {
        if (stage === "map" || stage === "start") {
          emitProgress(message || `${stage} ${current}/${total}`);
        } else if (stage === "reduce") {
          emitProgress("부분 결과 통합 중 (Reduce 단계)...");
        }
      },
      onChunk: (text) => {
        if (!reduceStarted) {
          onChunk("\n\n");
          reduceStarted = true;
        }
        onChunk(text);
      }
    });

    if (result.truncated) {
      onChunk(`\n\n[알림] 분석 한도(${MAP_REDUCE_MAX_CHUNKS}청크)에 따라 앞쪽 ${result.chunkCount}개 청크만 처리했습니다. 더 깊은 분석이 필요하면 자료를 분할하거나 MAP_REDUCE_MAX_CHUNKS를 조정하세요.`);
    }
  } catch (err) {
    if (signal?.aborted) throw err;
    if (!reduceStarted) onChunk("\n\n");
    onChunk(`[오류] Map-Reduce 분석 실패: ${err.message}`);
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
    const firstAttempt = await requestVisualizationPlan({
      model,
      prompt,
      recentMessages,
      context
    });

    let planResult = parseAndExecuteVisualizationPlan(firstAttempt.rawContent, context);

    if (!planResult.ok) {
      const repairAttempt = await requestVisualizationPlanRepair({
        model,
        prompt,
        recentMessages,
        context,
        previousContent: firstAttempt.rawContent,
        errors: planResult.errors
      });
      planResult = parseAndExecuteVisualizationPlan(repairAttempt.rawContent, context);
      if (!planResult.ok) {
        return buildFallbackVisualizationSpec({
          prompt,
          context,
          reason: planResult.errors.join(" "),
          modelText: repairAttempt.rawContent || firstAttempt.rawContent
        });
      }
    }

    const interpreted = await requestVisualizationInterpretation({
      model,
      prompt,
      recentMessages,
      context,
      spec: planResult.spec
    }).catch(() => null);

    return mergeVisualizationInterpretation(planResult.spec, interpreted);
  } catch (error) {
    return buildFallbackVisualizationSpec({
      prompt,
      context,
      reason: error.message || "Visualization model call failed."
    });
  }
}

async function requestVisualizationPlan({ model, prompt, recentMessages, context }) {
  const planningContext = formatPlanningContext(context);
  return requestOllamaJson({
    model,
    temperature: 0.02,
    messages: [
      {
        role: "system",
        content: [
          "You are a data analyst. Return only JSON.",
          "Choose an executable visualization plan for the user's analytical request.",
          "Do not calculate chart data points yourself. The server will calculate exact values.",
          "Do not compute averages, standard deviations, totals, correlations, or distribution summaries.",
          "Do not add keys such as average_metrics or distribution_summary.",
          "Use exact column names from the provided context.",
          "chartType must be one exact string: bar, line, pie, scatter, table, kpi, or infographic.",
          "Chart choice rules:",
          "- line: trend, date/time change, sequence, 추이",
          "- scatter: relationship, correlation, trade-off, impact between two numeric metrics",
          "- bar: comparison across categories/models/tasks",
          "- pie: small part-to-whole distribution",
          "- table: exact row values matter more than visual pattern",
          "- kpi: top-level summary metrics",
          "- infographic: KPI plus concise narrative sections",
          "aggregation must be one exact string: average, sum, count, min, max, or none.",
          "For percentages, rates, latency, satisfaction, and speed metrics, average is usually safer than sum.",
          "The JSON must have exactly these top-level keys: status, analysis, visualizationPlan.",
          "Example shape:",
          JSON.stringify({
            status: "ok",
            analysis: {
              summary: "Korean one-sentence analytical summary",
              insights: ["Korean insight grounded in the table profile"],
              warnings: ["data limitation, if any"]
            },
            visualizationPlan: {
              chartType: "scatter",
              dataSetIndex: 0,
              title: "Korean chart title",
              xColumn: "exact existing x/category column",
              yColumn: "exact existing numeric value column",
              labelColumn: "exact existing label column or empty string",
              seriesColumn: "exact existing grouping column or empty string",
              aggregation: "none",
              reason: "why this chart and these columns answer the user request"
            }
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
          "Available table context for planning:",
          planningContext,
          "",
          "Return the analysis plan JSON now."
        ].join("\n")
      }
    ]
  });
}

async function requestVisualizationPlanRepair({ model, prompt, recentMessages, context, previousContent, errors }) {
  const planningContext = formatPlanningContext(context);
  return requestOllamaJson({
    model,
    temperature: 0.02,
    messages: [
      {
        role: "system",
        content: [
          "You repair invalid visualization analysis plans.",
          "Return only strict JSON matching the requested schema.",
          "The JSON must contain status, analysis, and visualizationPlan.",
          "Use only exact column names from the table context.",
          "Do not calculate chart data points yourself.",
          "Do not return computed statistics or prose-only analysis.",
          "Fix every validation error."
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
          "Validation errors:",
          errors.map((error) => `- ${error}`).join("\n"),
          "",
          "Previous model output:",
          String(previousContent ?? "").slice(0, 4000),
          "",
          "Available table context for planning:",
          planningContext,
          "",
          "Return corrected JSON only."
        ].join("\n")
      }
    ]
  });
}

async function requestVisualizationInterpretation({ model, prompt, recentMessages, context, spec }) {
  const response = await requestOllamaJson({
    model,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content: [
          "You are a Korean data analyst.",
          "Always write summary, insights, and warnings in Korean.",
          "Do not make generic statements. Refer to the actual chart variables, point count, and visible pattern.",
          "Interpret the computed visualization result. Do not change the chart data.",
          "Return only strict JSON with summary, insights, and warnings.",
          "Base your answer on the computed render spec and table context only."
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
          "Computed visualization spec:",
          JSON.stringify(trimVisualizationForPrompt(spec), null, 2),
          "",
          "Table context summary:",
          JSON.stringify({
            tableCount: context.tableCount,
            dataSets: context.dataSets.map((dataSet) => ({
              fileName: dataSet.fileName,
              sheetName: dataSet.sheetName,
              rowCount: dataSet.rowCount,
              headers: dataSet.headers,
              columns: dataSet.columns
            }))
          }, null, 2),
          "",
          "Return JSON: {\"summary\":\"...\",\"insights\":[\"...\"],\"warnings\":[\"...\"]}"
        ].join("\n")
      }
    ]
  });

  const parsed = parseVisualizationJson(response.rawContent);
  if (!parsed || typeof parsed !== "object") return null;
  return normalizeInterpretation(parsed);
}

async function requestOllamaJson({ model, messages, temperature }) {
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      format: "json",
      messages,
      options: {
        temperature,
        top_p: 0.8
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Ollama returned ${response.status}. ${errorText}`);
  }

  const payload = await response.json();
  return { rawContent: payload.message?.content ?? "" };
}

function parseAndExecuteVisualizationPlan(rawContent, context) {
  const parsed = parseVisualizationJson(rawContent);
  const normalizedPlan = normalizeVisualizationPlan(parsed, context);
  if (!normalizedPlan.ok) return { ok: false, errors: normalizedPlan.errors };
  const execution = executeVisualizationPlan(normalizedPlan.plan, context);
  if (!execution.ok) return { ok: false, errors: execution.errors };
  return { ok: true, spec: execution.spec };
}

function normalizeInterpretation(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    summary: String(source.summary ?? source.answer ?? "").trim().slice(0, 600),
    insights: normalizeStringArray(source.insights ?? source.keyFindings ?? source.findings, 8),
    warnings: normalizeStringArray(source.warnings ?? source.limitations ?? source.cautions, 6)
  };
}

function mergeVisualizationInterpretation(spec, interpretation) {
  if (!interpretation) return spec;
  const summary = interpretation.summary && containsHangul(interpretation.summary)
    ? interpretation.summary
    : spec.summary;
  return {
    ...spec,
    summary,
    insights: interpretation.insights.length ? interpretation.insights : spec.insights,
    warnings: interpretation.warnings.length ? interpretation.warnings : spec.warnings
  };
}

function containsHangul(value) {
  return /[\u3131-\u318e\uac00-\ud7a3]/.test(String(value ?? ""));
}

function trimVisualizationForPrompt(spec) {
  return {
    source: spec.source,
    analysisPlan: spec.analysisPlan,
    visualizations: (spec.visualizations ?? []).map((visualization) => ({
      ...visualization,
      data: Array.isArray(visualization.data) ? visualization.data.slice(0, 40) : visualization.data,
      rows: Array.isArray(visualization.rows) ? visualization.rows.slice(0, 20) : visualization.rows
    }))
  };
}

function formatPlanningContext(context) {
  return context.dataSets.map((dataSet, index) => [
    `Dataset ${index}`,
    `File: ${dataSet.fileName}`,
    `Sheet: ${dataSet.sheetName}`,
    `Rows: ${dataSet.rowCount}`,
    `Columns: ${dataSet.headers.join(", ")}`,
    "Sample rows:",
    JSON.stringify((dataSet.sampleRows ?? dataSet.rows ?? []).slice(0, 5), null, 2)
  ].join("\n")).join("\n\n");
}

function normalizeStringArray(value, limit) {
  const values = Array.isArray(value) ? value : [value];
  return values
    .map((item) => String(item ?? "").trim().slice(0, 600))
    .filter(Boolean)
    .slice(0, limit);
}

async function buildMessages(messages, documents, personalization, notebookContext = null, { signal } = {}) {
  const userTitle = sanitizeName(personalization.userTitle, "사용자님");
  const aiName = sanitizeName(personalization.aiName, "AI");
  const customPrompt = sanitizeCustomPrompt(personalization.customPrompt);
  const notebook = notebookContext?.notebook ?? null;
  const notebookChunks = notebookContext?.chunks ?? [];
  const notebookDocumentSummaries = notebookContext?.documentSummaries ?? [];

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

  if (notebook) {
    systemParts.push(
      `이 대화는 부서노트북 "${notebook.name}"을(를) 지식 기반으로 사용한다. (RAG 모드)`,
      "노트북 컨텍스트와 사용자 첨부 파일이 유일한 답변 자료다. 이 두 자료 외부의 일반 지식이나 추측은 절대 사용하지 마라.",
      "자료에서 답을 찾을 수 없거나 자료가 부족하면 정확히 다음과 같이만 답해라: \"해당 노트북에서 관련 정보를 찾을 수 없습니다.\"",
      "자료에서 부분적으로만 답할 수 있으면 알 수 있는 범위만 답하고, 모르는 부분은 모른다고 명시하라.",
      "답변 본문에 [1], [2]처럼 노트북 컨텍스트 블록의 출처 번호를 인라인으로 인용하라. 동일 출처를 여러 번 인용해도 좋다.",
      "출처 번호는 아래 [노트북 컨텍스트] 블록에 있는 번호만 사용하라. 새 번호를 만들지 마라.",
      "사용자의 첨부 파일에서 인용할 때는 별도 번호 대신 파일명과 페이지/시트를 자연스럽게 적어라."
    );
  }

  systemParts.push(
    "App capability: this web app can render data visualizations for uploaded CSV/XLSX table data.",
    "When the user asks whether charts, graphs, dashboards, visualizations, or infographics are possible, answer that they are possible in this app when table data is uploaded.",
    "Do not claim that visualization is impossible just because the language model itself cannot directly paint pixels.",
    "Explain that the app routes chart/graph requests with tabular data to its visualization renderer, which can show SVG charts and provide PNG download controls.",
    "If no suitable CSV/XLSX table is available yet, ask the user to upload one and then request the chart type or insight they want.",
    "Supported visualization outputs include bar, line, pie, scatter, table, KPI cards, dashboards, and infographic-style summaries.",
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
  const context = await buildContext(documents, latestUserQuery, { signal });

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

  const systemSegments = [system];

  if (notebookChunks.length) {
    const summaryBlock = formatDocumentSummariesBlock(notebookDocumentSummaries);
    const notebookBlock = notebookChunks
      .map((chunk) => {
        const locator = chunk.locator ? ` · ${chunk.locator}` : "";
        return `[${chunk.citationId}] (출처: ${chunk.documentName}${locator})\n${chunk.text}`;
      })
      .join("\n\n");
    const header = `[노트북 컨텍스트] 부서노트북 "${notebook.name}"에서 사용자 질문과 가장 관련 있는 ${notebookChunks.length}개 청크입니다. 답변에 [N] 형식으로 인용하세요.`;
    systemSegments.push([header, summaryBlock, notebookBlock].filter(Boolean).join("\n\n"));
  } else if (notebook) {
    systemSegments.push(
      `[노트북 컨텍스트] 부서노트북 "${notebook.name}"에서 이 질문과 관련된 자료를 찾지 못했습니다. "해당 노트북에서 관련 정보를 찾을 수 없습니다."라고만 답하세요.`
    );
  }

  const attachmentOverview = formatAttachmentOverview(documents);
  if (attachmentOverview) {
    systemSegments.push(attachmentOverview);
  }

  if (context) {
    systemSegments.push(`다음은 사용자가 업로드한 파일에서 추출한 컨텍스트다.\n\n${context}`);
  }

  mapped.unshift({ role: "system", content: systemSegments.join("\n\n") });

  return mapped;
}

async function loadNotebookContext(notebookId, messages, { signal } = {}) {
  if (!notebookId || typeof notebookId !== "string") return null;
  try {
    const latestUserIndex = findLatestUserMessageIndex(messages);
    const query = latestUserIndex >= 0 ? String(messages[latestUserIndex]?.content ?? "") : "";
    const result = await queryNotebook(notebookId, query, { signal });
    if (!result.ok) return null;
    return result;
  } catch (error) {
    if (signal?.aborted) throw error;
    console.warn(`Notebook context load failed for ${notebookId}: ${error.message}`);
    return null;
  }
}

async function buildContext(documents, query = "", { signal } = {}) {
  throwIfAborted(signal);
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
  let selected;

  if (totalLength <= MAX_CONTEXT_CHARS) {
    selected = chunks;
  } else {
    let queries = [query].filter(Boolean);
    try {
      queries = await expandQuery(query, { signal });
    } catch (error) {
      if (signal?.aborted) throw error;
    }
    let queryEmbeddings = queries.map(() => null);
    try {
      const allTexts = [...queries, ...chunks.map((c) => c.text)];
      const vectors = await embedTexts(allTexts, { signal });
      queryEmbeddings = vectors.slice(0, queries.length);
      vectors.slice(queries.length).forEach((vec, i) => { chunks[i].embedding = vec; });
    } catch (error) {
      if (signal?.aborted) throw error;
      // BM25 fallback — embedding model not available or request failed
    }
    selected = multiQueryHybridSelect(chunks, queries, queryEmbeddings, MAX_CONTEXT_CHARS);
  }

  let body = selected.map((chunk) => chunk.text).join("\n\n");

  if (selected.length < chunks.length) {
    body += `\n\n[알림] 문서가 길어 컨텍스트 한도(${MAX_CONTEXT_CHARS}자) 안에서 사용자 질문과 가장 관련 있는 ${selected.length}/${chunks.length}개 단락만 포함했습니다.`;
  }

  if (unavailableDocuments.length) {
    body += `\n\n[알림] 본문을 추출하지 못한 첨부 파일: ${unavailableDocuments.join(", ")}`;
  }

  return body;
}

function formatDocumentSummariesBlock(summaries) {
  if (!Array.isArray(summaries) || !summaries.length) return "";
  const lines = ["[문서 개요] 인용된 자료의 사전 분석 요약입니다. 답변의 사실 근거가 아니라 맥락 파악용으로만 활용하세요."];
  for (const entry of summaries) {
    const summary = String(entry.summary ?? "").trim();
    const topics = Array.isArray(entry.topics) ? entry.topics.filter(Boolean) : [];
    if (!summary && !topics.length) continue;
    const parts = [`- ${entry.documentName}`];
    if (summary) parts.push(`  요약: ${summary}`);
    if (topics.length) parts.push(`  토픽: ${topics.join(", ")}`);
    lines.push(parts.join("\n"));
  }
  return lines.length > 1 ? lines.join("\n") : "";
}

function formatAttachmentOverview(documents) {
  if (!Array.isArray(documents) || !documents.length) return "";
  const lines = [];
  for (const documentItem of documents) {
    if (documentItem.kind !== "document") continue;
    const summary = String(documentItem.summary ?? "").trim();
    const topics = Array.isArray(documentItem.topics) ? documentItem.topics.filter(Boolean) : [];
    if (!summary && !topics.length) continue;
    const parts = [`- ${documentItem.fileName}`];
    if (summary) parts.push(`  요약: ${summary}`);
    if (topics.length) parts.push(`  토픽: ${topics.join(", ")}`);
    lines.push(parts.join("\n"));
  }
  if (!lines.length) return "";
  return ["[첨부 파일 개요] 사용자가 첨부한 문서의 사전 분석 요약입니다. 사용자가 \"이 문서 뭐야?\" 같이 전체를 묻는 경우 이 개요를 우선 활용하고, 세부 사실은 아래 추출된 컨텍스트로 검증하세요.", ...lines].join("\n");
}

function collectChunks(documents) {
  const chunks = [];
  for (const documentItem of documents) {
    if (!hasDocumentContext(documentItem)) continue;
    for (const chunk of chunkDocumentSections(documentItem)) {
      const label = chunk.label ? `${chunk.page} / ${chunk.label}` : chunk.page;
      const part = chunk.part ? ` (part ${chunk.part}/${chunk.partTotal})` : "";
      const text = `[${documentItem.fileName} - ${label}${part}]\n${chunk.text}`;
      chunks.push({
        text,
        fileName: documentItem.fileName,
        page: chunk.page,
        label: chunk.label,
        part: chunk.part,
        partTotal: chunk.partTotal,
        chunkIndex: chunk.index
      });
    }
  }
  return chunks;
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
