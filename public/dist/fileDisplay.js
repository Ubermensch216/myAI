import { repairMojibake } from "./textRepair.js";

const IMAGE_TYPES = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
const DOCUMENT_BADGES = new Map([
  ["pdf", "PDF"],
  ["docx", "DOC"],
  ["xlsx", "XLS"],
  ["csv", "CSV"],
  ["pptx", "PPT"],
  ["hwpx", "HWP"],
  ["md", "MD"]
]);

export function displayFileName(uploadedFile) {
  const name = repairMojibake(String(uploadedFile.fileName || "uploaded-file"));
  if (uploadedFile?.trustLevel === "generated" || uploadedFile?.origin === "assistant_answer") {
    return name.startsWith("AI 생성") ? name : `AI 생성 ${name}`;
  }
  return name;
}

export function fileTypeIcon(uploadedFile) {
  const type = String(uploadedFile.fileType || "").toLowerCase();
  if (uploadedFile?.trustLevel === "generated" || uploadedFile?.origin === "assistant_answer") return "AI";
  if (uploadedFile.kind === "image" || IMAGE_TYPES.has(type)) return "IMG";
  return DOCUMENT_BADGES.get(type) || "FILE";
}

export { repairMojibake };
