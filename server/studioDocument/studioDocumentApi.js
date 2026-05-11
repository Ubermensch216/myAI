import express from "express";
import { listDefaultTemplates, getDefaultTemplate, pickDefaultTemplateId } from "./defaultTemplates.js";
import { normalizeDocument, DOCUMENT_LIMITS } from "./documentModel.js";
import { renderDocumentToMarkdown, renderCitationsSection } from "./documentRenderer.js";
import { convertAnswerToDocument } from "./answerToDocument.js";
import { createExportFile, listExportFormats } from "../exportFiles.js";
import { DEFAULT_MODEL } from "../ollama.js";

export const studioDocumentRouter = express.Router();

studioDocumentRouter.get("/templates", (_req, res) => {
  res.json({
    ok: true,
    templates: listDefaultTemplates(),
    defaults: {
      compliance: "review_report"
    },
    limits: DOCUMENT_LIMITS
  });
});

studioDocumentRouter.post("/from-answer", async (req, res) => {
  try {
    const body = req.body || {};
    const answerMarkdown = typeof body.answerMarkdown === "string" ? body.answerMarkdown : "";
    if (!answerMarkdown.trim()) {
      return res.status(400).json({ ok: false, error: "문서로 보낼 답변 내용이 없습니다." });
    }

    const metadata = body.metadata && typeof body.metadata === "object" ? body.metadata : {};
    const requestedTemplateId = String(body.templateId || "").trim();
    const fallbackTemplateId = pickDefaultTemplateId(metadata) || "review_report";
    const templateId = requestedTemplateId || fallbackTemplateId;
    const template = (body.template && typeof body.template === "object" && Array.isArray(body.template.blocks))
      ? sanitizeIncomingTemplate(body.template, templateId)
      : getDefaultTemplate(templateId);
    if (!template) {
      return res.status(400).json({ ok: false, error: `알 수 없는 템플릿: ${templateId}` });
    }

    const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : DEFAULT_MODEL;

    const result = await convertAnswerToDocument({
      title: body.title,
      answerMarkdown,
      template,
      metadata,
      source: normalizeSourceField(body.source),
      model
    });

    // Body-only markdown: no title (the editor has a separate title input)
    // and no citations (those are appended at export time per user toggle).
    const markdown = renderDocumentToMarkdown(result.document, {
      includeTitle: false,
      includeCitations: false
    }).trim();

    res.json({
      ok: true,
      document: result.document,
      markdown,
      warnings: result.warnings,
      templateId: template.id
    });
  } catch (error) {
    const status = error.statusCode || (isClientError(error) ? 400 : 500);
    res.status(status).json({ ok: false, error: error.message, code: error.code || null });
  }
});

studioDocumentRouter.post("/export", async (req, res) => {
  try {
    const body = req.body || {};
    const format = String(body.format || "").trim().toLowerCase();
    if (!format) {
      return res.status(400).json({ ok: false, error: "format is required" });
    }
    const supportedFormats = listExportFormats().map((f) => f.id);
    if (!supportedFormats.includes(format)) {
      return res.status(400).json({
        ok: false,
        error: `지원하지 않는 문서 형식입니다: ${format}. (지원: ${supportedFormats.join(", ")})`
      });
    }
    if (!body.document || typeof body.document !== "object") {
      return res.status(400).json({ ok: false, error: "document is required" });
    }

    const options = body.options && typeof body.options === "object" ? body.options : {};
    const includeCitations = options.includeCitations !== false;
    const includeGeneratedAt = Boolean(options.includeGeneratedAt);

    const rawDoc = body.document;
    const rawMarkdown = typeof rawDoc.markdown === "string" ? rawDoc.markdown : "";
    const rawTitle = typeof rawDoc.title === "string" ? rawDoc.title.trim() : "";

    let title;
    let content;
    if (rawMarkdown.trim()) {
      title = rawTitle || "myAI 문서";
      const parts = [];
      if (title) {
        parts.push(`# ${title}`);
        parts.push("");
      }
      parts.push(rawMarkdown.trim());
      if (includeCitations && rawDoc.citations) {
        const cites = renderCitationsSection(rawDoc.citations);
        if (cites) {
          parts.push("");
          parts.push(cites);
        }
      }
      if (includeGeneratedAt) {
        const stamp = new Date().toISOString().replace("T", " ").slice(0, 16);
        parts.push("");
        parts.push(`> 생성: ${stamp}`);
      }
      content = parts.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
    } else {
      const normalized = normalizeDocument(rawDoc);
      if (!normalized.blocks.length) {
        return res.status(400).json({ ok: false, error: "내보낼 내용이 없습니다." });
      }
      title = normalized.title;
      content = renderDocumentToMarkdown(normalized, { includeCitations, includeGeneratedAt });
    }

    if (!content.trim()) {
      return res.status(400).json({ ok: false, error: "문서 본문이 비어있습니다." });
    }

    const file = await createExportFile({
      format,
      title,
      content
    });

    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Content-Length", file.buffer.length);
    res.setHeader("Content-Disposition", contentDisposition(file.filename));
    res.send(file.buffer);
  } catch (error) {
    const status = error.statusCode || (isClientError(error) ? 400 : 500);
    res.status(status).json({ ok: false, error: error.message, code: error.code || null });
  }
});

function sanitizeIncomingTemplate(rawTemplate, templateId) {
  const blocks = (rawTemplate.blocks || []).map((block) => {
    if (!block || typeof block !== "object") return null;
    const type = String(block.type || "").trim();
    if (type !== "section" && type !== "table" && type !== "checklist") return null;
    const out = {
      type,
      title: String(block.title || "").trim().slice(0, 200)
    };
    if (!out.title) return null;
    if (type === "table" && Array.isArray(block.columns)) {
      out.columns = block.columns.map((c) => String(c || "").trim()).filter(Boolean).slice(0, 12);
    }
    if (typeof block.instruction === "string") {
      out.instruction = block.instruction.trim().slice(0, 800);
    }
    return out;
  }).filter(Boolean);

  if (!blocks.length) return null;

  return {
    id: String(rawTemplate.id || templateId || "user_template").trim(),
    name: String(rawTemplate.name || "사용자 템플릿").trim().slice(0, 80),
    description: String(rawTemplate.description || "").trim().slice(0, 200),
    blocks
  };
}

function normalizeSourceField(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    roomId: typeof raw.roomId === "string" ? raw.roomId.slice(0, 200) : null,
    messageId: typeof raw.messageId === "string" ? raw.messageId.slice(0, 200) : null,
    sourceType: typeof raw.sourceType === "string" ? raw.sourceType.slice(0, 64) : "assistant_answer"
  };
}

function contentDisposition(filename) {
  const fallback = String(filename || "myai-document")
    .replace(/[^\x20-\x7e]+/g, "_")
    .replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(filename || "myai-document")
    .replace(/['()]/g, escape)
    .replace(/\*/g, "%2A");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function isClientError(error) {
  const code = error?.code;
  return code === "EMPTY_ANSWER"
    || code === "ANSWER_TOO_LARGE"
    || code === "TEMPLATE_REQUIRED"
    || code === "DOCUMENT_TOO_LARGE";
}
