# 시작하기 (Getting Started)

## 개요

Frontron은 Electron 기반 데스크톱 애플리케이션을 웹 개발자 경험(React / Next.js, Vite, Tailwind, Shadcn UI)으로 빠르게 구축할 수 있게 도와주는 CLI & 템플릿 컬렉션입니다. 하나의 템플릿 디렉터리(`packages/create-frontron/template`)를 바탕으로 선택 옵션에 따라 React/TypeScript/SWC/Next.js 변형을 스캐폴딩합니다.

## 지원 환경 (Runtime)

- Node.js 20+ 권장 (일부 빌드 체인/라이브러리 최신 기능 사용)
- Electron (Chromium + V8) 기반 → 브라우저 호환성은 Electron 버전과 동일
- Windows / macOS / (실험적) Linux 패키징 가능 (electron-builder 설정 확장 필요)

## 템플릿 프리셋

| JavaScript | TypeScript |
| ---------- | ---------- |
| `react`    | `react-ts` |
| `react-swc`| `react-swc-ts` |
| `next`     | `next-ts`  |

프리셋은 렌더러 빌드 도구(React + Vite vs Next.js) / 언어(JS/TS) / SWC 사용 여부만 달라지며 Electron 아키텍처(메인/프리로드/트레이/스플래시/IPC) 기본 구조는 동일합니다.

## 첫 프로젝트 생성 (Scaffold)

```bash
# NPM (권장)
npm create frontron@latest

# Yarn


# PNPM
pnpm create frontron

# Bun
bun create frontron
```

프롬프트에서 프로젝트명 / 템플릿 / TypeScript 여부 등을 선택하면 폴더가 생성됩니다. 현재 디렉터리에 만들려면 이름을 `.` 로 입력하세요.

### 비대화식 예시

```bash
npm create frontron@latest my-app -- --template react
yarn create frontron my-app --template react
pnpm create frontron my-app --template react
bun create frontron my-app --template react
```

## 개발 & 빌드

```bash
npm run app    # Vite dev + Electron 동시 실행 (HMR)
npm run build  # 프론트(Vite) + Electron 컴파일 + electron-builder 패키징
```

빌드 산출물은 기본적으로 `dist_app/` 에 생성됩니다 (portable exe / dir 등). 필요시 `package.json` 의 `build` 필드를 편집하세요.

## 아이콘 교체 (Icon & Branding)

단일 `public/icon.png` 를 교체하면 다음 영역에 반영됩니다:
1. 태스크바 / Dock 아이콘
2. 시스템 트레이 아이콘
3. 앱 패키징 아이콘 (electron-builder)
4. 데스크탑/런처 바로가기
5. (웹) Favicon / 로고 사용처

권장: 정사각형 512x512 PNG. 더 다양한 플랫폼 아이콘이 필요하면 electron-builder `build` 설정 내 `mac.icon`, `win.icon`, `linux.icon` 등을 별도 지정합니다.

```
public/
└─ icon.png
```

## 프로젝트 구조(예시)

```
my-app/
	public/            # 정적 자산 (icon, svg, fonts ...)
	src/
		electron/        # main.ts, preload.ts, tray.ts, splash.ts, window.ts, ipc.ts
		components/      # UI 컴포넌트 (Shadcn + Radix 래핑)
		hooks/, lib/     # 공용 로직
		...              # 렌더러 SPA/Next 페이지 코드
	package.json
```

## IPC & Preload 간단 예시

Preload (`preload.ts`) 에서 window.electron 브리지 노출:
```ts
contextBridge.exposeInMainWorld('electron', {
	send: (ch, data) => ipcRenderer.send(ch, data),
	on: (ch, fn) => ipcRenderer.on(ch, (_, ...a) => fn(...a)),
	get: (key) => ipcRenderer.invoke('get-value', key)
})
```
렌더러 사용:
```ts
window.electron.send('toggle-maximize')
window.electron.on('window-maximized-changed', (isMax) => { /* ... */ })
```

## 보안 기본값

- `contextIsolation: true`, `nodeIntegration: false`
- 최소한의 IPC 채널만 노출 → 필요 시 preload 에 함수 추가 후 main 핸들러 구현
- 패키징 시 코드 난독화 대신 의존성 최소화 + 자동 업데이트(로드맵) 고려 권장

## 다음 단계

1. 컴포넌트 스타일 수정 (Tailwind config / globals.css)
2. Tray 메뉴 확장 (`src/electron/tray.ts`)
3. Splash 페이드아웃 / 로딩 표시 수정 (`splash.ts`)
4. 다중 창 필요 시 `createWindow` 변형 추가
5. 자동 업데이트 / 설정 저장 (electron-store 등) 통합

## 문제 해결 (Troubleshooting)

| 증상 | 원인/해결 |
| ---- | -------- |
| 창이 흰 화면 | Vite dev 서버 포트 미매칭 → `determinePort()` 로그 확인 |
| IPC 수신 안 됨 | `setupIpcHandlers()` 실행 이전 채널 사용 → 렌더러 마운트 순서 확인 |
| 아이콘 적용 안 됨 | 빌드 캐시 남음 → `dist_app` 삭제 후 재빌드 |
| 폰트 깨짐 | `public/fonts` 경로 / MIME 설정 확인 |

## 참조 링크

- Repo: https://github.com/andongmin94/frontron
- Issues & 피드백: https://github.com/andongmin94/frontron/issues
- Electron Builder 문서: https://www.electron.build

---
궁금한 점이나 개선 아이디어가 있다면 이슈를 남겨 주세요.
