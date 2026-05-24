<script lang="ts">
  import { grcStore, setActiveTab, sendToStudio, getGrcOpinionMarkdown } from '../stores/grcStore';
  import GrcSidebar from './GrcSidebar.svelte';

  $: reviewResult = $grcStore.reviewResult;
  $: opinionMarkdown = getGrcOpinionMarkdown(reviewResult);
  $: highCount = reviewResult?.results.filter((r) => r.status === '충돌 가능성').length || 0;
  $: warnCount = reviewResult?.results.filter((r) => r.status === '일부 보완 필요').length || 0;
  $: passCount = reviewResult?.results.filter((r) => r.status === '적합').length || 0;
  $: infoCount = reviewResult?.results.filter((r) => r.status === '확인 불가').length || 0;

  function stripExt(name: string): string {
    return (name || '').replace(/\.[^/.]+$/, '');
  }

  $: policyBaseName = (() => {
    const s = $grcStore;
    if (s.policyMode === 'notebook') {
      const nb = s.notebooks.find((n) => n.id === s.selectedNotebookId);
      return nb?.name || '검토 기준';
    }
    return stripExt(s.policyDocName) || '검토 기준';
  })();
  $: targetBaseName = stripExt($grcStore.targetDocName) || '대상 문서';

  function renderMarkdown(md: string): string {
    if (!md) return "";
    const lines = md.split(/\r?\n/);
    let html: string[] = [];
    let inList = false;
    let listType = ""; // 'ul' or 'ol'
    let inTable = false;
    let tableRows: string[] = [];
    let inCode = false;
    let codeBlockLines: string[] = [];

    const closeList = () => {
      if (inList) {
        html.push(`</${listType}>`);
        inList = false;
        listType = "";
      }
    };

    const closeTable = () => {
      if (inTable) {
        if (tableRows.length > 0) {
          html.push('<div class="table-wrapper"><table class="markdown-table">');
          let hasHeader = false;
          let startIdx = 0;
          if (tableRows.length > 1 && /^\|?\s*:?-+:?\s*(\|?\s*:?-+:?\s*)*\|?$/.test(tableRows[1].trim())) {
            hasHeader = true;
          }

          if (hasHeader) {
            html.push('<thead><tr>');
            const cols = tableRows[0].split('|').map(c => c.trim()).filter((c, i, a) => {
              if (i === 0 && c === "") return false;
              if (i === a.length - 1 && c === "") return false;
              return true;
            });
            cols.forEach(c => html.push(`<th>${formatInline(c)}</th>`));
            html.push('</tr></thead>');
            startIdx = 2; // skip header and separator
          }

          html.push('<tbody>');
          for (let idx = startIdx; idx < tableRows.length; idx++) {
            html.push('<tr>');
            const cols = tableRows[idx].split('|').map(c => c.trim()).filter((c, i, a) => {
              if (i === 0 && c === "") return false;
              if (i === a.length - 1 && c === "") return false;
              return true;
            });
            cols.forEach(c => html.push(`<td>${formatInline(c)}</td>`));
            html.push('</tr>');
          }
          html.push('</tbody></table></div>');
        }
        inTable = false;
        tableRows = [];
      }
    };

    function formatInline(text: string): string {
      let escaped = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

      escaped = escaped.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
      escaped = escaped.replace(/__(.*?)__/g, "<strong>$1</strong>");
      escaped = escaped.replace(/\*(.*?)\*/g, "<em>$1</em>");
      escaped = escaped.replace(/_(.*?)_/g, "<em>$1</em>");
      escaped = escaped.replace(/`([^`]+)`/g, "<code>$1</code>");

      return escaped;
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (trimmed.startsWith('```')) {
        if (inCode) {
          html.push(`<pre class="markdown-code"><code>${codeBlockLines.join('\n')}</code></pre>`);
          inCode = false;
          codeBlockLines = [];
        } else {
          closeList();
          closeTable();
          inCode = true;
        }
        continue;
      }

      if (inCode) {
        codeBlockLines.push(line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"));
        continue;
      }

      if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
        closeList();
        inTable = true;
        tableRows.push(line);
        continue;
      } else {
        closeTable();
      }

      const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
      if (headingMatch) {
        closeList();
        const level = headingMatch[1].length;
        const content = formatInline(headingMatch[2]);
        html.push(`<h${level} class="markdown-h${level}">${content}</h${level}>`);
        continue;
      }

      const bulletMatch = line.match(/^\s*[-*+\u2022]\s+(.*)$/);
      if (bulletMatch) {
        const content = formatInline(bulletMatch[1]);
        if (!inList || listType !== 'ul') {
          closeList();
          html.push('<ul class="markdown-ul">');
          inList = true;
          listType = 'ul';
        }
        html.push(`<li>${content}</li>`);
        continue;
      }

      const numberedMatch = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (numberedMatch) {
        const content = formatInline(numberedMatch[1]);
        if (!inList || listType !== 'ol') {
          closeList();
          html.push('<ol class="markdown-ol">');
          inList = true;
          listType = 'ol';
        }
        html.push(`<li>${content}</li>`);
        continue;
      }

      if (trimmed === '') {
        closeList();
        continue;
      }

      if (trimmed.startsWith('>') && !trimmed.startsWith('>>')) {
        closeList();
        const content = formatInline(trimmed.substring(1).trim());
        html.push(`<blockquote class="markdown-quote">${content}</blockquote>`);
        continue;
      }

      closeList();
      html.push(`<p class="markdown-p">${formatInline(line)}</p>`);
    }

    closeList();
    closeTable();

    return html.join('\n');
  }
</script>

<div class="grc-main">
  <section class="grc-inputs-top">
    <GrcSidebar />
  </section>
  {#if $grcStore.analyzing}
    <div class="grc-loader">
      <div class="loader-card">
        <div class="loader-spinner-wrap">
          <div class="loader-ring"></div>
          <svg class="loader-shield" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
            <path d="M9 11l2 2 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
          </svg>
        </div>
        <h3 class="loader-title">컴플라이언스 검토 진행 중</h3>
        <p class="loader-subtitle">AI가 두 문서를 정밀하게 대조 분석하고 있습니다.</p>

        <div class="loader-files">
          <div class="loader-file-row">
            <span class="loader-file-label policy">기준</span>
            <span class="loader-file-name">{policyBaseName}</span>
          </div>
          <div class="loader-file-row">
            <span class="loader-file-label target">대상</span>
            <span class="loader-file-name">{targetBaseName}</span>
          </div>
        </div>

        <div class="loader-steps">
          <span class="loader-step">기준 매핑</span>
          <span class="loader-step-sep">›</span>
          <span class="loader-step">조항 충돌 진단</span>
          <span class="loader-step-sep">›</span>
          <span class="loader-step">종합 보고서 구성</span>
        </div>

        <div class="loader-dots" aria-hidden="true">
          <span></span><span></span><span></span>
        </div>
      </div>
    </div>
  {:else if reviewResult}
    <div class="grc-tabs-header">
      <button
        type="button"
        class="grc-tab-btn"
        class:active={$grcStore.activeTab === 'dashboard'}
        on:click={() => setActiveTab('dashboard')}>
        <svg class="tab-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>
        검토 대시보드
      </button>
      <button
        type="button"
        class="grc-tab-btn"
        class:active={$grcStore.activeTab === 'opinion'}
        on:click={() => setActiveTab('opinion')}>
        <svg class="tab-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M14 4l6 6L8 22H2v-6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"></path>
        </svg>
        의견서 초안
      </button>
    </div>

    <div class="grc-tabs-content">
      {#if $grcStore.activeTab === 'dashboard'}
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
                    <strong>
                      <svg class="inline-icon" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c1 1 1.5 1.5 1.5 3v.5h5v-.5c0-1.5.5-2 1.5-3A6 6 0 0 0 12 3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
                      </svg>
                      권고 조치 사항:
                    </strong>
                    <p>{item.remediation}</p>
                  </div>
                {/if}
              </div>
            </div>
          {/each}
        </div>

        {#if reviewResult.missingInformation && reviewResult.missingInformation.length > 0}
          <div class="grc-card missing-card">
            <h4>
              <svg class="inline-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 3 2 21h20z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"></path>
                <path d="M12 10v5M12 18v.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
              </svg>
              추가 확인이 필요한 정보
            </h4>
            <ul>
              {#each reviewResult.missingInformation as info}
                <li>{info}</li>
              {/each}
            </ul>
          </div>
        {/if}
      {:else}
        <div class="grc-card opinion-card">
          <div class="opinion-toolbar">
            <h3>
              <svg class="inline-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 4h10l4 4v12H5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"></path>
                <path d="M14 4v5h5" fill="none" stroke="currentColor" stroke-width="1.8"></path>
              </svg>
              준수 여부 의견 보고서 초안
            </h3>
            <button type="button" class="send-button export-btn" on:click={sendToStudio}>
              <svg class="inline-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M14 4h6v6M20 4l-9 9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
                <path d="M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
              </svg>
              스튜디오 문서로 내보내기
            </button>
          </div>
          <div class="opinion-text">{@html renderMarkdown(opinionMarkdown)}</div>
        </div>
      {/if}
    </div>
  {:else}
    <div class="grc-empty-state">
      <svg class="empty-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
        <path d="M9 11l2 2 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>
      <h3>내부 기준 적합성 검토(GRC)에 오신 것을 환영합니다.</h3>
      <p>왼쪽 패널에서 기준이 되는 내부 기준 파일(혹은 부서 프로젝트)과 검토할 대상 문서를 지정해 검토를 수행해 주세요.</p>
      <div class="grc-features-list">
        <div class="feat-item">
          <strong>
            <svg class="feat-icon" viewBox="0 0 24 24" aria-hidden="true">
              <rect x="5" y="11" width="14" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"></rect>
              <path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="1.8"></path>
            </svg>
            강력한 데이터 격리
          </strong>
          <span>로컬 시스템에서 동작하여 사내 대외비 조항이 클라우드로 나가지 않습니다.</span>
        </div>
        <div class="feat-item">
          <strong>
            <svg class="feat-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
            </svg>
            시각 대시보드
          </strong>
          <span>기준 적합 여부와 위험 조항을 통계 대시보드 형식으로 한눈에 파악합니다.</span>
        </div>
        <div class="feat-item">
          <strong>
            <svg class="feat-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M14 4l6 6L8 22H2v-6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"></path>
            </svg>
            스튜디오 문서 편집기 연계
          </strong>
          <span>완성된 의견서를 Document Studio로 내보내 즉시 편집 및 출력할 수 있습니다.</span>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .grc-main {
    flex: 1;
    min-width: 0;
    height: 100%;
    overflow: auto;
    padding: 20px;
    background: var(--surface-3);
    display: flex;
    flex-direction: column;
    gap: 20px;
    box-sizing: border-box;
  }

  .grc-inputs-top {
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--surface);
    flex: 0 0 auto;
  }

  .grc-inputs-top :global(.grc-sidebar-inner) {
    flex-direction: row;
    flex-wrap: wrap;
    gap: 16px;
    padding: 14px;
    overflow: visible;
    align-items: flex-start;
  }

  .grc-inputs-top :global(.grc-sidebar-inner .sidebar-section) {
    flex: 1 1 280px;
    min-width: 240px;
  }

  .grc-inputs-top :global(.grc-sidebar-inner .action-buttons) {
    flex: 0 0 200px;
    margin-top: 0;
  }

  .grc-inputs-top :global(.grc-sidebar-inner .grc-error) {
    flex-basis: 100%;
  }

  .grc-tabs-content {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-gutter: stable;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .tab-icon {
    width: 16px;
    height: 16px;
    vertical-align: -3px;
    margin-right: 4px;
  }

  .inline-icon {
    width: 14px;
    height: 14px;
    vertical-align: -2px;
    margin-right: 4px;
  }

  .empty-icon-svg {
    width: 64px;
    height: 64px;
    color: var(--accent);
    margin-bottom: 10px;
  }

  .feat-icon {
    width: 16px;
    height: 16px;
    vertical-align: -3px;
    margin-right: 6px;
  }

  .grc-loader {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    text-align: center;
    color: var(--muted);
    padding: 24px;
  }

  .loader-card {
    width: 100%;
    max-width: 520px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 16px;
    padding: 36px 32px 28px;
    box-shadow: 0 10px 32px var(--shadow);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    position: relative;
    overflow: hidden;
  }

  .loader-card::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: linear-gradient(90deg, transparent, var(--accent), transparent);
    animation: loader-sweep 2.2s linear infinite;
  }

  @keyframes loader-sweep {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(100%); }
  }

  .loader-spinner-wrap {
    position: relative;
    width: 72px;
    height: 72px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 4px;
  }

  .loader-ring {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    border: 3px solid var(--line);
    border-top-color: var(--accent);
    border-right-color: var(--accent);
    animation: spin 1.1s cubic-bezier(0.6, 0.1, 0.4, 0.9) infinite;
  }

  .loader-shield {
    width: 30px;
    height: 30px;
    color: var(--accent);
    z-index: 1;
  }

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }

  .loader-title {
    font-size: 17px;
    font-weight: 800;
    color: var(--text);
    margin: 4px 0 0 0;
    letter-spacing: -0.2px;
  }

  .loader-subtitle {
    font-size: 12px;
    color: var(--muted);
    margin: 0 0 6px 0;
    line-height: 1.5;
  }

  .loader-files {
    width: 100%;
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin: 4px 0 8px;
  }

  .loader-file-row {
    display: flex;
    align-items: center;
    gap: 12px;
    text-align: left;
    min-width: 0;
  }

  .loader-file-label {
    flex-shrink: 0;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.5px;
    padding: 3px 9px;
    border-radius: 4px;
    text-transform: uppercase;
  }

  .loader-file-label.policy {
    background: rgba(59, 130, 246, 0.15);
    color: #60a5fa;
  }

  .loader-file-label.target {
    background: rgba(34, 197, 94, 0.15);
    color: #4ade80;
  }

  .loader-file-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  .loader-steps {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: center;
    font-size: 11px;
    color: var(--muted);
    margin-top: 4px;
  }

  .loader-step {
    padding: 4px 10px;
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: 12px;
    font-weight: 600;
  }

  .loader-step-sep {
    color: var(--accent);
    font-weight: 700;
    opacity: 0.6;
  }

  .loader-dots {
    display: flex;
    gap: 6px;
    margin-top: 6px;
  }

  .loader-dots span {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    animation: loader-bounce 1.2s ease-in-out infinite;
  }

  .loader-dots span:nth-child(2) {
    animation-delay: 0.18s;
  }

  .loader-dots span:nth-child(3) {
    animation-delay: 0.36s;
  }

  @keyframes loader-bounce {
    0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
    40% { transform: scale(1); opacity: 1; }
  }

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

  .opinion-card {
    display: flex;
    flex-direction: column;
    gap: 16px;
    flex: 1;
    min-height: 0;
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
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    font-family: inherit;
    font-size: 13px;
    line-height: 1.65;
    color: var(--text);
    padding-right: 4px;
  }

  .opinion-text :global(.markdown-p) {
    margin: 0 0 12px 0;
  }

  .opinion-text :global(.markdown-h1),
  .opinion-text :global(.markdown-h2),
  .opinion-text :global(.markdown-h3),
  .opinion-text :global(.markdown-h4) {
    margin: 24px 0 12px 0;
    font-weight: 700;
    color: var(--text-bright, #ffffff);
  }

  .opinion-text :global(.markdown-h1) { font-size: 18px; border-bottom: 1px solid var(--line); padding-bottom: 6px; }
  .opinion-text :global(.markdown-h2) { font-size: 16px; }
  .opinion-text :global(.markdown-h3) { font-size: 14px; }
  .opinion-text :global(.markdown-h4) { font-size: 13px; }

  .opinion-text :global(.markdown-ul),
  .opinion-text :global(.markdown-ol) {
    margin: 0 0 16px 0;
    padding-left: 20px;
  }

  .opinion-text :global(.markdown-ul li),
  .opinion-text :global(.markdown-ol li) {
    margin-bottom: 6px;
  }

  .opinion-text :global(.markdown-quote) {
    margin: 16px 0;
    padding: 8px 16px;
    border-left: 4px solid var(--accent, #3b82f6);
    background: var(--surface-3);
    color: var(--text-muted);
    border-radius: 0 4px 4px 0;
  }

  .opinion-text :global(pre.markdown-code) {
    margin: 16px 0;
    padding: 12px;
    background: var(--surface-1);
    border: 1px solid var(--line);
    border-radius: 6px;
    overflow-x: auto;
    font-family: monospace;
    font-size: 12px;
  }

  .opinion-text :global(code) {
    background: var(--surface-1);
    padding: 2px 4px;
    border-radius: 4px;
    font-family: monospace;
    font-size: 12px;
  }

  .opinion-text :global(.table-wrapper) {
    margin: 16px 0;
    overflow-x: auto;
  }

  .opinion-text :global(.markdown-table) {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }

  .opinion-text :global(.markdown-table th),
  .opinion-text :global(.markdown-table td) {
    border: 1px solid var(--line);
    padding: 8px 12px;
    text-align: left;
  }

  .opinion-text :global(.markdown-table th) {
    background: var(--surface-1);
    font-weight: 700;
  }

  .opinion-text :global(.markdown-table tr:nth-child(even)) {
    background: var(--surface-3);
  }
</style>
