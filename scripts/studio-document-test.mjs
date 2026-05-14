// Smoke test for the Studio Document Phase A backend.
// Runs the router directly via express + a real HTTP listener on a free port.
// LLM calls are forced into the fallback path by pointing OLLAMA_URL at :1
// so this script needs no model server.

import express from "express";
import http from "node:http";

process.env.OLLAMA_URL = "http://127.0.0.1:1";

const { studioDocumentRouter } = await import("../server/studioDocument/studioDocumentApi.js");

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use("/api/studio/document", studioDocumentRouter);

const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const base = `http://127.0.0.1:${port}/api/studio/document`;

let failures = 0;

async function check(label, fn) {
  try {
    await fn();
    console.log(`  PASS  ${label}`);
  } catch (error) {
    failures += 1;
    console.log(`  FAIL  ${label} — ${error.message}`);
  }
}

async function asJson(response) {
  const text = await response.text();
  try { return { response, body: JSON.parse(text) }; } catch { return { response, body: text }; }
}

console.log("Studio Document API smoke");

await check("visual markdown parser supports headings, lists, checklists, and tables", async () => {
  const { parseMarkdownToVisualBlocks } = await import("../public/modules/documentStudioMarkdown.js");
  const blocks = parseMarkdownToVisualBlocks([
    "# Review plan",
    "",
    "Opening paragraph.",
    "",
    "- Alpha",
    "- Beta",
    "",
    "1. First",
    "2. Second",
    "",
    "- [x] Done",
    "- [ ] Todo",
    "",
    "| Name | Status |",
    "| --- | --- |",
    "| A | Ready |",
    "",
    "```js",
    "console.log('raw');",
    "```"
  ].join("\n"));
  const types = blocks.map((block) => block.type);
  const expectedTypes = ["heading", "paragraph", "bullet_list", "numbered_list", "checklist", "table", "raw"];
  if (JSON.stringify(types) !== JSON.stringify(expectedTypes)) {
    throw new Error(`types mismatch: ${types.join(",")}`);
  }
  if (blocks[0].level !== 1 || blocks[0].text !== "Review plan") throw new Error("heading mismatch");
  if (blocks[2].items?.[1]?.text !== "Beta") throw new Error("bullet item mismatch");
  if (blocks[4].items?.[0]?.checked !== true || blocks[4].items?.[1]?.checked !== false) throw new Error("checklist state mismatch");
  if (blocks[5].headers?.[1] !== "Status" || blocks[5].rows?.[0]?.[1] !== "Ready") throw new Error("table mismatch");
  if (!blocks[6].markdown.includes("console.log")) throw new Error("raw block not preserved");
});

await check("visual markdown serializer preserves edits and raw fallback blocks", async () => {
  const { serializeVisualBlocksToMarkdown } = await import("../public/modules/documentStudioMarkdown.js");
  const markdown = serializeVisualBlocksToMarkdown([
    { type: "heading", level: 2, text: "Edited" },
    { type: "paragraph", text: "Body" },
    { type: "checklist", items: [{ text: "Confirm", checked: true }] },
    { type: "table", headers: ["A", "B"], rows: [["1", "2"]] },
    { type: "raw", markdown: "```txt\nunchanged\n```" }
  ]);
  for (const needle of [
    "## Edited",
    "Body",
    "- [x] Confirm",
    "| A | B |",
    "| 1 | 2 |",
    "```txt\nunchanged\n```"
  ]) {
    if (!markdown.includes(needle)) throw new Error(`missing ${needle}`);
  }
});

await check("GET /templates returns 5 built-in templates", async () => {
  const { response, body } = await asJson(await fetch(`${base}/templates`));
  if (!response.ok) throw new Error(`status ${response.status}`);
  if (!body.ok) throw new Error("ok false");
  if (!Array.isArray(body.templates) || body.templates.length !== 5) {
    throw new Error(`expected 5 templates, got ${body.templates?.length}`);
  }
  const ids = body.templates.map((t) => t.id).sort();
  const want = ["audit_checklist", "daily_report", "meeting_minutes", "planning_proposal", "review_report"];
  if (JSON.stringify(ids) !== JSON.stringify(want)) {
    throw new Error(`ids mismatch: ${ids.join(",")}`);
  }
  if (body.defaults?.compliance !== "review_report") throw new Error("missing compliance default");
});

await check("POST /from-answer rejects empty answer", async () => {
  const res = await fetch(`${base}/from-answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answerMarkdown: "   ", templateId: "review_report" })
  });
  if (res.status !== 400) throw new Error(`expected 400, got ${res.status}`);
});

await check("POST /from-answer falls back when LLM is unreachable", async () => {
  const { response, body } = await asJson(await fetch(`${base}/from-answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "테스트 문서",
      answerMarkdown: "# 결과\n[N1] 과 [L1] 을 참조한다.",
      templateId: "review_report",
      metadata: { compliance: { type: "legal_review" } }
    })
  }));
  if (!response.ok) throw new Error(`status ${response.status}`);
  if (!body.ok) throw new Error("ok false");
  if (body.document?.templateId !== "review_report") throw new Error("templateId mismatch");
  if (!body.document.blocks.length) throw new Error("no blocks");
  if (!body.warnings.some((w) => w?.code === "model_fallback")) throw new Error("missing model_fallback warning");
  const reason = body.warnings.find((w) => w?.code === "model_fallback")?.message || "";
  if (!/Ollama|연결|연결할 수|fetch/i.test(reason)) throw new Error(`unexpected reason: ${reason}`);
});

await check("POST /from-answer auto-picks review_report for compliance metadata", async () => {
  const { body } = await asJson(await fetch(`${base}/from-answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      answerMarkdown: "검토 결과 [N1] 보완 필요.",
      metadata: { compliance: { type: "legal_review" } }
    })
  }));
  if (body.templateId !== "review_report") throw new Error(`got ${body.templateId}`);
});

const exportDoc = {
  title: "수출 테스트",
  templateId: "review_report",
  blocks: [
    { type: "heading", level: 1, text: "1. 검토 개요" },
    { type: "paragraph", text: "본 문서는 [N1] 을 검토한다." },
    { type: "table", columns: ["항목","내용","근거"], rows: [["위탁","보완 필요","[N1]"]] },
    { type: "checklist", items: [{ text: "재위탁 승인", checked: false }] }
  ],
  citations: { notebook: [{ marker: "[N1]", label: "프로젝트 문서" }] }
};

for (const format of ["md", "docx", "hwpx", "pdf"]) {
  await check(`POST /export → ${format.toUpperCase()} produces a non-empty binary`, async () => {
    const res = await fetch(`${base}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format, document: exportDoc, options: { includeCitations: true } })
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`status ${res.status} — ${text.slice(0, 120)}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100) throw new Error(`buffer too small: ${buf.length}`);
    const disposition = res.headers.get("content-disposition") || "";
    if (!disposition.includes(`.${format}`)) throw new Error(`bad disposition: ${disposition}`);
  });
}

await check("POST /export rejects empty document", async () => {
  const res = await fetch(`${base}/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ format: "md", document: { title: "x", blocks: [] } })
  });
  if (res.status !== 400) throw new Error(`expected 400, got ${res.status}`);
});

await check("POST /export rejects unsupported format", async () => {
  const res = await fetch(`${base}/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ format: "xyz", document: exportDoc })
  });
  if (res.status !== 400) throw new Error(`expected 400, got ${res.status}`);
});

await check("POST /from-answer returns body-only markdown", async () => {
  const { body } = await asJson(await fetch(`${base}/from-answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "마크다운 직출력",
      answerMarkdown: "테스트 답변 [N1]",
      templateId: "review_report"
    })
  }));
  if (typeof body.markdown !== "string") throw new Error("markdown field missing");
  if (body.markdown.startsWith("# ")) throw new Error("body markdown should NOT include title");
  if (!body.markdown.length) throw new Error("markdown is empty");
});

await check("POST /export accepts markdown directly and includes title", async () => {
  const res = await fetch(`${base}/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      format: "md",
      document: {
        title: "직접 마크다운 테스트",
        markdown: "## 1. 개요\n\n본문 내용입니다.\n\n## 2. 결론\n\n끝.",
        citations: { law: [{ marker: "[L1]", label: "테스트 법령 제1조" }] }
      },
      options: { includeCitations: true }
    })
  });
  if (!res.ok) throw new Error(`status ${res.status}`);
  const text = await res.text();
  if (!text.includes("# 직접 마크다운 테스트")) throw new Error("title not prepended");
  if (!text.includes("## 1. 개요")) throw new Error("body markdown missing");
  if (!text.includes("[L1]") || !text.includes("출처")) throw new Error("citations section missing");
});

await check("documentModel drops unsupported block types via /export normalization", async () => {
  const docWithBogus = {
    title: "필터 테스트",
    blocks: [
      { type: "heading", level: 1, text: "헤딩" },
      { type: "bogus_type", text: "should be dropped" },
      { type: "paragraph", text: "본문" }
    ]
  };
  const res = await fetch(`${base}/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ format: "md", document: docWithBogus })
  });
  if (!res.ok) throw new Error(`status ${res.status}`);
  const text = await res.text();
  if (text.includes("should be dropped")) throw new Error("unsupported block leaked into export");
  if (!text.includes("헤딩")) throw new Error("supported heading missing");
});

server.close();

if (failures) {
  console.log(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll smoke tests passed.");
