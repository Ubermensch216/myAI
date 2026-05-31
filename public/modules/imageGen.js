import { elements, accessAuthHeaders, getActiveRoom } from "./state.js";
import { scheduleSave } from "./persistence.js";
import { appendMessage } from "./chat.js";

// 정보탐색 방의 자연어 이미지 생성. 명시 토글로 활성화되며, 활성 상태에서
// 메시지를 보내면 /api/chat 대신 이미지 워커로 라우팅된다. 이미지 런타임이
// 없으면(워커 미가용) 토글 자체가 숨겨져 기존 채팅에 영향을 주지 않는다.

let _active = false;
let _available = false;

const RATIOS = {
  "1:1": [768, 768],
  "4:3": [768, 576],
  "16:9": [768, 432],
  "3:4": [576, 768]
};

export function isImageModeActive() {
  return _active && _available;
}

export async function bindImageGenEvents() {
  const button = elements.imageGenButton;
  const chip = elements.imageGenActiveButton;
  const panel = elements.imageGenPanel;
  if (!button) return;

  // 워커 가용성 확인 — 미가용이면 토글 숨김.
  _available = await checkAvailability();
  button.hidden = !_available;
  if (!_available) {
    if (panel) panel.hidden = true;
    if (chip) chip.hidden = true;
    return;
  }

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    setActive(!_active);
  });
  chip?.addEventListener("click", () => setActive(false));

  // 다른 곳(메시지 카드)에서 "다시 생성" 버튼이 디스패치하는 이벤트.
  window.addEventListener("myai:image-regenerate", (event) => {
    const detail = event.detail || {};
    if (!detail.prompt) return;
    runGeneration(detail.prompt, {
      stylePreset: detail.stylePreset || null,
      width: detail.width || null,
      height: detail.height || null,
      batch: detail.batch || 1
    }, { pushUser: false });
  });
}

function setActive(next) {
  _active = Boolean(next) && _available;
  const button = elements.imageGenButton;
  const chip = elements.imageGenActiveButton;
  const panel = elements.imageGenPanel;
  button?.setAttribute("aria-pressed", _active ? "true" : "false");
  if (chip) chip.hidden = !_active;
  if (panel) panel.hidden = !_active;
  if (_active && elements.promptInput) {
    elements.promptInput.setAttribute("placeholder", "생성할 이미지를 설명하세요 (예: 상수도 누수 점검 절차 카드뉴스)");
  } else if (elements.promptInput) {
    elements.promptInput.setAttribute("placeholder", "myAI에게 물어보세요 [Shift+I]");
  }
}

async function checkAvailability() {
  try {
    const response = await fetch("/api/status");
    if (!response.ok) return false;
    const data = await response.json();
    return Boolean(data?.image?.available);
  } catch {
    return false;
  }
}

function readPanelParams() {
  const stylePreset = elements.imageGenStyle?.value || null;
  const ratio = elements.imageGenRatio?.value || "1:1";
  const [width, height] = RATIOS[ratio] || RATIOS["1:1"];
  const batch = Math.min(4, Math.max(1, parseInt(elements.imageGenCount?.value, 10) || 1));
  return { stylePreset, width, height, batch };
}

/** Composer submit 진입점 (app.js에서 이미지 모드일 때 호출). */
export async function handleImagePrompt(prompt) {
  await runGeneration(prompt, readPanelParams(), { pushUser: true });
}

async function runGeneration(prompt, params, { pushUser }) {
  const room = getActiveRoom();
  if (!room) return;

  if (pushUser) {
    const userMessage = { role: "user", content: prompt, createdAt: new Date().toISOString() };
    room.messages.push(userMessage);
    room.updatedAt = userMessage.createdAt;
    if (room.title === "새 대화") room.title = prompt.slice(0, 30);
    scheduleSave();
    if (room.messages.length === 1) {
      window.dispatchEvent(new CustomEvent("myai:rendermessages"));
    } else {
      appendMessage("user", prompt, {
        persist: false,
        messageIndex: room.messages.length - 1,
        createdAt: userMessage.createdAt
      });
    }
  }

  const status = appendMessage("assistant", "이미지를 생성하는 중입니다…", { persist: false, streaming: true });

  try {
    const jobId = await startJob(prompt, params);
    const result = await pollJob(jobId);
    status?.remove();

    const assets = Array.isArray(result.assets) ? result.assets : [];
    if (!assets.length) throw new Error("생성된 이미지가 없습니다.");

    const meta = result.meta || {};
    const image = {
      prompt,
      stylePreset: params.stylePreset || null,
      provider: "diffusers",
      model: meta.model || null,
      width: meta.width ?? params.width,
      height: meta.height ?? params.height,
      assets: assets.map((a) => ({ assetId: a.assetId, seed: a.seed ?? null }))
    };

    // 현재 활성 방이 생성 시작 시점과 같을 때만 영속화한다.
    const current = getActiveRoom();
    if (current && current.id === room.id) {
      const assistantMessage = {
        role: "assistant",
        type: "generated_image",
        content: "요청하신 이미지를 생성했습니다.",
        image,
        createdAt: new Date().toISOString()
      };
      room.messages.push(assistantMessage);
      room.updatedAt = assistantMessage.createdAt;
      scheduleSave();
      appendMessage("assistant", assistantMessage.content, {
        persist: false,
        messageIndex: room.messages.length - 1,
        createdAt: assistantMessage.createdAt,
        image
      });
    } else {
      // 방을 옮겼으면 그냥 표시만.
      appendMessage("assistant", "요청하신 이미지를 생성했습니다.", { persist: false, image });
    }
  } catch (error) {
    status?.remove();
    appendMessage("assistant", `이미지 생성에 실패했습니다: ${error.message}`, { persist: false });
  }
}

async function startJob(prompt, params) {
  const response = await fetch("/api/image/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...accessAuthHeaders() },
    body: JSON.stringify({
      prompt,
      stylePreset: params.stylePreset,
      width: params.width,
      height: params.height,
      batch: params.batch
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "이미지 생성 요청에 실패했습니다.");
  return data.jobId;
}

async function pollJob(jobId) {
  for (let attempt = 0; attempt < 160; attempt++) {
    await sleep(1200);
    const response = await fetch(`/api/image/jobs/${jobId}`);
    if (!response.ok) {
      if (response.status === 404) throw new Error("작업을 찾을 수 없습니다.");
      continue;
    }
    const job = await response.json();
    if (job.status === "done") return job;
    if (job.status === "error") throw new Error(job.error || "이미지 생성에 실패했습니다.");
  }
  throw new Error("이미지 생성 시간이 초과되었습니다.");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
