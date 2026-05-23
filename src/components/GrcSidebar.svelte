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
</script>

<div class="grc-sidebar-inner">
  <div class="sidebar-section">
    <h3>1. 검토 기준</h3>
    <div class="toggle-group">
      <button
        type="button"
        class="toggle-btn"
        class:active={$grcStore.policyMode === 'upload'}
        on:click={() => setPolicyMode('upload')}>
        직접 업로드
      </button>
      <button
        type="button"
        class="toggle-btn"
        class:active={$grcStore.policyMode === 'notebook'}
        on:click={() => setPolicyMode('notebook')}>
        프로젝트 지정
      </button>
    </div>

    {#if $grcStore.policyMode === 'upload'}
      <div class="upload-zone">
        <input
          type="file"
          id="policyFileInput"
          accept=".pdf,.docx,.xlsx,.txt,.hwp,.hwpx"
          on:change={onPolicyFileChange}
          hidden />
        <label for="policyFileInput" class="upload-label">
          {#if $grcStore.uploadingPolicy}
            <span class="spinner"></span> 파싱 중...
          {:else if $grcStore.policyDocName}
            <span class="file-name">📄 {$grcStore.policyDocName}</span>
          {:else}
            <span class="upload-icon">📁</span> 규정 파일 선택 (PDF, HWPX 등)
          {/if}
        </label>
      </div>
    {:else}
      <select
        class="text-input select-input"
        value={$grcStore.selectedNotebookId}
        on:change={onNotebookChange}>
        <option value="">-- 부서 프로젝트 선택 --</option>
        {#each $grcStore.notebooks as nb}
          <option value={nb.id}>{nb.name}</option>
        {/each}
      </select>
    {/if}
  </div>

  <div class="sidebar-section">
    <h3>2. 검토 대상 문서</h3>
    <div class="upload-zone">
      <input
        type="file"
        id="targetFileInput"
        accept=".pdf,.docx,.xlsx,.txt,.hwp,.hwpx"
        on:change={onTargetFileChange}
        hidden />
      <label for="targetFileInput" class="upload-label">
        {#if $grcStore.uploadingTarget}
          <span class="spinner"></span> 파싱 중...
        {:else if $grcStore.targetDocName}
          <span class="file-name">📄 {$grcStore.targetDocName}</span>
        {:else}
          <span class="upload-icon">📎</span> 대상 파일 선택 (계약서, 기안 등)
        {/if}
      </label>
    </div>
  </div>

  <div class="action-buttons">
    <button
      type="button"
      class="send-button run-grc-btn"
      disabled={$grcStore.analyzing || $grcStore.uploadingPolicy || $grcStore.uploadingTarget}
      on:click={startGrcReview}>
      {#if $grcStore.analyzing}
        <span class="spinner"></span> 검토 진행 중...
      {:else}
        🔍 규정 적합성 검토 실행
      {/if}
    </button>

    <button type="button" class="ghost-button reset-grc-btn" on:click={resetGrc}>
      ↺ 초기화
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
    gap: 20px;
    padding: 18px;
    height: 100%;
    box-sizing: border-box;
    overflow-y: auto;
  }

  .sidebar-section h3 {
    font-size: 13px;
    font-weight: 700;
    margin-bottom: 10px;
    color: var(--accent-dark);
  }

  .toggle-group {
    display: flex;
    border: 1px solid var(--line);
    border-radius: 6px;
    overflow: hidden;
    margin-bottom: 12px;
  }

  .toggle-btn {
    flex: 1;
    border: none;
    background: var(--surface-2);
    color: var(--muted);
    font-size: 11px;
    padding: 8px 0;
    cursor: pointer;
    font-weight: 700;
    transition: background 0.12s, color 0.12s;
  }

  .toggle-btn.active {
    background: var(--accent);
    color: #fff;
  }

  .upload-zone {
    border: 2px dashed var(--line);
    border-radius: 8px;
    text-align: center;
    background: var(--surface-2);
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
  }

  .upload-zone:hover {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 5%, var(--surface-2));
  }

  .upload-label {
    display: block;
    padding: 24px 10px;
    font-size: 12px;
    cursor: pointer;
    font-weight: 600;
    color: var(--muted);
  }

  .file-name {
    color: var(--ink);
    font-weight: 700;
    display: inline-block;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .select-input {
    width: 100%;
    height: 38px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--surface);
    color: var(--ink);
    font-size: 12px;
  }

  .action-buttons {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: auto;
  }

  .run-grc-btn {
    width: 100%;
    padding: 11px 0;
    font-size: 13px;
    font-weight: 700;
    border-radius: 6px;
  }

  .reset-grc-btn {
    width: 100%;
    padding: 10px 0;
    font-size: 12px;
    border-radius: 6px;
  }

  .grc-error {
    background: color-mix(in srgb, var(--danger) 10%, var(--surface));
    border: 1px solid var(--danger);
    color: var(--danger);
    font-size: 11px;
    padding: 10px;
    border-radius: 6px;
    margin-top: 10px;
    word-break: break-all;
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
    margin-right: 6px;
  }

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
</style>
