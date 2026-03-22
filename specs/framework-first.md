# Frontron 최종 목표 명세

## 1. 핵심 정의

Frontron은 **기존 웹 프론트엔드 프로젝트를 거의 그대로 유지한 채**, 설정 중심(`config-driven`)으로 데스크톱 앱처럼 실행하고 빌드할 수 있게 만드는 **핵심 프레임워크**여야 한다.

`create-frontron`은 그 `frontron`이 미리 연결된 **최신 호환 스타터 템플릿 생성기**일 뿐이며, 제품의 본체가 되어서는 안 된다.

---

## 2. 제품 역할

### `frontron`
실제 제품이다. 아래 책임을 소유해야 한다.

- config schema
- config loader
- CLI (`frontron dev`, `frontron build` 등)
- Electron runtime ownership
- packaging/build ownership
- window / tray / menu / app-shell behavior
- typed web ↔ app bridge
- hooks/extensibility
- Rust 기반 native 확장 통합

### `create-frontron`
얇은 편의 도구다. 아래 역할만 가져야 한다.

- `frontron`이 설치된 스타터 생성
- `frontron.config.ts` 기본 예제 제공
- `frontron/` 폴더 기본 구조 제공
- 호환성 보장된 최신 웹 템플릿 제공

### `create-frontron`이 하면 안 되는 것
- Electron runtime logic 소유
- packaging/build logic 소유
- template 안에 app 본체를 복붙해서 관리
- template만 가능한 특별한 구조 제공

---

## 3. 가장 중요한 사용자 시나리오

### 시나리오 A. 기존 웹 프로젝트에 수동 설치
사용자는 템플릿 없이도 아래만으로 앱 형태를 확인할 수 있어야 한다.

1. 기존 웹 프론트엔드 프로젝트가 있다
2. `frontron`을 설치한다
3. 루트에 `frontron.config.ts`를 만든다
4. 최소 설정을 넣는다
5. `app:dev`를 실행한다
6. 즉시 앱 형태를 본다
7. `app:build`를 실행하면 앱 산출물이 나온다

이 시나리오는 **1급 시나리오**다. 절대 템플릿 전용 흐름이 되면 안 된다.

### 시나리오 B. 템플릿으로 새로 시작
사용자는 `create-frontron`으로 새 프로젝트를 시작할 수도 있다.

하지만 이 경우에도 결과물은 **수동 설치 사용자와 같은 공식 구조**를 가져야 한다.  
템플릿 유저만 가능한 별도 구조가 있으면 안 된다.

---

## 4. UX 목표

### 최소 도입 경험
사용자는 아래만으로 시작할 수 있어야 한다.

- `frontron` 설치
- `frontron.config.ts` 작성
- `app:dev` 실행

즉 사용자는 처음부터 아래를 직접 관리하지 않아야 한다.

- Electron `main.ts`
- preload
- ipc wiring
- builder 설정
- native module loader
- platform-specific packaging 세부 구현

### 점진적 확장 경험
처음엔 `frontron.config.ts` 하나로 시작한다.  
설정이 커지면 `frontron/` 폴더 아래로 분리한다.  
즉 확장 방식은 항상 아래 패턴을 따른다.

**inline으로 시작 → 파일로 분리 → 폴더로 모듈화**

---

## 5. 공식 구조

### 최소 구조
아주 단순한 사용자라면 아래만 있어도 시작 가능해야 한다.

```txt
my-app/
  src/
  public/
  package.json
  vite.config.ts
  frontron.config.ts
```

### 확장 구조
앱 기능이 커지면 아래 구조로 자연스럽게 확장한다.

```txt
my-app/
  src/                        # 기존 웹 프론트엔드
  public/
  package.json
  tsconfig.json
  vite.config.ts
  frontron.config.ts          # 공식 엔트리포인트

  frontron/                   # 앱 레이어 전용 공간
    config.ts
    bridge/
      index.ts
      system.ts
      auth.ts
      file.ts
      window.ts
    windows/
      index.ts
      main.ts
      settings.ts
    tray.ts
    menu.ts
    hooks/
      before-build.ts
      after-pack.ts
    rust/
      Cargo.toml
      src/
        lib.rs
        system.rs
        file.rs
        auth.rs
```

---

## 6. Config 원칙

### 공식 config 엔트리포인트
공식 auto-discovery 대상은 프로젝트 루트의 아래 파일 하나다.

```txt
frontron.config.ts
```

필요하면 이 파일은 아래처럼 내부 파일을 re-export만 해도 된다.

```ts
export { default } from './frontron/config'
```

### config의 역할
`frontron.config.ts`는 단순한 옵션 파일이 아니라 **앱 레이어의 단일 진입점**이다.

여기서 시작해야 하는 것:

- app metadata
- icon
- window definitions
- tray/menu
- build/dev integration
- bridge registration
- hooks registration
- Rust 사용 여부 및 연결
- packaging 관련 앱 설정

### 경로 해석 원칙
config 안의 상대경로는 **항상 프로젝트 루트 기준**으로 해석한다.  
config 파일이 어느 폴더에 있든 의미가 바뀌면 안 된다.

---

## 7. 시작은 단순하게, 커지면 분리

### 허용해야 하는 사용 방식
처음에는 이런 식으로 간단하게 쓸 수 있어야 한다.

```ts
import { defineConfig } from 'frontron'

export default defineConfig({
  app: {
    name: 'My App',
    id: 'com.example.myapp',
    icon: './public/icon.png',
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

### 커졌을 때의 분리 방식
설정이 길어지면 아래처럼 `frontron/` 아래로 분리하고, `frontron.config.ts`는 조립만 한다.

```ts
import { defineConfig } from 'frontron'
import windows from './frontron/windows'
import bridge from './frontron/bridge'
import tray from './frontron/tray'
import menu from './frontron/menu'

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
  windows,
  bridge,
  tray,
  menu,
})
```

---

## 8. 책임 분리

### 웹 프로젝트가 소유하는 것
`src/` 아래의 기존 웹 앱은 그대로 웹 앱답게 유지된다.

- 페이지
- 컴포넌트
- 상태관리
- 라우팅
- API 호출
- 백엔드 연동

### Frontron이 소유하는 것
앱 레이어는 `frontron`이 소유한다.

- app shell
- desktop runtime
- window lifecycle
- bridge runtime
- packaging
- native loading
- preload/main wiring
- app metadata injection

### 사용자 프로젝트의 `frontron/` 폴더가 소유하는 것
사용자 앱 고유의 desktop-side 설정과 확장 로직.

- 창 정의
- bridge namespace
- tray/menu 정의
- build hooks
- Rust 확장 코드

---

## 9. Bridge 설계 원칙

Bridge는 아래 조건을 만족해야 한다.

- explicit
- typed
- namespaced
- scalable

### 금지
아래처럼 flat한 함수 목록을 수십 개 늘어놓는 구조는 지양한다.

### 권장
도메인 기준 namespace를 사용한다.

- `system.*`
- `auth.*`
- `file.*`
- `window.*`

### 웹에서의 사용 원칙
웹 프론트엔드는 오직 `frontron/client`만 사용한다.

웹 코드에서 아래 직접 사용은 금지한다.

- `electron`
- `ipcRenderer`
- native addon direct import
- preload internals

즉 사용자는 아래처럼 느껴야 한다.

```ts
import { bridge } from 'frontron/client'

const version = await bridge.system.getVersion()
await bridge.system.openExternal({ url: 'https://example.com' })
```

---

## 10. Window 설계 원칙

Window는 **route 기반 선언**으로 가야 한다.

권장 예시:

```ts
export default {
  main: {
    route: '/',
    width: 1280,
    height: 800,
  },
  settings: {
    route: '/settings',
    width: 900,
    height: 700,
  },
}
```

### 원칙
- 처음엔 inline 가능
- 커지면 `frontron/windows/*`로 분리
- `frontron.config.ts`는 windows를 연결만 함
- frontend component를 직접 소유하는 구조보다 route 중심 구조를 우선한다

---

## 11. Rust 확장 원칙

### 지원 범위
Native 확장은 **Rust만 지원**한다.  
C++ 지원은 목표가 아니다.

### 사용자 경험 목표
사용자는 Rust를 “별도 네이티브 기술”로 느끼지 않아야 한다.  
그냥 Frontron이 제공하는 고성능/OS capability로 느껴져야 한다.

### 공식 슬롯
Rust 확장은 기본적으로 아래 위치를 공식 슬롯으로 사용한다.

```txt
frontron/rust
```

### v1 원칙
- 우선은 앱당 하나의 공식 Rust slot으로 시작
- 필요 이상으로 generic native module system을 만들지 않는다
- build / type generation / loading / wiring은 Frontron이 최대한 흡수한다
- 웹은 Rust를 직접 호출하지 않고 bridge를 통해서만 접근한다

### 사용자 입장 예시
사용자는 아래처럼 쓴다.

```ts
const hash = await bridge.file.hash({ path: '/tmp/a.txt' })
const info = await bridge.system.cpuInfo()
```

그 뒤에서 Rust가 쓰이더라도, 사용자는 그 구현 세부를 신경 쓸 필요가 없어야 한다.

---

## 12. Backend 호환 원칙

Frontron은 기존 웹 프론트엔드가 이미 백엔드와 통신하고 있다면,  
그 구조를 최대한 그대로 유지한 채 앱화해야 한다.

### 원칙
- 기존 frontend-backend flow를 깨지 않는다
- backend architecture를 강제로 바꾸지 않는다
- proxy 전제를 강요하지 않는다
- `window.location.origin`에 의존하는 API base URL 설계는 지양한다
- API base URL은 명시적 설정/env 기반으로 가는 것이 바람직하다

즉 Frontron은 backend 대체물이 아니라 **desktop wrapper + app bridge**다.

---

## 13. Template 규칙

`create-frontron`이 생성하는 결과물은 **수동 설치 사용자도 직접 만들 수 있는 공식 구조**와 동일해야 한다.

즉 템플릿은 아래를 미리 생성할 뿐이다.

- `frontron` dependency
- `frontron.config.ts`
- `frontron/` 기본 구조
- 추천 frontend starter

### 절대 금지
- 템플릿 전용 runtime 구조
- 템플릿 전용 build 로직
- 템플릿 안에 복붙된 Electron core
- 템플릿만 가능한 bridge/native 연결 방식

---

## 14. 피해야 할 방향

아래는 명확한 anti-goal이다.

- product를 template-first로 유지하는 것
- runtime/build ownership이 template에 남는 것
- app 관련 설정이 여러 user-managed Electron 파일에 흩어지는 것
- 사용자가 copied `main/preload/builder` 코드를 직접 관리해야 하는 것
- 템플릿으로 시작한 사람만 편한 구조
- C++ 지원을 고려한 과도한 추상화
- v1에서 과도한 generic plugin/native system 설계

---

## 15. 성공 기준

아래가 만족되면 방향이 맞다.

1. 기존 웹 프로젝트에 `frontron`만 설치해도 desktop 실행이 가능하다
2. 루트 `frontron.config.ts` 하나만으로 최소 앱 실행이 가능하다
3. 복잡해지면 `frontron/` 폴더로 자연스럽게 확장할 수 있다
4. `create-frontron`은 선택사항이며 얇다
5. runtime/build 개선은 template 교체가 아니라 `frontron` 업데이트로 전달된다
6. 웹 개발자는 Electron 내부를 몰라도 된다
7. Rust 확장은 Frontron 내부 capability처럼 통합된다
8. 템플릿 사용자와 수동 설치 사용자가 같은 공식 구조를 공유한다

---

## 16. 구현 우선순위

Codex는 아래 순서를 우선시한다.

### 1단계
기존 웹 프로젝트 + `frontron.config.ts` + `app:dev`  
이 최소 흐름을 먼저 성립시킨다.

### 2단계
`app:build`를 성립시킨다.

### 3단계
config가 커질 때 `frontron/`으로 분리 가능한 구조를 확정한다.

### 4단계
bridge / windows / tray / menu / hooks 구조를 정식화한다.

### 5단계
Rust slot (`frontron/rust`)을 1급 확장 영역으로 통합한다.

### 6단계
`create-frontron`을 얇은 starter generator로 축소한다.

### 7단계
문서와 예제를 framework-first 구조에 맞게 정리한다.

---

## 17. Codex 작업 원칙

- 큰 작업을 한 번에 하지 말고, 작고 리뷰 가능한 단위로 나눈다
- 사용자가 보는 동작이 바뀌면 문서를 같이 갱신한다
- 동작이 바뀌면 fixture/test를 추가한다
- template에 새 runtime logic를 추가하지 않는다
- ownership을 template에서 `frontron`으로 이동시키는 방향을 유지한다
- 필요 이상의 범용화보다 공식 구조와 DX 일관성을 우선한다

---

## 18. 최종 목표 문장

Frontron의 최종 목표는 다음과 같다.

**기존 웹 프론트엔드 프로젝트에 `frontron`과 `frontron.config.ts`만 추가하면 즉시 데스크톱 앱처럼 실행하고 빌드할 수 있어야 하며, 필요할 때만 `frontron/` 폴더로 앱 레이어를 점진적으로 확장할 수 있어야 한다. `create-frontron`은 이 구조를 미리 세팅해주는 최신 호환 스타터 생성기로만 남고, 제품의 본체는 항상 `frontron`이어야 한다.**
