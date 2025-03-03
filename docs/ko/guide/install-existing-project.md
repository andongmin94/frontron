# 기존 프로젝트에 설치하기

이 페이지는 Frontron의 가장 중요한 사용 흐름을 설명합니다.

이미 웹 프론트엔드 프로젝트가 있고, 스타터로 갈아타지 않고 데스크톱 앱 레이어만 추가하고 싶을 때 이 흐름을 사용하면 됩니다.

## 1. 먼저 필요한 것

시작하기 전에 프로젝트가 일반 웹 앱으로 정상 실행되는지 확인하세요.

아래가 있어야 합니다.

- Node.js `22+`
- 정상 동작하는 웹 프로젝트
- 루트 `package.json`

## 2. Frontron 설치

프로젝트에 `frontron` 을 추가합니다.

```bash
npm install frontron
```

## 3. 기본 파일 자동 추가

기본 설정을 Frontron 이 대신 넣어 주길 원한다면 아래를 실행하세요.

```bash
npx frontron init
```

이 명령은 아래 항목이 없을 때만 추가합니다.

- `package.json` 의 `app:dev`
- `package.json` 의 `app:build`
- 루트 `frontron.config.ts`

이미 있는 스크립트나 config 파일은 덮어쓰지 않습니다.

## 4. 필요하면 데스크톱 스크립트를 수동으로 추가

기존 웹 스크립트는 그대로 둡니다.

그 옆에 데스크톱 스크립트만 추가합니다.

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "app:dev": "frontron dev",
    "app:build": "frontron build"
  }
}
```

`npm run dev` 는 브라우저 전용입니다.

`npm run app:dev` 가 데스크톱 명령입니다.

## 5. 필요하면 `frontron.config.ts` 를 수동으로 추가

루트에 `frontron.config.ts` 를 만듭니다.

```ts
import { defineConfig } from 'frontron'

export default defineConfig({
  app: {
    name: 'My App',
    id: 'com.example.myapp',
  },
  windows: {
    main: {
      route: '/',
      width: 1280,
      height: 800,
    },
  },
})
```

표준 Vite 프로젝트라면 Frontron 이 아래 값을 프로젝트에서 자동으로 추론할 수 있습니다.

- `package.json` 의 웹 개발 명령
- `vite.config.*`, `--port`, `PORT=`, 또는 Vite 기본값에서 개발 포트
- `package.json` 의 빌드 명령
- `vite.config.*` 또는 Vite 기본값에서 빌드 출력 폴더

개발 스크립트에 포트가 분명하게 드러난다면 React Scripts, Next, Nuxt, Astro, Angular CLI, Vue CLI 같은 흔한 프론트엔드 기본값도 어느 정도 따라갈 수 있습니다.

그래도 프로젝트 구조가 더 특수하거나 기본값이 아니라면 `web.dev`, `web.build` 를 직접 적어 주세요.

```ts
export default defineConfig({
  app: {
    name: 'My App',
    id: 'com.example.myapp',
  },
  web: {
    dev: {
      command: 'npm run dev',
      url: 'http://localhost:5173',
    },
    build: {
      command: 'npm run build',
      outDir: 'dist',
    },
  },
})
```

## 6. 데스크톱 앱 실행

데스크톱 모드를 시작합니다.

```bash
npm run app:dev
```

데스크톱 창이 떠야 정상입니다.

`npm run dev` 만 실행하면 웹 프리뷰만 열립니다.

## 7. 데스크톱 앱 빌드

아래 명령으로 패키징합니다.

```bash
npm run app:build
```

Frontron 은 `.frontron/` 아래에 runtime 을 stage 하고, 패키징 결과는 `output/` 아래에 씁니다.

`app.icon` 을 설정하지 않으면 Frontron 기본 아이콘이 자동으로 사용됩니다.

## 8. 직접 만들 필요가 없는 것

이 흐름에서는 아래 파일을 직접 만들 필요가 없습니다.

- Electron `main.ts`
- preload 파일
- 직접 IPC wiring
- Electron Builder 설정 파일

이 부분은 Frontron 이 소유합니다.

## 9. 다음에 할 것

첫 실행 뒤에는 아래 문서가 가장 유용합니다.

1. [브리지 흐름 이해하기](/ko/guide/understand-bridge-flow)
2. [개발 모드로 실행하기](/ko/guide/run-development)
3. [데스크톱 브리지 사용하기](/ko/guide/use-bridge)
4. [빌드와 패키징](/ko/guide/build-and-package)

::: tip
처음에는 `frontron.config.ts` 하나만 있어도 됩니다.

app-layer 코드가 커질 때 나중에 `frontron/` 을 만들면 됩니다.
:::
