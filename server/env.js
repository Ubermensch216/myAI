import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

let loaded = false;

export function loadLocalEnv(filePath = path.join(rootDir, ".env")) {
  if (loaded) return;
  loaded = true;

  let source = "";
  try {
    source = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn(`Could not read local env file: ${error.message}`);
    }
    return;
  }

  for (const line of source.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    const { key, value } = parsed;
    if (Object.prototype.hasOwnProperty.call(process.env, key)) continue;
    process.env[key] = value;
  }
}

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (!match) return null;

  return {
    key: match[1],
    value: unquoteEnvValue(match[2].trim())
  };
}

function unquoteEnvValue(value) {
  if (!value) return "";
  const quote = value[0];
  if ((quote === `"` || quote === "'") && value.endsWith(quote)) {
    const inner = value.slice(1, -1);
    return quote === `"` ? inner.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t") : inner;
  }
  return value.replace(/\s+#.*$/, "").trim();
}

loadLocalEnv();
