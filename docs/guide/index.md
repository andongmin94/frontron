# 시작하기

Frontron에 오신 것을 환영합니다! 🎉

Frontron은 Electron 데스크톱 앱을 빠르게 만들 수 있도록 도와주는 CLI 도구입니다.

복잡한 Electron 설정을 직접 구성할 필요 없이, 명령어 하나로 바로 개발을 시작할 수 있습니다.

현재 두 가지 템플릿을 제공하고 있습니다.

| 템플릿 | 식별자 | 렌더러 |
| ---- | ---- | ---- |
| React | `react` | Vite + React 19 |
| Next.js | `next` | Next.js 16 (App Router) |

익숙한 웹 프레임워크로 데스크톱 앱을 개발할 수 있으니, 기존 웹 개발 경험을 그대로 활용하실 수 있습니다.

## 요구사항

시작하기 전에 아래 환경이 준비되어 있는지 확인해 주세요.

- Node.js `22+` (CLI `engines.node >= 22`)
- npm / yarn / pnpm / bun 중 아무거나 사용 가능

::: tip
패키지 매니저는 자유롭게 선택하셔도 괜찮습니다. 이 문서에서는 npm 기준으로 안내하지만, 다른 패키지 매니저도 동일하게 동작합니다.
:::

## 프로젝트 생성

가장 간단한 방법은 대화형 프롬프트를 사용하는 것입니다.

실행하면 템플릿을 선택할 수 있는 메뉴가 나타납니다:

```bash
npm create frontron@latest
```

이미 어떤 템플릿을 쓸지 정했다면, 비대화식으로 바로 생성할 수도 있습니다.

```bash
npx create-frontron@latest my-app --template react
npx create-frontron@latest my-app --template next
```

`-t`는 `--template`의 별칭입니다.

짧게 입력하고 싶을 때 유용합니다.

```bash
npx create-frontron@latest my-app -t next
```

::: tip
- 프로젝트명을 생략하면 기본 디렉터리 이름은 `frontron`이 됩니다.
- 현재 디렉터리에 바로 생성하고 싶으면 프로젝트명을 `.`으로 입력하세요.
- 템플릿 값은 `react` 또는 `next`만 허용됩니다.
:::

## 생성 후 실행

프로젝트가 생성되었으면, 아래 명령어로 바로 실행해 볼 수 있습니다.

```bash
cd my-app
npm install
npm run app
```

`npm run app`을 실행하면 렌더러 dev 서버와 Electron이 동시에 시작됩니다.

브라우저 대신 데스크톱 창이 열리는 것을 확인하실 수 있을 것입니다!

## 템플릿별 스크립트

두 템플릿 모두 동일한 스크립트 이름을 사용하지만, 내부 동작은 조금 다릅니다.

아래 표에서 차이를 확인해 보세요.

| 스크립트 | React 템플릿 | Next 템플릿 |
| ---- | ---- | ---- |
| `dev` | `vite` | `next dev` |
| `app` | `dev + tsc(electron) + electron` 동시 실행 | `dev + tsc(electron) + electron` 동시 실행 |
| `build` | `vite build` -> `tsc -p tsconfig.electron.json` -> `electron-builder` | `next build` 전에 `.next/.build` 정리 후 `tsc` -> `electron-builder` |
| `lint` | `eslint .` | `eslint` |

## 템플릿별 기본 구조

프로젝트가 어떤 구조로 생성되는지 미리 파악하면 개발할 때 훨씬 수월합니다.

**React 템플릿**에서는 Electron 코드가 `src/electron/` 안에 함께 위치합니다.

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

**Next 템플릿**에서는 Electron 코드가 최상위 `electron/` 폴더에 분리되어 있습니다.

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

렌더러(웹 페이지)에서 Electron 기능에 접근할 때는 `window.electron` 브리지를 사용합니다.

preload 스크립트를 통해 안전하게 노출된 API이므로, 보안 걱정 없이 사용하실 수 있습니다.

```ts
window.electron.send("toggle-maximize");

const off = window.electron.on?.("window-maximized-changed", (isMaximized) => {
  console.log(isMaximized);
});

const state = await window.electron.invoke?.("get-window-state");
off?.();
```

::: tip
- 두 템플릿 모두 `send` / `on` 패턴을 공통으로 사용합니다.
- Next 템플릿 preload에는 `invoke` 헬퍼가 기본 포함되어 있습니다.
- React 템플릿은 preload 기본 API 구성이 다르므로, 필요하면 preload에서 API를 확장해 주세요.
:::

## 아이콘 교체

기본 앱 아이콘은 두 템플릿 모두 `public/icon.ico` 경로에 있습니다.

내 앱 아이콘으로 바꾸고 싶다면 이 파일을 교체해 주세요.

```text
public/
  icon.ico
```

## 기본 보안 설정

Frontron 템플릿은 Electron 보안 모범 사례를 기본으로 적용하고 있습니다.

- `contextIsolation: true` — 렌더러와 메인 프로세스의 컨텍스트를 분리합니다.
- `nodeIntegration: false` — 렌더러에서 Node.js API에 직접 접근할 수 없습니다.
- preload 스크립트를 통해 꼭 필요한 API만 안전하게 노출합니다.

## 문제 해결

개발하다 보면 예상치 못한 문제를 만날 수 있습니다.

아래는 자주 발생하는 상황과 해결 방법입니다.

당황하지 마시고 하나씩 점검해 보세요!

**개발 중 흰 화면이 나타나는 경우**

가장 흔한 원인은 포트 설정이 맞지 않는 것입니다.
- React 템플릿: `vite.config.ts`의 `server.port` 값을 확인해 주세요.
- Next 템플릿: `NEXT_PORT` 또는 `PORT` 환경 변수를 확인해 주세요.

**창 버튼(최소화/최대화)이 반응하지 않는 경우**

preload 브리지 API에서 사용하는 IPC 채널 이름과, 메인 프로세스에서 등록한 채널 이름이 정확히 일치하는지 확인해 주세요.

**아이콘이 반영되지 않는 경우**

이전 빌드 캐시가 남아 있을 수 있습니다.

`output/` (React) 또는 `.build/` (Next) 폴더를 삭제한 뒤 다시 빌드해 보세요.

## 참조 링크

- Repo: https://github.com/andongmin94/frontron
- Issues: https://github.com/andongmin94/frontron/issues
- Electron Builder: https://www.electron.build
