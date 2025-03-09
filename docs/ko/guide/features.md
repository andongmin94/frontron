# 기능

이 페이지는 현재 Frontron 스타터와 support package가 기본으로 무엇을 제공하는지 정리한 레퍼런스입니다.

처음 보는 문서라면 먼저 빠른 시작 문서를 읽는 것이 좋습니다. 이 페이지는 “지금 기본으로 무엇이 들어 있지?”를 다시 확인할 때 더 잘 맞습니다.

## 먼저 보면 좋은 문서

::: tip
처음 쓰는 사람이라면 아래 순서가 더 쉽습니다.

1. 빠른 시작
2. 프로젝트 만들기 / 개발 모드로 실행하기
3. 앱 이름과 아이콘 바꾸기
4. 다시 이 페이지로 돌아와 기능 한눈에 보기
:::

## 1. 스타터 생성

Frontron 은 `create-frontron` 으로 새 프로젝트를 시작합니다.

이 도구는:

- 새 프로젝트 폴더 생성
- 공식 스타터 구조 복사
- `frontron.config.ts` 와 `frontron/` 시드
- `app:dev`, `app:build` 스크립트 연결

즉, 첫날부터 Electron `main`, preload, packaging 파일을 직접 쓸 필요가 없습니다.

## 2. 공식 스타터 구조

기본 스타터는 React 기반이며 starter/template 경로를 중심에 둡니다.

```text
src/
  components/
frontron.config.ts
frontron/
public/
package.json
```

이 구조 덕분에 웹 앱과 데스크톱 설정을 쉽게 분리해서 볼 수 있습니다.

## 3. `frontron` 이 제공하는 데스크톱 support

`frontron` 은 스타터 뒤의 데스크톱 support layer 를 제공합니다.

- CLI 명령
- primary window 생성
- config 에 정의한 secondary window 관리
- preload bridge 노출
- 창 상태 조회와 창 제어
- 개발 모드 실행과 빌드용 staged 파일 준비
- 패키징 흐름

## 4. 개발 흐름

`npm run app:dev` 가 메인 개발 명령입니다.

이 명령은:

- 설정된 웹 개발 명령
- Frontron support 를 통한 Electron 데스크톱 앱

을 함께 실행합니다.

또한 bridge 자동완성을 위한 `.frontron/types/frontron-client.d.ts` 도 생성합니다.

## 5. UI 와 스타일

기본 스타터에는 아래 구성이 포함됩니다.

- Tailwind CSS 4
- 작은 스타터 UI
- 커스텀 타이틀바 예제

예전 무거운 컴포넌트 덤프보다 더 작게 유지하는 쪽을 기본값으로 둡니다.

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

## 8. 이 페이지를 어떻게 쓰면 좋을까요?

아래가 궁금할 때 다시 펼쳐 보면 좋습니다.

- 기본으로 어떤 기능이 들어 있는지
- 스타터가 무엇을 포함하는지
- 스타터 뒤에서 `frontron` 이 무엇을 소유하는지
