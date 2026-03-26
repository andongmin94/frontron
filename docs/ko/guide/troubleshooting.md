# 문제 해결

처음 쓰는 사람은 비슷한 지점에서 자주 막힙니다.

이 페이지는 어떤 문제를 만났을 때 어디부터 확인하면 좋은지 빠르게 알려 주기 위한 문서입니다.

## 먼저 `frontron check` 실행하기

파일을 손으로 바꾸기 전에 아래 명령부터 실행하세요.

```bash
npx frontron check
```

이 명령은 첫 실행 계약을 확인합니다.

- `package.json`
- 루트 `frontron.config.ts`
- `app:dev`, `app:build`
- 명시되었거나 자동 추론된 `web.dev`, `web.build`
- dev 포트 충돌
- 프론트엔드 빌드 산출물, `.frontron/`, 패키징 출력 상태
- `rust.enabled`가 켜졌을 때 Rust toolchain 존재 여부
- 모노레포나 wrapper script 때문에 추론이 애매해 보이는지
- legacy renderer global 과 unsupported raw Electron migration blocker

## 앱이 시작되지 않을 때

먼저 아래를 확인하세요.

- `npx frontron check` 가 가장 먼저 실패한 항목을 이미 보여 주는지
- `npm install` 이 정상적으로 끝났는지
- `npm run app:dev` 실행 중 터미널에 에러가 없는지
- Node.js 버전이 `22.15+` 인지
- 루트에 `frontron.config.ts` 가 있는지

## 흰 화면이 보일 때

흰 화면은 개발 서버 연결 불일치인 경우가 많습니다.

아래를 확인하세요.

- `vite.config.ts` 의 포트
- 루트 `frontron.config.ts` 의 `web.dev.url`
- 같은 포트를 이미 쓰는 다른 프로세스가 있는지

## 창 버튼이나 브리지 호출이 반응하지 않을 때

창 제어와 데스크톱 브리지 호출은 `frontron/client` 가 framework runtime 과 연결되어 있어야만 동작합니다.

먼저 아래를 확인하세요.

1. `npm run dev` 가 아니라 `npm run app:dev` 를 실행했는지
2. 렌더러가 `frontron/client` 를 import 하는지
3. 터미널에 preload 또는 runtime 에러가 없는지

타이틀바에 `Web preview` 가 보이면 데스크톱 모드가 아니라 브라우저 전용 프리뷰 모드입니다.

## 오래된 생성 앱을 아직 쓰고 있을 때

오래된 생성 앱은 제거된 API 를 아직 써서 여기서 자주 막힙니다.

- `window.electron` 은 더 이상 지원되지 않습니다
- 렌더러 코드는 `frontron/client` 를 써야 합니다
- 예전 `src/electron/*` 구조는 더 이상 공식 계약이 아닙니다

아래를 먼저 확인하세요.

1. 렌더러 import 가 `frontron/client` 인지
2. preload global 을 직접 읽는 코드가 사라졌는지
3. 창/시스템 호출이 `bridge.window.*`, `bridge.system.*` 를 통하는지

## `check`가 예전 Electron 앱의 migration blocker를 잡을 때

`frontron check` 는 이제 마이그레이션을 자주 막는 raw Electron 패턴 몇 가지를 직접 스캔합니다.

대표 blocker 는 아래와 같습니다.

- `window.electron` 또는 남아 있는 `src/electron/*`, `electron/` 런타임 구조
- `preload`, `webPreferences`, `nodeIntegration`, `contextIsolation`, `webviewTag` 같은 raw `BrowserWindow` 보안 필드
- `setIgnoreMouseEvents` 같은 overlay / click-through API
- parent / modal window graph
- remote `loadURL()` / `loadFile()` 기반 window content mode
- renderer의 `<webview>` 사용

이런 항목이 잡히면, 더 깊게 연결하기 전에 먼저 [지원 범위 표](./support-matrix.md)와 요구사항을 맞춰 보세요.

대부분의 대응은 아래 넷 중 하나입니다.

- renderer 호출을 `frontron/client` 로 옮기기
- 데스크톱 로직을 공식 `frontron/` 앱 레이어로 옮기기
- 현재 지원하지 않는 raw Electron 가정을 제거하기
- 아니면 이 앱에는 raw Electron 이 더 맞다는 판단을 내리기

## 아이콘이 바뀌지 않을 때

아래를 순서대로 확인하세요.

1. `public/icon.ico` 를 정말 교체했는지
2. 루트 `frontron.config.ts` 의 `app.icon` 이 그 파일을 가리키는지
3. 다시 빌드했는지
4. 예전 패키징 결과를 보고 있는 것은 아닌지

## `output/` 이 비어 있거나 기대한 파일이 없을 때

먼저 빌드가 끝까지 성공했는지 확인하세요.

아래를 확인하세요.

- `dist/` 가 존재하는지
- `.frontron/` 가 존재하는지
- `.frontron/runtime/build/app/` 안에 `manifest.json`, `main.mjs`, `preload.mjs`, `web/` 가 있는지
- 마지막 터미널 로그에 에러가 없는지

Windows 에서는 현재 기본적으로 `win-unpacked/` 와 설치용 `.exe` 가 생성됩니다.

## Windows 패키징이 파일을 찾지 못한다고 실패할 때

프로젝트 경로가 너무 깊으면 Windows 패키징이 깨질 수 있습니다.

특히 긴 패키징 경로가 로그에 보이면 프로젝트를 더 짧은 경로로 옮겨 다시 빌드해 보세요.

- 예: `C:\dev\my-app`
- 예: `C:\work\demo`

::: tip
문제가 생기면 가장 최근에 바꾼 파일부터 확인하는 것이 가장 빠릅니다.
:::

## `check`가 이제 추가로 보는 항목

`frontron check`는 이제 첫 실행 계약만 보는 것이 아니라 아래도 함께 확인합니다.

- `app:dev`가 시작되기 전에 같은 dev 포트를 다른 프로세스가 이미 쓰고 있는지
- 프론트엔드 빌드 산출물 폴더가 있는지, 비어 있지는 않은지
- `.frontron/runtime/build/app/` 아래 스테이징 결과가 완전한지
- 패키징 출력 폴더가 비어 있는지
- `rust.enabled`가 켜져 있을 때 `cargo`가 실제로 잡히는지
- 모노레포나 wrapper script 때문에 추론이 애매해 보이는지

## dev 포트 충돌이 잡힐 때

`frontron check`가 dev URL이 Frontron 시작 전부터 이미 응답한다고 말하면, 보통 다른 서버가 같은 포트를 잡고 있는 상태입니다.

- 오래된 서버라면 종료하고 `npm run app:dev`를 다시 실행합니다.
- 의도적으로 외부 dev 서버를 재사용하는 구조라면 루트 `frontron.config.ts`의 `web.dev.url`을 그 서버에 맞게 명시합니다.

## `.frontron/` 또는 출력 폴더가 비정상일 때

`check`가 `.frontron/runtime/build/app/`가 불완전하다고 말하면, 보통 이전 중간 산출물이 깨진 상태입니다.

- `.frontron/`를 지우고
- `npm run app:build`를 다시 실행합니다.

출력 폴더가 비어 있다고 나오면 패키징이 끝까지 완료되지 않은 경우가 많습니다.

- 마지막 빌드 로그에 에러가 없는지 확인합니다.
- 다시 `npm run app:build`를 실행합니다.

## Rust를 켰는데 `cargo`가 없다고 나올 때

이 검사는 `rust.enabled`가 `true`일 때만 동작합니다.

- Rust를 실제로 사용할 계획이면 같은 터미널에서 `cargo --version`이 동작하도록 환경을 맞춥니다.
- 아직 Rust 슬롯을 쓰지 않을 계획이면 `rust.enabled`를 끄고 진행합니다.

## 모노레포나 커스텀 스크립트일 때

workspace wrapper나 custom launcher는 자동 추론이 모호할 수 있습니다.

이 경우 루트 `frontron.config.ts`에 `web.dev.command`, `web.dev.url`, `web.build.command`, `web.build.outDir`를 명시하는 편이 가장 안정적입니다.
