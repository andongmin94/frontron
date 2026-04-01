# 설정

이 페이지는 `create-frontron` 으로 시작한 스타터나, 기존 웹 프로젝트에 `frontron` 을 붙인 뒤 가장 자주 바꾸는 설정을 정리한 레퍼런스입니다.

데스크톱 레이어 전체를 한 번에 외울 필요는 없습니다. 먼저 체감이 큰 값부터 바꾸고, 특정 동작이 필요할 때 다시 찾아오는 문서로 보면 됩니다.

## 먼저 바꾸면 좋은 지점

대부분의 사용자에게는 아래 순서면 충분합니다.

1. `public/icon.ico`
2. 루트 `frontron.config.ts` 의 앱 메타데이터
4. `frontron/windows/index.ts`
5. `vite.config.ts`

## 1. 명령어

주요 실행/빌드 명령은 `package.json` 에 있습니다.

생성된 스타터는 아래 구조를 사용합니다.

```json
{
  "scripts": {
    "dev": "vite",
    "web:dev": "vite",
    "web:build": "vite build",
    "app:dev": "frontron dev",
    "app:build": "frontron build"
  }
}
```

표준 Vite 프로젝트라면 `frontron dev`, `frontron build` 가 `package.json` 과 `vite.config.*` 에서 웹 명령과 대상을 자동으로 추론할 수 있습니다.

개발 모드에서는 `--port 3001`, `PORT=3001`, 그리고 몇 가지 흔한 프론트엔드 기본값도 함께 읽을 수 있습니다.

기존 웹앱에 수동으로 붙인 경우에도 가능하면 같은 script 구조를 유지하는 편이 좋습니다.

프로젝트에서 값이 더 특수해서 `frontron` 이 안전하게 추론하기 어렵다면 그때만 `web.dev`, `web.build` 를 직접 적으면 됩니다.

## 2. 앱 메타데이터

주요 메타데이터 값은 루트 `frontron.config.ts` 에 있습니다.

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
- `build.fileAssociations`
- `build.windows.targets`
- `build.windows.icon`
- `build.windows.publisherName`
- `build.windows.certificateSubjectName`
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
- `build.mac.identity`
- `build.mac.hardenedRuntime`
- `build.mac.gatekeeperAssess`
- `build.mac.entitlements`
- `build.mac.entitlementsInherit`
- `build.mac.artifactName`
- `build.linux.targets`
- `build.linux.icon`
- `build.linux.category`
- `build.linux.packageCategory`
- `build.linux.artifactName`
- `deepLinks.enabled`
- `deepLinks.name`
- `deepLinks.schemes`
- `updates.enabled`
- `updates.provider`
- `updates.url`
- `updates.checkOnLaunch`
- `security.externalNavigation`
- `security.newWindow`

경로 기반 값인 `build.extraResources`, `build.extraFiles`, `build.windows.icon`, `build.nsis.installerIcon` 은 프로젝트 루트 기준으로 해석합니다.

`build.mac.icon`, `build.linux.icon` 도 같은 방식으로 프로젝트 루트 기준 경로입니다.

`build.files` 는 조금 다릅니다. 이 값은 스테이징된 패키지 앱 내용을 기준으로 필터링하므로, 패턴도 그 스테이징 앱 루트 기준으로 적어야 합니다.

`build.fileAssociations` 는 typed 파일 연결 표면입니다. raw `fileAssociations` 를 `build.advanced.electronBuilder` 로 우회하지 말고 이 공식 필드를 사용하면 됩니다.

`build.fileAssociations[].icon` 경로도 프로젝트 루트 기준으로 해석합니다.

Windows 에서 file association 은 electron-builder 기준으로 NSIS 빌드에 연결되고, 보통 `build.nsis.perMachine: true` 일 때 실제 등록 동작을 기대하는 편이 안전합니다.

`updates.*` 도 typed 제품 설정 표면에 포함됩니다. 다만 이번 첫 슬라이스는 작게 유지했고, 현재는 generic feed URL 을 쓰는 packaged macOS 앱만 공식 지원합니다.

`updates.enabled` 가 `false` 가 아니라면 `updates.url` 을 같이 설정하세요.

`deepLinks.*` 는 커스텀 프로토콜 등록과 런타임 딥링크 수신을 제어합니다. 들어온 링크는 `bridge.deepLink.getState()` 와 `bridge.deepLink.consumePending()` 으로 읽을 수 있습니다.

## 4. 창 설정

창 정의는 `frontron/windows/index.ts` 에 있습니다.

생성된 스타터는 route 기반 창 구조를 사용합니다.

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

`main` 은 계속 primary window 입니다.

추가로 정의한 창은 runtime 이 소유하는 named window 로 취급합니다.

현재 slice 에서는 non-primary 창을 bootstrap 시점에 만들지 않고 lazy singleton 으로 엽니다. menu, tray, hook, 또는 `bridge.windows.open({ name: 'settings' })` 같은 렌더러 bridge 호출로 나중에 열면 됩니다.

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

## 7. Guarded advanced overrides

`build.advanced.electronBuilder` 는 마지막 예외 처리용 escape hatch 입니다.

먼저 공식 typed `build.*` 설정을 쓰고, 정말 필요한 경우에만 이 블록을 써야 합니다.

Frontron 은 스테이징 경로, 패키지 엔트리, 그리고 이미 공식화한 패키징 필드처럼 프레임워크가 소유하는 값은 여기서 덮지 못하게 막습니다.

`windows.*.advanced` 도 같은 성격의 예외 블록입니다.

이 경로로는 `webPreferences`, 아이콘 연결, 그리고 이미 공식 typed surface 로 열린 일반 창 옵션을 다시 가져갈 수 없습니다.

안전하게 공식 지원하는 web preference subset 은 아래 네 가지입니다.

- `zoomFactor`
- `sandbox`
- `spellcheck`
- `webSecurity`

반대로 `preload`, `contextIsolation`, `nodeIntegration`, raw session 소유권은 계속 `frontron` 안에 남아 있습니다.

스타터 프로젝트와 호환 수동 설치 경로 모두 custom namespace 는 `frontron/bridge/` 아래에서 등록합니다.

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
- `.frontron/`: `frontron` 이 소유하는 staging, manifest, 생성 타입

`build.outputDir` 를 설정했다면 `output/` 대신 그 경로를 보면 됩니다.

## 8. menu, tray, hooks

스타터/템플릿 app-layer 확장은 `frontron/` 아래에서 이어집니다.

```ts
import menu from './frontron/menu'
import tray from './frontron/tray'
import hooks from './frontron/hooks'
```

- `frontron/menu.ts`: 앱 메뉴 정의
- `frontron/tray.ts`: 시스템 트레이 정의
- `frontron/hooks/`: `beforeDev`, `beforeBuild`, `afterPack`

## 9. Rust 슬롯

공식 Rust 슬롯은 루트 `frontron.config.ts` 에서 활성화합니다.

```ts
export default defineConfig({
  rust: {
    enabled: true,
  },
})
```

생성된 스타터 scaffold 는 `frontron/rust/` 아래에 있습니다.

- `npm run app:dev`: `cargo build`
- `npm run app:build`: `cargo build --release`

렌더러 코드는 여전히 `frontron/client` 를 통해 접근합니다.

```ts
import { bridge } from 'frontron/client'

const nativeStatus = await bridge.native.getStatus()
const isReady = await bridge.native.isReady()
```

스타터 scaffold 에는 config-driven Rust bridge 예제도 함께 들어 있습니다.

이 예제 메서드는 프레임워크 내장 API 가 아닙니다. 루트 `frontron.config.ts` 의 `rust.bridge` 에서 연결됩니다.

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

이 페이지는 support package 기준 참조 문서이지 튜토리얼은 아닙니다.

::: tip
값을 바꾸는 과정을 더 천천히 보고 싶다면 먼저 `앱 이름과 아이콘 바꾸기` 문서를 읽어 보세요.
:::

## Security

`security.*` 는 외부 네비게이션에 대한 첫 typed 런타임 정책 표면입니다.

```ts
security: {
  externalNavigation: 'openExternal',
  newWindow: 'deny',
}
```

지원 값:

- `allow`
- `deny`
- `openExternal`

이 정책은 렌더러가 현재 앱 origin 밖으로 이동하려 할 때만 적용됩니다.
같은 origin 안의 이동은 계속 앱 안에서 허용됩니다.
