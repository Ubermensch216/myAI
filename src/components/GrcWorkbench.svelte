<script lang="ts">
  import { grcStore, sendToStudio, getGrcOpinionMarkdown } from '../stores/grcStore';
  import GrcSidebar from './GrcSidebar.svelte';

  $: reviewResult = $grcStore.reviewResult;
  $: opinionMarkdown = getGrcOpinionMarkdown(reviewResult);
  $: highCount = reviewResult?.results.filter((r) => statusLevel(r.status) === 'high').length || 0;
  $: warnCount = reviewResult?.results.filter((r) => statusLevel(r.status) === 'medium').length || 0;
  $: passCount = reviewResult?.results.filter((r) => statusLevel(r.status) === 'low').length || 0;
  $: infoCount = reviewResult?.results.filter((r) => statusLevel(r.status) === 'info').length || 0;

  $: roadmapItems = (() => {
    if (!reviewResult?.results) return [];
    return reviewResult.results
      .filter((r) => statusLevel(r.status) !== 'low' && r.remediation)
      .sort((a, b) => {
        const order: Record<string, number> = { high: 0, medium: 1, info: 2 };
        return (order[statusLevel(a.status)] ?? 2) - (order[statusLevel(b.status)] ?? 2);
      });
  })();

  $: formattedReviewedAt = (() => {
    const at = $grcStore.reviewedAt;
    if (!at) return '–';
    const d = new Date(at);
    if (isNaN(d.getTime())) return '–';
    return d.toLocaleString('ko-KR', {
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric'
    });
  })();

  function stripExt(name: string): string {
    return (name || '').replace(/\.[^/.]+$/, '');
  }

  function statusLevel(status: string): 'high' | 'medium' | 'low' | 'info' {
    const text = String(status || '').toLowerCase();
    if (text.includes('충돌') || text.includes('위반') || text.includes('부적합') || text.includes('conflict') || text.includes('non-compliant')) return 'high';
    if (text.includes('보완') || text.includes('주의') || text.includes('warn')) return 'medium';
    if (text.includes('적합') || text.includes('통과') || text.includes('compliant') || text.includes('pass')) return 'low';
    return 'info';
  }

  function riskLabel(value: string): string {
    if (value === 'High') return '높음';
    if (value === 'Medium') return '보통';
    return '낮음';
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

  function formatInline(text: string): string {
    let escaped = String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    escaped = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    escaped = escaped.replace(/__(.*?)__/g, '<strong>$1</strong>');
    escaped = escaped.replace(/\*(.*?)\*/g, '<em>$1</em>');
    escaped = escaped.replace(/_(.*?)_/g, '<em>$1</em>');
    escaped = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');
    return escaped;
  }

  function renderMarkdown(md: string): string {
    if (!md) return '';
    const lines = md.split(/\r?\n/);
    const html: string[] = [];
    let inList = false;
    let listType = '';
    let inTable = false;
    let tableRows: string[] = [];
    let inCode = false;
    let codeBlockLines: string[] = [];

    const closeList = () => {
      if (!inList) return;
      html.push(`</${listType}>`);
      inList = false;
      listType = '';
    };

    const closeTable = () => {
      if (!inTable) return;
      if (tableRows.length > 0) {
        html.push('<div class="table-wrapper"><table class="markdown-table">');
        const hasHeader = tableRows.length > 1 && /^\|?\s*:?-+:?\s*(\|?\s*:?-+:?\s*)*\|?$/.test(tableRows[1].trim());
        let startIdx = 0;
        if (hasHeader) {
          html.push('<thead><tr>');
          tableRows[0].split('|').map((c) => c.trim()).filter(Boolean).forEach((c) => html.push(`<th>${formatInline(c)}</th>`));
          html.push('</tr></thead>');
          startIdx = 2;
        }
        html.push('<tbody>');
        for (let idx = startIdx; idx < tableRows.length; idx += 1) {
          html.push('<tr>');
          tableRows[idx].split('|').map((c) => c.trim()).filter(Boolean).forEach((c) => html.push(`<td>${formatInline(c)}</td>`));
          html.push('</tr>');
        }
        html.push('</tbody></table></div>');
      }
      inTable = false;
      tableRows = [];
    };

    for (const line of lines) {
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
        codeBlockLines.push(line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
        continue;
      }
      if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
        closeList();
        inTable = true;
        tableRows.push(line);
        continue;
      }
      closeTable();

      const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
      if (headingMatch) {
        closeList();
        const level = headingMatch[1].length;
        html.push(`<h${level} class="markdown-h${level}">${formatInline(headingMatch[2])}</h${level}>`);
        continue;
      }
      const bulletMatch = line.match(/^\s*[-*+•]\s+(.*)$/);
      if (bulletMatch) {
        if (!inList || listType !== 'ul') {
          closeList();
          html.push('<ul class="markdown-ul">');
          inList = true;
          listType = 'ul';
        }
        html.push(`<li>${formatInline(bulletMatch[1])}</li>`);
        continue;
      }
      const numberedMatch = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (numberedMatch) {
        if (!inList || listType !== 'ol') {
          closeList();
          html.push('<ol class="markdown-ol">');
          inList = true;
          listType = 'ol';
        }
        html.push(`<li>${formatInline(numberedMatch[1])}</li>`);
        continue;
      }
      if (trimmed === '') {
        closeList();
        continue;
      }
      if (trimmed.startsWith('>') && !trimmed.startsWith('>>')) {
        closeList();
        html.push(`<blockquote class="markdown-quote">${formatInline(trimmed.substring(1).trim())}</blockquote>`);
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
  <section class="grc-control-panel" aria-label="내부검토 입력">
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
        <p class="loader-subtitle">기준 문서와 대상 문서를 비교해 충돌, 보완 필요 항목, 확인 불가 사항을 정리하고 있습니다.</p>

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
          <span class="loader-step-sep">/</span>
          <span class="loader-step">조항 진단</span>
          <span class="loader-step-sep">/</span>
          <span class="loader-step">보고서 구성</span>
        </div>
      </div>
    </div>
  {:else if reviewResult}
    <div class="report-toolbar">
      <h2 class="report-title">내부검토 보고서</h2>
      <button type="button" class="send-button export-btn" on:click={sendToStudio}>
        <svg class="inline-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M14 4h6v6M20 4l-9 9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
          <path d="M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>
        스튜디오 문서로 보내기
      </button>
    </div>

    <div class="grc-report-content">

      <!-- (1) 요약 카드 -->
      <section class="grc-card summary-card">
        <div class="info-row">
          <div class="info-box">
            <span class="info-label">검토 대상</span>
            <span class="info-value" title={$grcStore.targetDocName}>{$grcStore.targetDocName || targetBaseName}</span>
          </div>
          <div class="info-box">
            <span class="info-label">검토 기준</span>
            <span class="info-value" title={policyBaseName}>{policyBaseName}</span>
          </div>
          <div class="info-box">
            <span class="info-label">생성일</span>
            <span class="info-value">{formattedReviewedAt}</span>
          </div>
          <div class="info-box risk-box risk-{reviewResult.overallRisk.toLowerCase()}">
            <span class="info-label">종합 위험도</span>
            <span class="info-value risk-val">{riskLabel(reviewResult.overallRisk)}</span>
          </div>
        </div>

        <p class="summary-text">{reviewResult.summary}</p>

        <div class="risk-summary-grid">
          <div class="risk-stat-item count-high">
            <span class="stat-num">{highCount}</span>
            <span class="stat-label">충돌 가능성</span>
          </div>
          <div class="risk-stat-item count-medium">
            <span class="stat-num">{warnCount}</span>
            <span class="stat-label">보완 필요</span>
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
      </section>

      <!-- (2) LLM 의견서 초안 전문 -->
      <section class="grc-card opinion-section">
        <h3 class="section-heading">
          <svg class="inline-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 4h10l4 4v12H5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"></path>
            <path d="M14 4v5h5" fill="none" stroke="currentColor" stroke-width="1.8"></path>
          </svg>
          LLM 의견서 초안 전문
        </h3>
        <div class="opinion-text">{@html renderMarkdown(opinionMarkdown)}</div>
      </section>

      <!-- (3) 쟁점별 판단 매트릭스 -->
      {#if reviewResult.results && reviewResult.results.length > 0}
        <section class="grc-card matrix-section">
          <h3 class="section-heading">
            <svg class="inline-icon" viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"></rect>
              <path d="M3 9h18M3 15h18M9 3v18" fill="none" stroke="currentColor" stroke-width="1.8"></path>
            </svg>
            쟁점별 판단 매트릭스
          </h3>
          <div class="table-wrapper">
            <table class="matrix-table">
              <thead>
                <tr>
                  <th>검토 항목</th>
                  <th>판정</th>
                  <th>검토 의견</th>
                </tr>
              </thead>
              <tbody>
                {#each reviewResult.results as item}
                  <tr class="matrix-row status-{statusLevel(item.status)}">
                    <td class="matrix-rule">{item.ruleTitle || '검토 항목'}</td>
                    <td class="matrix-status">
                      <span class="status-tag tag-{statusLevel(item.status)}">{item.status || '확인 불가'}</span>
                    </td>
                    <td class="matrix-reason">{item.reason}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </section>
      {/if}

      <!-- (4) 우선 조치 로드맵 -->
      {#if roadmapItems.length > 0}
        <section class="grc-card roadmap-section">
          <h3 class="section-heading">
            <svg class="inline-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c1 1 1.5 1.5 1.5 3v.5h5v-.5c0-1.5.5-2 1.5-3A6 6 0 0 0 12 3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
            </svg>
            우선 조치 로드맵
          </h3>
          <div class="roadmap-list">
            {#each roadmapItems as item, i}
              <div class="roadmap-item status-{statusLevel(item.status)}">
                <div class="roadmap-num">{i + 1}</div>
                <div class="roadmap-content">
                  <div class="roadmap-header">
                    <span class="roadmap-rule">{item.ruleTitle || '검토 항목'}</span>
                    <span class="status-tag tag-{statusLevel(item.status)}">{item.status}</span>
                  </div>
                  <p class="roadmap-remediation">{item.remediation}</p>
                </div>
              </div>
            {/each}
          </div>
        </section>
      {/if}

      <!-- (5) 추가 확인 필요 자료 -->
      {#if reviewResult.missingInformation && reviewResult.missingInformation.length > 0}
        <section class="grc-card missing-card">
          <h3 class="section-heading">
            <svg class="inline-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3 2 21h20z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"></path>
              <path d="M12 10v5M12 18v.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
            </svg>
            추가 확인 필요 자료
          </h3>
          <ul class="missing-list">
            {#each reviewResult.missingInformation as info}
              <li>{info}</li>
            {/each}
          </ul>
        </section>
      {/if}

    </div>
  {:else}
    <div class="grc-empty-state">
      <svg class="empty-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
        <path d="M9 11l2 2 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>
      <h3>내부 기준 적합성 검토</h3>
      <p>상단에서 기준 문서와 검토 대상 문서를 지정하면 규정 충돌, 보완 필요 항목, 의견서 초안을 한 화면에서 확인할 수 있습니다.</p>
      <div class="grc-features-list">
        <div class="feat-item">
          <strong>자료 분리</strong>
          <span>기준 문서와 대상 문서를 분리해 검토 근거를 명확하게 유지합니다.</span>
        </div>
        <div class="feat-item">
          <strong>대시보드</strong>
          <span>위험도와 항목별 판정을 먼저 보고, 필요한 상세 사유로 내려갈 수 있습니다.</span>
        </div>
        <div class="feat-item">
          <strong>문서화</strong>
          <span>검토 결과를 스튜디오 문서 초안으로 넘겨 후속 편집과 export에 연결합니다.</span>
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
    overflow-y: auto;
    padding: 18px min(3vw, 28px) 24px;
    background: var(--surface-3);
    display: flex;
    flex-direction: column;
    gap: 16px;
    box-sizing: border-box;
  }

  .grc-control-panel {
    flex: 0 0 auto;
    min-width: 0;
  }

  .report-toolbar {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .report-title {
    margin: 0;
    font-size: 15px;
    font-weight: 800;
    color: var(--ink);
  }

  .grc-report-content {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .inline-icon {
    width: 15px;
    height: 15px;
    flex: 0 0 auto;
  }

  .empty-icon-svg {
    width: 54px;
    height: 54px;
    color: var(--accent);
  }

  .grc-loader {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
    text-align: center;
    color: var(--muted);
    padding: 24px;
  }

  .loader-card {
    width: min(100%, 560px);
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 32px;
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
    inset: 0 auto auto 0;
    width: 100%;
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
    width: 66px;
    height: 66px;
    display: grid;
    place-items: center;
  }

  .loader-ring {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    border: 3px solid var(--line);
    border-top-color: var(--accent);
    border-right-color: var(--accent);
    animation: spin 1.1s linear infinite;
  }

  .loader-shield {
    width: 28px;
    height: 28px;
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
    color: var(--ink);
    margin: 0;
  }

  .loader-subtitle {
    font-size: 12px;
    color: var(--muted);
    margin: 0;
    line-height: 1.55;
    max-width: 420px;
  }

  .loader-files {
    width: 100%;
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .loader-file-row {
    display: flex;
    align-items: center;
    gap: 10px;
    text-align: left;
    min-width: 0;
  }

  .loader-file-label {
    flex: 0 0 auto;
    font-size: 10px;
    font-weight: 800;
    padding: 3px 8px;
    border-radius: 4px;
  }

  .loader-file-label.policy {
    background: color-mix(in srgb, #2a6fdb 12%, var(--surface));
    color: #2a6fdb;
  }

  .loader-file-label.target {
    background: color-mix(in srgb, #198754 12%, var(--surface));
    color: #198754;
  }

  .loader-file-name {
    font-size: 13px;
    font-weight: 700;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
  }

  .loader-step {
    padding: 4px 9px;
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: 6px;
    font-weight: 700;
  }

  .loader-step-sep {
    color: var(--accent-dark);
    font-weight: 800;
  }

  .grc-empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    max-width: 680px;
    margin: 0 auto;
    gap: 12px;
  }

  .grc-empty-state h3 {
    margin: 0;
    font-size: 18px;
    font-weight: 800;
    color: var(--ink);
  }

  .grc-empty-state p {
    margin: 0;
    font-size: 13px;
    color: var(--muted);
    line-height: 1.55;
  }

  .grc-features-list {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    width: 100%;
    margin-top: 14px;
  }

  .feat-item {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 14px;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .feat-item strong {
    font-size: 13px;
    color: var(--accent-dark);
  }

  .feat-item span {
    font-size: 11px;
    line-height: 1.45;
    color: var(--muted);
  }

  /* ── 공통 카드 ── */
  .grc-card {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 18px;
    box-shadow: 0 4px 12px var(--shadow);
  }

  .section-heading {
    margin: 0 0 14px;
    font-size: 14px;
    font-weight: 800;
    color: var(--accent-dark);
    display: flex;
    align-items: center;
    gap: 6px;
  }

  /* ── (1) 요약 카드 ── */
  .summary-card {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .info-row {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
  }

  .info-box {
    display: flex;
    flex-direction: column;
    gap: 5px;
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: 7px;
    padding: 10px 12px;
    min-width: 0;
  }

  .info-label {
    font-size: 10px;
    font-weight: 700;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .info-value {
    font-size: 12px;
    font-weight: 700;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.4;
  }

  .risk-box.risk-high { background: #fef2f2; border-color: #fecaca; }
  .risk-box.risk-medium { background: #fffbeb; border-color: #fde68a; }
  .risk-box.risk-low { background: #f0fdf4; border-color: #bbf7d0; }

  .risk-val {
    font-size: 14px;
    font-weight: 800;
  }

  .risk-box.risk-high .risk-val { color: #b91c1c; }
  .risk-box.risk-medium .risk-val { color: #92400e; }
  .risk-box.risk-low .risk-val { color: #166534; }

  .summary-text {
    margin: 0;
    font-size: 13px;
    line-height: 1.65;
    color: var(--ink);
  }

  .risk-summary-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
  }

  .risk-stat-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 70px;
    padding: 12px;
    border-radius: 8px;
    border: 1px solid var(--line);
  }

  .risk-stat-item .stat-num {
    font-size: 22px;
    font-weight: 800;
    line-height: 1;
  }

  .risk-stat-item .stat-label {
    font-size: 11px;
    font-weight: 800;
    margin-top: 6px;
    text-align: center;
  }

  .count-high { background: #fef2f2; border-color: #fecaca; color: #b91c1c; }
  .count-medium { background: #fffbeb; border-color: #fde68a; color: #92400e; }
  .count-low { background: #f0fdf4; border-color: #bbf7d0; color: #166534; }
  .count-info { background: #f8fafc; border-color: #e2e8f0; color: #475569; }

  /* ── (2) LLM 의견서 초안 전문 ── */
  .opinion-section {
    display: flex;
    flex-direction: column;
  }

  .opinion-text {
    font-size: 13px;
    line-height: 1.65;
    color: var(--ink);
  }

  .opinion-text :global(.markdown-p) { margin: 0 0 12px 0; }

  .opinion-text :global(.markdown-h1),
  .opinion-text :global(.markdown-h2),
  .opinion-text :global(.markdown-h3),
  .opinion-text :global(.markdown-h4) {
    margin: 22px 0 10px;
    font-weight: 800;
    color: var(--ink);
  }

  .opinion-text :global(.markdown-h1) { font-size: 18px; border-bottom: 1px solid var(--line); padding-bottom: 6px; }
  .opinion-text :global(.markdown-h2) { font-size: 16px; }
  .opinion-text :global(.markdown-h3) { font-size: 14px; }
  .opinion-text :global(.markdown-h4) { font-size: 13px; }

  .opinion-text :global(.markdown-ul),
  .opinion-text :global(.markdown-ol) {
    margin: 0 0 16px;
    padding-left: 20px;
  }

  .opinion-text :global(.markdown-ul li),
  .opinion-text :global(.markdown-ol li) { margin-bottom: 6px; }

  .opinion-text :global(.markdown-quote) {
    margin: 16px 0;
    padding: 8px 16px;
    border-left: 4px solid var(--accent);
    background: var(--surface-3);
    color: var(--muted);
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

  .opinion-text :global(.table-wrapper) { margin: 16px 0; overflow-x: auto; }

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
    font-weight: 800;
  }

  .opinion-text :global(.markdown-table tr:nth-child(even)) {
    background: var(--surface-3);
  }

  /* ── (3) 쟁점별 판단 매트릭스 ── */
  .matrix-section {
    display: flex;
    flex-direction: column;
  }

  .table-wrapper {
    overflow-x: auto;
  }

  .matrix-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
    line-height: 1.5;
  }

  .matrix-table th {
    background: var(--surface-2);
    border: 1px solid var(--line);
    padding: 8px 12px;
    text-align: left;
    font-weight: 800;
    color: var(--ink);
    white-space: nowrap;
  }

  .matrix-table td {
    border: 1px solid var(--line);
    padding: 10px 12px;
    vertical-align: top;
    color: var(--ink);
  }

  .matrix-row.status-high td:first-child { border-left: 3px solid #dc2626; }
  .matrix-row.status-medium td:first-child { border-left: 3px solid #d97706; }
  .matrix-row.status-low td:first-child { border-left: 3px solid #16a34a; }
  .matrix-row.status-info td:first-child { border-left: 3px solid #64748b; }

  .matrix-rule { font-weight: 700; min-width: 120px; }
  .matrix-status { white-space: nowrap; }
  .matrix-reason { min-width: 200px; }

  /* ── (4) 우선 조치 로드맵 ── */
  .roadmap-section {
    display: flex;
    flex-direction: column;
  }

  .roadmap-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .roadmap-item {
    display: flex;
    gap: 14px;
    align-items: flex-start;
    padding: 12px 14px;
    border-radius: 7px;
    border: 1px solid var(--line);
    background: var(--surface-2);
  }

  .roadmap-item.status-high { border-left: 4px solid #dc2626; background: color-mix(in srgb, #dc2626 4%, var(--surface-2)); }
  .roadmap-item.status-medium { border-left: 4px solid #d97706; background: color-mix(in srgb, #d97706 4%, var(--surface-2)); }
  .roadmap-item.status-info { border-left: 4px solid #64748b; }

  .roadmap-num {
    flex: 0 0 auto;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--accent);
    color: white;
    font-size: 11px;
    font-weight: 800;
    display: grid;
    place-items: center;
  }

  .roadmap-content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .roadmap-header {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .roadmap-rule {
    font-size: 13px;
    font-weight: 800;
    color: var(--ink);
  }

  .roadmap-remediation {
    margin: 0;
    font-size: 12px;
    line-height: 1.55;
    color: var(--ink);
  }

  /* ── 공통 상태 태그 ── */
  .status-tag {
    flex: 0 0 auto;
    font-size: 10px;
    font-weight: 800;
    padding: 3px 8px;
    border-radius: 5px;
  }

  .tag-high { background: #fee2e2; color: #b91c1c; }
  .tag-medium { background: #fef3c7; color: #92400e; }
  .tag-low { background: #dcfce7; color: #166534; }
  .tag-info { background: #f1f5f9; color: #475569; }

  /* ── (5) 추가 확인 필요 자료 ── */
  .missing-card {
    border: 1px dashed #d97706;
    background: #fffbeb;
  }

  .missing-card .section-heading {
    color: #92400e;
  }

  .missing-list {
    margin: 0;
    padding-left: 20px;
    font-size: 12px;
    line-height: 1.6;
    color: #78350f;
  }

  .missing-list li {
    margin-bottom: 4px;
  }

  /* ── 버튼 ── */
  .export-btn {
    flex: 0 0 auto;
    min-height: 34px;
    padding: 7px 14px;
    font-size: 12px;
    border-radius: 7px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  @media (max-width: 900px) {
    .grc-main { padding: 14px; }
    .info-row,
    .risk-summary-grid,
    .grc-features-list { grid-template-columns: repeat(2, 1fr); }
    .report-toolbar { flex-direction: column; align-items: stretch; }
  }

  @media (max-width: 560px) {
    .info-row,
    .risk-summary-grid { grid-template-columns: 1fr 1fr; }
  }
</style>
