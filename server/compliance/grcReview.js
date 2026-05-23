import { loadLocalEnv } from "../env.js";

loadLocalEnv();

const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "gemma3n:e2b";

/**
 * Executes a structured GRC compliance review on a target document text against policy guidelines.
 * 
 * @param {Object} params
 * @param {string} params.targetText - Text content of the document to review (e.g. a contract)
 * @param {string} params.policyText - Text content of the guidelines/rules to verify against
 * @param {string} [params.model] - Model name to use
 * @returns {Promise<Object>} The structured compliance review result
 */
export async function runGrcReview({ targetText, policyText, model = DEFAULT_MODEL }) {
  if (!targetText || !targetText.trim()) {
    throw new Error("검토 대상 문서의 텍스트 내용이 비어있습니다.");
  }
  if (!policyText || !policyText.trim()) {
    throw new Error("비교 검증할 사내 규정/지침의 텍스트 내용이 비어있습니다.");
  }

  const systemPrompt = [
    "You are an expert Corporate Compliance & GRC Auditor. Your task is to review a target document against a set of company policies/guidelines.",
    "Perform a strict analysis for contradictions, gaps, non-compliance, and risks.",
    "You must return ONLY a JSON object matching the requested schema. Do not output any markdown formatting (except in draftOpinion) or conversational text outside the JSON.",
    "",
    "The output JSON must contain exactly these keys in Korean:",
    "- summary: A concise high-level summary of the compliance review (3-4 sentences).",
    "- overallRisk: Overall risk level as one of: 'High', 'Medium', 'Low'.",
    "- results: An array of rule checks, where each item must contain:",
    "  * ruleTitle: Title of the specific policy/guideline rule checked.",
    "  * status: Status of compliance, one of: '적합' (Compliant), '일부 보완 필요' (Warning), '충돌 가능성' (Non-compliant), '확인 불가' (Insufficient data).",
    "  * reason: Clear explanation of why this status was given (referencing specific parts of the target document and the policy).",
    "  * remediation: Practical step-by-step remediation recommendation if not '적합'.",
    "- missingInformation: List of any missing information or documents needed to complete the review.",
    "- draftOpinion: A formal compliance opinion letter (마크다운 형식 보고서 초안) detailing the findings, structured with '1. 검토 목적', '2. 종합 의견', '3. 상세 분석', '4. 조치 권고사항'."
  ].join("\n");

  const userPrompt = [
    "Please perform the compliance review based on the following input data:",
    "",
    "=== [비교 기준: 사내 규정 및 지침] ===",
    policyText.slice(0, 30000), // Bounded to prevent excessive context sizes
    "",
    "=== [검토 대상: 제출된 문서] ===",
    targetText.slice(0, 30000),
    "",
    "Perform the audit and return the result as a strict JSON object."
  ].join("\n");

  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      format: "json",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      options: {
        temperature: 0.1, // Low temperature for high precision and adherence
        top_p: 0.9
      }
    })
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Ollama GRC call failed with status ${response.status}: ${errText}`);
  }

  const result = await response.json();
  const content = result.message?.content || "";

  try {
    const parsed = JSON.parse(content);
    return parsed;
  } catch (error) {
    console.error("Failed to parse Ollama GRC response as JSON. Content was:", content);
    // In case of parsing failure, try to wrap it or throw
    throw new Error("Ollama가 유효한 GRC JSON 규격을 반환하지 못했습니다. 다시 시도해 주세요.");
  }
}
