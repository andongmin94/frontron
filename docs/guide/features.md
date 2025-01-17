# 기능

이 페이지에서는 Frontron이 제공하는 주요 기능을 살펴볼 수 있습니다.

어떤 것들이 기본으로 갖춰져 있는지 미리 알아두면, 개발할 때 **이건 직접 만들어야 하나?**라는 고민을 줄일 수 있습니다.

## 스캐폴딩 (CLI)

Frontron의 CLI는 프로젝트 생성 과정을 최대한 간단하게 만들어 줍니다.

- `npm create frontron@latest` 또는 `npx create-frontron@latest`로 즉시 프로젝트를 생성할 수 있습니다.
- 대화형 프롬프트에서 `react` / `next` 템플릿을 선택할 수 있습니다.
- `--template`(`-t`) 옵션으로 비대화식 생성도 지원합니다.
- 이미 존재하는 디렉터리에 생성할 때는 `--overwrite yes|no|ignore` 옵션으로 처리 방식을 지정할 수 있습니다.

## 템플릿 비교

두 템플릿은 렌더러 기술과 파일 구조에서 차이가 있습니다.

아래 표를 참고해서 프로젝트에 맞는 템플릿을 선택해 보세요.

| 항목 | React 템플릿 (`react`) | Next 템플릿 (`next`) |
| ---- | ---- | ---- |
| 렌더러 런타임 | Vite + React | Next.js App Router |
| Electron 소스 루트 | `src/electron` | `electron` |
| Electron 빌드 결과 | `dist/electron` | `.electron` |
| 앱 엔트리(`main`) | `dist/electron/main.js` | `.electron/main.js` |
| 렌더러 빌드 결과 | `dist` | `.next` |
| 패키징 출력 | `output/` | `.build/` |
| 아이콘 기본 경로 | `public/icon.ico` | `public/icon.ico` |

::: tip
React 템플릿은 가볍고 빠르게 시작하기 좋고, Next 템플릿은 서버 사이드 렌더링이나 파일 기반 라우팅 같은 Next.js의 강력한 기능이 필요할 때 적합합니다.
:::

## Electron 아키텍처

Frontron의 Electron 코드는 역할별로 깔끔하게 분리되어 있습니다.

각 모듈이 어떤 일을 하는지 알아두면 커스터마이징할 때 훨씬 수월합니다:

- **`main.ts`** — 앱의 진입점입니다. 단일 인스턴스를 보장하고, 스플래시 화면 표시 후 포트를 탐색해서 메인 창을 생성합니다. Tray와 IPC도 여기서 초기화됩니다.
- **`window.ts`** — 프레임 없는(frameless) 창을 생성하고, 플랫폼별 우클릭 처리나 macOS 숨김 동작을 관리합니다.
- **`preload`** — `window.electron` 브리지를 렌더러에 노출합니다. `send`, `on` 등의 API를 안전하게 사용할 수 있게 해줍니다.
- **`ipc.ts`** — 창 상태 이벤트를 렌더러로 전파하고, 최소화/숨김/최대화 토글 같은 핸들러를 관리합니다.
- **`splash.ts`** — 앱 시작 시 로딩 화면을 보여주고, 렌더러가 준비되면 자동으로 종료됩니다.
- **`tray.ts`** — 시스템 트레이 아이콘과 메뉴를 구성합니다.

## 개발 서버 & HMR

개발 중에는 코드를 수정할 때마다 자동으로 화면이 갱신되는 HMR(Hot Module Replacement)이 동작합니다.

새로고침 없이 변경 사항을 바로 확인할 수 있어서 개발 속도가 훨씬 빨라집니다.

- **React 템플릿**: Vite 기반 HMR이 동작하며, `vite.config.ts`의 `server.port`를 기준으로 연결됩니다.
- **Next 템플릿**: `next dev` 기반으로 동작하며, 포트는 `NEXT_PORT` → `PORT` → `3000` 순서로 결정됩니다.
- **공통**: `npm run app`을 실행하면 `concurrently`를 통해 렌더러 dev 서버와 Electron이 동시에 시작됩니다.

## UI/스타일 스택

템플릿에는 모던 웹 앱에서 자주 사용되는 UI 도구들이 미리 구성되어 있습니다.

디자인 시스템을 처음부터 세팅하는 수고를 덜 수 있습니다.

- Tailwind CSS 4.x + Shadcn 스타일 패턴
- 다수의 Radix 기반 UI 컴포넌트 포함
- `class-variance-authority`, `clsx`, `tailwind-merge`
- `react-hook-form` + `zod`, `recharts`, `sonner`, `embla-carousel-react` 등 포함

## 빌드 & 패키징

개발이 완료되면 `npm run build` 한 번으로 렌더러 빌드부터 Electron 컴파일, 설치 파일 생성까지 한꺼번에 처리할 수 있습니다.

- **React 템플릿**: `vite build` → `tsc -p tsconfig.electron.json` → `electron-builder`
- **Next 템플릿**: `.next/.build` 정리 → `next build` → `tsc -p tsconfig.electron.json` → `electron-builder`
- **기본 타깃**: Windows (`msi`, `portable`), macOS (`dir`)

## IPC & 보안 기본값

보안은 데스크톱 앱에서 특히 중요합니다.

Frontron은 Electron의 보안 모범 사례를 기본으로 적용하고 있습니다:

- `contextIsolation: true`, `nodeIntegration: false`로 렌더러 프로세스를 보호합니다.
- preload를 통해 꼭 필요한 API만 선별적으로 노출합니다.
- 창 최대화 상태 변경 이벤트를 렌더러로 브로드캐스트해서, 커스텀 TitleBar를 구현할 수 있도록 지원합니다.

## 확장 포인트

기본 템플릿에서 시작해서, 프로젝트 요구에 맞게 자유롭게 확장할 수 있습니다.

아래는 자주 사용되는 확장 시나리오입니다.

| 확장 | 방법 |
| ---- | ---- |
| 다중 창 | `createWindow` 확장 + 창 레퍼런스 관리 |
| 자동 업데이트 | `electron-updater` 통합 + publish 채널 설정 |
| 설정 저장 | `electron-store` 등 key-value 스토리지 연동 |
| 네이티브 모듈 | node-gyp 기반 모듈 또는 사전 빌드 모듈 추가 |

## 스크립트 요약

개발 과정에서 자주 사용하게 될 스크립트들입니다.

| 스크립트 | 설명 |
| ---- | ---- |
| `dev` | 렌더러 개발 서버 실행 (`vite` 또는 `next dev`) |
| `app` | 렌더러 + Electron 동시 실행 |
| `build` | 렌더러 빌드 + Electron 컴파일 + 패키징 |
| `lint` | ESLint 실행 |

## 빠른 체크리스트

프로젝트를 본격적으로 시작하기 전에, 아래 항목들을 하나씩 확인해 보세요.

내 앱에 맞게 커스터마이징하는 첫 단계입니다.

- [ ] 아이콘 교체 (`public/icon.ico`)
- [ ] 앱 이름/빌드 설정 변경 (`package.json` → `build.appId`, `build.productName`)
- [ ] Tray 메뉴 수정 (`src/electron/tray.ts` 또는 `electron/tray.ts`)
- [ ] TitleBar UI 수정 (`src/components/TitleBar.tsx` 또는 `components/TitleBar.tsx`)
- [ ] `npm run lint && npm run build` 검증
