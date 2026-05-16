import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseAnswerBlocks } from "../public/answerRenderer.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failureCount = 0;

await run("chat prompt uses one unified readability policy", testUnifiedChatReadabilityPolicy);
await run("compliance prompt inherits the unified readability policy", testComplianceReadabilityPolicy);
await run("Korean answer labels parse as stable sections", testKoreanAnswerSections);

if (failureCount > 0) process.exitCode = 1;

async function run(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failureCount += 1;
    console.error(`not ok - ${name}`);
    console.error(error?.stack || error);
  }
}

async function testUnifiedChatReadabilityPolicy() {
  const source = await fs.readFile(path.join(rootDir, "server", "ollama.js"), "utf8");
  assert.match(source, /Unified answer readability policy/);
  assert.match(source, /Every assistant answer must follow this policy/);
  assert.match(source, /mandatory and has priority over response style, custom instructions, and custom prompts/);
  assert.doesNotMatch(source, /불릿 기호는 되도록 사용하지 않는다/);
  assert.doesNotMatch(source, /when helpful/);
}

async function testComplianceReadabilityPolicy() {
  const source = await fs.readFile(path.join(rootDir, "server", "compliance", "compliancePrompt.js"), "utf8");
  assert.match(source, /Unified answer readability policy/);
  assert.match(source, /Do not override this structure/);
  assert.match(source, /핵심 요약/);
  assert.match(source, /주요 근거/);
  assert.match(source, /세부 내용/);
  assert.match(source, /주의사항/);
  assert.match(source, /다음 단계/);
}

function testKoreanAnswerSections() {
  const blocks = parseAnswerBlocks([
    "\uD575\uC2EC \uC694\uC57D",
    "\uC774 \uB2F5\uBCC0\uC740 \uD55C \uBB38\uC7A5\uC73C\uB85C \uC694\uC57D\uD569\uB2C8\uB2E4.",
    "",
    "\uC8FC\uC694 \uADFC\uAC70",
    "- [L1] \uACF5\uC2DD \uBC95\uB839 \uADFC\uAC70",
    "- [D1] \uACB0\uC815\uB840 \uADFC\uAC70",
    "",
    "\uC8FC\uC758\uC0AC\uD56D",
    "\uADFC\uAC70\uAC00 \uBD80\uC871\uD55C \uBD80\uBD84\uC740 \uBD80\uC871\uD558\uB2E4\uACE0 \uD45C\uC2DC\uD569\uB2C8\uB2E4."
  ].join("\n"));

  assert.deepEqual(
    blocks.filter((block) => block.type === "section").map((block) => block.text),
    ["\uD575\uC2EC \uC694\uC57D", "\uC8FC\uC694 \uADFC\uAC70", "\uC8FC\uC758\uC0AC\uD56D"]
  );
  assert.equal(blocks.some((block) => block.type === "list" && block.items.length === 2), true);
}
