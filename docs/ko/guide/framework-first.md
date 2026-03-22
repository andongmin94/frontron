# Framework-First 계약

이 페이지는 Frontron이 따르는 공식 구조와 책임 분리를 설명합니다.

## 목표

실제 제품 표면은 `frontron` 패키지여야 합니다.

- 기존 웹 프로젝트에 `frontron` 을 설치할 수 있어야 합니다.
- 루트 `frontron.config.ts` 가 공식 엔트리포인트여야 합니다.
- `create-frontron` 은 얇은 스타터 생성기로 남아야 합니다.

## 공식 시작 흐름

지원되는 시작 흐름은 아래와 같습니다.

1. 기존 웹 프론트엔드 프로젝트 준비
2. `frontron` 설치
3. 루트 `frontron.config.ts` 작성
4. `app:dev` 실행
5. `app:build` 실행

## 공식 구조

중요한 구조는 아래와 같습니다.

```text
my-app/
  src/
  public/
  package.json
  vite.config.ts
  frontron.config.ts
  frontron/
```

`frontron/` 은 app-layer 전용 공간입니다.

- `bridge/`
- `windows/`
- `tray.ts`
- `menu.ts`
- `hooks/`
- `rust/`

## 책임 분리

웹 프로젝트가 소유하는 것:

- 페이지
- 컴포넌트
- 상태관리
- 라우팅
- API 호출

`frontron` 이 소유하는 것:

- Electron runtime ownership
- preload / main wiring
- packaging / build ownership
- typed bridge runtime
- native loading

`create-frontron` 이 소유하는 것:

- 공식 구조를 빠르게 만드는 스타터 생성
- `frontron` dependency wiring
- 예제 `frontron.config.ts`

## 현재 상태

이 저장소는 이미 이 구조를 구현하고 있습니다.

- `frontron` 이 config discovery, CLI, runtime/build staging 을 소유합니다.
- `create-frontron` 은 공식 구조를 생성하는 얇은 스타터 생성기입니다.
- public renderer API 는 이제 `frontron/client` 하나뿐입니다.
- 공식 Rust 슬롯은 `frontron/rust` 입니다.

## 오래된 앱

오래된 `window.electron` 렌더러 코드는 더 이상 지원되지 않습니다.

오래된 앱은 아래 규칙으로 옮겨야 합니다.

- 렌더러에서는 `frontron/client` 만 사용
- preload global 이나 내부 브리지 구현에 직접 의존하지 않기
- 예전 `src/electron/*` 구조를 되살리지 않기
