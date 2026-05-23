import { pageSections } from "./documents.js";
import { slidingChunkText } from "./parsers.js";

export const CHUNK_WINDOW_CHARS = Number(process.env.CHUNK_WINDOW_CHARS || process.env.CHUNK_TARGET_CHARS || 1024);
export const CHUNK_OVERLAP_CHARS = Number(process.env.CHUNK_OVERLAP_CHARS || 256);

function normalizeText(text) {
  return String(text ?? "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getOverlapBlocks(text, overlapChars) {
  if (overlapChars <= 0) return "";
  const blocks = text.split(/\n{2,}/);
  const overlap = [];
  let len = 0;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (len + block.length > overlapChars && overlap.length > 0) break;
    overlap.unshift(block);
    len += block.length + 2; // +2 for \n\n
  }
  return overlap.join("\n\n");
}

export function chunkDocumentSections(documentItem, options = {}) {
  const hierarchical = typeof options.hierarchical === "boolean" ? options.hierarchical : false;

  if (hierarchical) {
    const parentWindow = Number(options.windowChars || CHUNK_WINDOW_CHARS);
    const parentOverlap = Number(options.overlapChars || CHUNK_OVERLAP_CHARS);
    const childWindow = Number(options.childWindowChars || process.env.CHILD_CHUNK_WINDOW_CHARS || 256);
    const childOverlap = Number(options.childOverlapChars || process.env.CHILD_CHUNK_OVERLAP_CHARS || 64);

    const parentChunks = [];
    const childChunks = [];

    for (const section of pageSections(documentItem)) {
      if (!section.text) continue;

      const blocks = normalizeText(section.text).split(/\n{2,}/);
      const sectionParents = [];
      let currentParentText = "";

      for (const block of blocks) {
        const isTable = block.trim().startsWith("|");
        const blockLen = block.length;

        if (isTable) {
          if (currentParentText && (currentParentText.length + blockLen > parentWindow)) {
            sectionParents.push(currentParentText.trim());
            currentParentText = "";
          }
          if (blockLen > parentWindow * 0.8) {
            if (currentParentText) {
              sectionParents.push(currentParentText.trim());
              currentParentText = "";
            }
            sectionParents.push(block.trim());
            continue;
          }
        }

        if (currentParentText && (currentParentText.length + blockLen > parentWindow)) {
          sectionParents.push(currentParentText.trim());
          currentParentText = getOverlapBlocks(currentParentText, parentOverlap);
        }

        currentParentText = currentParentText ? `${currentParentText}\n\n${block}` : block;
      }
      if (currentParentText.trim()) {
        sectionParents.push(currentParentText.trim());
      }

      for (const parentText of sectionParents) {
        const parentIndex = parentChunks.length;
        parentChunks.push({
          index: parentIndex,
          text: parentText,
          page: section.page,
          label: section.label || ""
        });

        const childPieces = slidingChunkText(parentText, { windowChars: childWindow, overlapChars: childOverlap });
        childPieces.forEach((piece, partIndex) => {
          childChunks.push({
            index: childChunks.length,
            text: piece,
            parentIndex: parentIndex,
            page: section.page,
            label: section.label || "",
            part: childPieces.length > 1 ? partIndex + 1 : null,
            partTotal: childPieces.length > 1 ? childPieces.length : null
          });
        });
      }
    }

    return { parentChunks, chunks: childChunks };
  } else {
    const windowChars = Number.isFinite(options.windowChars) ? options.windowChars : CHUNK_WINDOW_CHARS;
    const overlapChars = Number.isFinite(options.overlapChars) ? options.overlapChars : CHUNK_OVERLAP_CHARS;
    const chunks = [];

    for (const section of pageSections(documentItem)) {
      if (!section.text) continue;
      const pieces = slidingChunkText(section.text, { windowChars, overlapChars });
      pieces.forEach((piece, partIndex) => {
        chunks.push({
          index: chunks.length,
          text: piece,
          page: section.page,
          label: section.label || "",
          part: pieces.length > 1 ? partIndex + 1 : null,
          partTotal: pieces.length > 1 ? pieces.length : null
        });
      });
    }

    return chunks;
  }
}
