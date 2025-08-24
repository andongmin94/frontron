# 기능 (Features)

Frontron은 단순한 Electron + React 초기화 이상의 개발 경험을 제공합니다. 아래는 템플릿과 CLI가 기본적으로 제공하는 주요 기능입니다.

## 스캐폴딩 (CLI)

- `npm create frontron@latest` 명령으로 프로젝트 구조/스크립트/의존성을 즉시 구성
- React + TypeScript 단일 템플릿 (추후 확장 예정)
- 프로젝트명/템플릿 지정 비대화식 옵션 (`--template`)

## Electron 아키텍처

| 모듈 | 역할 |
| ---- | ---- |
| `main.ts` | 단일 인스턴스 보장, Splash → 포트 탐색 → 메인 윈도우 생성, Tray/IPC 초기화 |
| `window.ts` | 프레임 없는 창, 플랫폼별 우클릭 제어, macOS 숨김 처리 |
| `preload.ts` | `window.electron` 브리지: `send`, `on`, `get`, `removeListener` 노출 |
| `ipc.ts` | 창 상태 이벤트 전파, minimize/hide/toggle maximize 핸들러 |
| `splash.ts` | 초기 로딩 스플래시 표시 후 렌더러 로딩 완료 시 종료 |
| `tray.ts` | 시스템 트레이 아이콘 및 메뉴 구성 |

## 개발 서버 & HMR

- Vite 기반 HMR: 렌더러 변경 시 즉시 반영
- Electron 메인 프로세스는 Typescript 컴파일 후 재시작 (필요 최소 범위)
- `npm run app` 스크립트로 동시 실행 (concurrently)

## UI 컴포넌트 세트

- Radix UI 기반 고수준 컴포넌트(Accordion, Dialog, Dropdown, Tabs, Tooltip 등)
- Shadcn 스타일 패턴 + Tailwind 4.x + `class-variance-authority`, `tailwind-merge`
- Icon: `lucide-react`
- Form: `react-hook-form` + `zod`
- Notification: `sonner`
- 차트, Carousel 등 일반 앱에 필요한 UI 포함

## 스타일 체계

- Tailwind CSS 4.x / PostCSS 자동 구성
- 전역 스타일(`globals.css`) + 컴포넌트 단위 스타일 혼합
- 다크 모드/테마 확장은 Tailwind config 또는 CSS 변수로 쉽게 확장

## 빌드 & 패키징

- 프론트: `vite build`
- 메인/프리로드: `tsc -p tsconfig.electron.json`
- 배포: electron-builder (`dist_app/` 산출)
- Windows portable / macOS dir 기본, 필요 시 dmg/installer 형식 추가 가능

## IPC & 브리지 보안

- `contextIsolation: true` / `nodeIntegration: false` 기본 적용
- Preload에서 최소 API만 노출 → 공격면 축소
- 창 상태 변화 이벤트를 렌더러로 전파하여 사용자 정의 TitleBar 구현 용이

## 확장 포인트

| 확장 | 방법 |
| ---- | ---- |
| 다중 창 | `createWindow` 함수 복제/변형 + 창 레퍼런스 관리 |
| 자동 업데이트 | `electron-updater` 통합 후 빌드 채널 설정 |
| 설정 저장 | `electron-store` 등 key-value 스토리지 활용 |
| Native 모듈 | `node-gyp` 또는 사전 컴파일 모듈 의존성 추가 |

## 성능 고려 사항

- Splash 지연(기본 2초) 동안 포트 탐색 및 개발 서버 준비 → 체감 빠른 로딩
- 필요 시 지연 시간 `main.ts` 내 setTimeout 조정
- 패키징 용량 축소: 사용 안 하는 컴포넌트/아이콘 제거, `electron-builder` `files` 필드 최적화

## 스크립트 요약 (템플릿)

| 스크립트 | 설명 |
| -------- | ---- |
| `dev` | Vite 개발 서버 실행 |
| `app` | Vite + Electron 동시 (개발 환경) |
| `build` | 프론트 빌드 + Electron 컴파일 + 패키징 |
| `lint` | ESLint + Prettier 실행 |

## 로깅 & 디버깅 팁

- 메인 프로세스: `console.log` 출력은 Electron 콘솔/터미널에서 확인
- Renderer: DevTools (Ctrl+Shift+I) 열어 네트워크/IPC 관련 콘솔 추적
- 포트 충돌 시 `determinePort()` 로그로 실제 사용 포트 확인 후 `createWindow()` URL 동기화

## 주의사항

- `preload.ts` 직접 수정 시 타입 재생성을 위해 TS 재컴파일 필요
  
- 자동 업데이트/서명 코드는 기본 제공되지 않으므로 배포 전 필수 검토

## 로드맵 (요약)

- 다중 창 & 세션 관리 템플릿
- Auto Update/Crash Reporter 통합
- 테스트(Vitest/Playwright) 기본 스캐폴딩
- 설정 저장/업데이트 채널 예시
- i18n (다국어) 예제

## 빠른 체크리스트

- [ ] 아이콘 교체 (`public/icon.png`)
- [ ] 앱 이름/빌드 설정 변경 (`package.json` build.appId / productName)
- [ ] Tray 메뉴 수정 (`tray.ts`)
- [ ] TitleBar UI 브랜딩 반영 (`components/TitleBar.tsx`)
- [ ] 사용하지 않는 컴포넌트 제거로 의존성 슬림화
- [ ] Lint & Build 성공 (`npm run lint && npm run build`)

---
추가적으로 필요하거나 부족한 기능이 있다면 Issue/PR 로 제안해 주세요.