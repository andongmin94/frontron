# 기능

이 페이지는 현재 Frontron 제품 표면과 스타터가 기본으로 제공하는 기능을 정리한 레퍼런스입니다.

처음 보는 문서라면 먼저 빠른 시작 문서를 읽는 것이 좋습니다. 이 페이지는 “지금 기본으로 무엇이 들어 있지?”를 다시 확인할 때 더 잘 맞습니다.

## 먼저 보면 좋은 문서

::: tip
처음 쓰는 사람이라면 아래 순서가 더 쉽습니다.

1. 빠른 시작
2. 프로젝트 만들기 / 개발 모드로 실행하기
3. 앱 이름과 아이콘 바꾸기
4. 다시 이 페이지로 돌아와 기능 한눈에 보기
:::

## 1. 프로젝트 시작 CLI

Frontron은 `create-frontron` 으로 새 프로젝트를 시작할 수 있습니다.

이 도구는:

- 새 프로젝트 폴더 생성
- 공식 스타터 구조 복사
- `frontron.config.ts` 와 `frontron/` 시드
- `app:dev`, `app:build` 스크립트 연결

즉, Electron `main`, preload, packaging 파일을 직접 작성할 필요가 없습니다.

## 2. 공식 스타터 구조

스타터는 React 기반이며 framework-first 계약을 따릅니다.

```text
src/
  components/
frontron.config.ts
frontron/
public/
package.json
```

이 구조 덕분에 웹 앱과 app-layer 설정을 쉽게 분리해서 볼 수 있습니다.

## 3. 프레임워크가 소유하는 데스크톱 기능

`frontron` 은 아래 핵심 기능을 소유합니다.

- primary window 생성
- config 에 정의한 named secondary window 관리
- preload bridge 노출
- 창 상태 조회와 창 제어
- `isVisible`, `isFocused`, `toggleVisibility` 같은 tray-friendly hidden-window helper
- 커스텀 타이틀바 연결
- 개발 모드 실행과 빌드용 staged 파일 준비
- 패키징 흐름

## 4. 개발 흐름

`npm run app:dev` 가 메인 개발 명령입니다.

이 명령은:

- 설정된 웹 개발 명령
- 프레임워크가 소유하는 Electron 데스크톱 앱

을 함께 실행합니다.

또한 bridge 자동완성을 위한 `.frontron/types/frontron-client.d.ts` 도 생성합니다.

## 5. UI 와 스타일

기본 스타터에는 아래 구성이 포함됩니다.

- Tailwind CSS 4
- 작은 스타터 UI
- 커스텀 타이틀바 예제

의도적으로 작은 스타터이므로 처음부터 큰 미사용 UI 번들을 함께 받지 않습니다.

## 6. 빌드와 패키징

`npm run app:build` 는 아래 흐름으로 이어집니다.

1. 렌더러 빌드
2. `.frontron/` runtime/build staging
3. 패키징된 데스크톱 결과물 생성

Windows 에서는 기본적으로 결과물이 `output/` 아래에 생성됩니다.

## 7. Rust 슬롯

공식 Rust 확장 위치는 `frontron/rust/` 입니다.

- `rust.enabled` 가 `true` 면 Frontron 이 Rust 산출물을 빌드하고 로드합니다.
- `bridge.native.getStatus()` 로 native runtime 상태를 볼 수 있습니다.
- `bridge.native.isReady()` 로 기본 readiness 심볼 상태를 확인할 수 있습니다.
- 스타터는 `bridge.system.cpuCount()` 를 config-driven Rust 예제로 함께 넣어 줍니다.
- `rust.bridge.math.add` 는 렌더러에서 `bridge.math.add(...)` 로 연결됩니다.
- config-driven Rust bridge 는 인자 개수와 기본 타입도 런타임에서 검증합니다.

## 8. 이 페이지를 어떻게 쓰면 좋을까요?

이 페이지는 튜토리얼이 아니라 레퍼런스입니다.

아래가 궁금할 때 다시 펼쳐 보면 좋습니다.

- 기본으로 어떤 기능이 들어 있는지
- 스타터가 무엇을 포함하는지
- runtime 과 packaging 흐름이 어떻게 나뉘는지
