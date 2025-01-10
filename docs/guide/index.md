# 시작하기 (Getting Started)

## 개요

Frontron은 Electron 데스크톱 앱을 빠르게 시작할 수 있는 CLI 템플릿입니다.  
현재 `create-frontron`은 템플릿 2종을 제공합니다.

| 템플릿 | 식별자 | 렌더러 |
| ---- | ---- | ---- |
| React | `react` | Vite + React 19 |
| Next.js | `next` | Next.js 16 (App Router) |

## 요구사항

- Node.js `22+` (CLI `engines.node >= 22`)
- npm / yarn / pnpm / bun 중 아무거나 사용 가능

## 프로젝트 생성

대화형(템플릿 선택 프롬프트):

```bash
npm create frontron@latest
```

템플릿 고정 비대화식:

```bash
npx create-frontron@latest my-app --template react
npx create-frontron@latest my-app --template next
```

`-t`는 `--template`의 별칭입니다.

```bash
npx create-frontron@latest my-app -t next
```

추가 팁:
- 프로젝트명을 생략하면 기본 디렉터리는 `frontron` 입니다.
- 현재 디렉터리에 만들려면 프로젝트명을 `.` 으로 입력하세요.
- 템플릿 값은 `react` 또는 `next`만 허용됩니다.

## 생성 후 실행

```bash
cd my-app
npm install
npm run app
```

`npm run app`은 템플릿별 렌더러 dev 서버 + Electron 실행을 동시에 수행합니다.

## 템플릿별 스크립트

| 스크립트 | React 템플릿 | Next 템플릿 |
| ---- | ---- | ---- |
| `dev` | `vite` | `next dev` |
| `app` | `dev + tsc(electron) + electron` 동시 실행 | `dev + tsc(electron) + electron` 동시 실행 |
| `build` | `vite build` -> `tsc -p tsconfig.electron.json` -> `electron-builder` | `next build` 전에 `.next/.build` 정리 후 `tsc` -> `electron-builder` |
| `lint` | `eslint .` | `eslint` |

## 템플릿별 기본 구조

React 템플릿:

```text
my-app/
  public/
  src/
    electron/
    components/
    hooks/
    lib/
  dist/electron/   # Electron TS 빌드 결과
  output/          # electron-builder 산출물
```

Next 템플릿:

```text
my-app/
  app/
  components/
  electron/
  lib/
  public/
  .electron/       # Electron TS 빌드 결과
  .next/           # Next build 결과
  .build/          # electron-builder 산출물
```

## Electron 브리지 빠른 예시

```ts
window.electron.send("toggle-maximize");

const off = window.electron.on?.("window-maximized-changed", (isMaximized) => {
  console.log(isMaximized);
});

const state = await window.electron.invoke?.("get-window-state");
off?.();
```

참고:
- 공통적으로 `send` / `on` 패턴을 사용합니다.
- Next 템플릿 preload에는 `invoke` 헬퍼가 기본 포함됩니다.
- React 템플릿은 preload 기본 API가 다르므로, 필요하면 preload에서 API를 확장하세요.

## 아이콘 교체

기본 앱 아이콘 경로는 템플릿 공통으로 `public/icon.ico` 입니다.

```text
public/
  icon.ico
```

## 기본 보안 설정

- `contextIsolation: true`
- `nodeIntegration: false`
- preload를 통한 제한적 API 노출

## 문제 해결 (Troubleshooting)

| 증상 | 점검 포인트 |
| ---- | ---- |
| 개발 중 흰 화면 | React: `vite.config.ts` 포트, Next: `NEXT_PORT/PORT` 확인 |
| 창 버튼(최소화/최대화) 반응 없음 | preload 브리지 API와 IPC 채널 이름 일치 여부 확인 |
| 아이콘 미반영 | 기존 빌드 산출물(`output` 또는 `.build`) 삭제 후 재빌드 |

## 참조 링크

- Repo: https://github.com/andongmin94/frontron
- Issues: https://github.com/andongmin94/frontron/issues
- Electron Builder: https://www.electron.build
