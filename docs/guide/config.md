# Frontron 설정 가이드 (Configuration)

이 문서는 기존 프로젝트에 Frontron 구조를 수동 적용하거나, 생성된 템플릿을 커스터마이징할 때 필요한 핵심 설정을 정리합니다. 일반적으로는 `npm create frontron@latest` 로 스캐폴딩하는 것이 가장 빠릅니다.

## 필수 package.json 필드

```jsonc
{
  "name": "my-frontron-app",
  "version": "0.0.1",
  "description": "나의 데스크톱 애플리케이션",
  "author": "Your Name",
  "main": "dist/electron/main.js", // 빌드 후 진입점
  "type": "module"
}
```

템플릿은 TypeScript 컴파일 결과(`dist/electron/main.js`)를 메인 엔트리로 사용합니다. 개발 단계에서는 `src/electron/main.ts` 가 실제 소스입니다.

## 디렉터리 기본 구조

```
src/
  electron/
    main.ts
    preload.ts
    ipc.ts
    window.ts
    tray.ts
    splash.ts
  components/
  hooks/
  lib/
public/
  icon.png
```

## 스크립트 구성

```jsonc
"scripts": {
  "dev": "vite",
  "app": "concurrently \"npm run dev\" \"tsc -p tsconfig.electron.json && cross-env NODE_ENV=development electron .\"",
  "build": "vite build && tsc -p tsconfig.electron.json && electron-builder",
  "lint": "eslint . && npx prettier --write ."
}
```

포트가 동적으로 결정되는 구조(`determinePort`)를 사용한다면 wait-on 이 필수적이지 않아 제거되었습니다. 고정 포트를 사용하려면 `app` 스크립트를 다음처럼 조정할 수 있습니다:

```jsonc
"app": "concurrently \"npm run dev\" \"wait-on http://localhost:3000 && cross-env NODE_ENV=development electron .\""
```

## TypeScript 설정 개요

- `tsconfig.json`: 기본 공통 옵션
- `tsconfig.app.json`: 렌더러(React) 전용 설정
- `tsconfig.electron.json`: `src/electron` 컴파일 (module=ESNext, outDir=dist/electron)

Electron main/preload 코드는 Node/Electron API 사용 → `types: ["node", "electron"]` 추가 고려.

## electron-builder 설정 예시

템플릿 기본값 (축약)
```jsonc
"build": {
  "appId": "Frontron",
  "productName": "Frontron",
  "artifactName": "${productName}.${ext}",
  "icon": "public/icon.png",
  "compression": "store",
  "mac": { "target": ["dir"] },
  "win": { "target": ["portable"] },
  "nsis": { "oneClick": true, "uninstallDisplayName": "Frontron" },
  "files": ["node_modules/**/*", "public/**/*", "dist/**/*"],
  "directories": { "output": "output" }
}
```

커스터마이징 팁

| 요구사항 | 수정 포인트 |
| -------- | ----------- |
| 설치형(Windows) | `win.target` 에 `nsis` 추가, `oneClick:false` 설정 |
| macOS dmg | `mac.target` 배열에 `dmg` 추가 |
| 파일 용량 축소 | `files` 배열에서 불필요 디렉터리 제외 |
| 채널 분리 | `publish` 필드 및 auto update 설정(추후 로드맵) |

## 개발 실행

```bash
npm run app
```

문제 발생 시 체크리스트
1. dev 서버 포트: 콘솔 로그로 실제 포트 확인 후 `createWindow(port)` 주소 일치 여부 확인
2. Preload 빌드 실패: `tsc -p tsconfig.electron.json` 직접 실행하여 에러 파악
3. 아이콘 미반영: `output` 삭제 후 재빌드

## 환경 변수

`dotenv` 사용 가능. 예시
```
ROOT/.env
VITE_API_BASE=https://api.example.com
```
렌더러에서 `import.meta.env.VITE_API_BASE` 로 접근. Electron 메인에서 사용하려면 `process.env.VITE_API_BASE` 로 직접 로드 (`dotenv.config()`).

## IPC 패턴 확장

메인 (`ipc.ts`)
```ts
ipcMain.handle('get-user-data', async () => {
  return {/* ... */}
})
```
Preload: 이미 `get(key)` 구현이 단일 채널(`get-value`)을 사용하는 경우 별도 채널을 원한다면 새 expose 추가 권장:
```ts
contextBridge.exposeInMainWorld('api', {
  getUserData: () => ipcRenderer.invoke('get-user-data')
})
```
렌더러
```ts
const user = await window.api.getUserData()
```

## 배포 산출물

`npm run build` 후
```
output/
  Frontron.exe (Windows portable 예시)
  latest.yml (업데이트 채널 구성 시)
  ...
```

서명/업데이트 기능은 기본 포함되지 않으므로 상용 배포 전 별도 설정 필요.

##  문제 해결 (Troubleshooting)

| 증상 | 해결 |
| ---- | ---- |
| 앱이 바로 종료 | 메인 프로세스 런타임 오류 → `electron .` 단독 실행 로그 확인 |
| dev HMR 미동작 | 브라우저 캐시 문제보단 Vite 설정 확인 (`vite.config.ts`) |
| 빌드 후 흰 화면 | 상대 경로/환경 변수 누락, 콘솔 DevTools 열어 404/JS 오류 확인 |

<!-- (추후 Next.js 템플릿 추가 시 주의사항 섹션 재도입 예정) -->

---
필요한 설정 항목이 누락되었거나 추가 가이드가 필요하면 이슈를 통해 요청해 주세요.