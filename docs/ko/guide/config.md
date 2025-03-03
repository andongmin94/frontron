# 설정

이 페이지는 Frontron 프로젝트에서 자주 바꾸는 설정을 정리한 레퍼런스입니다.

모든 값을 한 번에 이해할 필요는 없습니다. 먼저 체감이 큰 값부터 보면 됩니다.

## 먼저 바꾸면 좋은 지점

대부분의 사용자에게는 아래 순서면 충분합니다.

1. `public/icon.ico`
2. `frontron/config.ts` 의 `app.name`
3. `frontron/config.ts` 의 `app.id`
4. `frontron/windows/index.ts`
5. `vite.config.ts`

## 1. 명령어

주요 실행/빌드 명령은 `package.json` 에 있습니다.

스타터는 아래 구조를 사용합니다.

```json
{
  "scripts": {
    "dev": "vite",
    "web:dev": "vite",
    "web:build": "vite build",
    "app": "npm run app:dev",
    "app:dev": "frontron dev",
    "app:build": "frontron build",
    "build": "npm run app:build"
  }
}
```

표준 Vite 프로젝트라면 `frontron dev`, `frontron build` 가 `package.json` 과 `vite.config.*` 에서 웹 명령과 대상을 자동으로 추론할 수 있습니다.

개발 모드에서는 `--port 3001`, `PORT=3001`, 그리고 몇 가지 흔한 프론트엔드 기본값도 함께 읽을 수 있습니다.

프로젝트에서 값이 더 특수해서 Frontron 이 안전하게 추론하기 어렵다면 그때만 `web.dev`, `web.build` 를 직접 적으면 됩니다.

## 2. 앱 메타데이터

주요 메타데이터 값은 `frontron/config.ts` 에 있습니다.

대부분의 사용자가 먼저 수정하는 값은 아래입니다.

- `app.name`
- `app.id`
- `app.icon`

`app.icon` 을 생략하면 Frontron 기본 패키지 아이콘이 사용됩니다.

## 3. 창 설정

창 정의는 `frontron/windows/index.ts` 에 있습니다.

스타터는 route 기반 창 구조를 사용합니다.

```ts
const windows = {
  main: {
    route: '/',
    width: 1280,
    height: 800,
    frame: false,
  },
}
```

## 4. 개발 서버 맞추기

`web.dev.url` 을 직접 적는다면 `vite.config.ts` 의 개발 포트와 그 값이 맞아야 합니다.

이 값이 다르면 데스크톱 창이 흰 화면으로 열릴 수 있습니다.

## 5. 데스크톱 브리지

렌더러 코드는 `frontron/client` 만 사용해야 합니다.

```ts
import { bridge } from 'frontron/client'

const version = await bridge.system.getVersion()
const state = await bridge.window.getState()
const nativeStatus = await bridge.native.getStatus()
```

custom namespace 는 `frontron/bridge/` 아래에서 등록합니다.

```ts
// frontron/bridge/index.ts
const bridge = {
  app: {
    getGreeting: () => 'Hello from bridge',
  },
}

export default bridge
```

```ts
import { bridge } from 'frontron/client'

const greeting = await bridge.app.getGreeting()
```

`frontron dev`, `frontron build`, `frontron dev --check`, `frontron build --check` 는 `.frontron/types/frontron-client.d.ts` 도 생성합니다.

이 파일은 custom bridge namespace 와 생성된 메서드 시그니처를 TypeScript 자동완성에 연결합니다.

## 6. 출력 경로

주요 생성 경로는 아래와 같습니다.

```text
dist/
output/
.frontron/
```

- `dist/`: 빌드된 웹 결과물
- `output/`: 패키징된 데스크톱 결과물
- `.frontron/`: 프레임워크가 소유하는 staging, manifest, 생성 타입

## 7. menu, tray, hooks

app-layer 확장은 `frontron/` 아래에서 이어집니다.

```ts
import menu from './frontron/menu'
import tray from './frontron/tray'
import hooks from './frontron/hooks'
```

- `frontron/menu.ts`: 앱 메뉴 정의
- `frontron/tray.ts`: 시스템 트레이 정의
- `frontron/hooks/`: `beforeDev`, `beforeBuild`, `afterPack`

## 8. Rust 슬롯

공식 Rust 슬롯은 `frontron/config.ts` 에서 활성화합니다.

```ts
export default defineConfig({
  rust: {
    enabled: true,
  },
})
```

스타터 scaffold 는 `frontron/rust/` 아래에 있습니다.

- `npm run app:dev`: `cargo build`
- `npm run app:build`: `cargo build --release`

렌더러 코드는 여전히 `frontron/client` 를 통해 접근합니다.

```ts
import { bridge } from 'frontron/client'

const nativeStatus = await bridge.native.getStatus()
const isReady = await bridge.native.isReady()
```

스타터 scaffold 에는 config-driven Rust bridge 예제도 함께 들어 있습니다.

이 예제 메서드는 프레임워크 내장 API 가 아닙니다. `frontron/config.ts` 의 `rust.bridge` 에서 연결됩니다.

```ts
export default defineConfig({
  rust: {
    enabled: true,
    bridge: {
      math: {
        add: {
          symbol: 'frontron_native_add',
          args: ['int', 'int'] as const,
          returns: 'int' as const,
        },
      },
    },
  },
})
```

```ts
import { bridge } from 'frontron/client'

const sum = await bridge.math.add(2, 3)
const cpuCount = await bridge.system.cpuCount()
```

이 바인딩은 TypeScript 와 런타임 양쪽에서 모두 검증됩니다.

## 9. 이 페이지의 역할

이 페이지는 튜토리얼이 아니라 참조용 문서입니다.

::: tip
값을 바꾸는 과정을 더 천천히 보고 싶다면 먼저 `앱 이름과 아이콘 바꾸기` 문서를 읽어 보세요.
:::
