<script lang="ts">
  import { onMount } from 'svelte';

  // State
  let notebooks: any[] = [];
  let selectedNotebookId: string = '';
  let policyMode: 'upload' | 'notebook' = 'upload';
  
  let targetFile: File | null = null;
  let targetDocId: string = '';
  let targetDocName: string = '';
  let targetText: string = '';
  let uploadingTarget: boolean = false;

  let policyFile: File | null = null;
  let policyDocId: string = '';
  let policyDocName: string = '';
  let policyText: string = '';
  let uploadingPolicy: boolean = false;

  let analyzing: boolean = false;
  let errorMessage: string = '';
  
  interface GrcResult {
    ruleTitle: string;
    status: '적합' | '일부 보완 필요' | '충돌 가능성' | '확인 불가';
    reason: string;
    remediation: string;
  }

  interface GrcReviewResult {
    summary: string;
    overallRisk: 'High' | 'Medium' | 'Low';
    results: GrcResult[];
    missingInformation: string[];
    draftOpinion: string;
  }

  let reviewResult: GrcReviewResult | null = null;
  let activeTab: 'dashboard' | 'opinion' = 'dashboard';

  onMount(async () => {
    await loadNotebooks();
  });

  async function loadNotebooks() {
    try {
      const response = await fetch('/api/notebooks');
      if (response.ok) {
        const data = await response.json();
        notebooks = data.notebooks || [];
      }
    } catch (e) {
      console.error('Notebooks fetch failed:', e);
    }
  }

  // Get document cache headers
  function getHeaders() {
    const key = (window as any).state?.client?.documentCacheKey || '';
    return {
      'x-myai-document-key': key
    };
  }

  async function handleFileUpload(event: Event, type: 'target' | 'policy') {
    const input = event.target as HTMLInputElement;
    if (!input.files || !input.files[0]) return;
    const file = input.files[0];

    if (type === 'target') {
      targetFile = file;
      targetDocName = file.name;
      uploadingTarget = true;
    } else {
      policyFile = file;
      policyDocName = file.name;
      uploadingPolicy = true;
    }

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/upload', {
        method: 'POST',
        headers: getHeaders(),
        body: formData
      });

      if (!response.ok) {
        throw new Error(`파일 업로드 실패: status ${response.status}`);
      }

      const resData = await response.json();
      const doc = resData.document;
      
      // Get document detail to get full text
      const detailRes = await fetch(`/api/documents/${doc.id}`, {
        headers: getHeaders()
      });
      const detailData = await detailRes.json();
      const parsedText = detailData.document?.text || '';

      if (type === 'target') {
        targetDocId = doc.id;
        targetText = parsedText;
      } else {
        policyDocId = doc.id;
        policyText = parsedText;
      }
    } catch (err: any) {
      errorMessage = `${file.name} 처리 중 오류 발생: ${err.message}`;
    } finally {
      if (type === 'target') uploadingTarget = false;
      else uploadingPolicy = false;
    }
  }

  async function startGrcReview() {
    errorMessage = '';
    reviewResult = null;

    const currentModel = (document.querySelector('#modelInput') as HTMLInputElement)?.value || '';

    const payload: any = {
      targetText: targetText,
      model: currentModel
    };

    if (policyMode === 'notebook') {
      if (!selectedNotebookId) {
        errorMessage = '참조할 부서 프로젝트를 선택해주세요.';
        return;
      }
      payload.notebookId = selectedNotebookId;
    } else {
      if (!policyText) {
        errorMessage = '비교 검증할 규정 문서를 업로드해 주세요.';
        return;
      }
      payload.policyText = policyText;
    }

    if (!targetText) {
      errorMessage = '검토 대상 문서를 업로드해 주세요.';
      return;
    }

    analyzing = true;

    try {
      const response = await fetch('/api/compliance/grc/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `서버 오류: status ${response.status}`);
      }

      const resData = await response.json();
      reviewResult = resData.reviewResult;
      activeTab = 'dashboard';
    } catch (err: any) {
      errorMessage = err.message || 'GRC 분석 중 오류가 발생했습니다.';
    } finally {
      analyzing = false;
    }
  }

  function resetAll() {
    targetFile = null;
    targetDocId = '';
    targetDocName = '';
    targetText = '';
    
    policyFile = null;
    policyDocId = '';
    policyDocName = '';
    policyText = '';
    
    selectedNotebookId = '';
    reviewResult = null;
    errorMessage = '';
  }

  function sendToStudio() {
    if (!reviewResult || !reviewResult.draftOpinion) return;
    
    // Dispatch custom event to public/modules/documentStudio.js via window event listener
    const event = new CustomEvent('myai:grc:save-output', {
      detail: {
        title: `${targetDocName.replace(/\.[^/.]+$/, '')} 규정 검토 보고서`,
        markdown: reviewResult.draftOpinion
      }
    });
    window.dispatchEvent(event);
  }

  $: highCount = reviewResult?.results.filter(r => r.status === '충돌 가능성').length || 0;
  $: warnCount = reviewResult?.results.filter(r => r.status === '일부 보완 필요').length || 0;
  $: passCount = reviewResult?.results.filter(r => r.status === '적합').length || 0;
  $: infoCount = reviewResult?.results.filter(r => r.status === '확인 불가').length || 0;
</script>

<div class="grc-workbench-wrapper">
  <!-- Left control sidebar -->
  <div class="grc-sidebar">
    <div class="sidebar-section">
      <h3>1. 사내 규정 (검증 기준)</h3>
      <div class="toggle-group">
        <button 
          type="button" 
          class="toggle-btn" 
          class:active={policyMode === 'upload'} 
          on:click={() => policyMode = 'upload'}>
          직접 업로드
        </button>
        <button 
          type="button" 
          class="toggle-btn" 
          class:active={policyMode === 'notebook'} 
          on:click={() => policyMode = 'notebook'}>
          프로젝트 지정
        </button>
      </div>

      {#if policyMode === 'upload'}
        <div class="upload-zone">
          <input 
            type="file" 
            id="policyFileInput" 
            accept=".pdf,.docx,.xlsx,.txt,.hwp,.hwpx" 
            on:change={(e) => handleFileUpload(e, 'policy')} 
            hidden />
          <label for="policyFileInput" class="upload-label">
            {#if uploadingPolicy}
              <span class="spinner"></span> 파싱 중...
            {:else if policyDocName}
              <span class="file-name">📄 {policyDocName}</span>
            {:else}
              <span class="upload-icon">📁</span> 규정 파일 선택 (PDF, HWPX 등)
            {/if}
          </label>
        </div>
      {:else}
        <select class="text-input select-input" bind:value={selectedNotebookId}>
          <option value="">-- 부서 프로젝트 선택 --</option>
          {#each notebooks as nb}
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
          on:change={(e) => handleFileUpload(e, 'target')} 
          hidden />
        <label for="targetFileInput" class="upload-label">
          {#if uploadingTarget}
            <span class="spinner"></span> 파싱 중...
          {:else if targetDocName}
            <span class="file-name">📄 {targetDocName}</span>
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
        disabled={analyzing || uploadingPolicy || uploadingTarget} 
        on:click={startGrcReview}>
        {#if analyzing}
          <span class="spinner"></span> 검토 진행 중...
        {:else}
          🔍 규정 적합성 검토 실행
        {/if}
      </button>
      
      <button 
        type="button" 
        class="ghost-button reset-grc-btn" 
        on:click={resetAll}>
        ↺ 초기화
      </button>
    </div>

    {#if errorMessage}
      <div class="grc-error">{errorMessage}</div>
    {/if}
  </div>

  <!-- Center & Right main dashboard area -->
  <div class="grc-main">
    {#if analyzing}
      <div class="grc-loader">
        <div class="progress-spinner"></div>
        <h3>사내 규정에 따른 계약 및 문서 검토를 실행하고 있습니다.</h3>
        <p>규정 매핑, 조항 충돌 진단 및 종합 보고서를 구성 중입니다. 잠시만 기다려 주세요...</p>
      </div>
    {:else if reviewResult}
      <div class="grc-tabs-header">
        <button 
          type="button" 
          class="grc-tab-btn" 
          class:active={activeTab === 'dashboard'} 
          on:click={() => activeTab = 'dashboard'}>
          📊 검토 대시보드
        </button>
        <button 
          type="button" 
          class="grc-tab-btn" 
          class:active={activeTab === 'opinion'} 
          on:click={() => activeTab = 'opinion'}>
          📝 의견서 초안
        </button>
      </div>

      <div class="grc-tabs-content">
        {#if activeTab === 'dashboard'}
          <!-- Overall Summary Card -->
          <div class="grc-card summary-card">
            <div class="summary-header">
              <span class="risk-badge risk-{reviewResult.overallRisk.toLowerCase()}">
                종합 위험도: {reviewResult.overallRisk === 'High' ? '높음' : reviewResult.overallRisk === 'Medium' ? '보통' : '낮음'}
              </span>
            </div>
            <p class="summary-text">{reviewResult.summary}</p>

            <div class="risk-summary-grid">
              <div class="risk-stat-item count-high">
                <span class="stat-num">{highCount}</span>
                <span class="stat-label">충돌(위반)</span>
              </div>
              <div class="risk-stat-item count-medium">
                <span class="stat-num">{warnCount}</span>
                <span class="stat-label">일부 보완</span>
              </div>
              <div class="risk-stat-item count-low">
                <span class="stat-num">{passCount}</span>
                <span class="stat-label">적합</span>
              </div>
              <div class="risk-stat-item count-info">
                <span class="stat-num">{infoCount}</span>
                <span class="stat-label">확인 불가</span>
              </div>
            </div>
          </div>

          <!-- Findings List -->
          <h3 class="section-title">상세 조항별 진단 결과</h3>
          <div class="findings-list">
            {#each reviewResult.results as item}
              <div class="grc-card finding-item status-{item.status === '충돌 가능성' ? 'high' : item.status === '일부 보완 필요' ? 'medium' : item.status === '적합' ? 'low' : 'info'}">
                <div class="finding-header">
                  <h4>{item.ruleTitle}</h4>
                  <span class="status-tag">{item.status}</span>
                </div>
                <div class="finding-body">
                  <p class="finding-desc"><strong>검토 의견:</strong> {item.reason}</p>
                  {#if item.status !== '적합'}
                    <div class="remediation-box">
                      <strong>💡 권고 조치 사항:</strong>
                      <p>{item.remediation}</p>
                    </div>
                  {/if}
                </div>
              </div>
            {/each}
          </div>

          {#if reviewResult.missingInformation && reviewResult.missingInformation.length > 0}
            <div class="grc-card missing-card">
              <h4>⚠️ 추가 확인이 필요한 정보</h4>
              <ul>
                {#each reviewResult.missingInformation as info}
                  <li>{info}</li>
                {/each}
              </ul>
            </div>
          {/if}
        {:else}
          <!-- Markdown Opinion View -->
          <div class="grc-card opinion-card">
            <div class="opinion-toolbar">
              <h3>📄 준수 여부 의견 보고서 초안</h3>
              <button type="button" class="send-button export-btn" on:click={sendToStudio}>
                ✏️ 스튜디오 문서로 내보내기
              </button>
            </div>
            <pre class="opinion-text">{reviewResult.draftOpinion}</pre>
          </div>
        {/if}
      </div>
    {:else}
      <div class="grc-empty-state">
        <div class="empty-icon">🛡️</div>
        <h3>사내 규정 적합성 검토(GRC)에 오신 것을 환영합니다.</h3>
        <p>왼쪽 패널에서 기준이 되는 사내 규정 파일(혹은 부서 프로젝트)과 검토할 대상 문서를 지정해 검토를 수행해 주세요.</p>
        <div class="grc-features-list">
          <div class="feat-item">
            <strong>🔒 강력한 데이터 격리</strong>
            <span>로컬 시스템에서 동작하여 사내 대외비 조항이 클라우드로 나가지 않습니다.</span>
          </div>
          <div class="feat-item">
            <strong>📊 시각 대시보드</strong>
            <span>규정 적합 여부와 위험 조항을 통계 대시보드 형식으로 한눈에 파악합니다.</span>
          </div>
          <div class="feat-item">
            <strong>✍️ 스튜디오 문서 편집기 연계</strong>
            <span>완성된 의견서를 Document Studio로 내보내 즉시 편집 및 출력할 수 있습니다.</span>
          </div>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .grc-workbench-wrapper {
    display: flex;
    height: 100%;
    background: var(--bg);
    color: var(--ink);
  }

  /* Sidebar layout */
  .grc-sidebar {
    width: 320px;
    border-right: 1px solid var(--line);
    background: var(--surface);
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 20px;
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

  /* Main container */
  .grc-main {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
    background: var(--surface-3);
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  /* Loader state */
  .grc-loader {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    text-align: center;
    color: var(--muted);
  }

  .progress-spinner {
    width: 50px;
    height: 50px;
    border: 5px solid var(--line);
    border-top: 5px solid var(--accent);
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-bottom: 20px;
  }

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
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

  /* Empty state */
  .grc-empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    max-width: 600px;
    margin: 0 auto;
    gap: 12px;
  }

  .empty-icon {
    font-size: 60px;
    margin-bottom: 10px;
  }

  .grc-empty-state h3 {
    font-size: 18px;
    font-weight: 700;
  }

  .grc-empty-state p {
    font-size: 13px;
    color: var(--muted);
    line-height: 1.5;
  }

  .grc-features-list {
    display: grid;
    grid-template-columns: 1fr;
    gap: 12px;
    width: 100%;
    margin-top: 24px;
  }

  .feat-item {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 14px;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 4px;
    transition: transform 0.15s, border-color 0.15s;
  }

  .feat-item:hover {
    transform: translateY(-2px);
    border-color: var(--accent);
  }

  .feat-item strong {
    font-size: 13px;
    color: var(--accent-dark);
  }

  .feat-item span {
    font-size: 11px;
    color: var(--muted);
  }

  /* Tabs */
  .grc-tabs-header {
    display: flex;
    border-bottom: 1px solid var(--line);
    gap: 8px;
  }

  .grc-tab-btn {
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--muted);
    font-size: 14px;
    font-weight: 700;
    padding: 10px 16px;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
  }

  .grc-tab-btn.active {
    color: var(--accent-dark);
    border-bottom-color: var(--accent);
  }

  /* Card details */
  .grc-card {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 20px;
    box-shadow: 0 4px 12px var(--shadow);
  }

  .summary-card {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .summary-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .risk-badge {
    font-size: 11px;
    font-weight: 800;
    padding: 4px 10px;
    border-radius: 20px;
    text-transform: uppercase;
  }

  .risk-high { background: #fee2e2; color: #ef4444; }
  .risk-medium { background: #fef3c7; color: #d97706; }
  .risk-low { background: #dcfce7; color: #16a34a; }

  .summary-text {
    font-size: 13px;
    line-height: 1.6;
  }

  .risk-summary-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 10px;
    margin-top: 10px;
  }

  .risk-stat-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 12px;
    border-radius: 8px;
    border: 1px solid var(--line);
  }

  .risk-stat-item .stat-num {
    font-size: 18px;
    font-weight: 800;
  }

  .risk-stat-item .stat-label {
    font-size: 10px;
    font-weight: 700;
    margin-top: 4px;
  }

  .count-high { background: #fef2f2; border-color: #fee2e2; color: #ef4444; }
  .count-medium { background: #fffbeb; border-color: #fef3c7; color: #d97706; }
  .count-low { background: #f0fdf4; border-color: #dcfce7; color: #16a34a; }
  .count-info { background: #f8fafc; border-color: #f1f5f9; color: #64748b; }

  .section-title {
    font-size: 14px;
    font-weight: 700;
    margin-top: 10px;
    color: var(--accent-dark);
  }

  .findings-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .finding-item {
    border-left: 4px solid var(--line);
    transition: transform 0.15s;
  }

  .finding-item:hover {
    transform: translateX(2px);
  }

  .finding-item.status-high { border-left-color: #ef4444; }
  .finding-item.status-medium { border-left-color: #d97706; }
  .finding-item.status-low { border-left-color: #16a34a; }
  .finding-item.status-info { border-left-color: #64748b; }

  .finding-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
  }

  .finding-header h4 {
    font-size: 13px;
    font-weight: 700;
    margin: 0;
  }

  .status-tag {
    font-size: 10px;
    font-weight: 800;
    padding: 2px 8px;
    border-radius: 4px;
  }

  .status-high .status-tag { background: #fee2e2; color: #ef4444; }
  .status-medium .status-tag { background: #fef3c7; color: #d97706; }
  .status-low .status-tag { background: #dcfce7; color: #16a34a; }
  .status-info .status-tag { background: #f1f5f9; color: #64748b; }

  .finding-body {
    font-size: 12px;
    line-height: 1.5;
  }

  .remediation-box {
    margin-top: 12px;
    background: var(--surface-2);
    border-radius: 6px;
    padding: 10px 12px;
    border-left: 2px solid var(--accent);
  }

  .remediation-box strong {
    color: var(--accent-dark);
    display: block;
    margin-bottom: 4px;
  }

  .missing-card {
    border: 1px dashed #d97706;
    background: #fffbeb;
  }

  .missing-card h4 {
    color: #b45309;
    font-size: 13px;
    font-weight: 700;
    margin-top: 0;
  }

  .missing-card ul {
    margin: 8px 0 0;
    padding-left: 20px;
    font-size: 11px;
    line-height: 1.5;
    color: #78350f;
  }

  /* Opinion View */
  .opinion-card {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .opinion-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--line);
    padding-bottom: 12px;
  }

  .opinion-toolbar h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 700;
  }

  .export-btn {
    padding: 8px 16px;
    font-size: 12px;
    border-radius: 6px;
  }

  .opinion-text {
    font-family: inherit;
    font-size: 12px;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-all;
    background: var(--surface-2);
    padding: 16px;
    border-radius: 8px;
    border: 1px solid var(--line);
    max-height: 600px;
    overflow-y: auto;
  }
</style>
