import express from "express";
import { createExportFile } from "../exportFiles.js";
import { buildGeneratedSource, normalizeGeneratedSourceRequest } from "./generatedSourceModel.js";

export const generatedSourceRouter = express.Router();

generatedSourceRouter.post("/from-answer", async (request, response) => {
  try {
    const normalized = normalizeGeneratedSourceRequest(request.body || {});
    const exportFile = await createExportFile({
      format: normalized.format,
      title: normalized.title,
      content: normalized.answerMarkdown
    });
    const generatedSource = buildGeneratedSource({ request: normalized, exportFile });
    response.json({ ok: true, generatedSource });
  } catch (error) {
    response.status(400).json({ ok: false, error: error.message });
  }
});
