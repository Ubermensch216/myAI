# 대화방 Pin 기능 — 설계 문서

- 날짜: 2026-05-16
- 범위: Frontend only (`public/app.js`, `public/modules/state.js`, `public/styles.css`)
- 영향: 좌측 사이드바 대화방 목록 정렬 및 표시
- 호환성: 기존 IndexedDB 레코드와 하위 호환

## 1. 목적

좌측 메뉴의 대화방 목록이 늘어나면 자주 쓰는 대화방 접근성이 떨어진다. 사용자가 임의의 대화방을 핀(pin)으로 고정해 항상 목록 상단에 노출하도록 한다. 가장 최근에 고정한 방이 가장 위에 위치한다.

## 2. 요구사항

기능 요구:

- 각 대화방 항목에 핀 토글 컨트롤이 있다.
- 핀된 대화방은 핀되지 않은 대화방보다 항상 위에 표시된다.
- 핀된 대화방들 사이 정렬은 `pinnedAt` 내림차순(최근 고정 우선).
- 핀되지 않은 대화방들 사이 정렬은 기존 삽입 순서를 유지한다.
- 핀 상태는 새로고침/재방문 후에도 보존된다.
- 기존 대화방(핀 필드 없음)은 unpinned로 동작한다.

비기능 요구:

- 추가 서버 API 없음. 순수 클라이언트 변경.
- 기존 IndexedDB 스키마 마이그레이션 없음 (필드 추가만).
- 기존 디자인 토큰 (`--accent`, `--accent-dark`) 재사용.

비범위 (YAGNI):

- 핀 최대 개수 제한 없음.
- 핀 그룹의 시각적 구분선/헤더 없음 (정렬만으로 표시).
- 키보드 단축키 없음.
- 다중 선택 핀 토글 없음.
- 서버 동기화 없음 (브라우저 IndexedDB only).

## 3. 데이터 모델

### Room 객체 변경

`public/modules/state.js` `createRoom()`에 필드 추가:

```javascript
{
  // ... 기존 필드
  pinnedAt: null,     // string(ISO) | null
  // createdAt, updatedAt
}
```

값 정의:

- `null` 또는 `undefined`: 핀되지 않음.
- ISO timestamp 문자열: 핀된 시각.

핀 토글 동작:

- Pin: `room.pinnedAt = new Date().toISOString()`
- Unpin: `room.pinnedAt = null`
- 재핀(이미 핀된 방을 다시 핀): 호출 시 `pinnedAt`을 현재 시각으로 갱신 → 상단으로 이동. (UI에서는 unpin → pin 순서만 가능하므로 직접 노출되지는 않음.)

`updatedAt`은 핀 토글로 갱신하지 않는다 (핀은 메타 조작이며 대화 내용 변경이 아니다).

## 4. 정렬

`renderRooms()`(현재 [public/app.js:170-222](../../public/app.js#L170-L222))에서 정렬한 사본을 순회한다. `state.rooms` 배열 자체는 mutate 하지 않는다(다른 코드가 인덱스에 의존할 가능성 회피).

```javascript
function sortRoomsForRender(rooms) {
  const indexed = rooms.map((room, originalIndex) => ({ room, originalIndex }));
  indexed.sort((a, b) => {
    const aPin = a.room.pinnedAt || null;
    const bPin = b.room.pinnedAt || null;
    if (aPin && !bPin) return -1;
    if (!aPin && bPin) return 1;
    if (aPin && bPin) {
      // 최근 고정이 위
      if (aPin > bPin) return -1;
      if (aPin < bPin) return 1;
      return 0;
    }
    // 둘 다 unpinned: 기존 순서 유지
    return a.originalIndex - b.originalIndex;
  });
  return indexed.map(({ room }) => room);
}
```

## 5. UI

### 마크업 (renderRooms 내)

기존 구조:

```
button.room-item
  span.room-item-title
  span.room-status-indicators
  span.room-delete
```

변경:

```
button.room-item[.pinned]
  span.room-item-title
  span.room-status-indicators
  span.room-pin           ← 신규
  span.room-delete
```

### Pin 컨트롤

- 요소: `<span class="room-pin">` (의미상 button 역할이지만 부모가 이미 button이라 nested button 회피, 클릭 이벤트는 직접 처리).
- 속성: `role="button"`, `tabindex="0"`, `aria-pressed`, `title`.
- SVG 아이콘 2종:
  - `pushpin`: outline (unpinned, hover 시만 노출).
  - `pushpin-filled`: 채워진 모양 (pinned, 항상 노출).
- 클릭 핸들러:
  - `event.stopPropagation()` (방 전환 방지).
  - `room.pinnedAt = room.pinnedAt ? null : new Date().toISOString()`.
  - `scheduleSave()` → `renderRooms()`.
- 키보드: `Enter`/`Space`도 동일 토글.

### 시각 강조

- `.room-item.pinned`: 좌측 2px `--accent` 보더 또는 배경 강조. 디자인 토큰 사용.
- `.room-pin`:
  - 기본 `opacity: 0` (unpinned).
  - `.room-item:hover .room-pin`, `.room-item.pinned .room-pin` → `opacity: 1`.
  - `.room-item.pinned .room-pin` 색상은 `--accent` 계열.

### 툴팁

- Unpinned: "고정"
- Pinned: "고정 해제"

## 6. 영속화

- `state.rooms` 변경은 기존 `scheduleSave()` 경로(`public/modules/persistence.js`)를 통해 AES-GCM IndexedDB에 저장된다.
- 별도 마이그레이션 코드 없음. 로드 시 `pinnedAt`이 없는 방은 자연스럽게 `undefined`로 읽혀 unpinned 처리된다.
- `getActiveRoom`, `deleteRoom`, `createRoom`, 기타 room 소비 코드는 영향 없음.

## 7. 엣지 케이스

- **마지막 방 삭제 후 자동 생성되는 새 방**: `createRoom()`이 `pinnedAt: null`로 생성하므로 정상 동작.
- **핀된 방 삭제**: 기존 삭제 흐름(`showConfirmDialog` → `deleteRoom`) 그대로. 추가 확인 없음.
- **모든 방이 핀됨**: 정렬상 문제 없음(전부 `pinnedAt` desc).
- **`pinnedAt`이 잘못된 값(과거 데이터 오염)**: 문자열 비교로 정렬되며, falsy면 unpinned 처리되어 안전 실패.
- **동일 ms에 두 방 핀**: ISO 문자열이 같으면 `originalIndex` fallback 없이 sort가 stable이므로 두 방 순서는 기존 순서를 유지한다(Array.prototype.sort는 ECMA 2019 이후 stable).

## 8. 영향 받는 파일

- [public/modules/state.js](../../public/modules/state.js): `createRoom()`에 `pinnedAt: null` 추가.
- [public/app.js](../../public/app.js): `renderRooms()`에 정렬 + pin 컨트롤 + SVG 상수.
- [public/styles.css](../../public/styles.css): `.room-pin`, `.room-item.pinned` 스타일.

## 9. 수동 검증 시나리오

1. 새 대화방 3개 생성 → 두 번째 방을 pin → 두 번째 방이 최상단으로 이동.
2. 세 번째 방을 pin → 세 번째 방이 최상단, 두 번째 방이 그 아래.
3. 두 번째 방을 unpin → 두 번째 방이 unpinned 영역(세 번째, 첫 번째 아래)으로 이동, 세 번째 방만 핀 영역에 남음.
4. 새로고침 → 핀 상태 및 순서 유지.
5. 핀된 방 삭제 → 정상 삭제, 다른 핀 방 영향 없음.
6. 핀된 방 클릭 → 정상 전환 (핀 버튼 stopPropagation 동작).
7. 키보드 Tab으로 핀 버튼 포커스 → Enter로 토글.

## 10. 테스트

자동 테스트 추가 없음.

- 프로젝트의 `npm test`는 서버/RAG/법령 검증 중심이며 프론트엔드 DOM 테스트 인프라가 없다.
- 본 기능은 순수 UI/state 로직으로, 위 수동 검증 시나리오로 충분히 커버된다.
