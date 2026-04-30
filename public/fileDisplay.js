import { repairMojibake } from "./textRepair.js";

const IMAGE_TYPES = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
const DOCUMENT_BADGES = new Map([
  ["pdf", "PDF"],
  ["docx", "DOC"],
  ["xlsx", "XLS"],
  ["pptx", "PPT"],
  ["hwpx", "HWP"]
]);

export function displayFileName(uploadedFile) {
  return repairMojibake(String(uploadedFile.fileName || "uploaded-file"));
}

export function fileTypeIcon(uploadedFile) {
  const type = String(uploadedFile.fileType || "").toLowerCase();
  if (uploadedFile.kind === "image" || IMAGE_TYPES.has(type)) return "IMG";
  return DOCUMENT_BADGES.get(type) || "FILE";
}

export { repairMojibake };
