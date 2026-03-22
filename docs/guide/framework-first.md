# Framework-First Contract

이 문서는 Frontron이 수렴해야 하는 공식 구조와 책임 분리를 설명합니다.

## 목표

Frontron의 본체는 `frontron` 패키지여야 합니다.

- 기존 웹 프로젝트에 `frontron`을 설치할 수 있어야 합니다.
- root `frontron.config.ts`가 공식 entrypoint여야 합니다.
- `create-frontron`은 얇은 starter generator만 담당해야 합니다.

## 공식 시작 흐름

최종적으로 사용자는 아래만으로 시작할 수 있어야 합니다.

1. 기존 웹 프론트엔드 프로젝트 준비
2. `frontron` 설치
3. root `frontron.config.ts` 작성
4. `app:dev` 실행
5. `app:build` 실행

## 공식 구조

가장 중요한 구조는 아래 shape입니다.

```text
my-app/
  src/
  public/
  package.json
  vite.config.ts
  frontron.config.ts
  frontron/
```

`frontron/`은 app-layer 전용 확장 공간입니다.

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

`frontron`이 소유하는 것:

- Electron runtime ownership
- preload/main wiring
- packaging/build ownership
- typed bridge runtime
- native loading

`create-frontron`이 소유하는 것:

- 공식 구조를 빠르게 생성하는 starter scaffolding
- `frontron` dependency wiring
- example `frontron.config.ts`

## 현재 상태

현재 저장소는 이 구조를 이미 구현했습니다.

- `frontron`은 이미 config discovery, CLI, framework-owned runtime/build staging을 소유합니다.
- `create-frontron`은 공식 구조를 생성하는 얇은 starter generator입니다.
- 공식 migration target은 항상 `frontron/client`입니다.
- public renderer API는 이제 `frontron/client`만 지원합니다.

## Legacy Renderer Migration

old `window.electron` renderer 코드는 더 이상 지원되지 않습니다.

남아 있는 old app은 아래 기준으로 옮겨야 합니다.

- renderer API는 `frontron/client`만 사용합니다.
- preload internals나 `window.electron`에 직접 의존하지 않습니다.
- old `src/electron/*` 구조를 복원하지 않습니다.
