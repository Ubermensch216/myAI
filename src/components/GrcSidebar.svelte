<script lang="ts">
  import { onMount } from 'svelte';
  import {
    grcStore,
    loadNotebooks,
    handleFileUpload,
    setPolicyMode,
    setSelectedNotebookId,
    startGrcReview,
    resetGrc
  } from '../stores/grcStore';

  onMount(() => {
    loadNotebooks();
  });

  let isDragOverPolicy = false;
  let isDragOverTarget = false;

  function onPolicyFileChange(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) handleFileUpload(input.files[0], 'policy');
  }

  function onTargetFileChange(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) handleFileUpload(input.files[0], 'target');
  }

  function onNotebookChange(event: Event) {
    const select = event.target as HTMLSelectElement;
    setSelectedNotebookId(select.value);
  }

  function onDragOverPolicy(event: DragEvent) {
    event.preventDefault();
    isDragOverPolicy = true;
  }

  function onDragLeavePolicy() {
    isDragOverPolicy = false;
  }

  function onDropPolicy(event: DragEvent) {
    event.preventDefault();
    isDragOverPolicy = false;
    const files = event.dataTransfer?.files;
    if (files && files[0]) handleFileUpload(files[0], 'policy');
  }

  function onDragOverTarget(event: DragEvent) {
    event.preventDefault();
    isDragOverTarget = true;
  }

  function onDragLeaveTarget() {
    isDragOverTarget = false;
  }

  function onDropTarget(event: DragEvent) {
    event.preventDefault();
    isDragOverTarget = false;
    const files = event.dataTransfer?.files;
    if (files && files[0]) handleFileUpload(files[0], 'target');
  }
</script>

<div class="grc-sidebar-inner">
  <div class="workflow-grid">
    <section class="workflow-step">
      <header class="step-header">
        <h3><span class="step-prefix">1.</span> 검토 기준</h3>
      </header>
      <p class="step-desc">내부 규정 파일 또는 부서 프로젝트를 기준으로 사용합니다.</p>

      <div class="policy-zone" class:dragover={isDragOverPolicy && $grcStore.policyMode === 'upload'}>
        <div class="policy-tabs" role="tablist" aria-label="검토 기준 선택 방식">
          <button
            type="button"
            role="tab"
            class="policy-tab"
            class:active={$grcStore.policyMode === 'upload'}
            aria-selected={$grcStore.policyMode === 'upload'}
            on:click={() => setPolicyMode('upload')}>
            직접 업로드
          </button>
          <button
            type="button"
            role="tab"
            class="policy-tab"
            class:active={$grcStore.policyMode === 'notebook'}
            aria-selected={$grcStore.policyMode === 'notebook'}
            on:click={() => setPolicyMode('notebook')}>
            프로젝트 지정
          </button>
        </div>

        <div class="policy-content">
          {#if $grcStore.policyMode === 'upload'}
            <div
              class="upload-zone policy-upload"
              role="region"
              aria-label="규정 파일 업로드 영역"
              on:dragover={onDragOverPolicy}
              on:dragleave={onDragLeavePolicy}
              on:drop={onDropPolicy}>
              <input
                type="file"
                id="policyFileInput"
                accept=".pdf,.docx,.xlsx,.txt,.hwp,.hwpx,.md"
                on:change={onPolicyFileChange}
                hidden />
              <label for="policyFileInput" class="upload-label">
                {#if $grcStore.uploadingPolicy}
                  <span class="spinner"></span>
                  <span>문서 분석 중</span>
                {:else if $grcStore.policyDocName}
                  <span class="file-name">
                    <svg class="file-icon" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M5 4h10l4 4v12H5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"></path>
                      <path d="M14 4v5h5" fill="none" stroke="currentColor" stroke-width="1.8"></path>
                    </svg>
                    {$grcStore.policyDocName}
                  </span>
                {:else}
                  <svg class="upload-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
                    <path d="M9 11l2 2 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
                  </svg>
                  <span>규정 파일 선택</span>
                {/if}
              </label>
            </div>
          {:else}
            <select
              class="text-input select-input"
              value={$grcStore.selectedNotebookId}
              aria-label="부서 프로젝트 선택"
              on:change={onNotebookChange}>
              <option value="">부서 프로젝트 선택</option>
              {#each $grcStore.notebooks as nb}
                <option value={nb.id}>{nb.name}</option>
              {/each}
            </select>
          {/if}
        </div>
      </div>
    </section>

    <section class="workflow-step">
      <header class="step-header">
        <h3><span class="step-prefix">2.</span> 검토 대상 문서</h3>
      </header>
      <p class="step-desc">계약서, 업무위탁계약서, 계획서 등 검토할 문서를 올립니다.</p>

      <div
        class="upload-zone target"
        role="region"
        aria-label="검토 대상 문서 업로드 영역"
        class:dragover={isDragOverTarget}
        on:dragover={onDragOverTarget}
        on:dragleave={onDragLeaveTarget}
        on:drop={onDropTarget}>
        <input
          type="file"
          id="targetFileInput"
          accept=".pdf,.docx,.xlsx,.txt,.hwp,.hwpx,.md"
          on:change={onTargetFileChange}
          hidden />
        <label for="targetFileInput" class="upload-label">
          {#if $grcStore.uploadingTarget}
            <span class="spinner"></span>
            <span>문서 분석 중</span>
          {:else if $grcStore.targetDocName}
            <span class="file-name">
              <svg class="file-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 4h10l4 4v12H5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"></path>
                <path d="M14 4v5h5" fill="none" stroke="currentColor" stroke-width="1.8"></path>
              </svg>
              {$grcStore.targetDocName}
            </span>
          {:else}
            <svg class="upload-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.82-2.83l8.48-8.48" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
            </svg>
            <span>대상 파일 선택</span>
          {/if}
        </label>
      </div>
    </section>
  </div>

  <div class="workflow-actions">
    <button
      type="button"
      class="ghost-button reset-grc-btn"
      aria-label="초기화"
      title="초기화"
      disabled={$grcStore.analyzing}
      on:click={resetGrc}>
      <svg class="btn-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 12a8 8 0 0 1 14-5.3L20 4v6h-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
        <path d="M20 12a8 8 0 0 1-14 5.3L4 20v-6h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>
    </button>

    <button
      type="button"
      class="send-button run-grc-btn"
      disabled={$grcStore.analyzing || $grcStore.uploadingPolicy || $grcStore.uploadingTarget}
      on:click={startGrcReview}>
      {#if $grcStore.analyzing}
        <span class="spinner"></span>
      {:else}
        <svg class="btn-icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="1.8"></circle>
          <path d="m20 20-3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
        </svg>
      {/if}
      검토
    </button>
  </div>

  {#if $grcStore.errorMessage}
    <div class="grc-error">{$grcStore.errorMessage}</div>
  {/if}
</div>

<style>
  .grc-sidebar-inner {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 100%;
    box-sizing: border-box;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--line);
  }

  .workflow-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
    align-items: stretch;
  }

  .workflow-step {
    min-width: 0;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .step-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-width: 0;
  }

  .step-header h3 {
    margin: 0;
    color: var(--accent-dark);
    font-size: 13px;
    font-weight: 800;
    line-height: 1.25;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .step-prefix {
    color: var(--muted);
    font-weight: 700;
    margin-right: 2px;
  }

  .step-desc {
    margin: 0;
    color: var(--muted);
    font-size: 11px;
    line-height: 1.45;
  }

  .policy-zone {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: stretch;
    min-height: 64px;
    border: 1px dashed color-mix(in srgb, var(--accent) 48%, var(--line));
    border-radius: 8px;
    background: color-mix(in srgb, var(--accent) 5%, var(--surface-2));
    overflow: hidden;
    transition: border-color 0.15s, background 0.15s;
  }

  .policy-zone.dragover {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 9%, var(--surface-2));
  }

  .policy-tabs {
    display: flex;
    flex-direction: column;
    border-right: 1px solid color-mix(in srgb, var(--accent) 22%, var(--line));
    background: var(--surface-2);
  }

  .policy-tab {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    color: var(--muted);
    font-size: 11px;
    font-weight: 700;
    padding: 8px 12px;
    line-height: 1.35;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.12s, color 0.12s;
  }

  .policy-tab + .policy-tab {
    border-top: 1px solid color-mix(in srgb, var(--accent) 18%, var(--line));
  }

  .policy-tab.active {
    background: var(--surface);
    color: var(--accent-dark);
  }

  .policy-content {
    display: flex;
    min-width: 0;
  }

  .policy-upload {
    flex: 1;
    border: 0 !important;
    background: transparent !important;
    border-radius: 0 !important;
    min-height: 62px;
  }

  .policy-content .select-input {
    border: 0;
    background: transparent;
    border-radius: 0;
    min-height: 62px;
  }

  .upload-zone {
    min-height: 64px;
    border: 1px dashed color-mix(in srgb, var(--accent) 48%, var(--line));
    border-radius: 8px;
    background: color-mix(in srgb, var(--accent) 5%, var(--surface-2));
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
    display: flex;
  }

  .upload-zone.target {
    border-color: color-mix(in srgb, var(--accent) 62%, var(--line));
  }

  .upload-zone:hover,
  .upload-zone.dragover {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 9%, var(--surface-2));
  }

  .upload-label {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 64px;
    padding: 10px 12px;
    box-sizing: border-box;
    color: var(--ink);
    cursor: pointer;
    font-size: 12px;
    font-weight: 700;
    line-height: 1.35;
    text-align: center;
  }

  .upload-icon {
    width: 18px;
    height: 18px;
    flex: 0 0 auto;
  }

  .file-icon,
  .btn-icon {
    width: 14px;
    height: 14px;
    flex: 0 0 auto;
  }

  .file-name {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-width: 0;
    max-width: 100%;
    color: var(--ink);
    font-weight: 800;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .select-input {
    width: 100%;
    min-height: 64px;
    border: 1px dashed color-mix(in srgb, var(--accent) 48%, var(--line));
    border-radius: 8px;
    background: color-mix(in srgb, var(--accent) 5%, var(--surface-2));
    color: var(--ink);
    font-size: 12px;
    padding: 8px 12px;
    box-sizing: border-box;
  }

  .workflow-actions {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 8px;
  }

  .run-grc-btn,
  .reset-grc-btn {
    height: 36px;
    border-radius: 7px;
    font-size: 12px;
    font-weight: 800;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    box-sizing: border-box;
  }

  .run-grc-btn {
    padding: 0 18px;
    min-width: 96px;
  }

  .reset-grc-btn {
    width: 36px;
    padding: 0;
    background: transparent;
    border: 1px solid var(--line);
    color: var(--muted);
  }

  .reset-grc-btn:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent-dark);
  }

  .grc-error {
    background: color-mix(in srgb, var(--danger) 8%, var(--surface));
    border: 1px solid var(--danger);
    color: var(--danger);
    font-size: 12px;
    line-height: 1.45;
    padding: 10px 12px;
    border-radius: 7px;
    word-break: break-word;
  }

  .spinner {
    display: inline-block;
    width: 12px;
    height: 12px;
    border: 2px solid transparent;
    border-top: 2px solid currentColor;
    border-right: 2px solid currentColor;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    flex: 0 0 auto;
  }

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }

  @media (max-width: 720px) {
    .workflow-grid {
      grid-template-columns: 1fr;
    }

    .step-header {
      flex-wrap: wrap;
    }
  }
</style>
