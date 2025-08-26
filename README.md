<div align=center>

<a href="https://frontron.andongmin.com">
<img src="https://frontron.andongmin.com/frontron.svg" alt="logo" height="200" />
</a>

</div>

# Frontron <a href="https://npmjs.com/package/create-frontron"><img src="https://img.shields.io/npm/v/frontron" alt="npm package"></a>

> Electron 기반 데스크톱 앱 개발을 더 단순하고 빠르게

Frontron은 Electron 위에서 React + TypeScript 환경을 빠르게 셋업하고, Tailwind + Shadcn UI + 다수의 공통 컴포넌트/유틸을 포함한 개발 경험을 제공하는 단일 템플릿 & CLI 도구입니다.

- React 템플릿 지원
- Tailwind CSS + Shadcn UI 스타일 구성
- 자주 쓰는 Radix 기반 UI 컴포넌트 다수 포함
- 커스텀 프레임(TitleBar), Splash, Tray, IPC 패턴
- HMR (Vite) + Typescript + ES Module 환경
- 구조적 코드 분리 (electron / renderer)

## 핵심 기능 개요

| 영역 | 내용 |
| ---- | ---- |
| CLI (`create-frontron`) | React + TypeScript 단일 템플릿 스캐폴딩 (추후 확장 예정) |
| Electron Main | 단일 인스턴스 보장, Splash → 메인 윈도우 지연 생성, Tray, IPC 이벤트 핸들링 |
| Preload | `contextIsolation` 하에서 안전한 bridge 제공 (`electron.send/on/get`) |
| UI | Radix + Shadcn 패턴 컴포넌트 세트, Tailwind 4.x, utility helpers |
| Build | Vite (프론트), `tsc` (main/preload), electron-builder (배포) |
| 품질 | ESLint + Prettier + Import Sort + TypeScript strict 구성 |

## 프로젝트 구조 (요약)

```
frontron/
 ├─ docs/               	   # 문서 사이트 (Vite 기반)
 └─ packages/           	   # 실제 앱 (Electron + React)
	 ├─ create-frontron/       # CLI & 템플릿 소스
	 │  ├─ src/                # CLI 로직
	 │  └─ template/           # 실제 생성되는 앱 템플릿
	 │  	 └─ src/
	 │  	 	├─ electron/   # main, preload, tray, splash, ipc, window
	 │  		├─ components/ # UI 컴포넌트(Shadcn)
	 │ 			├─ hooks/
	 │  		└─ lib/        # 공용 훅/유틸
	 └─ frontron/              # 설명 패키지
```

## Node / 런타임 요구사항

- 최소 Node.js 20+ (CLI와 일부 템플릿은 18도 동작 가능하나 20 이상 권장)
- pnpm / npm / yarn / bun 모두 지원

## 시작하기 (CLI 사용)

NPM:
```bash
npm create frontron@latest
```
Yarn:
```bash
yarn create frontron
```
PNPM:
```bash
pnpm create frontron
```
Bun:
```bash
bun create frontron
```

현재는 React + TypeScript 단일 템플릿만 제공됩니다. `--template` 옵션을 넣더라도 현재 버전에서는 무시됩니다. (로드맵: 추가 템플릿)

현재 디렉터리에 생성하려면 프로젝트명을 `.` 으로 지정할 수 있습니다.

### 비대화식 예시 (실제 동일 결과)
```bash
npm create frontron@latest my-app
```

## 개발 흐름

템플릿 생성 후:
```bash
npm run app
```
동시에 Vite 개발 서버 + Electron 메인 프로세스(dev) 실행(HMR 반영). 

프로덕션 빌드:
```bash
npm run build
```
순서: `vite build` → `tsc -p tsconfig.electron.json` → `electron-builder` 로 패키징.

### Electron 구조 요약

- `main.ts`: 단일 인스턴스 잠금, Splash 생성 → 지연(2s) 후 포트 탐색(`determinePort`) → BrowserWindow 생성, Tray/IPC 초기화.
- `window.ts`: 프레임 없는(`frame: false`) 메인 창, macOS 숨김 처리, Windows 우클릭 차단 로직.
- `preload.ts`: renderer에 `electron` 네임스페이스 노출 (`send`, `on`, `get`, `removeListener`).
- `ipc.ts`: 창 상태(maximize/unmaximize) 이벤트 브로드캐스트, 최소화/토글 maximize 등 핸들러.
- `splash.ts`: 초기 로딩 화면 표시 후 main 윈도우 로드 완료 시 닫기.
- `tray.ts`: 시스템 트레이 아이콘/메뉴 관리.

### IPC 패턴

렌더러 → 메인:
```ts
window.electron.send('toggle-maximize')
```
메인 → 렌더러 (예: 창 상태 브로드캐스트):
```ts
webContents.send('window-maximized-changed', isMaximized)
```
렌더러 초기 상태 요청:
```ts
const state = await window.electron.get('get-window-state') // handle 사용 예시
```

## 포함된 UI & 스타일

- Tailwind CSS 4.x + Autoprefixer
- Shadcn 스타일 패턴 기반 Radix 컴포넌트 래핑 (Accordion, Dialog, Menu, Tabs, Tooltip 등)
- 유틸: `class-variance-authority`, `clsx`, `tailwind-merge`

## 추가 스택

- Routing (React Router DOM) - React 템플릿
- Form: `react-hook-form` + `zod` (검증)
- Chart: `recharts`
- Carousel: `embla-carousel-react`

## 스크립트 (템플릿)

| 스크립트 | 설명 |
| -------- | ---- |
| dev | Vite 개발 서버 (렌더러) |
| app | 렌더러(dev)+Electron 동시 실행 |
| build | 프론트 빌드 + Electron 타입컴파일 + 패키징 |
| lint | ESLint + Prettier 실행 |

## 배포 (electron-builder)

`build` 스크립트 실행 시 `dist_app/` 에 플랫폼 별 산출물 생성. 현재 설정:
- Windows: portable
- macOS: dir (샘플 설정, 필요 시 dmg/zip 추가 가능)

구성 커스터마이징은 템플릿 `package.json` 의 `build` 필드를 수정하세요.

## 로드맵 (예상)

- [ ] 다중 창 템플릿 옵션
- [ ] Auto Update (electron-updater) 통합
  
향후 계획 (로드맵 검토 중)
- [ ] 추가 템플릿 (예: Next.js / SWC 변형)
- [ ] 테스트(Playwright / Vitest) 기본 골격 제공
- [ ] 다국어(i18n) 예제

## 기여하기

이슈나 PR 환영합니다. 버그/제안 라벨을 활용해 주세요.

기여 절차 요약:
1. Fork & 브랜치 생성 (`feat/`, `fix/` prefix)
2. 변경 및 테스트
3. 커밋 컨벤션(간단 명령형) 권장
4. PR 열고 설명 추가 / 스크린샷 첨부

## 라이선스

MIT License. 자세한 내용은 `LICENSE.md` 참고.
