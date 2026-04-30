const CODE_COPY_RESET_MS = 900;

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
  container.classList.toggle("has-code-block", blocks.some((block) => block.type === "code"));

  if (!blocks.length) {
    container.classList.remove("has-code-block");
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

    if (block.type === "code") {
      container.append(createCodeBlock(block.code, block.language));
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
    const codeBlock = parseCodeBlock(lines, index);
    if (codeBlock) {
      flushParagraph();
      blocks.push(codeBlock.block);
      index = codeBlock.nextIndex;
      continue;
    }

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

function parseCodeBlock(lines, startIndex) {
  const fence = parseCodeFence(lines[startIndex]);
  if (!fence) return null;

  const codeLines = [];
  let index = startIndex + 1;

  while (index < lines.length) {
    if (isCodeFenceClose(lines[index], fence)) {
      index += 1;
      break;
    }

    codeLines.push(lines[index]);
    index += 1;
  }

  return {
    block: {
      type: "code",
      language: fence.language,
      code: codeLines.join("\n")
    },
    nextIndex: index
  };
}

function parseCodeFence(line = "") {
  const match = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
  if (!match) return null;

  return {
    marker: match[1][0],
    length: match[1].length,
    language: sanitizeCodeLanguage(match[2])
  };
}

function isCodeFenceClose(line = "", fence) {
  const match = line.match(/^\s*(`{3,}|~{3,})\s*$/);
  return Boolean(match && match[1][0] === fence.marker && match[1].length >= fence.length);
}

function sanitizeCodeLanguage(value = "") {
  return String(value ?? "")
    .trim()
    .split(/\s+/)[0]
    .replace(/[^a-zA-Z0-9_+.#-]/g, "")
    .slice(0, 32)
    .toLowerCase();
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

function createCodeBlock(code, language = "") {
  const wrapper = document.createElement("div");
  wrapper.className = "answer-code-block";

  const header = document.createElement("div");
  header.className = "answer-code-header";

  const label = document.createElement("span");
  label.className = "answer-code-language";
  label.textContent = language || "code";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "answer-code-copy";
  button.title = "코드 복사";
  button.setAttribute("aria-label", "코드 복사");
  button.innerHTML = `
    <svg class="copy-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="9" width="10" height="10" rx="2"></rect>
      <path d="M5 15V7a2 2 0 0 1 2-2h8"></path>
    </svg>
    <svg class="check-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="m5 13 4 4L19 7"></path>
    </svg>
  `;
  button.addEventListener("click", async () => {
    await copyTextToClipboard(String(code ?? ""));
    showCodeCopyFeedback(button);
  });

  const pre = document.createElement("pre");
  pre.className = "answer-code-pre";

  const codeElement = document.createElement("code");
  codeElement.textContent = String(code ?? "");
  if (language) codeElement.dataset.language = language;

  pre.append(codeElement);
  header.append(label, button);
  wrapper.append(header, pre);
  return wrapper;
}

function showCodeCopyFeedback(button) {
  button.classList.add("copied");
  clearTimeout(button.copyResetTimer);
  button.copyResetTimer = setTimeout(() => {
    button.classList.remove("copied");
  }, CODE_COPY_RESET_MS);
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (error) {
      // Fall back for older or restricted browser contexts.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
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
