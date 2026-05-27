import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun,
  Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType, ShadingType,
  VerticalAlign, PageNumber, PageBreak, LevelFormat, ExternalHyperlink,
  TableOfContents
} = require('C:/Users/accdo/AppData/Roaming/npm/node_modules/docx');

const SS_DIR = 'C:/Users/accdo/OneDrive/사진/Screenshots/';
const OUT = 'C:/Dev/myAI/output/리걸데스크_사용자매뉴얼.docx';

function loadImg(name) {
  return fs.readFileSync(path.join(SS_DIR, name));
}

function imgRun(filename, origW, origH, displayW) {
  const scale = displayW / origW;
  const displayH = Math.round(origH * scale);
  return new ImageRun({
    type: 'png',
    data: loadImg(filename),
    transformation: { width: displayW, height: displayH },
    altText: { title: filename, description: filename, name: filename }
  });
}

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text, font: 'Malgun Gothic', bold: true })]
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text, font: 'Malgun Gothic', bold: true })]
  });
}

function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    children: [new TextRun({ text, font: 'Malgun Gothic', bold: true })]
  });
}

function para(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 120 },
    children: [new TextRun({ text, font: 'Malgun Gothic', size: 22, ...opts })]
  });
}

function bullet(text) {
  return new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    spacing: { after: 80 },
    children: [new TextRun({ text, font: 'Malgun Gothic', size: 22 })]
  });
}

function pageBreak() {
  return new Paragraph({ children: [new PageBreak()] });
}

function imgPara(filename, origW, origH, displayW = 560) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: 120 },
    children: [imgRun(filename, origW, origH, displayW)]
  });
}

function caption(text) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [new TextRun({ text, font: 'Malgun Gothic', size: 18, color: '666666', italics: true })]
  });
}

function hrLine() {
  return new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '2E5FA3', space: 1 } },
    spacing: { after: 200 }
  });
}

function featureTable(rows) {
  const border = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
  const borders = { top: border, bottom: border, left: border, right: border };
  return new Table({
    width: { size: 9026, type: WidthType.DXA },
    columnWidths: [2500, 6526],
    spacing: { after: 200 },
    rows: rows.map(([label, desc]) => new TableRow({
      children: [
        new TableCell({
          borders,
          width: { size: 2500, type: WidthType.DXA },
          shading: { fill: 'E8EEF7', type: ShadingType.CLEAR },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [new Paragraph({ children: [new TextRun({ text: label, font: 'Malgun Gothic', size: 20, bold: true })] })]
        }),
        new TableCell({
          borders,
          width: { size: 6526, type: WidthType.DXA },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [new Paragraph({ children: [new TextRun({ text: desc, font: 'Malgun Gothic', size: 20 })] })]
        })
      ]
    }))
  });
}

const doc = new Document({
  numbering: {
    config: [{
      reference: 'bullets',
      levels: [{
        level: 0,
        format: LevelFormat.BULLET,
        text: '•',
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } }
      }]
    }]
  },
  styles: {
    default: {
      document: { run: { font: 'Malgun Gothic', size: 22 } }
    },
    paragraphStyles: [
      {
        id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 36, bold: true, font: 'Malgun Gothic', color: '1B3F7A' },
        paragraph: { spacing: { before: 480, after: 240 }, outlineLevel: 0 }
      },
      {
        id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 28, bold: true, font: 'Malgun Gothic', color: '2E5FA3' },
        paragraph: { spacing: { before: 360, after: 180 }, outlineLevel: 1 }
      },
      {
        id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 24, bold: true, font: 'Malgun Gothic', color: '3A7DC9' },
        paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 2 }
      }
    ]
  },
  sections: [{
    properties: {
      page: {
        size: { width: 11906, height: 16838 },
        margin: { top: 1440, right: 1080, bottom: 1440, left: 1080 }
      }
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '2E5FA3', space: 1 } },
          spacing: { after: 120 },
          children: [
            new TextRun({ text: '리걸데스크 (LegalDesk)  사용자 매뉴얼', font: 'Malgun Gothic', size: 18, color: '2E5FA3' }),
          ]
        })]
      })
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC', space: 1 } },
          alignment: AlignmentType.CENTER,
          spacing: { before: 120 },
          children: [
            new TextRun({ text: '- ', font: 'Malgun Gothic', size: 18, color: '888888' }),
            new TextRun({ children: [PageNumber.CURRENT], font: 'Malgun Gothic', size: 18, color: '888888' }),
            new TextRun({ text: ' -', font: 'Malgun Gothic', size: 18, color: '888888' })
          ]
        })]
      })
    },
    children: [

      // ─── 표지 ───────────────────────────────────────────────────────────────
      new Paragraph({ spacing: { before: 2880 } }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 160 },
        children: [new TextRun({ text: '리걸데스크', font: 'Malgun Gothic', size: 72, bold: true, color: '1B3F7A' })]
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 160 },
        children: [new TextRun({ text: 'LegalDesk', font: 'Malgun Gothic', size: 36, color: '2E5FA3' })]
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 480 },
        children: [new TextRun({ text: '사용자 매뉴얼', font: 'Malgun Gothic', size: 40, bold: true, color: '333333' })]
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '2E5FA3', space: 1 } },
        spacing: { after: 480 }
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
        children: [new TextRun({ text: '문서 버전: 1.0', font: 'Malgun Gothic', size: 22, color: '666666' })]
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
        children: [new TextRun({ text: '작성일: 2026년 5월 27일', font: 'Malgun Gothic', size: 22, color: '666666' })]
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
        children: [new TextRun({ text: '배포: 사내 한정', font: 'Malgun Gothic', size: 22, color: '666666' })]
      }),

      pageBreak(),

      // ─── 1. 개요 ────────────────────────────────────────────────────────────
      h1('1. 개요'),
      hrLine(),

      h2('1.1 시스템 소개'),
      para('리걸데스크(LegalDesk)는 로컬 AI 모델(Ollama) 기반의 법무·컴플라이언스 전문 AI 비서 시스템입니다. 한국 법령 검색, 판례·결정례 조회, 내부 컴플라이언스 검토, 문서 분석 및 보고서 생성 등 법무 실무에 필요한 기능을 통합적으로 제공합니다.'),
      para('모든 대화 내용과 첨부 문서는 브라우저 내 암호화된 IndexedDB에 저장되어 외부로 유출되지 않으며, AI 처리는 조직 내부 서버에서 수행됩니다.'),

      h2('1.2 주요 기능'),
      featureTable([
        ['대화', '멀티룸 스트리밍 채팅. 문서·이미지 첨부, 법령 검색, 결정례 조회, 팔로우업 제안'],
        ['지식팩', '관리자가 승인한 업무 문서 묶음 조회 및 지식팩 기반 새 대화 시작 (권한 기반)'],
        ['법령검토', '법령 워크벤치를 통한 법령 조사 및 검토 보고서 자동 생성'],
        ['내부검토', '부서 지식팩·첨부 문서 기반 컴플라이언스 검토 및 보고서 생성'],
        ['스튜디오', '첨부 문서 마인드맵, 지식팩 지식그래프, 구조화 문서 편집기, 파일 도구'],
        ['일정', '한국 공휴일 기반 로컬 캘린더 에이전트'],
        ['설정', '개인 설정(이름·테마·아바타) 및 어드민 콘솔(지식팩 관리·RAG 평가·통계)']
      ]),

      h2('1.3 화면 구성'),
      para('리걸데스크 화면은 3개 영역으로 구성됩니다.'),
      featureTable([
        ['왼쪽 사이드바', '대화방 목록, 지식팩·법령검토·내부검토·일정 메뉴, 설정 버튼'],
        ['중앙 콘텐츠', '채팅 메시지, 지식팩 목록·상세, 검토 결과, 일정 등 주요 콘텐츠 표시 영역'],
        ['오른쪽 스튜디오', '마인드맵·지식그래프·문서 편집·파일도구 탭 (접기/펴기 가능)']
      ]),

      pageBreak(),

      // ─── 2. 대화 ────────────────────────────────────────────────────────────
      h1('2. 대화 (Chat)'),
      hrLine(),
      para('대화 기능은 리걸데스크의 핵심 기능입니다. 법령 조회, 문서 분석, 일반 법률 질의응답 등 다양한 용도로 활용할 수 있습니다.'),

      h2('2.1 기본 대화 및 문서 분석'),
      para('PDF·DOCX·HWPX·PPTX·XLSX·CSV·이미지 파일을 첨부하여 문서를 AI로 분석하고 질문할 수 있습니다. 첨부 파일은 자동으로 요약·토픽 추출됩니다.'),
      para('아래는 법무/컴플라이언스 관련 질의에 대해 AI가 상세한 법률 이슈를 분석하고, 오른쪽 스튜디오 패널에서 구조화 문서로 변환하는 화면입니다.'),
      imgPara('01.대화(문서화 포함).png', 1484, 908, 560),
      caption('[그림 2-1] 대화 화면 및 스튜디오 문서 생성'),

      h2('2.2 첨부 문서 마인드맵'),
      para('첨부된 문서를 AI가 분석하여 마인드맵을 자동 생성합니다. 스튜디오 패널의 [마인드맵] 탭에서 시각화된 문서 구조를 확인할 수 있습니다.'),
      imgPara('02.대화(첨부문서 Mindmap).png', 1480, 905, 560),
      caption('[그림 2-2] 첨부 문서 마인드맵 자동 생성'),

      h2('2.3 새 대화 화면 및 부서 지식팩 지식그래프'),
      para('새 대화 시작 시 Cat_Coder 마스코트가 표시됩니다. 오른쪽 스튜디오에서 부서 지식팩의 지식그래프를 조회하여 주요 개념, 법령, 절차 간의 관계를 탐색할 수 있습니다.'),
      imgPara('03.대화(프로젝트 지식그래프).png', 1577, 901, 560),
      caption('[그림 2-3] 새 대화 화면 및 지식그래프 (공무원 복무규정 지식팩)'),

      pageBreak(),

      // ─── 3. 법령 검색 ───────────────────────────────────────────────────────
      h1('3. 법령 검색 및 결정례 조회'),
      hrLine(),
      para('리걸데스크는 법.go.kr 공식 법령 데이터베이스와 헌법재판소·행정심판 결정례를 AI가 직접 검색하고 인용합니다. 법령 관련 질문 시 자동으로 공식 근거가 첨부됩니다.'),

      h2('3.1 헌법재판소 결정례 검색'),
      para('헌법재판소 결정례를 자연어로 질의하면 AI가 관련 결정례를 조회하여 핵심 요약 및 주요 근거를 정리합니다. 응답 상단의 [공식 법령] 뱃지가 표시됩니다.'),
      imgPara('03.대화(헌재결정례 1of2).png', 1071, 904, 520),
      caption('[그림 3-1] 헌법재판소 결정례 검색 결과 - 핵심 요약 및 주요 근거'),
      imgPara('03.대화(헌재결정례 2of2).png', 1074, 907, 520),
      caption('[그림 3-2] 헌법재판소 결정례 검색 결과 - 출처 패널 (결정례 D1~D5)'),

      h2('3.2 공식 법령 인용'),
      para('법령 관련 질의 시 AI는 관련 법령을 자동 검색하여 [AI-L1], [AI-L2] 등의 인용 마커로 근거를 표시합니다. 응답 하단의 출처 패널에서 각 법령의 전체 제목과 시행일을 확인할 수 있습니다.'),
      imgPara('04. 대화(관련법령1of2).png', 1074, 906, 520),
      caption('[그림 3-3] 법령 검색 및 인용 - 본문 내 인용 마커'),
      imgPara('04. 대화(관련법령2of2).png', 1075, 910, 520),
      caption('[그림 3-4] 법령 검색 및 인용 - 출처 패널 (공식 법령 목록)'),

      para('출처 패널에서 제공되는 주요 정보:'),
      bullet('법령 명칭 및 시행일'),
      bullet('인용 유형 구분: 공식 법령 [L], 헌재 결정 [D], 행정심판 결정 [D], 지식팩 [N]'),
      bullet('법령 클릭 시 법.go.kr 원문 연결'),

      pageBreak(),

      // ─── 4. 법령검토 ────────────────────────────────────────────────────────
      h1('4. 법령검토 워크벤치'),
      hrLine(),
      para('법령검토는 공식 법령을 체계적으로 조사하고 검토 보고서를 자동 작성하는 기능입니다. 왼쪽 사이드바의 [법령검토] 메뉴에서 접근합니다.'),

      h2('4.1 법령검토 프로세스'),
      para('법령검토는 다음 단계로 진행됩니다:'),
      bullet('검토 대상 법령 또는 법적 사안 입력'),
      bullet('AI가 관련 법령·시행령·예규·판례 등을 자동 수집'),
      bullet('수집된 공식 근거를 바탕으로 검토 보고서 초안 생성'),
      bullet('스튜디오 패널에서 보고서를 구조화 문서로 편집 및 내보내기'),

      h2('4.2 법령검토 화면'),
      para('아래는 공중보건의 복무기간 관련 법령을 조사하고 검토 보고서를 생성하는 화면입니다. 왼쪽에는 검색 결과가, 오른쪽 스튜디오에는 자동 생성된 법령 검토 보고서가 표시됩니다.'),
      imgPara('05.법령검토.png', 1529, 907, 560),
      caption('[그림 4-1] 법령검토 워크벤치 및 스튜디오 보고서 생성'),

      h2('4.3 주요 특징'),
      featureTable([
        ['법령 자동 수집', '법.go.kr에서 관련 법령·시행령·예규·훈령·조례 자동 검색'],
        ['결정례 연동', '헌법재판소·행정심판 결정례 동시 조회'],
        ['보고서 생성', '수집된 근거 기반 법령 검토 보고서 자동 초안 작성'],
        ['내보내기', 'HWPX·DOCX·PDF·MD 형식으로 내보내기'],
        ['법령 인용', '모든 인용에 공식 법령 번호 및 조문 번호 표시']
      ]),

      pageBreak(),

      // ─── 5. 내부검토 ────────────────────────────────────────────────────────
      h1('5. 내부검토 (컴플라이언스 검토)'),
      hrLine(),
      para('내부검토는 기준 문서(내부 규정, 지침 등)와 검토 대상 문서를 비교하여 컴플라이언스를 분석하는 기능입니다. 법무·컴플라이언스 부서에서 계약서, 보고서, 정책 문서 등을 검토할 때 활용합니다.'),

      h2('5.1 내부검토 프로세스'),
      bullet('1단계: 기준 문서(내부 규정, 표준 약관 등) 업로드 또는 부서 지식팩 선택'),
      bullet('2단계: 검토 대상 문서(계약서, 보고서 등) 업로드'),
      bullet('3단계: [검토] 버튼 클릭'),
      bullet('AI가 기준 대비 검토 항목을 분석하여 적합/부적합 여부, 조항 비교, 보고서 구성'),
      bullet('스튜디오 패널에서 결과 문서 확인 및 내보내기'),

      h2('5.2 내부검토 화면'),
      para('아래는 내부 규정을 기준으로 업무위탁계약서를 검토하는 화면입니다. 중앙에는 컴플라이언스 검토 진행 상황이, 오른쪽 스튜디오에는 검토 보고서 초안이 생성됩니다.'),
      imgPara('06. 내부검토.png', 1527, 903, 560),
      caption('[그림 5-1] 내부검토 화면 - 컴플라이언스 검토 및 보고서 생성'),

      h2('5.3 주요 특징'),
      featureTable([
        ['기준 매핑', '기준 문서의 핵심 조항을 자동 추출하여 검토 항목 구성'],
        ['조항 비교', '기준·대상 문서 간 조항별 적합성 자동 판단'],
        ['보고서 생성', '검토 결과를 구조화 문서(보고서)로 자동 작성'],
        ['부서 지식팩 연동', '부서 RAG 지식팩의 법령·지침을 검토 근거로 활용'],
        ['내보내기', 'HWPX·DOCX·PDF 형식으로 검토 보고서 내보내기']
      ]),

      pageBreak(),

      // ─── 6. 스튜디오 패널 ───────────────────────────────────────────────────
      h1('6. 스튜디오 패널'),
      hrLine(),
      para('스튜디오 패널은 화면 오른쪽에 위치한 통합 작업 공간입니다. [문서], [마인드맵], [지식그래프], [파일도구] 4개 탭으로 구성됩니다.'),

      h2('6.1 문서 편집기'),
      para('AI 답변을 공공기관 문서 양식으로 자동 변환합니다. 기본 서식 외에도 사용자 정의 템플릿을 적용할 수 있으며, HWPX·DOCX·PDF·MD 형식으로 내보낼 수 있습니다.'),
      featureTable([
        ['문서 변환', 'AI 답변을 법령 검토서, 컴플라이언스 보고서 등 공문서 양식으로 변환'],
        ['템플릿 적용', '기본 제공 템플릿 및 사용자 정의 템플릿 지원'],
        ['시각 편집', '변환된 문서를 블록 단위로 직접 편집'],
        ['내보내기', 'HWPX·DOCX·PDF·MD 형식 지원']
      ]),

      h2('6.2 마인드맵'),
      para('현재 대화방에 첨부된 문서를 AI가 분석하여 주요 개념·섹션·관계를 시각화합니다. 문서의 전체 구조를 한눈에 파악할 수 있습니다.'),

      h2('6.3 지식그래프'),
      para('부서 지식팩의 Knowledge Graph를 시각화합니다. 법령, 절차, 개념 간의 관계를 노드·엣지 형태로 탐색할 수 있습니다. 노드를 클릭하면 관련 출처 및 설명이 표시됩니다.'),
      featureTable([
        ['노드 유형', 'Document, Concept, Department, Role, Procedure, Rule, Form, System, Statute, Article'],
        ['검색 필터', '노드명/설명 검색 및 타입별 필터링'],
        ['출처 연결', '각 노드의 원본 문서 및 청크로 이동 가능'],
        ['통계', '노드 수, 엣지 수, 연결 관계 수 표시']
      ]),

      h2('6.4 파일도구'),
      para('별도 설치 없이 브라우저에서 파일을 변환·분할·병합합니다.'),
      featureTable([
        ['PDF 병합', '여러 PDF 파일을 하나로 합치기'],
        ['PDF 분할', 'PDF의 특정 페이지 범위를 별도 파일로 추출'],
        ['XLSX 병합', '여러 엑셀 파일을 하나의 워크북으로 통합'],
        ['TXT 병합/분할', '텍스트 파일 합치기 및 분할'],
        ['클라이언트 처리', '모든 파일 처리가 브라우저 내에서 완결 (서버 전송 없음)']
      ]),

      pageBreak(),

      // ─── 7. 일정 ────────────────────────────────────────────────────────────
      h1('7. 일정 (Calendar)'),
      hrLine(),
      para('일정 기능은 한국 공휴일이 연동된 로컬 캘린더입니다. 자연어로 일정을 추가하거나 조회할 수 있습니다.'),

      h2('7.1 주요 기능'),
      featureTable([
        ['일정 등록', '"다음 주 화요일 오후 2시 회의 추가해줘" 등 자연어 입력 지원'],
        ['일정 조회', '월별·주별 캘린더 뷰 및 리스트 뷰'],
        ['공휴일 연동', '한국 법정 공휴일 자동 표시'],
        ['알림', '일정 시작 전 브라우저 알림'],
        ['로컬 저장', '일정은 브라우저 IndexedDB에 저장 (외부 캘린더 미연동)']
      ]),
      para('왼쪽 사이드바의 [일정] 메뉴에서 접근합니다. 일정 메뉴 또는 대화창에서 자연어로 일정을 관리할 수 있습니다.'),

      pageBreak(),

      // ─── 8. 설정 및 어드민 콘솔 ─────────────────────────────────────────────
      h1('8. 설정 및 어드민 콘솔'),
      hrLine(),

      h2('8.1 개인 설정'),
      para('화면 왼쪽 하단의 [설정] 아이콘을 클릭하면 개인 설정 다이얼로그가 열립니다.'),
      featureTable([
        ['AI 이름', 'AI 비서의 표시 이름 변경'],
        ['아바타', 'AI 및 사용자 아바타 이미지 설정'],
        ['배너', '앱 상단 배너 이미지 변경'],
        ['테마/색상', '내장 테마 또는 사용자 정의 3색 팔레트 설정'],
        ['프롬프트 프리셋', '자주 사용하는 프롬프트를 프리셋으로 저장'],
        ['문서 템플릿', '스튜디오 문서 편집기에서 사용할 개인 템플릿 관리']
      ]),

      h2('8.2 어드민 콘솔'),
      para('ADMIN_TOKEN이 설정된 경우, 설정 다이얼로그의 [어드민 콘솔] 탭에서 시스템 관리 기능을 사용할 수 있습니다.'),
      featureTable([
        ['지식팩 관리', '부서 지식팩 생성·수정·삭제, 문서 인제스트'],
        ['접근 관리', '그룹·레벨별 접근 권한 및 비밀번호 관리'],
        ['RAG 상태', 'Qdrant·SQLite FTS 인덱스 상태 및 임베딩 검증'],
        ['RAG 품질', 'Golden Set 기반 Recall/MRR 평가 및 히스토리'],
        ['사용 통계', 'KPI 요약, 그룹별·지식팩별 활동, 최근 세션 현황'],
        ['승인 검토', 'Studio 출력물의 지식팩 편입 승인 워크플로']
      ]),

      pageBreak(),

      // ─── 9. 주요 사용 팁 ─────────────────────────────────────────────────────
      h1('9. 주요 사용 팁'),
      hrLine(),

      h2('9.1 효과적인 질의 방법'),
      bullet('법령 검색: "○○에 관한 법령을 조사해줘" 형태로 질문하면 공식 법령 엔진이 활성화됩니다.'),
      bullet('결정례 조회: "헌법재판소 결정례", "행정심판 재결례" 등 키워드를 포함하면 결정례 검색이 활성화됩니다.'),
      bullet('문서 분석: 파일 첨부 후 "이 문서에서 ○○ 부분을 정리해줘" 형태로 질문합니다.'),
      bullet('정밀 분석: 긴 문서의 전체 내용 분석이 필요할 때 [정밀 분석] 버튼을 사용합니다 (Map-Reduce 방식).'),

      h2('9.2 답변 활용'),
      bullet('[문서만들기] 버튼: AI 답변을 스튜디오 문서 편집기로 전송하여 공문서로 변환'),
      bullet('[자료 추가] 버튼: 답변을 현재 대화방의 AI 생성 자료로 저장'),
      bullet('[내보내기] 버튼: 답변을 MD·XLSX·PDF·HWPX·DOCX로 직접 내보내기'),
      bullet('팔로우업 제안: 답변 하단에 자동 생성된 후속 질문 제안을 클릭하여 대화를 이어갑니다.'),

      h2('9.3 자료 관리'),
      bullet('대화방별 첨부 파일과 AI 생성 자료는 브라우저 IndexedDB에 암호화 저장됩니다.'),
      bullet('방 목록에서 핀 아이콘으로 중요한 대화방을 상단에 고정할 수 있습니다.'),
      bullet('대화방의 자료 패널(+버튼 옆)에서 첨부 파일별 삭제 및 관리가 가능합니다.'),
      bullet('부서 지식팩은 서버에 저장되며, 어드민 승인을 통해 AI 생성 문서를 지식팩에 추가할 수 있습니다.'),

      h2('9.4 시스템 접속'),
      para('리걸데스크는 웹 브라우저로 접속합니다. 서버 URL은 시스템 관리자에게 문의하세요.'),
      featureTable([
        ['로컬 접속', 'https://localhost:3000 (서버와 같은 PC에서 접속 시)'],
        ['네트워크 접속', 'https://<서버 IP>:3000 (LAN 내 원격 접속 시, HTTPS 필수)'],
        ['권장 브라우저', 'Google Chrome, Microsoft Edge (최신 버전)'],
        ['모바일 지원', '모바일 브라우저에서도 접속 가능 (터치 UI 지원)']
      ]),

      new Paragraph({ spacing: { before: 480 } }),
      hrLine(),
      para('이 문서에 대한 문의 및 개선 요청은 시스템 관리자에게 연락하시기 바랍니다.', { color: '888888', size: 20 }),
    ]
  }]
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(OUT, buf);
  console.log('Done:', OUT);
}).catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
