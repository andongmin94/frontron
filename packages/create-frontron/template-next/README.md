# Frontron Next Template

이 프로젝트는 Frontron `next` 템플릿으로 생성되었습니다.

## 스택

- Electron + Next.js(App Router) + TypeScript
- Tailwind CSS 4 + Shadcn 스타일 패턴
- Electron IPC / Splash / Tray / 커스텀 TitleBar 기본 포함

## 개발 실행

```bash
npm install
npm run app
```

- `npm run dev`: Next 개발 서버
- `npm run app`: Next dev + Electron 동시 실행

## 빌드

```bash
npm run build
```

빌드 순서:
- `.next`, `.build` 정리
- `next build`
- `tsc -p tsconfig.electron.json`
- `electron-builder`

산출물:
- `.next/`
- `.electron/`
- `.build/`

## 주요 디렉터리

```text
app/             # Next App Router
components/      # UI 컴포넌트
electron/        # main, preload, ipc, tray, splash, window
lib/
public/
  icon.ico
```

## 포트 설정

개발 포트는 아래 순서로 결정됩니다.
- `NEXT_PORT`
- `PORT`
- 기본값 `3000`

## 문서

- https://frontron.andongmin.com
- https://frontron.andongmin.com/guide/
