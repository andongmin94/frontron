# 기존 프로젝트에 설치하기

이 페이지는 수동 설치 또는 retrofit 경로를 설명합니다.

이미 있는 호환 웹 프론트엔드 프로젝트에 스타터로 갈아타지 않고 데스크톱 support 만 추가하고 싶을 때 사용하세요.

## 1. 먼저 필요한 것

시작하기 전에 프로젝트가 일반 웹앱으로 정상 실행되는지 확인하세요.

필요한 것은 아래와 같습니다.

- Node.js `22+`
- 정상 동작하는 웹 프로젝트
- 루트 `package.json`

## 2. 가장 빠른 수동 부트스트랩

가장 짧은 retrofit 설정은 아래 명령입니다.

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

먼저 의존성을 직접 설치하고 싶다면 아래 흐름도 유효합니다.

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

프로젝트 구성이 특수하면 `web.dev`, `web.build` 를 직접 적어 주세요.

## 6. 데스크톱 앱 실행

```bash
npm run app:dev
```

데스크톱 창이 뜨면 정상입니다.

`npm run dev` 만 실행하면 웹 미리보기만 열립니다.

## 7. 데스크톱 앱 빌드

```bash
npm run app:build
```

Frontron 은 `.frontron/` 아래에 runtime 을 stage 하고, 패키징 결과는 기본적으로 `output/` 아래에 둡니다.

## 8. 직접 만들 필요가 없는 것

이 흐름에서는 아래 파일을 직접 만들 필요가 없습니다.

- Electron `main.ts`
- preload 파일
- 직접 IPC wiring
- Electron Builder 설정 파일

이 부분은 Frontron 이 소유합니다.

## 9. 다음에 읽을 것

처음 실행 후에는 아래 문서가 가장 유용합니다.

1. [개발 모드로 실행하기](/ko/guide/run-development)
2. [데스크톱 브리지 사용하기](/ko/guide/use-bridge)
3. [빌드와 패키징](/ko/guide/build-and-package)

::: tip
새 프로젝트를 처음 시작하는 경우에는 여전히 `npm create frontron@latest` 경로가 기본 추천입니다.
:::
