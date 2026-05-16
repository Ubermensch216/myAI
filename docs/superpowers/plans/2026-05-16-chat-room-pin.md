# Chat Room Pin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pin toggle to each chat room in the left sidebar so pinned rooms are always sorted to the top, with the most recently pinned room first.

**Architecture:** Pure frontend change. Adds a nullable `pinnedAt` ISO timestamp field to each room object. `renderRooms()` sorts a non-mutating copy of `state.rooms` by pinned-first then `pinnedAt` desc, with stable insertion-order fallback. A new `.room-pin` control inside each `.room-item` toggles the field and triggers the existing `scheduleSave()` + re-render. Persistence flows through the existing AES-GCM IndexedDB save path; no schema migration needed because absent fields are treated as unpinned.

**Tech Stack:** Vanilla ES modules, plain HTML/CSS/JS, browser IndexedDB via existing `persistence.js`.

**Spec:** [docs/superpowers/specs/2026-05-16-chat-room-pin-design.md](../specs/2026-05-16-chat-room-pin-design.md)

**No automated tests:** The project's `npm test` covers server/RAG/law concerns only — there is no frontend DOM test harness. This plan uses manual verification in the browser, listed in Task 5.

---

## File Structure

| File | Change | Responsibility |
| --- | --- | --- |
| [public/modules/state.js](../../public/modules/state.js) | Modify `createRoom()` | Add `pinnedAt: null` to the room object factory |
| [public/app.js](../../public/app.js) | Modify `ROOM_FILE_SVG`, add `sortRoomsForRender()`, modify `renderRooms()` | Pin SVG icons, sort logic, pin control UI and click handler |
| [public/styles.css](../../public/styles.css) | Add `.room-pin` rules, modify `.room-item` grid | Pin button visibility, pinned-room visual emphasis, layout |

---

### Task 1: Add `pinnedAt` to room model

**Files:**
- Modify: `public/modules/state.js:733-760` (`createRoom()`)

- [ ] **Step 1: Add `pinnedAt: null` to the returned object**

In [public/modules/state.js](../../public/modules/state.js), replace the `createRoom()` body so the returned object includes `pinnedAt: null` right before `createdAt`:

```javascript
export function createRoom() {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: "새 대화",
    messages: [],
    documents: [],
    materialsExpanded: false,
    materialGroups: {
      notebook: false,
      attachments: false,
      generatedSources: false
    },
    pendingCalendarAction: null,
    selectedNotebookId: null,
    studio: {
      mindmap: {
        signature: "",
        data: null,
        selectedNodeId: ""
      },
      documents: [],
      activeDocumentId: ""
    },
    pinnedAt: null,
    createdAt: now,
    updatedAt: now
  };
}
```

- [ ] **Step 2: Manually verify the change**

Open `public/modules/state.js` and confirm `pinnedAt: null` appears in `createRoom()`. No automated test exists for this factory.

- [ ] **Step 3: Commit**

```bash
git add public/modules/state.js
git commit -m "feat(state): add pinnedAt field to room model"
```

---

### Task 2: Add pin/unpin SVG icons

**Files:**
- Modify: `public/app.js:34-37` (`ROOM_FILE_SVG`)

- [ ] **Step 1: Extend `ROOM_FILE_SVG` with pin icons**

In [public/app.js](../../public/app.js), replace the existing `ROOM_FILE_SVG` constant with:

```javascript
const ROOM_FILE_SVG = {
  paperclip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"></path></svg>',
  notebook: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4z"></path><path d="M5 17a3 3 0 0 1 3-3h11"></path></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3l7 7-4 1-4 4-1 5-3-3-5 5 5-5-3-3 5-1 4-4z"></path></svg>',
  pinFilled: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" stroke="currentColor"><path d="M14 3l7 7-4 1-4 4-1 5-3-3-5 5 5-5-3-3 5-1 4-4z"></path></svg>'
};
```

The `pin` icon uses the existing stroke-only style (matches paperclip/notebook). The `pinFilled` icon flips `fill` to `currentColor` so the pinned state is visually distinct.

- [ ] **Step 2: Commit**

```bash
git add public/app.js
git commit -m "feat(ui): add pin SVG icons for room list"
```

---

### Task 3: Add `sortRoomsForRender()` helper

**Files:**
- Modify: `public/app.js` (add helper above `renderRooms()` at line 170)

- [ ] **Step 1: Insert the sort helper**

In [public/app.js](../../public/app.js), add the following function directly above the existing `function renderRooms()` definition:

```javascript
function sortRoomsForRender(rooms) {
  const indexed = rooms.map((room, originalIndex) => ({ room, originalIndex }));
  indexed.sort((a, b) => {
    const aPin = a.room.pinnedAt || null;
    const bPin = b.room.pinnedAt || null;
    if (aPin && !bPin) return -1;
    if (!aPin && bPin) return 1;
    if (aPin && bPin) {
      if (aPin > bPin) return -1;
      if (aPin < bPin) return 1;
      return 0;
    }
    return a.originalIndex - b.originalIndex;
  });
  return indexed.map(({ room }) => room);
}
```

Rules encoded:
- Pinned rooms come before unpinned (lines 4-5).
- Among pinned rooms, more recent `pinnedAt` (lexicographic ISO compare) comes first (lines 6-10).
- Among unpinned rooms, the original `state.rooms` insertion order is preserved (line 12).
- `state.rooms` itself is not mutated — only a shallow-copied projection is sorted.

- [ ] **Step 2: Commit**

```bash
git add public/app.js
git commit -m "feat(ui): add sortRoomsForRender helper for pinned rooms"
```

---

### Task 4: Wire pin control into `renderRooms()`

**Files:**
- Modify: `public/app.js:170-222` (`renderRooms()`)

- [ ] **Step 1: Replace `renderRooms()` with the pin-aware version**

In [public/app.js](../../public/app.js), replace the entire existing `renderRooms()` function (currently lines 170-222) with:

```javascript
function renderRooms() {
  elements.roomList.innerHTML = "";

  const sortedRooms = sortRoomsForRender(state.rooms);

  for (const room of sortedRooms) {
    const isPinned = Boolean(room.pinnedAt);
    const item = document.createElement("button");
    item.type = "button";
    item.className = `room-item${room.id === state.activeRoomId ? " active" : ""}${isPinned ? " pinned" : ""}`;
    item.addEventListener("click", () => {
      if (state.activeRoomId === room.id) return;
      state.activeRoomId = room.id;
      scheduleSave();
      renderAll();
      window.dispatchEvent(new CustomEvent("myai:roomchange", { detail: { roomId: room.id } }));
    });

    const title = document.createElement("span");
    title.className = "room-item-title";
    title.textContent = room.title || "제목 없는 대화";

    const roomDocs = Array.isArray(room.documents) ? room.documents : [];
    const indicators = document.createElement("span");
    indicators.className = "room-status-indicators";

    const attachmentIndicator = document.createElement("span");
    attachmentIndicator.className = "room-status-indicator room-attachment-indicator";
    attachmentIndicator.title = "첨부 있음";
    attachmentIndicator.setAttribute("role", "img");
    attachmentIndicator.setAttribute("aria-label", "첨부 있음");
    if (roomDocs.length) {
      attachmentIndicator.innerHTML = ROOM_FILE_SVG.paperclip;
      indicators.append(attachmentIndicator);
    }

    const notebookIndicator = document.createElement("span");
    notebookIndicator.className = "room-status-indicator room-notebook-indicator";
    notebookIndicator.title = "프로젝트 있음";
    notebookIndicator.setAttribute("role", "img");
    notebookIndicator.setAttribute("aria-label", "프로젝트 있음");
    if (room.selectedNotebookId) {
      notebookIndicator.innerHTML = ROOM_FILE_SVG.notebook;
      indicators.append(notebookIndicator);
    }
    indicators.hidden = !indicators.childElementCount;

    const pinButton = document.createElement("span");
    pinButton.className = "room-pin";
    pinButton.setAttribute("role", "button");
    pinButton.setAttribute("tabindex", "0");
    pinButton.setAttribute("aria-pressed", isPinned ? "true" : "false");
    pinButton.title = isPinned ? "고정 해제" : "고정";
    pinButton.innerHTML = isPinned ? ROOM_FILE_SVG.pinFilled : ROOM_FILE_SVG.pin;
    const togglePin = (event) => {
      event.stopPropagation();
      event.preventDefault();
      room.pinnedAt = room.pinnedAt ? null : new Date().toISOString();
      scheduleSave();
      renderRooms();
    };
    pinButton.addEventListener("click", togglePin);
    pinButton.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        togglePin(event);
      }
    });

    const deleteButton = document.createElement("span");
    deleteButton.className = "room-delete";
    deleteButton.title = "대화방 삭제";
    deleteButton.textContent = "×";
    deleteButton.addEventListener("click", async (event) => { event.stopPropagation(); await deleteRoom(room.id); });
    item.append(title, indicators, pinButton, deleteButton);
    elements.roomList.append(item);
  }
}
```

Key changes versus the original:
- Iterates `sortedRooms`, not `state.rooms` directly.
- Adds `.pinned` class to `room-item` when `room.pinnedAt` is truthy.
- Inserts `pinButton` between `indicators` and `deleteButton` in the `item.append(...)` call.
- Pin click toggles `room.pinnedAt`, persists via `scheduleSave()`, re-renders only the room list (`renderRooms()`) — full `renderAll()` is unnecessary for a sidebar metadata change.
- Pin keyboard support: Enter/Space triggers the same toggle.

- [ ] **Step 2: Commit**

```bash
git add public/app.js
git commit -m "feat(ui): render pin control and sort pinned rooms first"
```

---

### Task 5: Add pin styles and adjust grid

**Files:**
- Modify: `public/styles.css:239-316` (`.room-item` + related rules)

- [ ] **Step 1: Update `.room-item` grid to four columns**

In [public/styles.css](../../public/styles.css), change the `grid-template-columns` value on `.room-item` from `minmax(0, 1fr) auto auto` to `minmax(0, 1fr) auto auto auto`. Final rule:

```css
.room-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto auto;
  gap: 8px;
  align-items: center;
  width: 100%;
  min-height: 40px;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 8px 10px;
  background: var(--surface);
  color: var(--ink);
  cursor: pointer;
  text-align: left;
}
```

- [ ] **Step 2: Append `.room-pin` and `.room-item.pinned` rules**

At the end of the block that defines `.room-status-indicator svg` (after line 316 in the current file), append these rules:

```css
.room-pin {
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border-radius: 6px;
  color: var(--muted);
  opacity: 0;
  transition: opacity 120ms ease;
  cursor: pointer;
}

.room-pin svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.9;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.room-item:hover .room-pin,
.room-item:focus-within .room-pin {
  opacity: 1;
}

.room-pin:hover {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent-dark);
}

.room-item.pinned {
  border-left: 2px solid var(--accent);
}

.room-item.pinned .room-pin {
  opacity: 1;
  color: var(--accent-dark);
}

.room-item.pinned .room-pin svg {
  fill: currentColor;
}
```

Rules in plain language:
- Pin button is hidden by default; revealed on hover or keyboard focus into the row, or when the room is pinned.
- Pinned rooms get a 2px accent-colored left border and an always-visible filled accent-colored pin icon.

- [ ] **Step 3: Commit**

```bash
git add public/styles.css
git commit -m "style(ui): pin button visibility and pinned-room emphasis"
```

---

### Task 6: Manual verification

**Files:** none.

- [ ] **Step 1: Start the dev server**

```powershell
cd c:\Dev\myAI
npm.cmd start
```

Open http://localhost:3000 in a browser.

- [ ] **Step 2: Run the verification scenarios from the spec**

Walk through each scenario from spec section 9 ([docs/superpowers/specs/2026-05-16-chat-room-pin-design.md](../specs/2026-05-16-chat-room-pin-design.md)) and confirm each passes:

1. Create three rooms → pin the second → it moves to the top.
2. Pin the third → it sits above the second; first stays at bottom.
3. Unpin the second → it moves back into the unpinned area; only the third stays pinned.
4. Reload the page → pin state and order persist.
5. Delete a pinned room via `×` → standard delete confirmation appears, other pinned rooms are unaffected.
6. Click on a pinned room (not the pin icon) → room activates without toggling pin.
7. Tab to the pin button → press Enter → pin toggles.

If any scenario fails, fix the underlying code and re-verify before continuing.

- [ ] **Step 3: Stop the dev server**

Stop the Node process (`Ctrl+C` in its terminal).

---

## Self-Review Notes

- Spec section 2 requirements: pin toggle (Task 4), pin-first sort (Tasks 3-4), `pinnedAt` desc (Task 3), unpinned insertion-order preserved (Task 3), persistence across reload (Task 1 + existing `scheduleSave`), backward compat for old rooms without `pinnedAt` (covered by `room.pinnedAt || null` in Task 3 and `Boolean(room.pinnedAt)` in Task 4).
- Spec section 5 UI: pin control as 4th grid column (Task 5), hover reveal (Task 5), `.pinned` border (Task 5), tooltip strings (Task 4), keyboard support (Task 4).
- Spec section 6 persistence: `scheduleSave()` reused (Task 4), no migration code (intentional, see spec).
- Spec section 7 edge cases: pinned-room delete handled via existing `deleteRoom` flow (unchanged in Task 4); equal `pinnedAt` falls through to stable Array.sort (Task 3).
- No placeholders, every step contains the literal code or command to run.
