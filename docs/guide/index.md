# 시작하기

Frontron에 오신 것을 환영합니다! 🎉

Frontron은 Electron 데스크톱 앱을 빠르게 만들 수 있도록 도와주는 CLI 도구입니다.

복잡한 Electron 설정을 직접 구성할 필요 없이, 명령어 하나로 바로 개발을 시작할 수 있습니다.

현재는 React 템플릿을 제공합니다.

| 템플릿 | 렌더러 |
| ---- | ---- |
| React | Vite + React 19 |

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

실행하면 프로젝트 이름을 확인한 뒤 바로 React 템플릿이 생성됩니다:

```bash
npm create frontron@latest
```

프로젝트 이름까지 한 번에 지정해서 비대화식으로 생성할 수도 있습니다.

```bash
npx create-frontron@latest my-app
```

::: tip
- 프로젝트명을 생략하면 기본 디렉터리 이름은 `frontron`이 됩니다.
- 현재 디렉터리에 바로 생성하고 싶으면 프로젝트명을 `.`으로 입력하세요.
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

## 기본 스크립트

생성된 React 템플릿은 아래 스크립트를 기본으로 제공합니다.

| 스크립트 | 동작 |
| ---- | ---- |
| `dev` | `vite` |
| `app` | `dev + tsc(electron) + electron` 동시 실행 |
| `build` | `vite build` -> `tsc -p tsconfig.electron.json` -> `electron-builder` |
| `lint` | `eslint .` |

## 기본 구조

프로젝트가 어떤 구조로 생성되는지 미리 파악하면 개발할 때 훨씬 수월합니다.

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
- 기본적으로 `send` / `on` 패턴을 사용할 수 있습니다.
- 필요하면 preload에서 `invoke` 같은 헬퍼를 직접 확장해 주세요.
:::

## 아이콘 교체

기본 앱 아이콘은 `public/icon.ico` 경로에 있습니다.

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
- `vite.config.ts`의 `server.port` 값을 확인해 주세요.

**창 버튼(최소화/최대화)이 반응하지 않는 경우**

preload 브리지 API에서 사용하는 IPC 채널 이름과, 메인 프로세스에서 등록한 채널 이름이 정확히 일치하는지 확인해 주세요.

**아이콘이 반영되지 않는 경우**

이전 빌드 캐시가 남아 있을 수 있습니다.

`output/` 폴더를 삭제한 뒤 다시 빌드해 보세요.

## 참조 링크

- Repo: https://github.com/andongmin94/frontron
- Issues: https://github.com/andongmin94/frontron/issues
- Electron Builder: https://www.electron.build
