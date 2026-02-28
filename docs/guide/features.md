# 기능 (Features)

Frontron은 Electron 데스크톱 앱 기본기를 빠르게 갖출 수 있도록 설계된 CLI 템플릿 모음입니다.  
현재 `create-frontron`은 React/Vite와 Next.js/App Router 두 가지 템플릿을 제공합니다.

## 스캐폴딩 (CLI)

- `npm create frontron@latest` 또는 `npx create-frontron@latest`로 즉시 프로젝트 생성
- 템플릿 선택 지원: `react` / `next`
- 비대화식 옵션 지원: `--template`, `-t`
- 대상 디렉터리 처리 옵션 지원: `--overwrite yes|no|ignore`

## 템플릿 비교

| 항목 | React 템플릿 (`react`) | Next 템플릿 (`next`) |
| ---- | ---- | ---- |
| 렌더러 런타임 | Vite + React | Next.js App Router |
| Electron 소스 루트 | `src/electron` | `electron` |
| Electron 빌드 결과 | `dist/electron` | `.electron` |
| 앱 엔트리(`main`) | `dist/electron/main.js` | `.electron/main.js` |
| 렌더러 빌드 결과 | `dist` | `.next` |
| 패키징 출력 | `output/` | `.build/` |
| 아이콘 기본 경로 | `public/icon.ico` | `public/icon.ico` |

## Electron 아키텍처

| 모듈 | 역할 |
| ---- | ---- |
| `main.ts` | 단일 인스턴스 보장, Splash -> 포트 탐색 -> 메인 창 생성, Tray/IPC 초기화 |
| `window.ts` | 프레임 없는 창, 플랫폼별 우클릭 처리, macOS 숨김 동작 |
| `preload` | `window.electron` 브리지 노출 (`send`, `on`, 템플릿별 보조 API) |
| `ipc.ts` | 창 상태 이벤트 전파, minimize/hide/toggle maximize 핸들러 |
| `splash.ts` | 초기 로딩 화면 표시 후 렌더러 준비 시 종료 |
| `tray.ts` | 시스템 트레이 아이콘 및 메뉴 구성 |

## 개발 서버 & HMR

- React 템플릿: Vite 기반 HMR, `vite.config.ts`의 `server.port`를 기준으로 동작
- Next 템플릿: `next dev` 기반, 포트는 `NEXT_PORT` -> `PORT` -> `3000` 순으로 결정
- 공통: `npm run app`에서 렌더러 dev 서버 + Electron 실행을 `concurrently`로 처리

## UI/스타일 스택

- Tailwind CSS 4.x + Shadcn 스타일 패턴
- 다수의 Radix 기반 UI 컴포넌트 포함
- `class-variance-authority`, `clsx`, `tailwind-merge`
- `react-hook-form` + `zod`, `recharts`, `sonner`, `embla-carousel-react` 등 포함

## 빌드 & 패키징

- React 템플릿: `vite build` -> `tsc -p tsconfig.electron.json` -> `electron-builder`
- Next 템플릿: `.next/.build` 정리 -> `next build` -> `tsc -p tsconfig.electron.json` -> `electron-builder`
- 기본 타깃: Windows (`msi`, `portable`), macOS (`dir`)

## IPC & 보안 기본값

- `contextIsolation: true`, `nodeIntegration: false`
- preload를 통해 필요한 API만 노출
- 창 최대화 상태 변경 이벤트를 렌더러로 브로드캐스트해 커스텀 TitleBar 구현 지원

## 확장 포인트

| 확장 | 방법 |
| ---- | ---- |
| 다중 창 | `createWindow` 확장 + 창 레퍼런스 관리 |
| 자동 업데이트 | `electron-updater` 통합 + publish 채널 설정 |
| 설정 저장 | `electron-store` 등 key-value 스토리지 연동 |
| 네이티브 모듈 | node-gyp 기반 모듈 또는 사전 빌드 모듈 추가 |

## 스크립트 요약

| 스크립트 | 설명 |
| ---- | ---- |
| `dev` | 렌더러 개발 서버 실행 (`vite` 또는 `next dev`) |
| `app` | 렌더러 + Electron 동시 실행 |
| `build` | 렌더러 빌드 + Electron 컴파일 + 패키징 |
| `lint` | ESLint 실행 |

## 빠른 체크리스트

- [ ] 아이콘 교체 (`public/icon.ico`)
- [ ] 앱 이름/빌드 설정 변경 (`package.json` -> `build.appId`, `build.productName`)
- [ ] Tray 메뉴 수정 (`src/electron/tray.ts` 또는 `electron/tray.ts`)
- [ ] TitleBar UI 수정 (`src/components/TitleBar.tsx` 또는 `components/TitleBar.tsx`)
- [ ] `npm run lint && npm run build` 검증
