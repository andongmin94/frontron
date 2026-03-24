# 빠른 시작

이 페이지는 가장 짧게 시작하는 방법과 다음에 읽을 가이드를 빠르게 보여줍니다.

Frontron 은 기존 웹 프로젝트에 설치하는 경로와 새 스타터를 생성하는 경로를 모두 지원합니다.

데스크톱 브리지가 아직 추상적으로 느껴진다면 API 가이드보다 먼저 [브리지 흐름 이해하기](/ko/guide/understand-bridge-flow) 를 읽으세요.

## 1. 준비물

시작에 필요한 것은 두 가지뿐입니다.

- Node.js `22+`
- npm, yarn, pnpm, bun 중 하나

::: tip
예시는 `npm` 기준이지만 같은 흐름을 다른 패키지 매니저에도 적용할 수 있습니다.
:::

## 2. 가장 짧은 유효한 설정

기존 프로젝트에서는 아래 흐름이 가장 짧은 공식 경로입니다.

```bash
npx frontron init
```

`frontron init` 은 `frontron` 이 없으면 자동으로 설치하고, 기본 파일과 스크립트도 함께 추가합니다.

의존성 설치를 직접 관리하고 싶다면 `npx frontron init --skip-install` 을 사용하세요.

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

이 구조는 수동 설치와 스타터 생성 결과 모두의 공식 형태입니다.

## 4. 다음에 읽을 가이드

### 개념부터 잡고 싶다면

1. [브리지 흐름 이해하기](/ko/guide/understand-bridge-flow)
2. [데스크톱 브리지 사용하기](/ko/guide/use-bridge)

### 이미 웹앱이 있다면

1. [기존 프로젝트에 설치하기](/ko/guide/install-existing-project)
2. [브리지 흐름 이해하기](/ko/guide/understand-bridge-flow)
3. [개발 모드로 실행하기](/ko/guide/run-development)
4. [데스크톱 브리지 사용하기](/ko/guide/use-bridge)
5. [빌드와 패키징](/ko/guide/build-and-package)

### 새 프로젝트를 만들고 싶다면

1. [프로젝트 만들기](/ko/guide/create-project)
2. [개발 모드로 실행하기](/ko/guide/run-development)
3. [앱 이름과 아이콘 바꾸기](/ko/guide/customize-app)
4. [생성된 구조 이해하기](/ko/guide/understand-template)

## 5. Frontron 이 소유하는 것

- `frontron` 은 `defineConfig`, config discovery, `frontron dev`, `frontron build`, `frontron/client` 를 제공합니다.
- `create-frontron` 은 `frontron.config.ts`, `frontron/`, `app:dev`, `app:build` 를 생성합니다.
- `bridge`, `menu`, `tray`, `hooks`, runtime/build 흐름은 `frontron` 이 소유합니다.
- 공식 Rust 슬롯은 `frontron/rust` 로 고정됩니다.
- `app:dev` 와 `app:build` 는 이미 저장소 안에서 스모크 테스트로 검증됩니다.

## 6. 자주 보는 매뉴얼

- [공식 계약](/ko/guide/framework-first)
- [기존 프로젝트에 설치하기](/ko/guide/install-existing-project)
- [브리지 흐름 이해하기](/ko/guide/understand-bridge-flow)
- [데스크톱 브리지 사용하기](/ko/guide/use-bridge)
- [문제 해결](/ko/guide/troubleshooting)

::: tip
공식 계약의 중심은 항상 `frontron.config.ts` 입니다.
:::
