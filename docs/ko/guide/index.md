# 빠른 시작

이 페이지는 어디서 시작해야 하는지와 다음에 어떤 가이드를 읽어야 하는지를 가장 빠르게 보여 줍니다.

Frontron은 기존 웹 프로젝트를 위한 framework-first 데스크톱 앱 레이어입니다.

Frontron은 두 가지 일반적인 시작 경로를 지원합니다. 기존 웹 프로젝트에 설치하는 방식과 새 스타터를 생성하는 방식입니다.

데스크톱 브리지가 아직 추상적으로 느껴진다면 API 가이드보다 먼저 [브리지 흐름 이해하기](/ko/guide/understand-bridge-flow)를 읽는 편이 좋습니다.

## 1. 준비물

시작할 때 필요한 것은 두 가지뿐입니다.

- Node.js `22.15+`
- npm, yarn, pnpm, bun 중 하나

::: tip
예시는 `npm` 기준이지만 같은 흐름을 다른 패키지 매니저에도 그대로 적용할 수 있습니다.
:::

## 2. 가장 짧은 공식 설치 경로

기존 프로젝트에서는 아래가 가장 짧은 공식 경로입니다.

```bash
npx frontron init
```

`frontron init` 은 `frontron` 이 없으면 자동으로 설치한 뒤, 기본 파일과 스크립트를 추가합니다.

의존성을 직접 관리하고 싶다면 `npx frontron init --skip-install` 을 쓰면 됩니다.

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

이 구조가 수동 설치와 스타터 생성 결과 모두의 공식 형태입니다.

## 4. 다음에 읽을 가이드

### 먼저 개념부터 잡고 싶다면

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

## 5. Frontron이 소유하는 것

- `frontron` 은 `defineConfig`, config discovery, `frontron dev`, `frontron build`, `frontron/client` 를 제공합니다.
- `create-frontron` 은 `frontron.config.ts`, `frontron/`, `app:dev`, `app:build` 를 생성합니다.
- `bridge`, `menu`, `tray`, `hooks`, 런타임/빌드 흐름은 `frontron` 이 소유합니다.
- 공식 Rust 슬롯은 `frontron/rust` 로 고정됩니다.
- `app:dev`, `app:build` 는 저장소 안에서 스모크 테스트로 검증됩니다.

## 6. 자주 보는 문서

- [공식 계약](/ko/guide/framework-first)
- [기존 프로젝트에 설치하기](/ko/guide/install-existing-project)
- [브리지 흐름 이해하기](/ko/guide/understand-bridge-flow)
- [데스크톱 브리지 사용하기](/ko/guide/use-bridge)
- [지원 범위 표](/ko/guide/support-matrix)
- [스택별 레시피](/ko/guide/recipes)
- [문제 해결](/ko/guide/troubleshooting)

::: tip
공식 계약의 중심은 항상 `frontron.config.ts` 입니다.
:::
