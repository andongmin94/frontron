# 기존 프로젝트에 설치하기

이 페이지는 Frontron 의 가장 중요한 사용 흐름을 설명합니다.

이미 있는 웹 프론트엔드 프로젝트에 스타터로 갈아타지 않고 데스크톱 앱 레이어만 추가하고 싶을 때 사용하세요.

## 1. 먼저 필요한 것

시작하기 전에 프로젝트가 일반 웹앱으로 정상 실행되는지 확인하세요.

필요한 것은 아래와 같습니다.

- Node.js `22.15+`
- 정상 동작하는 웹 프로젝트
- 루트 `package.json`

## 2. 가장 빠른 부트스트랩

가장 짧은 설정은 아래 명령입니다.

```bash
npx frontron init
```

이 명령은 `frontron` 이 없으면 자동으로 설치하고, 아래 기본 항목도 없을 때만 추가합니다.

- `package.json` 의 `app:dev`
- `package.json` 의 `app:build`
- 루트 `frontron.config.ts`

기존 스크립트나 config 파일은 덮어쓰지 않습니다.

의존성 설치를 직접 관리하고 싶다면 아래처럼 실행하세요.

```bash
npx frontron init --skip-install
```

## 3. 수동 설치가 필요하다면

먼저 의존성을 직접 설치하고 싶다면 아래 흐름도 계속 유효합니다.

```bash
npm install frontron
npx frontron init --skip-install
```

## 4. 필요하면 데스크톱 스크립트를 수동으로 추가하기

기존 웹 스크립트는 그대로 둡니다.

그 옆에 데스크톱 스크립트만 추가하세요.

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

`npm run dev` 는 브라우저 미리보기 전용입니다.

`npm run app:dev` 가 데스크톱 명령입니다.

## 5. 필요하면 `frontron.config.ts` 를 수동으로 추가하기

루트에 `frontron.config.ts` 를 만드세요.

```ts
import { defineConfig } from 'frontron'

export default defineConfig({
  app: {
    name: 'My App',
    id: 'com.example.myapp',
    description: 'My desktop app',
    author: 'My Team',
  },
  build: {
    outputDir: 'release',
    artifactName: '${productName}-${version}-${target}.${ext}',
    windows: {
      targets: ['portable', 'dir'],
    },
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

표준 Vite 프로젝트라면 Frontron 은 아래 값을 프로젝트에서 자동 추론할 수 있습니다.

- `package.json` 의 웹 개발 명령
- `vite.config.*`, `--port`, `PORT=`, 또는 Vite 기본값에서 개발 포트
- `package.json` 의 웹 빌드 명령
- `vite.config.*` 또는 Vite 기본값에서 빌드 출력 폴더

개발 스크립트에서 포트가 분명하게 드러난다면 React Scripts, Astro, Angular CLI, Vue CLI 같은 일반적인 프론트엔드 기본값뿐 아니라 VitePress `docs:dev` / `docs:build`, `frontend:dev`, `frontend:build`, `client:dev`, `client:build`, `ui:dev`, `renderer:build` 같은 잘 알려진 namespaced 스크립트도 따라갈 수 있습니다.

Next.js 는 `next.config.*` 에 `output: 'export'` 가 있을 때 패키징용 빌드 출력 폴더를 자동 추론할 수 있습니다.

Nuxt 는 `nuxt generate` / `nuxi generate` 같은 정적 생성 흐름이나 다른 prerender 기반 정적 출력이 있을 때 패키징용 빌드 출력 폴더를 자동 추론할 수 있습니다.

프로젝트 구성이 특수하거나 기본 추론이 맞지 않으면 `web.dev`, `web.build` 를 직접 적어 주세요.

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

데스크톱 창이 뜨면 정상입니다.

`npm run dev` 만 실행하면 웹 미리보기만 열립니다.

## 7. 데스크톱 앱 빌드

아래 명령으로 패키징합니다.

```bash
npm run app:build
```

Frontron 은 `.frontron/` 아래에 runtime 을 stage 하고, 패키징 결과는 기본적으로 `output/` 아래에 둡니다.

패키징된 프로덕션 앱에서는 `file://` 대신 Frontron 이 소유한 로컬 loopback 서버로 빌드된 프론트엔드를 제공합니다.

`app.icon` 을 설정하지 않으면 Frontron 기본 아이콘을 자동으로 사용합니다.

이 패키징 결과는 `frontron.config.ts` 에서 위치와 형태를 바꿀 수 있습니다.

보통 사용자가 직접 정하는 빌드 값은 아래와 같습니다.

- `app.description`
- `app.author`
- `app.copyright`
- `build.outputDir`
- `build.artifactName`
- `build.windows.targets`

## 8. 일반적인 제품 설정

일반적인 제품 메타데이터는 `app` 에 두고, 패키징 출력 정책은 최상위 `build` 블록에서 설정하세요.

`web.build` 는 여전히 프론트엔드 빌드 단계입니다.

최상위 `build` 블록은 출력 폴더, 산출물 이름, 퍼블리시 모드, Windows 타깃 같은 데스크톱 패키징 결정을 담당합니다.

```ts
export default defineConfig({
  app: {
    name: 'My App',
    id: 'com.example.myapp',
    description: 'Desktop shell for My App',
    author: 'Example Team',
    copyright: 'Copyright (c) 2026 Example Team',
  },
  build: {
    outputDir: 'artifacts',
    artifactName: '${productName}-${version}.${ext}',
    publish: 'onTag',
    windows: {
      targets: ['nsis', 'portable', 'dir'],
    },
  },
})
```

## 9. 직접 만들 필요가 없는 것

이 흐름에서는 아래 파일을 직접 만들 필요가 없습니다.

- Electron `main.ts`
- preload 파일
- 직접 IPC wiring
- Electron Builder 설정 파일

이 부분은 Frontron 이 소유합니다.

## 10. 다음에 읽을 것

처음 실행 후에는 아래 문서가 가장 유용합니다.

1. [브리지 흐름 이해하기](/ko/guide/understand-bridge-flow)
2. [개발 모드로 실행하기](/ko/guide/run-development)
3. [데스크톱 브리지 사용하기](/ko/guide/use-bridge)
4. [빌드와 패키징](/ko/guide/build-and-package)

::: tip
처음에는 `frontron.config.ts` 하나만 있어도 됩니다.

app-layer 코드가 커질 때 `frontron/` 을 만들면 됩니다.
:::
