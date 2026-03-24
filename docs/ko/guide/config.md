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
- `app.description`
- `app.author`

`app.icon` 을 생략하면 Frontron 기본 패키지 아이콘이 사용됩니다.

## 3. 패키징 설정

일반적인 제품 패키징 결정도 `frontron.config.ts` 에서 합니다.

```ts
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
    mac: {
      targets: ['dmg', 'zip'],
    },
    linux: {
      targets: ['AppImage', 'deb'],
    },
  },
})
```

가장 많이 바꾸는 빌드 값은 아래입니다.

- `build.outputDir`
- `build.artifactName`
- `build.asar`
- `build.compression`
- `build.files`
- `build.extraResources`
- `build.extraFiles`
- `build.windows.targets`
- `build.windows.icon`
- `build.windows.publisherName`
- `build.windows.signAndEditExecutable`
- `build.windows.requestedExecutionLevel`
- `build.windows.artifactName`
- `build.nsis.oneClick`
- `build.nsis.perMachine`
- `build.nsis.allowToChangeInstallationDirectory`
- `build.nsis.deleteAppDataOnUninstall`
- `build.nsis.installerIcon`
- `build.nsis.uninstallerIcon`
- `build.mac.targets`
- `build.mac.icon`
- `build.mac.category`
- `build.mac.artifactName`
- `build.linux.targets`
- `build.linux.icon`
- `build.linux.category`
- `build.linux.packageCategory`
- `build.linux.artifactName`

경로 기반 값인 `build.extraResources`, `build.extraFiles`, `build.windows.icon`, `build.nsis.installerIcon` 은 프로젝트 루트 기준으로 해석합니다.

`build.mac.icon`, `build.linux.icon` 도 같은 방식으로 프로젝트 루트 기준 경로입니다.

`build.files` 는 조금 다릅니다. 이 값은 스테이징된 패키지 앱 내용을 기준으로 필터링하므로, 패턴도 그 스테이징 앱 루트 기준으로 적어야 합니다.

## 4. 창 설정

창 정의는 `frontron/windows/index.ts` 에 있습니다.

스타터는 route 기반 창 구조를 사용합니다.

```ts
const windows = {
  main: {
    route: '/',
    width: 1280,
    height: 800,
    frame: false,
    minWidth: 960,
    minHeight: 640,
    center: true,
    autoHideMenuBar: true,
  },
}
```

이제 `frontron.config.ts` 또는 `frontron/windows/index.ts` 에서 아래 창 옵션도 공식적으로 바꿀 수 있습니다.

- `route`
- `width`, `height`
- `minWidth`, `minHeight`, `maxWidth`, `maxHeight`
- `frame`, `resizable`
- `show`, `center`
- `fullscreen`, `fullscreenable`
- `maximizable`, `minimizable`, `closable`
- `alwaysOnTop`, `skipTaskbar`
- `backgroundColor`, `transparent`
- `autoHideMenuBar`
- `title`, `titleBarStyle`

트레이 앱처럼 처음에는 창을 숨겨 두고 싶다면 `show: false` 를 사용하면 됩니다.

## 5. 개발 서버 맞추기

`web.dev.url` 을 직접 적는다면 `vite.config.ts` 의 개발 포트와 그 값이 맞아야 합니다.

이 값이 다르면 데스크톱 창이 흰 화면으로 열릴 수 있습니다.

## 6. 데스크톱 브리지

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

## 7. 출력 경로

주요 생성 경로는 아래와 같습니다.

```text
dist/
output/
.frontron/
```

- `dist/`: 빌드된 웹 결과물
- `output/`: 기본 패키징 결과물
- `.frontron/`: 프레임워크가 소유하는 staging, manifest, 생성 타입

`build.outputDir` 를 설정했다면 `output/` 대신 그 경로를 보면 됩니다.

## 8. menu, tray, hooks

app-layer 확장은 `frontron/` 아래에서 이어집니다.

```ts
import menu from './frontron/menu'
import tray from './frontron/tray'
import hooks from './frontron/hooks'
```

- `frontron/menu.ts`: 앱 메뉴 정의
- `frontron/tray.ts`: 시스템 트레이 정의
- `frontron/hooks/`: `beforeDev`, `beforeBuild`, `afterPack`

## 9. Rust 슬롯

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

## 10. 이 페이지의 역할

이 페이지는 튜토리얼이 아니라 참조용 문서입니다.

::: tip
값을 바꾸는 과정을 더 천천히 보고 싶다면 먼저 `앱 이름과 아이콘 바꾸기` 문서를 읽어 보세요.
:::
