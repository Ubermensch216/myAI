import { pageSections } from "./documents.js";
import { slidingChunkText } from "./parsers.js";

export const CHUNK_WINDOW_CHARS = Number(process.env.CHUNK_WINDOW_CHARS || process.env.CHUNK_TARGET_CHARS || 1024);
export const CHUNK_OVERLAP_CHARS = Number(process.env.CHUNK_OVERLAP_CHARS || 256);

export function chunkDocumentSections(documentItem, options = {}) {
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
