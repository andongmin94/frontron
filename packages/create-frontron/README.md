<div align=center>

<a href="https://frontron.andongmin.com">
<img src="/docs/public/logo.svg" alt="logo" height=200px>
</a>

</div>

# create-frontron <a href="https://npmjs.com/package/create-frontron"><img src="https://img.shields.io/npm/v/create-frontron" alt="npm package"></a>

> Electron + React + TypeScript 데스크톱 앱 템플릿을 즉시 생성하는 CLI

Frontron CLI 는 아래 구성을 갖춘 단일 React + TypeScript 템플릿을 생성합니다:

- React + Vite + TypeScript 환경
- Electron 메인/프리로드/트레이/스플래시/IPC 기본 아키텍처
- Tailwind 4 + Shadcn 스타일 패턴 + Radix 기반 UI 컴포넌트 다수
- 커스텀 TitleBar, 창 상태 IPC 브로드캐스트, Splash 표시 흐름

## 빠른 시작

Node.js 20+ 권장.

```bash
npm create frontron@latest
```

비대화식:
```bash
npm create frontron@latest my-app
```

기타 패키지 매니저:
```bash
yarn create frontron
pnpm create frontron
bun create frontron
```

현재는 추가 템플릿 선택 옵션이 제공되지 않으며 React + TypeScript 구조로 고정 생성됩니다. (로드맵: 추가 템플릿 예정)

현재 디렉터리에 생성: 프로젝트명을 `.` 로 입력

## 생성 후 주요 스크립트

```bash
npm run app    # Vite + Electron 동시 실행 (HMR)
npm run build  # 프론트 빌드 + Electron 컴파일 + 패키징
npm run lint   # 코드 스타일/품질 점검
```

## 디렉터리 개요 (템플릿)

```
src/
	electron/ (main.ts, preload.ts, ipc.ts, tray.ts, splash.ts, window.ts)
	components/ (UI)
	hooks/ lib/ assets/
public/ (icon.png, fonts, svg)
```

## IPC 예시

Renderer → Main:
```ts
window.electron.send('toggle-maximize')
```
Main → Renderer:
```ts
webContents.send('window-maximized-changed', isMaximized)
```

## 커스터마이징 힌트

| 목표 | 위치 |
| ---- | ---- |
| 아이콘 교체 | `public/icon.png` |
| Tray 메뉴 | `src/electron/tray.ts` |
| Splash UI/시간 | `src/electron/splash.ts`, `main.ts` 지연 | 
| 다중 창 | `createWindow` 확장 및 참조 배열 유지 |
| 테마/스타일 | `globals.css`, Tailwind config |

## 로드맵 (요약)

- 다중 창 템플릿 옵션
- 자동 업데이트 통합
  
향후 로드맵(예정)
- Next.js / SWC 변형 템플릿
- 테스트 스켈레톤 (Vitest / Playwright)

## 기여

이슈/PR 환영: https://github.com/andongmin94/frontron/issues

## 라이선스

MIT. `LICENSE` 참고.

문서: https://frontron.andongmin.com
