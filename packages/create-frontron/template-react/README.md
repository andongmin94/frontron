# Frontron React Template

이 프로젝트는 Frontron `react` 템플릿으로 생성되었습니다.

## 스택

- Electron + React + Vite + TypeScript
- Tailwind CSS 4 + Shadcn 스타일 패턴
- Electron IPC / Splash / Tray / 커스텀 TitleBar 기본 포함

## 개발 실행

```bash
npm install
npm run app
```

- `npm run dev`: Vite 개발 서버
- `npm run app`: Vite + Electron 동시 실행

## 빌드

```bash
npm run build
```

빌드 순서:
- `vite build`
- `tsc -p tsconfig.electron.json`
- `electron-builder`

산출물:
- `dist/`
- `dist/electron/`
- `output/`

## 주요 디렉터리

```text
src/
  electron/      # main, preload, ipc, tray, splash, window
  components/    # UI 컴포넌트
  hooks/
  lib/
public/
  icon.ico
```

## 문서

- https://frontron.andongmin.com
- https://frontron.andongmin.com/guide/
