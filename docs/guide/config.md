# Frontron 설정 가이드 (Configuration)

이 문서는 `create-frontron` 최신 템플릿(`react`, `next`) 기준으로 핵심 설정 포인트를 정리합니다.

## 템플릿별 핵심 차이

| 항목 | React 템플릿 | Next 템플릿 |
| ---- | ---- | ---- |
| Electron 소스 루트 | `src/electron` | `electron` |
| Electron TS 출력(`outDir`) | `dist/electron` | `.electron` |
| `package.json main` | `dist/electron/main.js` | `.electron/main.js` |
| 렌더러 빌드 산출물 | `dist/` | `.next/` |
| 패키징 출력 디렉터리 | `output/` | `.build/` |
| 기본 아이콘 경로 | `public/icon.ico` | `public/icon.ico` |

## scripts 설정

React 템플릿 기본값:

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

Next 템플릿 기본값:

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

## TypeScript(Electron) 설정

React 템플릿 `tsconfig.electron.json`:
- `rootDir`: `./src/electron`
- `outDir`: `./dist/electron`
- `include`: `src/electron/**/*.ts`

Next 템플릿 `tsconfig.electron.json`:
- `rootDir`: `./electron`
- `outDir`: `./.electron`
- `include`: `electron/**/*.ts`, `electron/**/*.mts`

## electron-builder 설정 포인트

React 템플릿 기본 출력:

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

Next 템플릿 기본 출력:

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

공통 커스터마이징:
- 앱 식별자: `build.appId`
- 앱 이름: `build.productName`
- 타깃 형식: `build.win.target`, `build.mac.target`
- 아이콘: `build.icon`

## 개발 포트 설정

React 템플릿:
- `vite.config.ts`의 `server.port`를 Electron이 읽어 사용
- 포트 미설정 시 기본 `3000`

Next 템플릿:
- `NEXT_PORT` 우선, 없으면 `PORT`, 둘 다 없으면 `3000`
- Electron/Chromium에서 차단되는 포트는 자동으로 `3000`으로 대체

## 아이콘/리소스 경로

두 템플릿 모두 기본 아이콘 파일은 `public/icon.ico` 입니다.

```text
public/
  icon.ico
```

Next 템플릿은 패키징 환경에서도 공용 리소스를 찾기 위해 `electron/paths.ts`의 `resolvePublicPath()`를 사용합니다.

## IPC/Preload 확장

기본적으로 창 제어 채널(`minimize`, `toggle-maximize`, `hidden`)과 상태 이벤트(`window-maximized-changed`)가 제공됩니다.

예시: 새 IPC 메서드 추가

메인 프로세스(`ipc.ts`):

```ts
ipcMain.handle("get-user-data", async () => {
  return { id: 1, name: "Frontron" };
});
```

preload에서 노출:

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

렌더러에서 사용:

```ts
const user = await window.electron.invoke?.("get-user-data");
```

## 빌드 산출물 확인

React 템플릿:

```text
dist/
dist/electron/
output/
```

Next 템플릿:

```text
.next/
.electron/
.build/
```

## Troubleshooting

| 증상 | 점검 포인트 |
| ---- | ---- |
| 앱 실행 시 흰 화면 | dev 포트와 `createWindow()`의 URL 일치 여부 확인 |
| Electron이 바로 종료 | `tsc -p tsconfig.electron.json` 단독 실행으로 컴파일 오류 확인 |
| 빌드 후 아이콘 누락 | `build.icon` 경로와 실제 `public/icon.ico` 존재 여부 확인 |
| IPC 동작 불일치 | `ipcMain` 채널명, preload 노출 API, 렌더러 호출 채널명이 같은지 확인 |
