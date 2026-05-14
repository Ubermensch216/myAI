const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;
const CHECKLIST_RE = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/;
const BULLET_RE = /^\s*[-*+]\s+(?!\[[ xX]\]\s)(.*)$/;
const NUMBERED_RE = /^\s*\d+[.)]\s+(.*)$/;
const FENCE_RE = /^\s*```/;

export function parseMarkdownToVisualBlocks(markdown) {
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    if (!lines[i].trim()) {
      i += 1;
      continue;
    }

    if (FENCE_RE.test(lines[i])) {
      const start = i;
      i += 1;
      while (i < lines.length && !FENCE_RE.test(lines[i])) i += 1;
      if (i < lines.length) i += 1;
      blocks.push({ type: "raw", markdown: lines.slice(start, i).join("\n") });
      continue;
    }

    const heading = HEADING_RE.exec(lines[i]);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] });
      i += 1;
      continue;
    }

    if (isTableStart(lines, i)) {
      const parsed = readTable(lines, i);
      blocks.push(parsed.block);
      i = parsed.next;
      continue;
    }

    const checklist = CHECKLIST_RE.exec(lines[i]);
    if (checklist) {
      const items = [];
      while (i < lines.length) {
        const match = CHECKLIST_RE.exec(lines[i]);
        if (!match) break;
        items.push({ checked: match[1].toLowerCase() === "x", text: match[2] });
        i += 1;
      }
      blocks.push({ type: "checklist", items });
      continue;
    }

    const bullet = BULLET_RE.exec(lines[i]);
    if (bullet) {
      const items = [];
      while (i < lines.length) {
        const match = BULLET_RE.exec(lines[i]);
        if (!match) break;
        items.push({ text: match[1] });
        i += 1;
      }
      blocks.push({ type: "bullet_list", items });
      continue;
    }

    const numbered = NUMBERED_RE.exec(lines[i]);
    if (numbered) {
      const items = [];
      while (i < lines.length) {
        const match = NUMBERED_RE.exec(lines[i]);
        if (!match) break;
        items.push({ text: match[1] });
        i += 1;
      }
      blocks.push({ type: "numbered_list", items });
      continue;
    }

    if (isUnsupportedStart(lines[i])) {
      const start = i;
      i += 1;
      while (i < lines.length && lines[i].trim()) i += 1;
      blocks.push({ type: "raw", markdown: lines.slice(start, i).join("\n") });
      continue;
    }

    const paragraph = [];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines, i)) {
      paragraph.push(lines[i]);
      i += 1;
    }
    if (paragraph.length) {
      blocks.push({ type: "paragraph", text: paragraph.join("\n") });
    }
  }

  return blocks;
}

export function serializeVisualBlocksToMarkdown(blocks) {
  const out = [];
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "heading") {
      const level = clampLevel(block.level);
      out.push(`${"#".repeat(level)} ${String(block.text || "").trim()}`);
    } else if (block.type === "paragraph") {
      const text = String(block.text || "").trim();
      if (text) out.push(text);
    } else if (block.type === "bullet_list") {
      const items = listItems(block);
      if (items.length) out.push(items.map((item) => `- ${item.text}`).join("\n"));
    } else if (block.type === "numbered_list") {
      const items = listItems(block);
      if (items.length) out.push(items.map((item, index) => `${index + 1}. ${item.text}`).join("\n"));
    } else if (block.type === "checklist") {
      const items = listItems(block);
      if (items.length) {
        out.push(items.map((item) => `- [${item.checked ? "x" : " "}] ${item.text}`).join("\n"));
      }
    } else if (block.type === "table") {
      const headers = tableCells(block.headers);
      if (headers.length) {
        const rows = Array.isArray(block.rows) ? block.rows : [];
        out.push([
          `| ${headers.map(escapePipe).join(" | ")} |`,
          `| ${headers.map(() => "---").join(" | ")} |`,
          ...rows.map((row) => `| ${headers.map((_, index) => escapePipe(String(row?.[index] ?? ""))).join(" | ")} |`)
        ].join("\n"));
      }
    } else if (block.type === "raw") {
      const raw = String(block.markdown || "").trim();
      if (raw) out.push(raw);
    }
  }
  return out.join("\n\n").trim();
}

function isBlockStart(lines, index) {
  return HEADING_RE.test(lines[index])
    || FENCE_RE.test(lines[index])
    || isTableStart(lines, index)
    || CHECKLIST_RE.test(lines[index])
    || BULLET_RE.test(lines[index])
    || NUMBERED_RE.test(lines[index])
    || isUnsupportedStart(lines[index]);
}

function isUnsupportedStart(line) {
  return /^\s*(>|-{3,}|\*{3,}|#{1,6}\s*$)/.test(line);
}

function isTableStart(lines, index) {
  return isPipeRow(lines[index]) && isDividerRow(lines[index + 1] || "");
}

function readTable(lines, index) {
  const headers = parsePipeRow(lines[index]);
  let next = index + 2;
  const rows = [];
  while (next < lines.length && isPipeRow(lines[next])) {
    rows.push(parsePipeRow(lines[next]));
    next += 1;
  }
  return { block: { type: "table", headers, rows }, next };
}

function isPipeRow(line) {
  return typeof line === "string" && line.includes("|") && parsePipeRow(line).length > 1;
}

function isDividerRow(line) {
  const cells = parsePipeRow(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function parsePipeRow(line) {
  return String(line || "")
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function clampLevel(level) {
  return Math.min(6, Math.max(1, Number(level) || 1));
}

function listItems(block) {
  return (Array.isArray(block.items) ? block.items : [])
    .map((item) => ({
      text: String(item?.text || "").trim(),
      checked: Boolean(item?.checked)
    }))
    .filter((item) => item.text);
}

function tableCells(cells) {
  return (Array.isArray(cells) ? cells : [])
    .map((cell) => String(cell || "").trim())
    .filter(Boolean);
}

function escapePipe(value) {
  return String(value || "").replace(/\|/g, "\\|");
}
