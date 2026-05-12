import { elements } from "./state.js";

let selectedFiles = [];
let currentMode = 'merge'; // 'merge' or 'split'
let draggedItem = null;
let draggedIndex = null;

export function initDocTool() {
  const dropZone = document.getElementById("doctoolDropZone");
  const fileInput = document.getElementById("doctoolFileInput");
  const fileList = document.getElementById("doctoolFileList");
  const clearBtn = document.getElementById("doctoolClearBtn");
  const executeBtn = document.getElementById("doctoolExecuteBtn");
  const modeMergeBtn = document.getElementById("docToolModeMergeBtn");
  const modeSplitBtn = document.getElementById("docToolModeSplitBtn");
  const statusMsg = document.getElementById("doctoolStatusMsg");
  const downloadList = document.getElementById("doctoolDownloadList");

  if (!dropZone) return;

  // Dropzone events
  dropZone.addEventListener("click", () => fileInput.click());
  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("drag-over");
  });
  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("drag-over");
  });
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
    handleFiles(Array.from(e.dataTransfer.files));
  });
  fileInput.addEventListener("change", (e) => {
    handleFiles(Array.from(e.target.files));
    e.target.value = "";
  });

  // Clear button
  clearBtn.addEventListener("click", () => {
    selectedFiles = [];
    updateFileList();
    updateUI();
  });

  // Mode switching
  modeMergeBtn.addEventListener("click", () => {
    currentMode = 'merge';
    modeMergeBtn.classList.add('is-active');
    modeSplitBtn.classList.remove('is-active');
    modeMergeBtn.setAttribute('aria-selected', 'true');
    modeSplitBtn.setAttribute('aria-selected', 'false');
    document.getElementById("doctoolMergeOptions").style.display = "block";
    document.getElementById("doctoolSplitOptions").style.display = "none";
    updateUI();
  });
  modeSplitBtn.addEventListener("click", () => {
    currentMode = 'split';
    modeSplitBtn.classList.add('is-active');
    modeMergeBtn.classList.remove('is-active');
    modeSplitBtn.setAttribute('aria-selected', 'true');
    modeMergeBtn.setAttribute('aria-selected', 'false');
    document.getElementById("doctoolMergeOptions").style.display = "none";
    document.getElementById("doctoolSplitOptions").style.display = "block";
    updateUI();
  });

  // Type change listeners for splitting
  document.getElementById("doctoolPdfSplitType")?.addEventListener("change", (e) => {
    document.getElementById("doctoolPdfSplitRange").style.display = e.target.value === "range" ? "block" : "none";
    document.getElementById("doctoolPdfSplitChunk").style.display = e.target.value === "chunk" ? "block" : "none";
  });
  document.getElementById("doctoolExcelSplitType")?.addEventListener("change", (e) => {
    document.getElementById("doctoolExcelSplitRow").style.display = e.target.value === "row" ? "block" : "none";
  });
  document.getElementById("doctoolTxtSplitType")?.addEventListener("change", (e) => {
    document.getElementById("doctoolTxtSplitRange").style.display = e.target.value === "range" ? "block" : "none";
    document.getElementById("doctoolTxtSplitChunk").style.display = e.target.value === "chunk" ? "block" : "none";
  });

  // Execute
  executeBtn.addEventListener("click", executeOperation);

  function handleFiles(files) {
    const validFiles = files.filter(f => {
      const ext = f.name.split('.').pop().toLowerCase();
      return ['pdf', 'xlsx', 'txt'].includes(ext);
    });

    if (validFiles.length < files.length) {
      showStatus("PDF, XLSX, TXT 파일만 지원됩니다.", "error");
    }

    validFiles.forEach(f => {
      if (f.size > 100 * 1024 * 1024) {
        showStatus(`${f.name}은(는) 100MB를 초과할 수 없습니다.`, "error");
        return;
      }
      const fileInfo = {
        file: f,
        name: f.name,
        size: f.size,
        type: f.name.split('.').pop().toLowerCase(),
        id: Date.now() + Math.random().toString(36).substr(2, 9),
        loaded: false,
        hasError: false
      };
      selectedFiles.push(fileInfo);
      loadFileContent(fileInfo);
    });
    updateFileList();
    updateUI();
  }

  async function loadFileContent(fileInfo) {
    try {
      if (fileInfo.type === 'pdf') {
        const arrayBuffer = await fileInfo.file.arrayBuffer();
        if (typeof window.PDFLib !== 'undefined') {
           fileInfo.pdfDoc = await window.PDFLib.PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
           fileInfo.pageCount = fileInfo.pdfDoc.getPageCount();
        }
      } else if (fileInfo.type === 'xlsx') {
        const arrayBuffer = await fileInfo.file.arrayBuffer();
        if (typeof window.XLSX !== 'undefined') {
           fileInfo.workbook = window.XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
           fileInfo.sheetCount = fileInfo.workbook.SheetNames.length;
        }
      } else if (fileInfo.type === 'txt') {
        fileInfo.content = await fileInfo.file.text();
      }
      fileInfo.loaded = true;
    } catch (e) {
      fileInfo.hasError = true;
      fileInfo.errorMessage = "파일 로드 실패";
    }
    updateFileList();
  }

  function updateFileList() {
    fileList.innerHTML = "";
    document.getElementById("doctoolFileHint").hidden = selectedFiles.length < 2;
    clearBtn.style.display = selectedFiles.length > 0 ? "block" : "none";

    selectedFiles.forEach((fileInfo, index) => {
      const item = document.createElement("div");
      item.className = "doctool-file-item";
      item.draggable = true;
      item.dataset.index = index;

      const infoWrap = document.createElement("div");
      infoWrap.className = "doctool-file-info";
      
      const name = document.createElement("span");
      name.className = "doctool-file-name";
      name.textContent = fileInfo.name;
      infoWrap.appendChild(name);

      const meta = document.createElement("span");
      meta.className = "doctool-file-meta";
      let metaText = formatBytes(fileInfo.size);
      if (fileInfo.hasError) metaText += " - 오류";
      else if (!fileInfo.loaded) metaText += " - 로딩중...";
      else if (fileInfo.type === 'pdf') metaText += ` - ${fileInfo.pageCount}페이지`;
      else if (fileInfo.type === 'xlsx') metaText += ` - ${fileInfo.sheetCount}시트`;
      meta.textContent = metaText;
      infoWrap.appendChild(meta);
      
      item.appendChild(infoWrap);

      const removeBtn = document.createElement("button");
      removeBtn.className = "icon-button";
      removeBtn.innerHTML = "×";
      removeBtn.onclick = () => {
        selectedFiles.splice(index, 1);
        updateFileList();
        updateUI();
      };
      item.appendChild(removeBtn);

      // Drag and drop logic
      item.addEventListener("dragstart", (e) => {
        draggedItem = item;
        draggedIndex = index;
        e.dataTransfer.effectAllowed = "move";
        setTimeout(() => item.classList.add("dragging"), 0);
      });
      item.addEventListener("dragend", () => {
        draggedItem = null;
        draggedIndex = null;
        item.classList.remove("dragging");
      });
      item.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (draggedItem && draggedItem !== item) {
          const rect = item.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          if (e.clientY < midY) {
            item.parentNode.insertBefore(draggedItem, item);
          } else {
            item.parentNode.insertBefore(draggedItem, item.nextSibling);
          }
        }
      });
      item.addEventListener("drop", () => {
        const newIndex = Array.from(item.parentNode.children).indexOf(draggedItem);
        if (draggedIndex !== null && newIndex > -1) {
          const [removed] = selectedFiles.splice(draggedIndex, 1);
          selectedFiles.splice(newIndex, 0, removed);
          updateFileList();
        }
      });

      fileList.appendChild(item);
    });
  }

  function updateUI() {
    const valid = selectedFiles.filter(f => !f.hasError && f.loaded);
    const types = [...new Set(valid.map(f => f.type))];

    // Show/hide split options based on file type
    const splitPdfOptions = document.getElementById("doctoolPdfSplitOptions");
    const splitExcelOptions = document.getElementById("doctoolExcelSplitOptions");
    const splitTxtOptions = document.getElementById("doctoolTxtSplitOptions");
    const splitEmpty = document.getElementById("doctoolSplitEmpty");
    
    if (currentMode === 'split') {
       if (valid.length === 1) {
         if (splitEmpty) splitEmpty.style.display = "none";
         splitPdfOptions.style.display = types[0] === 'pdf' ? "block" : "none";
         splitExcelOptions.style.display = types[0] === 'xlsx' ? "block" : "none";
         splitTxtOptions.style.display = types[0] === 'txt' ? "block" : "none";
       } else {
         if (splitEmpty) splitEmpty.style.display = "block";
         splitPdfOptions.style.display = "none";
         splitExcelOptions.style.display = "none";
         splitTxtOptions.style.display = "none";
       }
    } else {
       if (splitEmpty) splitEmpty.style.display = "none";
       splitPdfOptions.style.display = "none";
       splitExcelOptions.style.display = "none";
       splitTxtOptions.style.display = "none";
    }

    const mergeExcelOptions = document.getElementById("doctoolExcelMergeOptions");
    mergeExcelOptions.style.display = (currentMode === 'merge' && types[0] === 'xlsx' && types.length === 1) ? "block" : "none";

    let canExecute = valid.length > 0;
    if (currentMode === 'merge') {
      canExecute = valid.length > 1 && types.length === 1;
    } else {
      canExecute = valid.length === 1;
    }

    executeBtn.disabled = !canExecute;
  }

  async function executeOperation() {
    const valid = selectedFiles.filter(f => !f.hasError && f.loaded);
    if (!valid.length) return;

    executeBtn.disabled = true;
    showStatus("처리 중...", "info");
    downloadList.innerHTML = "";

    try {
      if (currentMode === 'merge') {
         await mergeFiles(valid);
      } else {
         await splitFile(valid[0]);
      }
    } catch (err) {
      showStatus(`오류: ${err.message}`, "error");
    } finally {
      executeBtn.disabled = false;
    }
  }

  async function mergeFiles(files) {
     const type = files[0].type;
     let filename = document.getElementById("doctoolMergeFilename").value.trim() || `Merged_${Date.now()}`;
     
     if (type === 'pdf') {
       if (typeof window.PDFLib === 'undefined') throw new Error("PDF 라이브러리가 로드되지 않았습니다.");
       const mergedPdf = await window.PDFLib.PDFDocument.create();
       for (const f of files) {
          const pages = await mergedPdf.copyPages(f.pdfDoc, f.pdfDoc.getPageIndices());
          pages.forEach(p => mergedPdf.addPage(p));
       }
       const bytes = await mergedPdf.save();
       addDownload(bytes, `${filename}.pdf`, "application/pdf");
       showStatus("PDF 병합 완료", "success");
     } else if (type === 'xlsx') {
       if (typeof window.XLSX === 'undefined') throw new Error("Excel 라이브러리가 로드되지 않았습니다.");
       const mergeType = document.getElementById("doctoolExcelMergeType").value;
       const mergedWb = window.XLSX.utils.book_new();
       
       if (mergeType === 'separate') {
         let sheetIdx = 1;
         for (const f of files) {
           f.workbook.SheetNames.forEach(name => {
             const sheet = f.workbook.Sheets[name];
             window.XLSX.utils.book_append_sheet(mergedWb, sheet, `S${sheetIdx++}_${name.substring(0,20)}`);
           });
         }
       } else {
         let allData = [];
         for (const f of files) {
           f.workbook.SheetNames.forEach(name => {
             const sheet = f.workbook.Sheets[name];
             const json = window.XLSX.utils.sheet_to_json(sheet, { header: 1 });
             if (json.length) {
               allData.push([`--- ${f.name} ---`]);
               allData.push(...json);
               allData.push([]);
             }
           });
         }
         const newSheet = window.XLSX.utils.aoa_to_sheet(allData);
         window.XLSX.utils.book_append_sheet(mergedWb, newSheet, 'MergedData');
       }
       
       const wbout = window.XLSX.write(mergedWb, { bookType: 'xlsx', type: 'array' });
       addDownload(new Uint8Array(wbout), `${filename}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
       showStatus("Excel 병합 완료", "success");
     } else if (type === 'txt') {
       let content = files.map(f => f.content).join('\n\n--- 병합됨 ---\n\n');
       addDownload(content, `${filename}.txt`, "text/plain");
       showStatus("텍스트 병합 완료", "success");
     }
  }

  async function splitFile(fileInfo) {
    const baseName = fileInfo.name.substring(0, fileInfo.name.lastIndexOf('.'));
    
    if (fileInfo.type === 'pdf') {
      const type = document.getElementById("doctoolPdfSplitType").value;
      if (type === 'chunk') {
         const chunk = parseInt(document.getElementById("doctoolPdfSplitChunk").value) || 3;
         const totalChunks = Math.ceil(fileInfo.pageCount / chunk);
         for (let i = 0; i < totalChunks; i++) {
            const start = i * chunk + 1;
            const end = Math.min((i + 1) * chunk, fileInfo.pageCount);
            const newPdf = await window.PDFLib.PDFDocument.create();
            const indices = Array.from({length: end - start + 1}, (_, k) => start - 1 + k);
            const pages = await newPdf.copyPages(fileInfo.pdfDoc, indices);
            pages.forEach(p => newPdf.addPage(p));
            const bytes = await newPdf.save();
            addDownload(bytes, `${baseName}_part${i+1}.pdf`, "application/pdf");
         }
      } else {
         const rangeStr = document.getElementById("doctoolPdfSplitRange").value;
         if (!rangeStr) throw new Error("분할 범위를 입력하세요.");
         const ranges = parseRange(rangeStr, fileInfo.pageCount);
         const newPdf = await window.PDFLib.PDFDocument.create();
         for (const p of ranges) {
           if (p > 0 && p <= fileInfo.pageCount) {
             const [page] = await newPdf.copyPages(fileInfo.pdfDoc, [p - 1]);
             newPdf.addPage(page);
           }
         }
         const bytes = await newPdf.save();
         addDownload(bytes, `${baseName}_split.pdf`, "application/pdf");
      }
      showStatus("PDF 분할 완료", "success");
    } else if (fileInfo.type === 'xlsx') {
      const type = document.getElementById("doctoolExcelSplitType").value;
      if (type === 'sheet') {
         fileInfo.workbook.SheetNames.forEach((name, i) => {
           const newWb = window.XLSX.utils.book_new();
           window.XLSX.utils.book_append_sheet(newWb, fileInfo.workbook.Sheets[name], name);
           const wbout = window.XLSX.write(newWb, { bookType: 'xlsx', type: 'array' });
           addDownload(new Uint8Array(wbout), `${baseName}_${name}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
         });
      } else {
         const chunk = parseInt(document.getElementById("doctoolExcelSplitRow").value) || 50;
         const sheet = fileInfo.workbook.Sheets[fileInfo.workbook.SheetNames[0]];
         const json = window.XLSX.utils.sheet_to_json(sheet, { header: 1 });
         if (json.length <= 1) throw new Error("데이터가 부족합니다.");
         const header = json[0];
         const data = json.slice(1);
         const chunks = Math.ceil(data.length / chunk);
         for (let i = 0; i < chunks; i++) {
           const part = data.slice(i * chunk, (i + 1) * chunk);
           const newWb = window.XLSX.utils.book_new();
           window.XLSX.utils.book_append_sheet(newWb, window.XLSX.utils.aoa_to_sheet([header, ...part]), 'Data');
           const wbout = window.XLSX.write(newWb, { bookType: 'xlsx', type: 'array' });
           addDownload(new Uint8Array(wbout), `${baseName}_part${i+1}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
         }
      }
      showStatus("Excel 분할 완료", "success");
    } else if (fileInfo.type === 'txt') {
      const lines = fileInfo.content.split('\n');
      const chunk = parseInt(document.getElementById("doctoolTxtSplitChunk").value) || 100;
      const chunks = Math.ceil(lines.length / chunk);
      for (let i=0; i<chunks; i++) {
         const part = lines.slice(i*chunk, (i+1)*chunk).join('\n');
         addDownload(part, `${baseName}_part${i+1}.txt`, "text/plain");
      }
      showStatus("텍스트 분할 완료", "success");
    }
  }

  function parseRange(str, max) {
     const res = new Set();
     const parts = str.split(',');
     for (const p of parts) {
       const trimmed = p.trim();
       if (trimmed.includes('-')) {
         const [start, end] = trimmed.split('-').map(Number);
         if (!isNaN(start) && !isNaN(end)) {
           for (let i=start; i<=end; i++) res.add(i);
         }
       } else {
         const num = Number(trimmed);
         if (!isNaN(num)) res.add(num);
       }
     }
     return Array.from(res).sort((a,b)=>a-b);
  }

  function addDownload(content, filename, mimeType) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.className = "ghost-button";
    a.style.display = "block";
    a.style.marginTop = "8px";
    a.href = url;
    a.download = filename;
    a.textContent = `⬇ 다운로드: ${filename}`;
    downloadList.appendChild(a);
  }

  function showStatus(msg, type) {
    statusMsg.textContent = msg;
    statusMsg.style.color = type === 'error' ? 'var(--danger)' : (type === 'success' ? 'var(--safe)' : 'var(--ink)');
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}
