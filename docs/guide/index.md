# 빠른 시작

이 페이지는 Frontron의 공식 목표 계약과 현재 제품 상태를 가장 짧게 설명합니다.

legacy starter guide는 이전 앱 참고용으로만 남아 있고, 공식 방향은 framework-first, config-driven 구조입니다.

## 1. 먼저 준비할 것

아래 두 가지만 준비되어 있으면 시작할 수 있습니다.

- Node.js `22+`
- npm / yarn / pnpm / bun 중 하나

::: tip
이 문서에서는 명령어를 `npm` 기준으로 적습니다. 다른 패키지 매니저를 써도 흐름은 거의 같습니다.
:::

## 2. 공식 목표 계약

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
})
```

```bash
npm run app:dev
npm run app:build
```

## 3. 공식 구조

```text
my-app/
  src/
  public/
  package.json
  vite.config.ts
  frontron.config.ts
  frontron/
```

이 구조는 manual install 사용자와 starter 사용자 모두가 공유해야 하는 공식 shape입니다.

## 4. 현재 저장소 상태

- `frontron`은 이미 `defineConfig`, config discovery, `frontron dev`, `frontron build`, `frontron/client`를 제공합니다.
- `create-frontron`은 `frontron.config.ts`, `frontron/`, `app:dev`, `app:build`를 생성합니다.
- `bridge`, `menu`, `tray`, `hooks`는 이미 공식 config surface에서 로드됩니다.
- 공식 `frontron/rust` 슬롯도 이제 config와 starter 구조에서 고정되었습니다.
- `app:dev`와 `app:build` smoke check도 이미 정리되었습니다.
- 핵심 framework-first migration work는 완료되었습니다.

## 5. 다음에 볼 문서

- [공식 구조와 계약](/guide/framework-first)
- legacy starter flow를 참고해야 한다면 sidebar의 `Legacy Starter Guides`

::: tip
old starter docs는 참고용일 뿐이고, 공식 contract는 항상 `frontron.config.ts` 중심 구조입니다.
:::
