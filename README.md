<div align="center">

<a href="https://frontron.andongmin.com">
<img src="https://frontron.andongmin.com/logo.svg" alt="logo" height="200" />
</a>

</div>

# Frontron

기존 웹 프론트엔드 프로젝트를 config-driven 데스크톱 앱으로 확장하는 framework-first 제품 저장소입니다.

## 개요

이 저장소의 역할은 아래 두 패키지로 분리됩니다.

- `frontron`: 실제 제품. config, CLI, runtime/build ownership, bridge, app-layer 확장 구조를 소유합니다.
- `create-frontron`: 얇은 starter generator. `frontron`이 연결된 공식 구조만 생성합니다.

공식 계약은 [specs/framework-first.md](C:/Users/Andongmin/Desktop/repository/frontron/specs/framework-first.md)에 고정됩니다.

## 공식 목표 계약

최종적으로 사용자는 아래 흐름으로 시작할 수 있어야 합니다.

```bash
npm install frontron
```

```ts
// frontron.config.ts
import { defineConfig } from 'frontron'

export default defineConfig({
  app: {
    name: 'My App',
    id: 'com.example.myapp',
  },
  web: {
    dev: {
      command: 'npm run web:dev',
      url: 'http://localhost:5173',
    },
    build: {
      command: 'npm run web:build',
      outDir: 'dist',
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

```json
{
  "scripts": {
    "app:dev": "frontron dev",
    "app:build": "frontron build"
  }
}
```

## 현재 상태

- `packages/frontron`은 `defineConfig`, config discovery, `frontron dev`, `frontron build`, `frontron/client`, framework-owned runtime/build staging을 제공합니다.
- `packages/create-frontron`은 root `frontron.config.ts`, `frontron/`, `app:dev`, `app:build`를 생성하는 thin starter generator입니다.
- 문서와 예제는 framework-first 구조를 기준으로 정리되어 있습니다.

## 요구사항

- Node.js `22+` 버전이 필요합니다.

## 저장소 구조

```text
frontron/
  docs/                        # VitePress 문서 사이트
  specs/                       # architecture contract and fixtures
  packages/
    create-frontron/           # thin starter generator CLI
      src/                     # CLI 로직
      template/                # framework-first starter 템플릿
    frontron/                  # real product surface 패키지
```

## 문서

더 자세한 내용은 공식 문서에서 확인하실 수 있습니다.

- 공식 문서: https://frontron.andongmin.com
- 가이드: https://frontron.andongmin.com/guide/
- 아키텍처 명세: [specs/framework-first.md](C:/Users/Andongmin/Desktop/repository/frontron/specs/framework-first.md)
- 이슈: https://github.com/andongmin94/frontron/issues

## 라이선스

MIT 라이선스를 따릅니다. 자세한 내용은 `LICENSE.md`를 참고해 주세요.
