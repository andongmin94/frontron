# 기능

이 페이지는 현재 Frontron starter와 framework package가 기본으로 무엇을 제공하는지 한눈에 다시 확인할 때 읽는 레퍼런스입니다.

처음 읽는 문서로는 빠른 시작과 단계별 튜토리얼을 먼저 권장합니다. 이 페이지는 "지금 내 프로젝트에 어떤 기본 기능이 들어 있지?"를 다시 정리하고 싶을 때 더 잘 맞습니다.

## 먼저 보면 좋은 문서

::: tip
처음 쓰는 사람이라면 아래 순서가 더 쉽습니다.

1. 빠른 시작
2. 프로젝트 만들기 / 개발 모드로 실행하기
3. 앱 이름과 아이콘 바꾸기
4. 이 페이지로 돌아와 기본 기능 훑어보기
:::

## 1. 프로젝트 생성 CLI

Frontron은 `create-frontron` CLI를 통해 프로젝트를 만듭니다.

- 새 프로젝트 폴더 생성
- 공식 starter 구조 복사
- `frontron.config.ts`와 `frontron/` 시드
- `app:dev`, `app:build` 스크립트 준비

즉, 초보자는 Electron `main.ts`, preload, builder 설정을 처음부터 손으로 조립하지 않아도 됩니다.

## 2. 기본 템플릿 구조

기본 템플릿은 React 기반입니다.

```text
src/
  components/
frontron.config.ts
frontron/
public/
package.json
```

이 구조 덕분에 "웹 코드"와 "app-layer 설정"을 비교적 쉽게 나눠서 볼 수 있습니다.

## 3. Framework-owned 기본 기능

`frontron`이 아래 기능을 기본으로 소유합니다.

- 메인 창 생성
- preload 브리지 노출
- 창 상태 조회와 창 제어
- 커스텀 TitleBar
- 개발 실행과 빌드 staging
- 기본 패키징 흐름

처음에는 전부를 깊게 이해할 필요는 없습니다. 어떤 기능이 이미 준비되어 있는지만 알아도 개발 속도가 훨씬 빨라집니다.

## 4. 개발 실행 흐름

`npm run app:dev`는 개발할 때 가장 자주 쓰는 명령입니다.

이 명령은:

- configured web dev command
- framework-owned Electron 데스크톱 앱

을 함께 실행합니다.

이 과정에서 `.frontron/types/frontron-client.d.ts`도 생성되어 custom bridge 자동완성과 메서드 시그니처 추론에 사용됩니다.

## 5. UI와 스타일 스택

기본 템플릿에는 아래 구성이 포함됩니다.

- Tailwind CSS 4.x
- 작은 starter UI 예제
- 커스텀 TitleBar 예제

즉, 초보자도 "아무것도 없는 화면"에서 시작하지 않으면서도 과한 UI 번들을 함께 받지 않습니다.

## 6. 빌드와 패키징

`npm run app:build`를 실행하면 아래 흐름이 이어집니다.

1. 렌더러 빌드
2. `.frontron/` 아래 runtime/build staging
3. 패키징 결과물 생성

Windows 기본 설정에서는 `output/` 폴더 아래에 설치 파일과 휴대용 실행 파일이 생성될 수 있습니다.

## 7. Rust native slot

공식 Rust 확장 위치는 `frontron/rust/`입니다.

- `rust.enabled: true`면 Frontron이 Rust 산출물을 찾고 로드합니다.
- `bridge.system.getNativeStatus()`로 로드 상태를 확인할 수 있습니다.
- `bridge.system.isNativeReady()`로 기본 준비 심볼 상태를 확인할 수 있습니다.
- `bridge.native.add(left, right)`는 starter scaffold의 첫 Rust-backed bridge 예제입니다.
- `rust.bridge.math.add`는 첫 config-driven Rust bridge 예제이며, 렌더러에서는 `bridge.math.add(left, right)`로 호출합니다.
- config-driven Rust bridge는 런타임에서 인자 개수와 `int` / `double` / `bool` / `string` 타입도 검증합니다.

## 8. 이 페이지를 어떻게 활용하면 좋을까요?

이 페이지는 처음부터 끝까지 따라 읽는 문서라기보다:

- "기본 기능이 뭐였지?"
- "템플릿에 어떤 구성요소가 이미 있었지?"
- "빌드 흐름이 어떻게 이어졌지?"

같은 질문이 생겼을 때 다시 펼쳐 보는 용도에 더 가깝습니다.
