# 문제 해결

처음 쓰는 사람은 대부분 비슷한 지점에서 막힙니다.

이 페이지는 "어디부터 확인하면 좋은지"를 빠르게 알려 주는 용도로 만들었습니다.

## 앱이 실행되지 않는 경우

먼저 아래를 확인해 보세요.

- `npm install`이 정상적으로 끝났는지
- `npm run app:dev` 실행 중 터미널에 에러가 없는지
- Node.js 버전이 `22+`인지
- root `frontron.config.ts`가 존재하는지

## 흰 화면이 보이는 경우

흰 화면은 개발 서버 연결 문제일 때가 많습니다.

가장 먼저 아래를 확인해 보세요.

- `vite.config.ts`의 `server.port`
- `frontron/config.ts`의 `web.dev.url`
- 같은 포트를 이미 쓰는 다른 프로세스가 있는지

## 창 버튼이나 브리지가 반응하지 않는 경우

최소화/최대화 같은 버튼은 `frontron/client`와 framework runtime이 연결되어야 동작합니다.

초보자라면 먼저 아래를 확인해 보세요.

1. `npm run dev`가 아니라 `npm run app:dev`를 실행했는지
2. 렌더러 코드가 `window.electron`이 아니라 `frontron/client`를 쓰는지
3. 터미널에 preload/runtime 에러가 없는지

old generated app을 그대로 실행 중이라면 여기서 자주 막힙니다.

- `window.electron` adapter는 더 이상 지원되지 않습니다.
- renderer 코드는 `frontron/client`로 옮겨야 합니다.
- old `src/electron/*` 구조나 template-owned runtime/build model은 다시 공식화하지 않습니다.

가능하면 가장 먼저 아래를 확인해 보세요.

1. 렌더러 import가 `frontron/client`인지
2. `bridge.window.*`와 `bridge.system.*` 호출로 바뀌었는지
3. 직접 preload global을 읽는 코드가 남아 있지 않은지

## 아이콘이 바뀌지 않는 경우

아래 항목을 순서대로 보세요.

1. `public/icon.ico`를 정말 교체했는지
2. 다시 빌드했는지
3. 이전 패키징 결과가 남아 있지 않은지

## `output/` 폴더가 비어 있거나 기대한 파일이 없는 경우

가장 먼저 빌드가 끝까지 성공했는지 확인하세요.

- `dist/`가 생성되었는지
- `.frontron/`가 생성되었는지
- `.frontron/runtime/build/app/` 안에 `manifest.json`, `main.mjs`, `preload.mjs`, `web/`가 있는지
- 터미널 마지막 줄에 에러가 없는지

Windows에서는 기본적으로 `output/` 아래에 `win-unpacked/`, 설치 파일(`.msi`), 휴대용 실행 파일(`.exe`)이 생성될 수 있습니다. 파일 이름이 다르더라도 확장자와 역할부터 확인하는 것이 좋습니다.

## Windows에서 `MSI` 빌드가 "파일을 찾을 수 없다"며 실패하는 경우

프로젝트 경로가 너무 깊으면 Windows 경로 길이 제한 때문에 `MSI` 단계에서 실패할 수 있습니다.

특히 아래처럼 `app.asar.unpacked` 안의 긴 경로를 가리키는 에러가 보이면 이 가능성을 먼저 의심해 보세요.

- `...output\\win-unpacked\\resources\\app.asar.unpacked\\...`
- `The system cannot find the file ...`

이럴 때는 프로젝트를 더 짧은 경로로 옮겨 다시 빌드해 보세요.

- 예: `C:\dev\my-app`
- 예: `C:\work\demo`

::: tip
문제가 생기면 한 번에 모든 파일을 의심하지 말고, "방금 바꾼 파일"부터 보는 것이 가장 빠릅니다.
:::
