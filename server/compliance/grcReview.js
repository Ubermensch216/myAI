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
    throw new Error("비교 검증할 내부 기준 문서의 텍스트 내용이 비어있습니다.");
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
    "=== [비교 기준: 내부 기준 문서] ===",
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
        top_p: 0.9,
        num_predict: 4096 // Ensure long responses are not truncated
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
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (parseError) {
      console.warn("Standard GRC JSON parse failed, attempting repair...", parseError.message);
      let repaired = content.trim();

      if (!repaired.endsWith("}")) {
        // 1. Close unclosed double quote if odd count
        const quoteMatches = repaired.match(/(?<!\\)"/g) || [];
        if (quoteMatches.length % 2 !== 0) {
          repaired += '"';
        }

        // 2. Close unclosed array brackets
        const openBrackets = (repaired.match(/\[/g) || []).length;
        const closeBrackets = (repaired.match(/\]/g) || []).length;
        if (openBrackets > closeBrackets) {
          repaired += "]".repeat(openBrackets - closeBrackets);
        }

        // 3. Close unclosed curly braces
        const openBraces = (repaired.match(/\{/g) || []).length;
        const closeBraces = (repaired.match(/\}/g) || []).length;
        if (openBraces > closeBraces) {
          repaired += "}".repeat(openBraces - closeBraces);
        }

        try {
          parsed = JSON.parse(repaired);
          console.log("GRC JSON repaired successfully!");
        } catch (repairError) {
          console.error("GRC JSON repair failed:", repairError.message);
          throw parseError; // Rethrow original error if repair fails
        }
      } else {
        throw parseError;
      }
    }

    // Helper to find key value case-insensitively or via aliases
    const normalizeKey = (key) => String(key || "").toLowerCase().replace(/[\s_-]+/g, "");
    const hasValue = (value) => value !== undefined && value !== null && value !== "";
    const pickValue = (obj, keys) => {
      if (!obj || typeof obj !== "object") return undefined;
      for (const k of keys) {
        if (hasValue(obj[k])) return obj[k];
        const lowerK = k.toLowerCase();
        const compactK = normalizeKey(k);
        for (const key of Object.keys(obj)) {
          if (key.toLowerCase() === lowerK && hasValue(obj[key])) {
            return obj[key];
          }
          if (normalizeKey(key) === compactK && hasValue(obj[key])) {
            return obj[key];
          }
        }
      }
      return undefined;
    };

    // Normalize overallRisk to 'High' | 'Medium' | 'Low'
    let overallRisk = pickValue(parsed, ["overallRisk", "overall_risk", "risk", "종합위험도", "위험도", "overallRiskLevel"]);
    if (typeof overallRisk === "string") {
      overallRisk = overallRisk.trim();
      if (overallRisk === "높음" || overallRisk.toLowerCase() === "high") {
        overallRisk = "High";
      } else if (overallRisk === "보통" || overallRisk.toLowerCase() === "medium" || overallRisk.toLowerCase() === "warn" || overallRisk.toLowerCase() === "warning") {
        overallRisk = "Medium";
      } else {
        overallRisk = "Low";
      }
    } else {
      overallRisk = "Low";
    }

    // Normalize results rule checks
    const rawResults = pickValue(parsed, ["results", "result", "checks", "items", "검토결과", "결과"]) || [];
    const results = (Array.isArray(rawResults) ? rawResults : []).map(item => {
      if (!item || typeof item !== "object") return null;
      const ruleTitle = pickValue(item, ["ruleTitle", "rule_title", "title", "rule", "규정명", "조항명", "대상규정", "조항"]) || "";

      let status = pickValue(item, ["status", "state", "결과", "상태", "판정"]) || "확인 불가";
      if (typeof status === "string") {
        status = status.trim();
        if (status.includes("충돌") || status.toLowerCase().includes("conflict") || status.toLowerCase().includes("non-compliant") || status.toLowerCase().includes("high")) {
          status = "충돌 가능성";
        } else if (status.includes("보완") || status.toLowerCase().includes("warn") || status.toLowerCase().includes("medium")) {
          status = "일부 보완 필요";
        } else if (status.includes("적합") || status.toLowerCase().includes("compliant") || status.toLowerCase().includes("pass") || status.toLowerCase().includes("low")) {
          status = "적합";
        } else {
          status = "확인 불가";
        }
      } else {
        status = "확인 불가";
      }

      const reason = pickValue(item, ["reason", "reasoning", "explanation", "설명", "이유", "의견", "검토의견"]) || "";
      const remediation = pickValue(item, ["remediation", "action", "recommendation", "조치", "조치사항", "권고사항", "조치권고"]) || "";
      return { ruleTitle, status, reason, remediation };
    }).filter(Boolean);

    // Normalize missingInformation
    const rawMissing = pickValue(parsed, ["missingInformation", "missing_information", "missing", "추가정보", "필요정보"]) || [];
    const missingInformation = (Array.isArray(rawMissing) ? rawMissing : []).map(x => String(x || "").trim()).filter(Boolean);

    // Normalize draftOpinion and summary
    const summary = pickValue(parsed, ["summary", "description", "요약", "종합요약"]) || "";
    const draftOpinion = pickValue(parsed, ["draftOpinion", "draft_opinion", "opinion", "draft", "초안", "의견서", "검토의견서", "의견서초안", "의견서 초안", "검토의견서초안", "검토의견서 초안", "검토 의견서 초안"])
      || buildFallbackDraftOpinion({ summary, overallRisk, results, missingInformation });

    return {
      summary,
      overallRisk,
      results,
      missingInformation,
      draftOpinion
    };
  } catch (error) {
    console.error("Failed to parse Ollama GRC response as JSON. Content was:", content);
    // In case of parsing failure, try to wrap it or throw
    throw new Error("Ollama가 유효한 GRC JSON 규격을 반환하지 못했습니다. 다시 시도해 주세요.");
  }
}

function buildFallbackDraftOpinion({ summary = "", overallRisk = "Low", results = [], missingInformation = [] } = {}) {
  const riskLabel = overallRisk === "High" ? "높음" : overallRisk === "Medium" ? "보통" : "낮음";
  const findings = Array.isArray(results) && results.length
    ? results.map((item, index) => {
      const lines = [
        `${index + 1}. ${item.ruleTitle || "검토 항목"}`,
        `   - 판정: ${item.status || "확인 불가"}`,
        item.reason ? `   - 검토 의견: ${item.reason}` : "",
        item.remediation ? `   - 조치 권고: ${item.remediation}` : ""
      ];
      return lines.filter(Boolean).join("\n");
    }).join("\n\n")
    : "구조화된 상세 진단 결과가 충분히 생성되지 않았습니다.";
  const missing = Array.isArray(missingInformation) && missingInformation.length
    ? missingInformation.map((item) => `- ${item}`).join("\n")
    : "- 추가 확인이 필요한 정보는 별도로 식별되지 않았습니다.";

  return [
    "## 1. 검토 목적",
    "본 의견서 초안은 제출된 검토 대상 문서가 내부 규정 및 지침에 부합하는지 확인하기 위해 작성되었습니다.",
    "",
    "## 2. 종합 의견",
    summary || "검토 결과 요약이 충분히 생성되지 않았습니다.",
    "",
    `- 종합 위험도: ${riskLabel}`,
    "",
    "## 3. 상세 분석",
    findings,
    "",
    "## 4. 조치 권고사항",
    missing,
    "",
    "본 문서는 AI가 생성한 업무 검토용 초안이므로 최종 제출 전 담당자의 사실관계 및 법무/준법 검토가 필요합니다."
  ].join("\n");
}
