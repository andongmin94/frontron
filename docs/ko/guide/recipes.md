# 스택별 레시피

이 페이지는 자주 쓰는 프론트엔드 스택에서 `frontron` 을 붙이는 가장 작은 예시를 모아 둔 문서입니다.

생성된 스타터의 script 구조를 비교할 때 보거나, 기존 프론트엔드에 수동으로 붙일 때 최소 명시 설정 예시를 찾는 용도로 보면 됩니다.

모든 옵션을 다 보여 주는 것이 목적은 아닙니다.

자동 추론이 충분한지, 아니면 `web.dev`, `web.build` 를 직접 적어야 하는지만 빠르게 판단할 수 있게 하는 것이 목적입니다.

## Vite

Vite는 가장 단순한 경로이고 기본 스타터 구조와도 가장 가깝습니다.

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

일반적인 Vite 앱이면 `frontron dev`, `frontron build` 가 대부분 자동으로 추론됩니다.

## VitePress

VitePress를 데스크톱 렌더러로 쓰는 경우도 잘 맞습니다.

```json
{
  "scripts": {
    "docs:dev": "vitepress dev docs",
    "docs:build": "vitepress build docs",
    "app:dev": "frontron dev",
    "app:build": "frontron build"
  }
}
```

포트나 출력 경로를 따로 바꾸지 않았다면 루트 `frontron.config.ts` 는 최소 설정으로 두면 됩니다.

## Next.js static export

현재 Frontron의 Next 지원은 static export 흐름 기준입니다.

```ts
// next.config.ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'export',
}

export default nextConfig
```

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "app:dev": "frontron dev",
    "app:build": "frontron build"
  }
}
```

정적 export를 쓰지 않는다면, 안전한 정적 출력 경로가 명확할 때만 `web.build` 를 직접 적는 편이 좋습니다.  
그렇지 않으면 현재 Frontron이 그 빌드 형태에 완전히 맞는 상태는 아닙니다.

## Nuxt generate

현재 Nuxt 지원은 static generate 또는 prerender 흐름 기준입니다.

```json
{
  "scripts": {
    "dev": "nuxt dev",
    "generate": "nuxt generate",
    "app:dev": "frontron dev",
    "app:build": "frontron build"
  }
}
```

정적 출력 명령이 다르면 직접 적으면 됩니다.

```ts
web: {
  build: {
    command: 'npm run generate',
    outDir: '.output/public',
  },
}
```

## 모노레포 프론트엔드 앱

프론트엔드 앱이 여러 개 있는 모노레포에서는 명시 설정이 더 낫습니다.

```ts
import { defineConfig } from 'frontron'

export default defineConfig({
  web: {
    dev: {
      command: 'pnpm --filter web dev',
      url: 'http://127.0.0.1:5173',
    },
    build: {
      command: 'pnpm --filter web build',
      outDir: 'apps/web/dist',
    },
  },
})
```

워크스페이스 retrofit 에서는 자동 추론보다 이 방식이 보통 더 명확합니다.

## 커스텀 래퍼 스크립트

팀에서 커스텀 스크립트 이름을 쓰면 그대로 적는 편이 맞습니다.

```json
{
  "scripts": {
    "frontend:start": "turbo run dev --filter web",
    "frontend:bundle": "turbo run build --filter web",
    "app:dev": "frontron dev",
    "app:build": "frontron build"
  }
}
```

```ts
import { defineConfig } from 'frontron'

export default defineConfig({
  web: {
    dev: {
      command: 'npm run frontend:start',
      url: 'http://127.0.0.1:5173',
    },
    build: {
      command: 'npm run frontend:bundle',
      outDir: 'apps/web/dist',
    },
  },
})
```

## `frontron check` 를 먼저 돌릴 때

아래 경우에는 먼저 `npx frontron check` 를 돌리는 편이 좋습니다.

- 추론된 스크립트가 이상할 때
- dev URL 포트가 맞는지 헷갈릴 때
- build 출력 폴더가 확실하지 않을 때
- 워크스페이스나 래퍼 스크립트를 처음 연결할 때

`check` 출력은 `frontron` 이 무엇을 추론했는지와, 어떤 값을 명시로 바꿔야 하는지를 가장 빨리 보여 줍니다.
