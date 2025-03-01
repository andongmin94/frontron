# Frontron React Starter

이 프로젝트는 Frontron framework-first starter로 생성되었습니다.

## 스택

- Frontron + React + Vite + TypeScript
- Tailwind CSS 4
- `frontron.config.ts` + `frontron/` app-layer 구조
- `frontron/client` 기반 bridge access
- `frontron/bridge`의 config-driven custom namespace 예제
- `frontron/menu`, `frontron/tray`, `frontron/hooks` 공식 surface 예제
- `frontron/rust` 공식 슬롯 scaffold

## 개발 실행

```bash
npm install
npm run app:dev
```

- `npm run dev`: web preview only, without the desktop bridge
- `npm run web:dev`: Vite 개발 서버
- `npm run app:dev`: Frontron desktop runtime + web dev command

## 빌드

```bash
npm run app:build
```

빌드 순서:

- `npm run web:build`
- `frontron build`

산출물:

- `dist/`
- `output/`
- `.frontron/` runtime staging artifacts
- `.frontron/types/frontron-client.d.ts` generated bridge types

## 주요 디렉터리

```text
src/
  components/
  lib/
frontron.config.ts
frontron/
  config.ts
  bridge/
  hooks/
  menu.ts
  rust/
  tray.ts
  windows/
public/
  icon.ico
```

예제 bridge namespace:

```ts
import { bridge } from 'frontron/client'

const greeting = await bridge.app.getGreeting()
```

생성된 bridge 타입은 `.frontron/types/frontron-client.d.ts`에 저장됩니다.

Rust가 활성화되어 있으면 built-in native 상태 API와 config-driven Rust bridge도 사용할 수 있습니다.

```ts
const status = await bridge.native.getStatus()
const sum = await bridge.math.add(2, 3)
const average = await bridge.math.average(2, 3)
const healthy = await bridge.health.isReady()
const isTextFile = await bridge.file.hasTxtExtension('notes.txt')
const cpuCount = await bridge.system.cpuCount()
```

## 문서

- https://frontron.andongmin.com
- https://frontron.andongmin.com/guide/
