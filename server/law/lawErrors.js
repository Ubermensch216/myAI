import { maskLawSecrets } from "./lawConfig.js";

export const LAW_ERROR_MARKERS = {
  NOT_FOUND: "NOT_FOUND",
  HALLUCINATION_DETECTED: "HALLUCINATION_DETECTED",
  LAW_API_ERROR: "LAW_API_ERROR",
  LAW_DISABLED: "LAW_DISABLED",
  LAW_NOT_CONFIGURED: "LAW_NOT_CONFIGURED"
};

export class LawError extends Error {
  constructor(message, { marker = LAW_ERROR_MARKERS.LAW_API_ERROR, statusCode = 500, cause } = {}) {
    super(maskLawSecrets(message));
    this.name = "LawError";
    this.marker = marker;
    this.statusCode = statusCode;
    this.cause = cause;
  }
}

export function toLawError(error, fallbackMessage = "Korean Law API request failed.") {
  if (error instanceof LawError) return error;
  return new LawError(maskLawSecrets(error?.message || fallbackMessage), {
    marker: LAW_ERROR_MARKERS.LAW_API_ERROR,
    statusCode: error?.statusCode || 502,
    cause: error
  });
}

export function lawErrorPayload(error) {
  const lawError = toLawError(error);
  return {
    ok: false,
    error: maskLawSecrets(lawError.message),
    marker: lawError.marker
  };
}

export function assertLawAvailable(config) {
  if (!config.enabled) {
    throw new LawError("Korean Law Engine is disabled by LAW_API_ENABLED=false.", {
      marker: LAW_ERROR_MARKERS.LAW_DISABLED,
      statusCode: 503
    });
  }
  if (!config.configured) {
    throw new LawError("Korean Law Engine requires LAW_OC to be configured on the server.", {
      marker: LAW_ERROR_MARKERS.LAW_NOT_CONFIGURED,
      statusCode: 503
    });
  }
}
