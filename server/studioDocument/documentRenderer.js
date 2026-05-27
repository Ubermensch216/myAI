// Render a Studio Document model into Markdown text suitable for the existing
// exporter (server/exportFiles.js). Tables are emitted as GFM pipe tables —
// the DOCX/HWPX/PDF code in exportFiles.js already parses those.

const CITATION_GROUPS = [
  { key: "notebook", label: "내부 문서/지식팩" },
  { key: "law", label: "법령" },
  { key: "precedent", label: "판례" },
  { key: "interpretation", label: "해석례" },
  { key: "adminRule", label: "행정규칙" },
  { key: "ordinance", label: "자치법규" },
  { key: "web", label: "웹" }
];

export function renderDocumentToMarkdown(doc, options = {}) {
  const { includeTitle = true, includeCitations = true, includeGeneratedAt = false } = options;
  if (!doc || typeof doc !== "object") return "";

  const lines = [];
  if (includeTitle) {
    const title = String(doc.title || "").trim();
    if (title) {
      lines.push(`# ${title}`);
      lines.push("");
    }
  }

  for (const block of Array.isArray(doc.blocks) ? doc.blocks : []) {
    const rendered = renderBlock(block);
    if (rendered === null) continue;
    lines.push(rendered);
    lines.push("");
  }

  if (includeCitations) {
    const citationsBlock = renderCitations(doc.citations);
    if (citationsBlock) {
      lines.push(citationsBlock);
      lines.push("");
    }
  }

  if (includeGeneratedAt) {
    const stamp = new Date().toISOString().replace("T", " ").slice(0, 16);
    lines.push(`> 생성: ${stamp}`);
    lines.push("");
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

export function renderCitationsSection(citations) {
  return renderCitations(citations);
}

function renderBlock(block) {
  if (!block || typeof block !== "object") return null;
  switch (block.type) {
    case "heading": {
      const level = clamp(block.level, 1, 6);
      const hashes = "#".repeat(level + 1); // doc title is H1, headings start at H2
      return `${hashes} ${block.text}`;
    }
    case "paragraph":
      return String(block.text || "");
    case "quote":
      return String(block.text || "")
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    case "bullet_list":
      return (block.items || []).map((item) => `- ${item}`).join("\n");
    case "numbered_list":
      return (block.items || []).map((item, i) => `${i + 1}. ${item}`).join("\n");
    case "checklist":
      return (block.items || [])
        .map((item) => `- [${item.checked ? "x" : " "}] ${item.text}`)
        .join("\n");
    case "table":
      return renderTable(block);
    case "source_list":
      return (block.items || []).map((item) => `- ${item}`).join("\n");
    case "spacer":
      return "";
    default:
      return null;
  }
}

function renderTable(block) {
  const columns = Array.isArray(block.columns) ? block.columns : [];
  if (!columns.length) return null;
  const header = `| ${columns.map(cellEscape).join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  const rows = Array.isArray(block.rows) ? block.rows : [];
  const body = rows.map((row) => {
    const cells = columns.map((_, i) => cellEscape(row[i] ?? ""));
    return `| ${cells.join(" | ")} |`;
  });
  return [header, divider, ...body].join("\n");
}

function cellEscape(value) {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

function renderCitations(citations) {
  if (!citations || typeof citations !== "object") return "";
  const sections = [];
  for (const { key, label } of CITATION_GROUPS) {
    const items = Array.isArray(citations[key]) ? citations[key] : [];
    if (!items.length) continue;
    const lines = [`### ${label}`];
    for (const item of items) {
      const marker = item.marker ? `${item.marker} ` : "";
      const text = item.label || item.text || "";
      const url = item.url ? ` (${item.url})` : "";
      lines.push(`${marker}${text}${url}`.trim());
    }
    sections.push(lines.join("\n"));
  }
  if (!sections.length) return "";
  return ["## 출처", "", sections.join("\n\n")].join("\n");
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}
