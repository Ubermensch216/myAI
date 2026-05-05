import { loadLocalEnv } from "../env.js";

loadLocalEnv();

export const PROFILE_PERSONAL = "personal";
export const PROFILE_DEPARTMENT = "department";

export const DEPARTMENT_VECTOR_BACKEND =
  String(process.env.DEPARTMENT_VECTOR_BACKEND || "json").toLowerCase();
export const DEPARTMENT_LEXICAL_BACKEND =
  String(process.env.DEPARTMENT_LEXICAL_BACKEND || "memory").toLowerCase();

const SUPPORTED_VECTOR_BACKENDS = new Set(["json", "qdrant"]);
const SUPPORTED_LEXICAL_BACKENDS = new Set(["memory", "sqlite"]);

if (!SUPPORTED_VECTOR_BACKENDS.has(DEPARTMENT_VECTOR_BACKEND)) {
  console.warn(
    `[ragConfig] Unsupported DEPARTMENT_VECTOR_BACKEND="${DEPARTMENT_VECTOR_BACKEND}". Supported: ${[...SUPPORTED_VECTOR_BACKENDS].join(", ")}. Falling back to "json".`
  );
}
if (!SUPPORTED_LEXICAL_BACKENDS.has(DEPARTMENT_LEXICAL_BACKEND)) {
  console.warn(
    `[ragConfig] Unsupported DEPARTMENT_LEXICAL_BACKEND="${DEPARTMENT_LEXICAL_BACKEND}". Supported: ${[...SUPPORTED_LEXICAL_BACKENDS].join(", ")}. Falling back to "memory".`
  );
}

export function resolvedDepartmentBackend() {
  return {
    vector: SUPPORTED_VECTOR_BACKENDS.has(DEPARTMENT_VECTOR_BACKEND)
      ? DEPARTMENT_VECTOR_BACKEND
      : "json",
    lexical: SUPPORTED_LEXICAL_BACKENDS.has(DEPARTMENT_LEXICAL_BACKEND)
      ? DEPARTMENT_LEXICAL_BACKEND
      : "memory"
  };
}
