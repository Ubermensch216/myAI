import { loadLocalEnv } from "./env.js";

loadLocalEnv();

const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "gemma3n:e2b";
const BATCH_CHUNKS = clampInt(process.env.MAP_REDUCE_BATCH_CHUNKS, 4, 1, 20);
const MAX_CHUNKS = clampInt(process.env.MAP_REDUCE_MAX_CHUNKS, 80, 4, 400);
const PARALLELISM = clampInt(process.env.MAP_REDUCE_PARALLELISM, 2, 1, 8);
const MAP_TIMEOUT_MS = clampInt(process.env.MAP_REDUCE_MAP_TIMEOUT_MS, 45000, 5000, 300000);
const MAP_PARTIAL_MAX_CHARS = 1200;

function clampInt(raw, fallback, min, max) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/**
 * Run Map-Reduce analysis over provided chunks.
 * Map step: each batch of BATCH_CHUNKS chunks → 1 LLM call producing partial findings.
 * Reduce step: all partial findings → 1 streaming LLM call producing the final answer.
 *
 * chunks: Array<{ text, citationId?, documentName?, locator?, ... }>
 * query: user's natural-language question that drives both Map and Reduce prompts
 * onProgress({ stage, current, total, message }): non-streaming status updates
 * onChunk(text): reduce-stage streaming content (final answer body)
 *
 * Returns { mapped: number, batches: number, truncated: boolean } when done.
 * Throws on Reduce failure; Map failures degrade per-batch (skipped, others continue).
 */
export async function streamMapReduceAnalysis({
  chunks,
  query,
  model = DEFAULT_MODEL,
  systemDirective = "",
  onProgress = () => {},
  onChunk
}) {
  if (typeof onChunk !== "function") {
    throw new Error("streamMapReduceAnalysis requires onChunk callback for Reduce streaming.");
  }
  const list = Array.isArray(chunks) ? chunks.filter((c) => c && typeof c.text === "string" && c.text.trim()) : [];
  if (!list.length) {
    throw new Error("Map-Reduce 분석을 수행할 컨텍스트가 없습니다. 먼저 노트북이나 첨부 파일을 추가하세요.");
  }

  const truncated = list.length > MAX_CHUNKS;
  const working = truncated ? list.slice(0, MAX_CHUNKS) : list;
  const batches = chunkBatches(working, BATCH_CHUNKS);
  const trimmedQuery = String(query ?? "").trim() || "이 자료의 핵심 내용을 정리해주세요.";

  onProgress({ stage: "start", current: 0, total: batches.length, message: `Map-Reduce 분석 시작: ${working.length}청크 → ${batches.length}배치` });

  const partials = await runMapStage({
    batches,
    query: trimmedQuery,
    model,
    onProgress
  });

  const usable = partials.filter((p) => p && p.text);
  if (!usable.length) {
    throw new Error("Map 단계에서 사용할 수 있는 부분 결과를 얻지 못했습니다.");
  }

  onProgress({ stage: "reduce", current: 0, total: 1, message: "Reduce 단계: 부분 결과들을 통합 중" });

  await runReduceStream({
    partials: usable,
    query: trimmedQuery,
    model,
    systemDirective,
    onChunk
  });

  onProgress({ stage: "done", current: batches.length, total: batches.length, message: "분석 완료" });

  return {
    mapped: usable.length,
    batches: batches.length,
    chunkCount: working.length,
    truncated
  };
}

function chunkBatches(items, batchSize) {
  const out = [];
  for (let i = 0; i < items.length; i += batchSize) {
    out.push(items.slice(i, i + batchSize));
  }
  return out;
}

async function runMapStage({ batches, query, model, onProgress }) {
  const partials = new Array(batches.length).fill(null);
  let cursor = 0;
  let completed = 0;

  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= batches.length) return;
      try {
        const text = await runMapBatch({ batch: batches[index], query, model, batchIndex: index });
        partials[index] = { batchIndex: index, text };
      } catch (err) {
        partials[index] = { batchIndex: index, text: "", error: err.message };
        console.warn(`[mapReduce] map batch ${index + 1}/${batches.length} 실패: ${err.message}`);
      } finally {
        completed += 1;
        onProgress({
          stage: "map",
          current: completed,
          total: batches.length,
          message: `Map 단계 진행 ${completed}/${batches.length}`
        });
      }
    }
  }

  const workers = Array.from({ length: Math.min(PARALLELISM, batches.length) }, () => worker());
  await Promise.all(workers);
  return partials;
}

async function runMapBatch({ batch, query, model, batchIndex }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MAP_TIMEOUT_MS);
  try {
    const chunkBlock = batch.map((chunk, localIndex) => {
      const locator = formatChunkLocator(chunk);
      const header = locator ? `청크 ${batchIndex + 1}.${localIndex + 1} (${locator})` : `청크 ${batchIndex + 1}.${localIndex + 1}`;
      return `[${header}]\n${chunk.text}`;
    }).join("\n\n");

    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          {
            role: "system",
            content: [
              "너는 긴 문서를 부분별로 분석해 핵심을 정리하는 한국어 분석가다.",
              "사용자 질문에 답하는 데 필요한 사실, 수치, 인물, 결정, 일정, 쟁점을 이 청크들에서만 추출해라.",
              "추출할 게 없으면 '관련 정보 없음'이라고만 답해라.",
              "답변은 한국어 평문 단락 또는 짧은 불릿 목록(- 형식)으로 작성. 마크다운 제목/굵게는 사용 금지.",
              "각 사실 뒤에는 가능하면 청크 번호 (예: [청크 3.2])를 붙여 출처를 명시.",
              "본문에 없는 사실을 추측·일반화해 추가하지 마라.",
              `한 응답은 ${MAP_PARTIAL_MAX_CHARS}자 이내로 압축.`
            ].join("\n")
          },
          {
            role: "user",
            content: [
              `사용자 질문: ${query}`,
              "",
              "분석 대상 청크들:",
              chunkBlock,
              "",
              "위 청크들에서 사용자 질문과 관련된 사실/근거만 추출해 정리하세요."
            ].join("\n")
          }
        ],
        options: { temperature: 0.2, top_p: 0.9 }
      })
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`Ollama ${response.status} ${errText}`.trim());
    }
    const payload = await response.json();
    const text = String(payload.message?.content ?? "").trim().slice(0, MAP_PARTIAL_MAX_CHARS);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function runReduceStream({ partials, query, model, systemDirective, onChunk }) {
  const block = partials.map((p, i) => `[부분 결과 ${i + 1}]\n${p.text}`).join("\n\n");
  const systemParts = [
    "너는 Map 단계의 부분 분석 결과들을 사용자 질문에 답하는 하나의 한국어 응답으로 통합하는 분석가다.",
    "응답은 사용자 질문에 직접 답하는 형태로 작성. 일반 문장과 짧은 단락 위주로 구성.",
    "여러 항목을 비교할 때는 마크다운 표(| 헤더 | … |)를 사용해도 좋다. 표 외 마크다운 제목·굵게·코드블록은 사용 금지.",
    "본문에 명시된 사실만 사용. 부분 결과들 사이에 충돌이 있으면 충돌을 그대로 노출하라.",
    "부분 결과 어디에서도 답을 찾을 수 없으면 '제공된 자료에서는 해당 질문의 답을 찾을 수 없습니다.'라고만 답해라.",
    "출처가 부분 결과에 [청크 N.M]로 표기돼 있으면 최종 답변에도 그대로 인용 가능."
  ];
  const directive = String(systemDirective ?? "").trim();
  if (directive) systemParts.push(directive);

  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: true,
      messages: [
        { role: "system", content: systemParts.join("\n") },
        {
          role: "user",
          content: [
            `사용자 질문: ${query}`,
            "",
            "Map 단계 부분 결과들:",
            block,
            "",
            "위 부분 결과들을 통합해 사용자 질문에 답하세요."
          ].join("\n")
        }
      ],
      options: { temperature: 0.3, top_p: 0.9 }
    })
  });

  if (!response.ok || !response.body) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Reduce 단계 실패: Ollama ${response.status} ${errText}`.trim());
  }

  const decoder = new TextDecoder();
  let buffer = "";
  for await (const raw of response.body) {
    buffer += decoder.decode(raw, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      const content = event.message?.content ?? "";
      if (content) onChunk(content);
      if (event.done) return;
    }
  }
}

function formatChunkLocator(chunk) {
  const parts = [];
  if (chunk.documentName) parts.push(chunk.documentName);
  if (chunk.locator) parts.push(chunk.locator);
  else if (chunk.page != null) parts.push(`${chunk.page}쪽`);
  return parts.join(" · ");
}

export const MAP_REDUCE_BATCH_CHUNKS = BATCH_CHUNKS;
export const MAP_REDUCE_MAX_CHUNKS = MAX_CHUNKS;
export const MAP_REDUCE_PARALLELISM = PARALLELISM;
