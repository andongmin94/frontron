# 설정 가이드

이 페이지에서는 Frontron 프로젝트의 각종 설정을 어디서 어떻게 변경하는지 안내합니다.

처음 프로젝트를 생성한 뒤 내 앱에 맞게 커스터마이징할 때 이 문서를 참고하시면 됩니다.

## 템플릿별 핵심 차이

설정을 변경하기 전에, 사용 중인 템플릿의 경로 구조를 먼저 파악하는 게 중요합니다.

두 템플릿은 Electron 소스 위치와 빌드 산출물 경로가 다르니 아래 표를 확인해 주세요.

| 항목 | React 템플릿 | Next 템플릿 |
| ---- | ---- | ---- |
| Electron 소스 루트 | `src/electron` | `electron` |
| Electron TS 출력(`outDir`) | `dist/electron` | `.electron` |
| `package.json main` | `dist/electron/main.js` | `.electron/main.js` |
| 렌더러 빌드 산출물 | `dist/` | `.next/` |
| 패키징 출력 디렉터리 | `output/` | `.build/` |
| 기본 아이콘 경로 | `public/icon.ico` | `public/icon.ico` |

## scripts 설정

`package.json`의 `scripts` 섹션은 개발, 빌드, 린트 등 핵심 명령어를 정의하는 곳입니다.

보통은 기본값 그대로 사용해도 충분하지만, 필요에 따라 수정할 수 있습니다.

**React 템플릿** 기본값

```json
{
  "scripts": {
    "dev": "vite",
    "app": "concurrently \"npm run dev\" \"tsc -p tsconfig.electron.json && cross-env NODE_ENV=development electron .\"",
    "build": "vite build && tsc -p tsconfig.electron.json && electron-builder",
    "lint": "eslint ."
  }
}
```

**Next 템플릿** 기본값

```json
{
  "scripts": {
    "dev": "next dev",
    "lint": "eslint",
    "app": "concurrently \"npm run dev\" \"tsc -p tsconfig.electron.json && cross-env NODE_ENV=development electron .\"",
    "clean:next": "node -e \"require('fs').rmSync('.next', { recursive: true, force: true })\"",
    "clean:build": "node -e \"require('fs').rmSync('.build', { recursive: true, force: true })\"",
    "build": "npm run clean:next && npm run clean:build && next build && tsc -p tsconfig.electron.json && electron-builder"
  }
}
```

::: tip
Next 템플릿의 `build` 스크립트에는 이전 빌드 결과물을 정리하는 `clean` 단계가 포함되어 있습니다.

빌드 캐시로 인한 문제를 예방해 주는 역할을 합니다.
:::

## TypeScript(Electron) 설정

Electron 코드는 별도의 `tsconfig.electron.json`으로 컴파일됩니다.

소스와 출력 경로는 템플릿마다 다르니 주의해 주세요.

**React 템플릿** `tsconfig.electron.json`
- `rootDir`: `./src/electron`
- `outDir`: `./dist/electron`
- `include`: `src/electron/**/*.ts`

**Next 템플릿** `tsconfig.electron.json`
- `rootDir`: `./electron`
- `outDir`: `./.electron`
- `include`: `electron/**/*.ts`, `electron/**/*.mts`

## electron-builder 설정 포인트

앱을 배포 가능한 설치 파일로 패키징하는 건 `electron-builder`가 담당합니다.

`package.json`의 `build` 필드에서 설정할 수 있습니다.

**React 템플릿** 기본 출력

```json
{
  "directories": {
    "output": "output"
  },
  "files": [
    "dist{,/**/*}",
    "public{,/**/*}"
  ]
}
```

**Next 템플릿** 기본 출력

```json
{
  "directories": {
    "output": ".build",
    "buildResources": "public"
  },
  "files": [
    ".electron/**/*",
    ".next/**/*",
    "public/**/*"
  ]
}
```

앱 이름이나 아이콘 같은 기본 정보를 변경하고 싶다면 아래 필드를 수정하세요.

- **앱 식별자**: `build.appId` — 앱의 고유 ID입니다 (예: `com.mycompany.myapp`).
- **앱 이름**: `build.productName` — 설치 프로그램과 타이틀에 표시되는 이름입니다.
- **타깃 형식**: `build.win.target`, `build.mac.target` — 빌드할 설치 파일 형식을 지정합니다.
- **아이콘**: `build.icon` — 앱 아이콘 파일 경로를 지정합니다.

## 개발 포트 설정

개발 중 렌더러 dev 서버의 포트를 Electron이 알아야 앱 창에 올바른 페이지를 로드할 수 있습니다.

**React 템플릿**
- `vite.config.ts`의 `server.port` 값을 Electron이 읽어서 사용합니다.
- 포트를 따로 설정하지 않으면 기본 `3000`을 사용합니다.

**Next 템플릿**
- `NEXT_PORT` 환경 변수를 우선 확인하고, 없으면 `PORT`, 둘 다 없으면 `3000`을 사용합니다.
- Electron/Chromium에서 차단되는 포트(예: 일부 시스템 예약 포트)는 자동으로 `3000`으로 대체됩니다.

::: warning
포트 충돌이 발생하면 앱이 흰 화면으로 표시될 수 있습니다.

다른 프로세스가 같은 포트를 사용하고 있지 않은지 확인해 주세요.
:::

## 아이콘/리소스 경로

두 템플릿 모두 기본 아이콘 파일은 `public/icon.ico`에 있습니다.

내 앱 아이콘으로 교체하려면 이 파일을 덮어쓰기하면 됩니다.

```text
public/
  icon.ico
```

Next 템플릿에서는 패키징된 환경에서도 공용 리소스를 올바르게 찾을 수 있도록 `electron/paths.ts`의 `resolvePublicPath()` 함수를 사용합니다.

## IPC/Preload 확장

기본으로 창 제어 채널(`minimize`, `toggle-maximize`, `hidden`)과 상태 이벤트(`window-maximized-changed`)가 제공됩니다.

여기에 나만의 IPC 메서드를 추가하는 것도 어렵지 않습니다!

아래는 새로운 IPC 메서드를 추가하는 예시입니다. 총 3곳을 수정하면 됩니다.

**1단계 — 메인 프로세스에서 핸들러 등록** (`ipc.ts`)

```ts
ipcMain.handle("get-user-data", async () => {
  return { id: 1, name: "Frontron" };
});
```

**2단계 — preload에서 API 노출**

```ts
contextBridge.exposeInMainWorld("electron", {
  send: (channel, data) => ipcRenderer.send(channel, data),
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, listener) => {
    const wrapped = (_event, ...args) => listener(...args);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
});
```

**3단계 — 렌더러에서 호출**

```ts
const user = await window.electron.invoke?.("get-user-data");
```

::: tip
채널 이름은 메인 프로세스, preload, 렌더러 세 곳에서 정확히 일치해야 합니다.

오타가 있으면 조용히 실패하니 주의해 주세요!
:::

## 빌드 산출물 확인

빌드가 완료된 후 아래 경로에서 결과물을 확인할 수 있습니다.

**React 템플릿**

```text
dist/
dist/electron/
output/
```

**Next 템플릿**

```text
.next/
.electron/
.build/
```

## 문제 해결

설정을 변경하다 보면 예상치 못한 문제가 생길 수 있습니다.

아래는 자주 발생하는 문제들입니다.

걱정하지 마시고 차근차근 확인해 보세요!

**앱 실행 시 흰 화면이 나타나는 경우**

dev 서버 포트와 `createWindow()`에서 로드하는 URL이 일치하는지 확인해 주세요.

포트가 다르면 Electron이 빈 페이지를 표시하게 됩니다.

**Electron이 실행 직후 바로 종료되는 경우**

Electron 코드에 컴파일 에러가 있을 가능성이 높습니다.

`tsc -p tsconfig.electron.json`을 단독으로 실행해서 에러 메시지를 확인해 보세요.

**빌드 후 아이콘이 누락되는 경우**

`build.icon` 경로가 실제 `public/icon.ico` 파일 위치와 일치하는지, 그리고 파일이 정말 존재하는지 확인해 주세요.

**IPC가 예상대로 동작하지 않는 경우**

`ipcMain`에 등록한 채널명, preload에서 노출한 API, 렌더러에서 호출하는 채널명이 모두 동일한지 다시 한번 확인해 주세요.

셋 중 하나라도 다르면 통신이 이루어지지 않습니다.
