# Frontron <a href="https://npmjs.com/package/frontron"><img src="https://img.shields.io/npm/v/frontron" alt="npm package"></a>

`frontron`은 framework-first 방향에서 실제 제품이 되어야 하는 패키지입니다.

## 목표 public surface

이 패키지는 최종적으로 아래 surface를 소유해야 합니다.

- `defineConfig`
- `frontron dev`
- `frontron build`
- config discovery for root `frontron.config.ts`
- `frontron/client`
- Electron runtime/build ownership
- typed bridge registration
- app-layer expansion under `frontron/`
- the official `frontron/rust` slot

## 현재 상태

이 패키지는 이미 framework-first product surface의 기본 동작을 소유합니다.

- `defineConfig`, config discovery, `frontron dev`, `frontron build`, `frontron/client`를 제공합니다.
- `frontron dev`는 configured web dev command와 framework-owned Electron runtime을 함께 실행합니다.
- `frontron build`는 configured web build command 이후 `.frontron/` 아래에 runtime/build staging을 만들고 desktop packaging을 수행합니다.
- config-driven custom bridge namespace는 `frontron.config.ts`에서 로드되며, build 시 공식 app-layer 파일과 함께 staging 됩니다.
- `frontron` CLI는 `.frontron/types/frontron-client.d.ts`를 생성해서 custom bridge namespace와 메서드 시그니처를 TypeScript에 연결합니다.
- `menu`, `tray`, `hooks`도 같은 config surface에서 로드되며, starter와 manual install이 같은 구조를 공유합니다.
- `rust: { enabled: true }`는 공식 `frontron/rust` 슬롯을 사용하며, `frontron dev`에서는 `cargo build`, `frontron build`에서는 `cargo build --release`를 먼저 실행합니다.
- native artifact가 있으면 framework runtime이 이를 직접 로드하고, `bridge.system.getNativeStatus()`와 `bridge.system.isNativeReady()`로 상태를 확인할 수 있습니다.
- 첫 built-in Rust bridge surface로 `bridge.native.getStatus()`, `bridge.native.isReady()`, `bridge.native.add(left, right)`를 제공합니다.
- 첫 config-driven Rust bridge 예제로 `rust.bridge.math.add -> bridge.math.add` 흐름도 지원합니다.
- config-driven Rust bridge는 런타임에서도 인자 개수와 `int` / `double` / `bool` / `string` 타입을 검증합니다.
- public renderer API는 이제 `frontron/client`만 지원합니다.

## Migration Note

이 패키지는 더 이상 `window.electron` compatibility adapter를 제공하지 않습니다.

- old renderer `window.electron` 코드는 `frontron/client`로 옮겨야 합니다.
- old `src/electron/*` ownership model은 공식 구조가 아닙니다.
- template-owned build/runtime logic도 다시 지원하지 않습니다.

## 목표 사용 방식

```ts
import { defineConfig } from 'frontron'

export default defineConfig({
  app: {
    name: 'My App',
    id: 'com.example.myapp',
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

문서: https://frontron.andongmin.com
명세: [../../specs/framework-first.md](C:/Users/Andongmin/Desktop/repository/frontron/specs/framework-first.md)

## 라이선스

MIT © andongmin

이슈 / 제안: https://github.com/andongmin94/frontron/issues
