const CODE_COPY_RESET_MS = 900;

const SECTION_LABELS = new Set([
  "summary",
  "key points",
  "details",
  "evidence",
  "caution",
  "warning",
  "next steps",
  "note",
  "notes",
  "핵심 요약",
  "요약",
  "핵심",
  "핵심 내용",
  "주요 근거",
  "근거",
  "세부 내용",
  "상세 내용",
  "주의사항",
  "주의",
  "주의점",
  "다음 단계",
  "확인한 내용",
  "결론"
]);

export function renderAssistantAnswer(container, rawText, citations = []) {
  container.innerHTML = "";
  const { progress, errors, remaining } = extractProgressLines(rawText);
  const answerText = remaining.join("\n");
  const hasAnswer = answerText.trim().length > 0;

  if (progress.length || errors.length) {
    container.append(createProgressPanel(progress, { collapsed: hasAnswer, errors }));
    container.classList.add("has-progress-panel");
  } else {
    container.classList.remove("has-progress-panel");
  }

  const blocks = parseAnswerBlocks(answerText);
  container.classList.toggle("has-code-block", blocks.some((block) => block.type === "code"));

  if (!blocks.length) {
    container.classList.remove("has-code-block");
    if (!progress.length) container.textContent = rawText;
    return;
  }

  for (const block of blocks) {
    if (block.type === "section") {
      container.append(createSectionTitle(block.text));
      continue;
    }

    if (block.type === "list") {
      container.append(createList(block.items, block.ordered, block.startNumber, citations));
      continue;
    }

    if (block.type === "table") {
      container.append(createTable(block.rows, citations));
      continue;
    }

    if (block.type === "code") {
      container.append(createCodeBlock(block.code, block.language));
      continue;
    }

    const paragraph = document.createElement("p");
    renderTextWithCitations(cleanPlainText(block.text), paragraph, citations);
    container.append(paragraph);
  }
}

function extractProgressLines(rawText) {
  const lines = String(rawText ?? "").split(/\r?\n/);
  const progress = [];
  const remaining = [];
  const errors = [];
  const reProgress = /^\[분석 진행\]\s*(.*)$/;
  const reError = /^\[오류\]\s*(.*)$/;

  for (const line of lines) {
    const m = line.match(reProgress);
    if (m) { progress.push(m[1]); continue; }
    remaining.push(line);
  }

  if (progress.length) {
    const filtered = [];
    for (const line of remaining) {
      const em = line.match(reError);
      if (em) errors.push(em[1]);
      else filtered.push(line);
    }
    remaining.length = 0;
    remaining.push(...filtered);
  }

  while (remaining.length && !remaining[0].trim()) remaining.shift();
  return { progress, errors, remaining };
}

function createProgressPanel(steps, { collapsed, errors = [] }) {
  const details = document.createElement("details");
  details.className = "answer-progress-panel";
  const hasError = errors.length > 0;
  if (hasError) {
    details.classList.add("has-error");
    details.open = true;
  } else if (collapsed) {
    details.classList.add("is-historical");
  } else {
    details.open = true;
  }

  const summary = document.createElement("summary");
  summary.className = "answer-progress-summary";
  summary.textContent = hasError
    ? `정밀 분석 실패 · ${steps.length}단계 진행됨`
    : collapsed
      ? `정밀 분석 과정 ${steps.length}단계 (완료)`
      : `정밀 분석 진행 중 · ${steps.length}단계`;
  details.append(summary);

  if (steps.length) {
    const list = document.createElement("ol");
    list.className = "answer-progress-list";
    for (const step of steps) {
      const li = document.createElement("li");
      li.textContent = step;
      list.append(li);
    }
    details.append(list);
  }

  if (hasError) {
    const errorBox = document.createElement("div");
    errorBox.className = "answer-progress-error";
    for (const err of errors) {
      const p = document.createElement("p");
      p.textContent = `[오류] ${err}`;
      errorBox.append(p);
    }
    details.append(errorBox);
  }

  return details;
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
      const startNumber = listItem.startNumber;
      const items = [];

      while (index < lines.length) {
        const nextItem = parseListItem(lines[index]);
        if (!nextItem || nextItem.ordered !== ordered) break;
        items.push(nextItem.text);
        index += 1;
      }

      blocks.push({ type: "list", ordered, items, startNumber });
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
  renumberOutlineOrderedLists(blocks);
  return blocks;

  function flushParagraph() {
    if (!paragraph.length) return;
    blocks.push({ type: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  }
}

function renumberOutlineOrderedLists(blocks) {
  const orderedBlocks = blocks.filter((b) => b.type === "list" && b.ordered);
  if (orderedBlocks.length < 2) return;
  const isOutlinePattern = orderedBlocks.every(
    (b) => b.startNumber === 1 && Array.isArray(b.items) && b.items.length === 1
  );
  if (!isOutlinePattern) return;
  let counter = 1;
  for (const block of orderedBlocks) {
    block.startNumber = counter;
    counter += block.items.length;
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
    startNumber: match[2] ? Number(match[2]) : null,
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
  return "•";
}

function createList(items, ordered, startNumber, citations) {
  const list = document.createElement(ordered ? "ol" : "ul");
  list.className = "answer-list";
  if (ordered && Number.isInteger(startNumber) && startNumber > 1) {
    list.setAttribute("start", String(startNumber));
  }

  for (const item of items) {
    const li = document.createElement("li");
    renderTextWithCitations(item, li, citations);
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

function createTable(rows, citations) {
  const wrapper = document.createElement("div");
  wrapper.className = "table-wrap";

  const table = document.createElement("table");
  const [headerRow, ...bodyRows] = rows;

  if (headerRow) {
    const thead = document.createElement("thead");
    const tr = document.createElement("tr");
    for (const cell of headerRow) {
      const th = document.createElement("th");
      renderTextWithCitations(cell, th, citations);
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
      renderTextWithCitations(cell, td, citations);
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(tbody);
  wrapper.append(table);
  return wrapper;
}

const EMOJI_STRIP_RE = /[\p{Emoji_Presentation}\p{Emoji_Modifier}️]/gu;

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
    .replace(EMOJI_STRIP_RE, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

const CITATION_BRACKET_REGEX = /(\[(?:(?:청크\s+)?\d+(?:\.\d+)?|[a-zA-Z]+-?[a-zA-Z]*\d+)(?:\s*,\s*(?:(?:청크\s+)?\d+(?:\.\d+)?|[a-zA-Z]+-?[a-zA-Z]*\d+))*\])/g;

function buildCitationButtons(bracketContent, citations) {
  const citStrings = bracketContent.split(",");
  const result = [];
  citStrings.forEach((citStr, idx) => {
    if (idx > 0) result.push(document.createTextNode(" "));
    const trimmed = citStr.trim();
    const displayText = trimmed.replace(/^청크\s+/, "");
    const normalize = (id) => String(id || "").replace(/^청크\s+/, "").trim().toLowerCase();
    const normKey = normalize(trimmed);
    const citation = citations.find(c => {
      const cid = String(c.citationId || c.id || "").trim();
      return normalize(cid) === normKey;
    });
    if (citation) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "inline-citation-btn";
      btn.textContent = displayText;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        showCitationPopup(citation, btn);
      });
      result.push(btn);
    } else {
      result.push(document.createTextNode(displayText));
    }
  });
  return result;
}

function renderTextWithCitations(text, parentElement, citations) {
  parentElement.innerHTML = "";
  if (!text) return;

  if (!Array.isArray(citations) || !citations.length) {
    parentElement.textContent = text;
    return;
  }

  // Split on citation brackets, then re-assemble moving them after a preceding period.
  // Pattern: "...text. [N.M]" → "...text. N.M" or "...text [N.M]." → "...text. N.M"
  const parts = text.split(CITATION_BRACKET_REGEX);

  // Collect segments: { type: 'text'|'citation', value }
  const segments = parts.map(p => {
    if (p.startsWith("[") && p.endsWith("]")) {
      return { type: "citation", value: p.slice(1, -1) };
    }
    return { type: "text", value: p };
  });

  // Move any citation immediately before a period to after the period.
  // E.g. "some text [1.2]." → rebuild so period comes first, then citation.
  const reordered = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.type === "citation") {
      const next = segments[i + 1];
      if (next && next.type === "text" && next.value.startsWith(".")) {
        // Emit the period, then citation with a space before it
        reordered.push({ type: "text", value: "." });
        reordered.push({ type: "citation", value: seg.value });
        segments[i + 1] = { type: "text", value: next.value.slice(1) };
      } else {
        reordered.push(seg);
      }
    } else {
      // Check if this text ends with '.' and next is citation — reorder
      if (seg.type === "text" && seg.value.endsWith(".")) {
        const next = segments[i + 1];
        if (next && next.type === "citation") {
          // Text without trailing period
          reordered.push({ type: "text", value: seg.value.slice(0, -1) });
          // Period
          reordered.push({ type: "text", value: "." });
          // Citation will be processed next iteration (unchanged)
          reordered.push(next);
          i++; // skip next citation since we've handled it
        } else {
          reordered.push(seg);
        }
      } else {
        reordered.push(seg);
      }
    }
  }

  for (const seg of reordered) {
    if (seg.type === "citation") {
      // Space before citation buttons
      parentElement.appendChild(document.createTextNode(" "));
      const btns = buildCitationButtons(seg.value, citations);
      btns.forEach(b => parentElement.appendChild(b));
    } else {
      if (seg.value) parentElement.appendChild(document.createTextNode(seg.value));
    }
  }
}

let activeCitationPopup = null;

function showCitationPopup(citation, btn) {
  if (activeCitationPopup) {
    activeCitationPopup.remove();
    activeCitationPopup = null;
  }

  const popup = document.createElement("div");
  popup.className = "inline-citation-popup";

  const header = document.createElement("div");
  header.className = "inline-citation-popup-header";

  const title = document.createElement("span");
  title.className = "inline-citation-popup-title";

  let docName = citation.documentName || "출처 파일";
  let locatorText = citation.locator || "";
  if (citation.page != null && !locatorText) {
    locatorText = `${citation.page}쪽`;
  }
  title.textContent = locatorText ? `${docName} (${locatorText})` : docName;

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "inline-citation-popup-close";
  closeBtn.innerHTML = "&times;";
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    popup.remove();
    if (activeCitationPopup === popup) {
      activeCitationPopup = null;
    }
  });

  header.append(title, closeBtn);

  const body = document.createElement("div");
  body.className = "inline-citation-popup-body";

  const content = document.createElement("div");
  content.className = "inline-citation-popup-content";
  content.textContent = citation.excerpt || citation.text || "근거 내용이 존재하지 않습니다.";
  body.append(content);

  popup.append(header, body);
  document.body.appendChild(popup);
  activeCitationPopup = popup;

  const rect = btn.getBoundingClientRect();
  const scrollX = window.scrollX || window.pageXOffset;
  const scrollY = window.scrollY || window.pageYOffset;

  // Let popup size be calculated
  const popupWidth = popup.offsetWidth || 320;
  const popupHeight = popup.offsetHeight || 120;

  let left = rect.left + rect.width / 2 - popupWidth / 2 + scrollX;
  let top = rect.top - popupHeight - 8 + scrollY;

  const padding = 12;
  const viewportWidth = window.innerWidth;

  if (left < padding) {
    left = padding;
  } else if (left + popupWidth > viewportWidth - padding) {
    left = viewportWidth - popupWidth - padding;
  }

  if (rect.top - popupHeight - 8 < padding) {
    top = rect.bottom + 8 + scrollY;
  }

  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;

  const onOutsideClick = (e) => {
    if (!popup.contains(e.target) && e.target !== btn) {
      cleanup();
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      cleanup();
    }
  };

  function cleanup() {
    popup.remove();
    if (activeCitationPopup === popup) {
      activeCitationPopup = null;
    }
    document.removeEventListener("mousedown", onOutsideClick);
    document.removeEventListener("keydown", onKeyDown);
  }

  document.addEventListener("mousedown", onOutsideClick);
  document.addEventListener("keydown", onKeyDown);
}
