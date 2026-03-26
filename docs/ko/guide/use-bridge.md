# 데스크톱 브리지 사용하기

이 페이지는 기본 개념을 이해한 다음 실제 브리지 API를 사용할 때 보는 문서입니다.

Electron 스타일 앱이 처음이라면 먼저 [브리지 흐름 이해하기](/ko/guide/understand-bridge-flow) 를 읽으세요.

짧은 규칙은 여전히 간단합니다. 렌더러에서는 `frontron/client` 만 사용하세요.

## 1. 브리지 import

```ts
import { bridge } from 'frontron/client'
```

preload global 을 직접 읽지 마세요.

`window.electron` 을 사용하지 마세요.

## 2. 기본 내장 브리지 API

아래 namespace 는 Frontron 에 기본으로 들어 있습니다.

### `bridge.system`

- `getVersion()`
- `getPlatform()`
- `getNativeStatus()`
- `isNativeReady()`
- `openExternal(url | { url })`

### `bridge.window`

- `isVisible()`
- `isFocused()`
- `toggleVisibility()`
- `showInactive()`
- `minimize()`
- `toggleMaximize()`
- `hide()`
- `getBounds()`
- `setBounds({ x, y, width, height })`
- `getPosition()`
- `setPosition({ x, y })`
- `getAlwaysOnTop()`
- `setAlwaysOnTop({ value })`
- `getOpacity()`
- `setOpacity({ value })`
- `getState()`
- `onMaximizedChanged(listener)`

`bridge.window` 는 계속 primary window 편의 API 입니다.

### `bridge.windows`

- `open({ name })`
- `isVisible({ name })`
- `isFocused({ name })`
- `show({ name })`
- `showInactive({ name })`
- `toggleVisibility({ name })`
- `hide({ name })`
- `focus({ name })`
- `close({ name })`
- `minimize({ name })`
- `toggleMaximize({ name })`
- `exists({ name })`
- `getBounds({ name })`
- `setBounds({ name, x, y, width, height })`
- `getPosition({ name })`
- `setPosition({ name, x, y })`
- `getAlwaysOnTop({ name })`
- `setAlwaysOnTop({ name, value })`
- `getOpacity({ name })`
- `setOpacity({ name, value })`
- `getState({ name })`
- `listConfigured()`
- `listOpen()`

config 에 window 를 여러 개 정의했다면 이 namespace 를 사용하세요.

현재 window 모델은 여전히 named, route-based, lazy-singleton 구조입니다. `bridge.windows` 는 configured window 이름만 다루며, 임의의 runtime window instance 나 parent/modal window graph 를 만들지는 않습니다.

### `bridge.native`

- `getStatus()`
- `isReady()`
- `add(left, right)`

## 3. 기본 호출 예제

```ts
import { bridge } from 'frontron/client'

const version = await bridge.system.getVersion()
const state = await bridge.window.getState()
const bounds = await bridge.window.getBounds()
const mainVisible = await bridge.window.isVisible()
const mainFocused = await bridge.window.isFocused()
const nativeStatus = await bridge.native.getStatus()
await bridge.window.toggleVisibility()
const settingsVisible = await bridge.windows.isVisible({ name: 'settings' })
const settingsFocused = await bridge.windows.isFocused({ name: 'settings' })
await bridge.windows.toggleVisibility({ name: 'settings' })
await bridge.windows.setAlwaysOnTop({ name: 'settings', value: true })
```

이 메서드는 프로젝트별 bridge 코드를 추가하지 않아도 동작합니다.

## 4. custom bridge namespace 추가

custom bridge 코드는 두 부분으로 생각하면 쉽습니다.

1. config 에 bridge 등록
2. `frontron/bridge/` 에 handler export

### config 에 등록

```ts
// frontron.config.ts
import { defineConfig } from 'frontron'
import bridge from './frontron/bridge'

export default defineConfig({
  app: {
    name: 'My App',
    id: 'com.example.myapp',
  },
  bridge,
})
```

### handler export

```ts
// frontron/bridge/index.ts
const bridge = {
  app: {
    getGreeting: () => 'Hello from desktop code',
  },
}

export default bridge
```

### 렌더러에서 호출

```ts
import { bridge } from 'frontron/client'

const greeting = await bridge.app.getGreeting()
```

## 5. Rust 기반 bridge 메서드 추가

`frontron/rust` 에서 오는 메서드라면 `rust.bridge` 를 사용합니다.

```ts
import { defineConfig } from 'frontron'

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

그러면 렌더러에서는 이렇게 호출합니다.

```ts
import { bridge } from 'frontron/client'

const sum = await bridge.math.add(2, 3)
```

## 6. 내장 API 와 스타터 예제 구분

스타터에 들어 있는 몇몇 브리지 메서드는 예제일 뿐이고, 프레임워크 기본 내장 API 는 아닙니다.

예를 들면:

- `bridge.system.cpuCount()` 는 스타터 config 에서 옵니다
- `bridge.math.add()` 는 `rust.bridge` 에서 옵니다
- `bridge.file.hasTxtExtension()` 는 스타터 config 에서 옵니다

이 메서드는 프로젝트 config 가 등록했을 때만 존재합니다.

## 7. 생성 타입

Frontron 은 아래 시점에 `.frontron/types/frontron-client.d.ts` 를 생성합니다.

- `frontron dev`
- `frontron build`
- `frontron dev --check`
- `frontron build --check`

이 파일은 custom namespace 와 생성된 메서드 시그니처 자동완성을 제공합니다.

## 8. 브리지가 없는 것처럼 보일 때

UI 에 `Desktop bridge unavailable` 이나 `Missing bridge handler` 가 보이면 먼저 아래를 확인하세요.

1. `npm run dev` 가 아니라 `npm run app:dev` 를 실행했는지
2. `frontron/client` 에서 import 하는지
3. custom bridge 를 config 에 등록했는지
4. 터미널에 preload 또는 runtime 에러가 없는지

::: tip
처음에는 `bridge.system` 과 `bridge.window` 부터 시작하세요.

프로젝트 전용 데스크톱 호출이 필요할 때만 custom bridge namespace 로 가면 됩니다.
:::
