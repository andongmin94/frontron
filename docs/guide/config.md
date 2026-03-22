# 설정

이 페이지는 Frontron 프로젝트에서 자주 바꾸는 설정이 어디에 있는지 정리한 레퍼런스입니다.

처음 쓰는 사람이라면 모든 값을 한 번에 이해할 필요는 없습니다. 아래에서 "먼저 바꾸면 체감이 큰 것"부터 보는 것이 좋습니다.

## 먼저 보면 좋은 변경 지점

대부분의 초보자는 아래 순서만 알아도 충분합니다.

1. `public/icon.ico`
2. `frontron/config.ts`의 `app.name`
3. `frontron/config.ts`의 `app.id`
4. `frontron/windows/index.ts`
5. `vite.config.ts`

## 1. 실행 명령 설정

실행과 빌드 관련 명령은 `package.json`의 `scripts`에 있습니다.

대표적으로 많이 쓰는 값은 아래와 같습니다.

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

## 2. 앱 이름과 앱 ID

앱 이름과 식별자는 `frontron/config.ts`에서 바꿉니다.

특히 초보자에게 중요한 값은 아래 두 가지입니다.

- `app.name`
- `app.id`

화면에 보이는 제목은 `frontron/windows/index.ts`나 `src/components/TitleBar.tsx`에서도 함께 바꿀 수 있습니다.

## 3. 아이콘 경로

기본 아이콘은 `public/icon.ico`를 사용하고, `frontron/config.ts`의 `app.icon`에서 연결합니다.

처음에는 이 파일 하나만 바꿔도 패키징 결과에서 큰 차이를 느낄 수 있습니다.

## 4. 개발 서버 포트

`vite.config.ts`의 `server.port`는 `frontron/config.ts`의 `web.dev.url`과 맞아야 합니다.

포트가 맞지 않으면 흰 화면이 보일 수 있습니다.

## 5. Frontron 브리지

렌더러에서 데스크톱 기능을 쓸 때는 `frontron/client`만 사용합니다.

기본적으로 아래 형태를 기억하면 충분합니다.

```ts
import { bridge } from 'frontron/client'

const version = await bridge.system.getVersion()
const state = await bridge.window.getState()
const off = bridge.window.onMaximizedChanged((value) => {
  console.log(value)
})

await bridge.window.toggleMaximize()
off()
```

즉, 초보자는 "데스크톱 기능은 `frontron/client` 브리지로 호출한다"는 한 문장만 제대로 기억해도 많은 혼란을 줄일 수 있습니다.

custom namespace는 `frontron/bridge/`에서 등록합니다.

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

`frontron dev`, `frontron build`, `frontron --check`는 `.frontron/types/frontron-client.d.ts`도 함께 생성합니다.

이 파일은 custom bridge namespace 이름뿐 아니라, config source에서 읽은 메서드 시그니처도 TypeScript 자동완성에 연결합니다.

## 6. 빌드 결과가 쌓이는 경로

아래 세 경로를 함께 기억하면 좋습니다.

```text
dist/
output/
.frontron/
```

- `dist/`: 화면 빌드 결과
- `output/`: 패키징 결과물
- `.frontron/`: framework-owned runtime/build staging

## 7. menu / tray / hooks

app-layer 확장은 `frontron/` 아래에서 이어집니다.

```ts
import menu from './frontron/menu'
import tray from './frontron/tray'
import hooks from './frontron/hooks'
```

- `frontron/menu.ts`: 앱 메뉴 정의
- `frontron/tray.ts`: 시스템 트레이 정의
- `frontron/hooks/`: `beforeDev`, `beforeBuild`, `afterPack` hook 정의

## 8. Rust 슬롯

Rust를 쓰려면 `frontron/config.ts`에서 공식 슬롯을 켭니다.

```ts
export default defineConfig({
  rust: {
    enabled: true,
  },
})
```

기본 scaffold는 `frontron/rust/` 아래에 있습니다.

- `npm run app:dev`: `cargo build`
- `npm run app:build`: `cargo build --release`

렌더러에서는 `frontron/client`를 통해 상태만 확인합니다.
렌더러에서는 `frontron/client`를 통해 built-in 상태 API와 config-driven Rust bridge를 사용합니다.

```ts
import { bridge } from 'frontron/client'

const nativeStatus = await bridge.system.getNativeStatus()
const isReady = await bridge.system.isNativeReady()
const sum = await bridge.math.add(2, 3)
```

첫 config-driven Rust bridge 예제는 `frontron/config.ts`의 `rust.bridge`입니다.
이 바인딩은 TypeScript 타입뿐 아니라 런타임에서도 인자 개수와 기본 값 타입을 확인합니다.

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

## 9. 이 페이지의 역할

이 페이지는 설정을 "순서대로 따라 하는 튜토리얼"이 아니라, 필요한 값을 다시 찾아보는 참조 문서입니다.

::: tip
실제로 아이콘과 이름을 바꾸는 순서를 먼저 보고 싶다면 `앱 이름과 아이콘 바꾸기` 튜토리얼을 먼저 읽어 보세요.
:::
