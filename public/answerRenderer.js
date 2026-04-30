const SECTION_LABELS = new Set([
  "summary",
  "key points",
  "evidence",
  "caution",
  "next steps",
  "note",
  "notes",
  "요약",
  "핵심",
  "핵심 내용",
  "근거",
  "주의",
  "주의점",
  "다음 단계",
  "확인한 내용",
  "결론"
]);

export function renderAssistantAnswer(container, rawText) {
  container.innerHTML = "";
  const blocks = parseAnswerBlocks(rawText);

  if (!blocks.length) {
    container.textContent = rawText;
    return;
  }

  for (const block of blocks) {
    if (block.type === "section") {
      container.append(createSectionTitle(block.text));
      continue;
    }

    if (block.type === "list") {
      container.append(createList(block.items, block.ordered));
      continue;
    }

    if (block.type === "table") {
      container.append(createTable(block.rows));
      continue;
    }

    const paragraph = document.createElement("p");
    paragraph.textContent = cleanPlainText(block.text);
    container.append(paragraph);
  }
}

export function parseAnswerBlocks(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const blocks = [];
  let paragraph = [];
  let index = 0;

  while (index < lines.length) {
    if (isMarkdownTableStart(lines, index)) {
      flushParagraph();
      const tableLines = [];
      while (index < lines.length && isTableLine(lines[index])) {
        tableLines.push(lines[index]);
        index += 1;
      }
      blocks.push({ type: "table", rows: parseTableRows(tableLines) });
      continue;
    }

    const listItem = parseListItem(lines[index]);
    if (listItem) {
      flushParagraph();
      const ordered = listItem.ordered;
      const items = [];

      while (index < lines.length) {
        const nextItem = parseListItem(lines[index]);
        if (!nextItem || nextItem.ordered !== ordered) break;
        items.push(nextItem.text);
        index += 1;
      }

      blocks.push({ type: "list", ordered, items });
      continue;
    }

    const line = lines[index];
    if (!line.trim()) {
      flushParagraph();
      index += 1;
      continue;
    }

    if (!paragraph.length && isSectionLabel(line, lines[index + 1])) {
      blocks.push({ type: "section", text: cleanSectionLabel(line) });
    } else {
      paragraph.push(line);
    }

    index += 1;
  }

  flushParagraph();
  return blocks;

  function flushParagraph() {
    if (!paragraph.length) return;
    blocks.push({ type: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  }
}

function parseListItem(line = "") {
  const match = line.match(/^\s*(?:([-*•])|(\d+)[.)]|(->|※))\s+(.+)$/);
  if (!match) return null;
  return {
    ordered: Boolean(match[2]),
    text: cleanPlainText(match[4])
  };
}

function isSectionLabel(line = "", nextLine = "") {
  const label = cleanSectionLabel(line);
  if (!label || label.length > 36) return false;
  if (/[.!?。？！]$/.test(label)) return false;
  if (parseListItem(line) || isTableLine(line)) return false;

  const normalized = label.toLowerCase();
  if (SECTION_LABELS.has(normalized)) return true;
  if (/[:：]$/.test(line.trim())) return true;

  return Boolean(nextLine?.trim()) && !line.includes(",") && !line.includes(".");
}

function cleanSectionLabel(line = "") {
  return cleanPlainText(line)
    .replace(/^[◆◇◈■□▣▪▫●○◯◎▶▷►▸★☆※→⇒✓✔✗❖]+\s*/, "")
    .replace(/[:：]\s*$/, "")
    .trim();
}

function createSectionTitle(text) {
  const title = document.createElement("div");
  title.className = "answer-section-title";

  const symbol = document.createElement("span");
  symbol.className = "answer-section-symbol";
  symbol.setAttribute("aria-hidden", "true");
  symbol.textContent = getSectionSymbol(text);

  const label = document.createElement("span");
  label.textContent = text;

  title.append(symbol, label);
  return title;
}

function getSectionSymbol(text = "") {
  const normalized = text.toLowerCase();
  if (matchesAny(normalized, ["caution", "warning", "주의"])) return "※";
  if (matchesAny(normalized, ["next", "step", "다음"])) return "→";
  if (matchesAny(normalized, ["evidence", "근거", "확인"])) return "✓";
  if (matchesAny(normalized, ["key", "핵심"])) return "●";
  if (matchesAny(normalized, ["note", "참고"])) return "◇";
  return "◆";
}

function matchesAny(value, needles) {
  return needles.some((needle) => value.includes(needle));
}

function createList(items, ordered) {
  const list = document.createElement(ordered ? "ol" : "ul");
  list.className = "answer-list";

  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = item;
    list.append(li);
  }

  return list;
}

function isMarkdownTableStart(lines, index) {
  return isTableLine(lines[index]) && isTableSeparator(lines[index + 1]);
}

function isTableLine(line = "") {
  return line.trim().startsWith("|") && line.trim().endsWith("|");
}

function isTableSeparator(line = "") {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function parseTableRows(lines) {
  return lines
    .filter((line) => !isTableSeparator(line))
    .map((line) =>
      line
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cleanPlainText(cell.trim()))
    );
}

function createTable(rows) {
  const wrapper = document.createElement("div");
  wrapper.className = "table-wrap";

  const table = document.createElement("table");
  const [headerRow, ...bodyRows] = rows;

  if (headerRow) {
    const thead = document.createElement("thead");
    const tr = document.createElement("tr");
    for (const cell of headerRow) {
      const th = document.createElement("th");
      th.textContent = cell;
      tr.append(th);
    }
    thead.append(tr);
    table.append(thead);
  }

  const tbody = document.createElement("tbody");
  for (const row of bodyRows) {
    const tr = document.createElement("tr");
    for (const cell of row) {
      const td = document.createElement("td");
      td.textContent = cell;
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(tbody);
  wrapper.append(table);
  return wrapper;
}

function cleanPlainText(text) {
  return String(text ?? "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+•]\s+/gm, "")
    .replace(/^\s*(?:\d+[.)]|->|※)\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/_(.*?)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}
