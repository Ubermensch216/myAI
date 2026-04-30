export function summarizeDocument(document) {
  return {
    id: document.id,
    createdAt: document.createdAt,
    fileName: document.fileName,
    fileType: document.fileType,
    kind: document.kind,
    pageCount: document.pages?.length ?? 0,
    sheetCount: document.sheets?.length ?? 0,
    textLength: document.text?.length ?? 0,
    preview: document.text?.slice(0, 280) ?? ""
  };
}

export function serializeDocumentForClient(document) {
  return {
    ...summarizeDocument(document),
    mimeType: document.mimeType,
    imageBase64: document.imageBase64,
    text: document.text,
    pages: document.pages || [],
    sheets: document.sheets || []
  };
}

