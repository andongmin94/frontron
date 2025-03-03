# 브리지 흐름 이해하기

Frontron이 어렵게 느껴진다면 이 페이지부터 보세요.

가장 중요한 생각은 간단합니다. 웹 UI와 데스크톱 쪽 코드는 같은 곳에서 실행되지 않습니다.

Frontron은 이 둘을 대신 연결해 줍니다.

## 1. 세 부분으로 보기

```text
src/ React UI  ->  frontron/client  ->  desktop-side handlers
renderer           safe bridge          Electron runtime
```

- `src/` 는 평범한 프론트엔드 코드입니다.
- `frontron/client` 는 프론트엔드가 데스크톱 기능을 부를 때 쓰는 유일한 API 입니다.
- desktop-side handlers 는 브라우저가 아니라 Frontron 데스크톱 런타임에서 실행됩니다.

## 2. 왜 브리지가 필요한가요?

브라우저 코드는 데스크톱 창 제어, 시스템 API, 네이티브 모듈을 직접 만지면 안 됩니다.

그래서 Frontron은 데스크톱 쪽을 한쪽에 두고, 렌더러 쪽에는 안전한 호출 지점만 제공합니다.

## 3. Frontron이 이미 맡고 있는 것

Frontron은 아래 부분을 이미 소유합니다.

- Electron main process
- preload
- IPC wiring
- runtime boot
- packaging 흐름

이 파일들은 사용자가 직접 만들지 않습니다.

## 4. 사용자가 주로 쓰는 것

보통 사용자는 아래 부분만 작성하면 됩니다.

- `src/` 안의 페이지와 컴포넌트
- `bridge.system`, `bridge.window`, 또는 직접 만든 bridge namespace 호출
- `frontron/bridge/` 아래의 선택적 desktop-side handler

## 5. 아주 작은 예제

이 예제는 UI에서 데스크톱 코드로 가는 전체 경로를 보여 줍니다.

### Step 1. config에 bridge 등록

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

### Step 2. desktop-side handler 추가

```ts
// frontron/bridge/index.ts
import os from 'node:os'

const bridge = {
  app: {
    getComputerName: () => os.hostname(),
  },
}

export default bridge
```

이 파일은 데스크톱 쪽에서 실행됩니다.

그래서 `node:os` 를 사용할 수 있습니다.

### Step 3. 프론트엔드에서 호출

```tsx
import { bridge } from 'frontron/client'

const computerName = await bridge.app.getComputerName()
```

이 코드는 프론트엔드에서 실행됩니다.

Node API를 직접 만지는 것이 아닙니다.

브리지만 호출합니다.

## 6. 버튼을 누르면 실제로 무슨 일이 일어나나요?

흐름을 아주 단순하게 적으면 이렇습니다.

1. React 컴포넌트가 `bridge.app.getComputerName()` 을 호출합니다.
2. Frontron이 그 요청을 데스크톱 쪽으로 보냅니다.
3. `frontron/bridge/index.ts` 의 handler가 그쪽에서 실행됩니다.
4. 반환값이 다시 프론트엔드로 돌아옵니다.
5. UI가 그 결과를 화면에 그립니다.

## 7. 처음에는 기본 브리지부터 쓰세요

custom handler를 만들기 전에 기본 API부터 확인하는 편이 좋습니다.

- `bridge.window`: 최소화, 최대화 같은 창 동작
- `bridge.system`: 앱과 플랫폼 관련 도우미
- `bridge.native`: 네이티브 런타임 상태 확인

이 메서드는 프로젝트 설정을 더 하지 않아도 바로 존재합니다.

## 8. custom handler는 필요할 때만 추가하세요

프론트엔드가 아래 같은 데스크톱 전용 작업이 필요할 때만 직접 bridge namespace를 추가하면 됩니다.

- 시스템 정보 읽기
- Node 모듈 호출
- 프로젝트 전용 데스크톱 로직 감싸기

Rust 기반 네이티브 코드가 필요하면 config의 `rust.bridge` 를 사용하세요.

## 9. 자주 하는 실수

- `npm run app:dev` 대신 `npm run dev` 를 실행함
- 렌더러 코드에서 `frontron/client` 말고 다른 것을 import 함
- `frontron/bridge/index.ts` 파일은 만들었지만 config에 등록하지 않음
- 스타터 예제 메서드를 직접 추가하지 않았는데도 수동 설치 프로젝트에서 자동으로 있을 것이라 기대함

## 10. 다음에 읽으면 좋은 문서

- [기존 프로젝트에 설치하기](/ko/guide/install-existing-project)
- [개발 모드로 실행하기](/ko/guide/run-development)
- [데스크톱 브리지 사용하기](/ko/guide/use-bridge)
