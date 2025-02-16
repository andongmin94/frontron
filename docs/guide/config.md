# 설정

이 페이지는 Frontron 프로젝트에서 자주 바꾸는 설정이 어디에 있는지 정리한 레퍼런스입니다.

처음 쓰는 사람이라면 모든 값을 한 번에 이해할 필요는 없습니다. 아래에서 "먼저 바꾸면 체감이 큰 것"부터 보는 것이 좋습니다.

## 먼저 보면 좋은 변경 지점

대부분의 초보자는 아래 순서만 알아도 충분합니다.

1. `public/icon.ico`
2. `package.json`의 `build.productName`
3. `package.json`의 `build.appId`
4. `src/components/TitleBar.tsx`
5. `vite.config.ts`

## 1. 실행 명령 설정

실행과 빌드 관련 명령은 `package.json`의 `scripts`에 있습니다.

대표적으로 많이 쓰는 값은 아래와 같습니다.

```json
{
  "scripts": {
    "dev": "vite",
    "app": "concurrently \"npm run dev\" \"tsc -p tsconfig.electron.json && cross-env NODE_ENV=development electron .\"",
    "build": "vite build && tsc -p tsconfig.electron.json && electron-builder"
  }
}
```

## 2. 앱 이름과 패키징 설정

앱 이름과 패키징 관련 값은 `package.json`의 `build` 아래에 있습니다.

특히 초보자에게 중요한 값은 아래 두 가지입니다.

- `build.productName`
- `build.appId`

이 두 값은 역할이 다릅니다.

- `productName`: 패키징 결과물 이름 쪽
- `appId`: 앱 식별자 쪽

화면에 보이는 제목은 `src/components/TitleBar.tsx`처럼 다른 파일에서도 바꿀 수 있습니다.

## 3. 아이콘 경로

기본 아이콘은 `public/icon.ico`를 사용합니다.

처음에는 이 파일 하나만 바꿔도 패키징 결과에서 큰 차이를 느낄 수 있습니다.

## 4. 개발 서버 포트

`vite.config.ts`의 `server.port`는 개발 중 Electron이 연결할 포트와 연결됩니다.

포트가 맞지 않으면 흰 화면이 보일 수 있습니다.

## 5. Electron 브리지

렌더러에서 Electron 기능을 쓸 때는 `window.electron` 브리지를 사용합니다.

기본적으로 아래 형태를 기억하면 충분합니다.

```ts
window.electron?.send("toggle-maximize");
const state = await window.electron?.invoke?.("get-window-state");
const off = window.electron?.on?.("window-maximized-changed", (value) => {
  console.log(value);
});
off?.();
```

즉, 초보자는 "Electron 기능은 브리지로 호출한다"는 한 문장만 제대로 기억해도 많은 혼란을 줄일 수 있습니다.

## 6. 빌드 결과가 쌓이는 경로

아래 세 경로를 함께 기억하면 좋습니다.

```text
dist/
dist/electron/
output/
```

- `dist/`: 화면 빌드 결과
- `dist/electron/`: Electron 코드 빌드 결과
- `output/`: 패키징 결과물

## 7. 이 페이지의 역할

이 페이지는 설정을 "순서대로 따라 하는 튜토리얼"이 아니라, 필요한 값을 다시 찾아보는 참조 문서입니다.

::: tip
실제로 아이콘과 이름을 바꾸는 순서를 먼저 보고 싶다면 `앱 이름과 아이콘 바꾸기` 튜토리얼을 먼저 읽어 보세요.
:::
