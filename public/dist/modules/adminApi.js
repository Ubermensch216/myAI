import { state } from "./state.js";

export function adminAuthHeaders() {
  return state.admin?.token ? { Authorization: `Bearer ${state.admin.token}` } : {};
}

export async function fetchAdminJson(pathname, init = {}) {
  const headers = { ...adminAuthHeaders(), ...(init.headers || {}) };
  if (init.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const response = await fetch(pathname, { ...init, headers });
  if (!response.ok) {
    let message = "";
    try { message = (await response.json()).error || ""; } catch { /* ignore */ }
    throw new Error(message || `HTTP ${response.status}`);
  }
  if (response.status === 204) return null;
  return response.json();
}
