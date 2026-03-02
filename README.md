# Web Capture MCP Server

Playwright 기반 웹 스크린샷·텍스트 추출·PDF 저장 MCP 서버

<img src="https://img.shields.io/badge/TypeScript-ES2022-3178C6?style=flat&logo=typescript&logoColor=white" alt="TypeScript">
<img src="https://img.shields.io/badge/Node.js-ES_Modules-339933?style=flat&logo=node.js&logoColor=white" alt="Node.js">
<img src="https://img.shields.io/badge/Playwright-1.50.0-2EAD33?style=flat&logo=playwright&logoColor=white" alt="Playwright">
<img src="https://img.shields.io/badge/MCP-Model_Context_Protocol-4A154B?style=flat" alt="MCP">
<img src="https://img.shields.io/badge/Zod-3.25.0-3068B7?style=flat&logo=zod&logoColor=white" alt="Zod">
<img src="https://img.shields.io/badge/License-MIT-yellow?style=flat" alt="MIT License">

## 프로젝트 개요

[MCP(Model Context Protocol)](https://modelcontextprotocol.io) 기반의 웹 캡처 서버입니다. Claude Code에 웹 브라우징 능력을 부여하여, AI가 실시간 웹페이지를 스크린샷하고 구조화된 텍스트를 추출할 수 있도록 합니다.

- **동적 웹 지원**: JavaScript로 렌더링되는 SPA도 완전히 로드된 후 캡처
- **구조화된 추출**: 단순 텍스트가 아닌 title, meta, headings, links 등 메타데이터를 구조화하여 반환
- **디바이스 에뮬레이션**: iPhone, iPad, Pixel 등 실제 디바이스 viewport + User Agent 프리셋 지원
- **MCP 네이티브 통합**: Claude Code에 도구로 등록하여 자연어 명령으로 바로 사용 가능

## 주요 특징

### 웹 캡처 파이프라인

- **스크린샷**: 전체 페이지 또는 특정 CSS 셀렉터 영역만 PNG 캡처
- **텍스트 추출**: 이미지 없이 구조화된 텍스트만 빠르게 추출
- **PDF 저장**: A4, Letter 등 다양한 포맷으로 웹페이지를 PDF 변환

### 디바이스 에뮬레이션

Playwright 내장 디바이스 레지스트리를 활용하여 정확한 viewport와 User Agent를 에뮬레이션합니다.

| 프리셋 | 기기 |
|--------|------|
| `iphone-14` | iPhone 14 |
| `iphone-15` | iPhone 15 Pro Max |
| `ipad` | iPad Pro 11 |
| `pixel-7` | Pixel 7 |

### 성능 최적화

- **Lazy Browser Singleton**: 첫 요청 시 Chromium 인스턴스 생성, 이후 재사용하여 응답 속도 향상
- **자동 다운스케일링**: MCP base64 전송 제한(~800KB) 초과 시 자동 50% 축소, 원본은 디스크 보존
- **리소스 정리**: 요청별 브라우저 컨텍스트 격리 + 프로세스 종료 시 자동 브라우저 정리

## 기술 스택

| 분류 | 기술 | 용도 |
|------|------|------|
| 언어 | TypeScript (ES2022) | 타입 안전한 서버 구현 |
| 런타임 | Node.js (ES Modules) | MCP 서버 실행 환경 |
| 프로토콜 | @modelcontextprotocol/sdk v1.12.0 | MCP 서버 프레임워크 (stdio 트랜스포트) |
| 브라우저 자동화 | Playwright v1.50.0 | Chromium 헤드리스 제어 |
| 검증 | Zod v3.25.0 | 입력 스키마 유효성 검사 |

## 프로젝트 구조

```
├── src/
│   └── index.ts              # MCP 서버 메인 (도구 정의 + 브라우저 제어)
├── dist/                     # 빌드 결과물
├── package.json
├── tsconfig.json
├── LICENSE                   # MIT License
└── README.md
```

## 동작 원리

### 1. 브라우저 초기화

첫 번째 도구 호출 시 Chromium 헤드리스 인스턴스를 생성하고, 이후 모든 요청에서 재사용합니다. 프로세스 종료 시(SIGINT, SIGTERM) 자동으로 브라우저를 정리합니다.

### 2. 페이지 로딩

`waitUntil: "networkidle"` 전략으로 네트워크 요청이 완료될 때까지 대기한 후, 추가 대기 시간(기본 3000ms)을 두어 클라이언트 사이드 렌더링이 완료되도록 합니다.

### 3. 콘텐츠 추출

브라우저 내부에서 JavaScript를 실행하여 구조화된 데이터를 추출합니다:
- `document.title`, `meta description`, `og:image`
- `<h1>`~`<h3>` 헤딩 목록
- `<a>` 링크 (최대 50개)
- `document.body.innerText` (최대 5,000자)

### 4. 결과 반환

- **스크린샷**: `/tmp/web-capture/`에 원본 PNG 저장 → base64 인코딩 → 크기 초과 시 자동 다운스케일링
- **PDF**: 지정된 포맷으로 생성 후 파일 경로 반환
- **텍스트**: JSON 형태의 구조화된 메타데이터 반환

## 도구 상세

### `web_screenshot`

| 파라미터 | 타입 | 기본값 | 설명 |
|----------|------|--------|------|
| `url` | string | (필수) | 캡처할 URL |
| `viewport_width` | number | `1280` | 뷰포트 너비 (px) |
| `viewport_height` | number | `720` | 뷰포트 높이 (px) |
| `device` | string | — | 디바이스 프리셋 |
| `full_page` | boolean | `true` | 전체 페이지 캡처 여부 |
| `wait_for` | number | `3000` | JS 렌더링 대기 시간 (ms) |
| `selector` | string | — | 특정 요소만 캡처할 CSS 셀렉터 |
| `javascript` | string | — | 캡처 전 실행할 JS 코드 |

**반환**: 스크린샷 이미지 (base64 PNG) + 구조화된 메타데이터 JSON

### `web_extract`

`web_screenshot`과 동일한 파라미터 (`full_page`, `selector` 제외). 이미지 없이 JSON만 반환하여 더 빠릅니다.

### `web_pdf`

| 파라미터 | 타입 | 기본값 | 설명 |
|----------|------|--------|------|
| `url` | string | (필수) | PDF로 저장할 URL |
| `format` | string | `A4` | 페이지 포맷: `A4`, `Letter`, `Legal`, `Tabloid`, `A3` |
| `wait_for` | number | `3000` | JS 렌더링 대기 시간 (ms) |
| `javascript` | string | — | PDF 생성 전 실행할 JS 코드 |

**반환**: 저장된 PDF 파일 경로

## 시작하기

### 1. 클론 및 설치

```bash
git clone https://github.com/Happ11quokka/Web-Capture.git ~/.claude/tools/web-capture
cd ~/.claude/tools/web-capture
npm install
npx playwright install chromium
```

### 2. 빌드

```bash
npm run build
```

### 3. Claude Code에 등록

```bash
claude mcp add -s user web-capture -- node ~/.claude/tools/web-capture/dist/index.js
```

글로벌(user scope)로 등록되어 모든 프로젝트에서 사용할 수 있습니다.

### 4. 확인

Claude Code를 재시작한 후 `/mcp` 명령으로 `web_screenshot`, `web_extract`, `web_pdf` 도구가 등록되었는지 확인합니다.

### 사용 예시

```
"https://example.com 스크린샷 찍어줘"
"https://example.com을 iphone-14로 스크린샷"
"https://news.ycombinator.com에서 텍스트 추출해줘"
"https://example.com을 PDF로 저장해줘"
```

## 기술적 의사결정

| 선택 | 이유 |
|------|------|
| Playwright | Puppeteer 대비 다중 브라우저 지원, 내장 디바이스 레지스트리로 정확한 에뮬레이션, `networkidle` 대기 전략 |
| Lazy Browser Singleton | 매 요청마다 브라우저 재시작 비용 제거, 컨텍스트 격리로 요청 간 안전성 유지 |
| Zod 스키마 검증 | MCP 프로토콜의 JSON Schema 요구사항 충족 + 런타임 타입 안전성 확보 |
| stdio 트랜스포트 | Claude Code 네이티브 통합, HTTP 서버 없이 프로세스 간 직접 통신 |
| 자동 다운스케일링 | MCP base64 전송 제한(~800KB) 대응, 원본 파일은 디스크에 보존하여 품질 손실 없음 |
| ES Modules + ES2022 | 최신 JavaScript 기능 활용, top-level await 등 비동기 패턴 지원 |

## 라이선스

MIT License
