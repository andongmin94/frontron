# 빠른 시작

이 페이지는 Frontron을 어떻게 시작하고 다음에 어떤 문서를 읽어야 하는지 가장 빠르게 설명합니다.

Frontron은 크게 두 가지 경로를 지원합니다. 기존 웹 프로젝트에 설치하거나, 새 스타터를 생성하는 방식입니다.

데스크톱 브리지가 추상적으로 느껴진다면 API 문서보다 먼저 [브리지 흐름 이해하기](/ko/guide/understand-bridge-flow) 를 보세요.

## 1. 준비 사항

시작하려면 아래 두 가지만 있으면 됩니다.

- Node.js `22+`
- npm, yarn, pnpm, bun 중 하나

::: tip
이 가이드에서는 `npm` 기준으로 예시를 적지만, 다른 패키지 매니저를 써도 흐름은 같습니다.
:::

## 2. 가장 짧은 공식 설정

가장 작은 공식 흐름은 아래와 같습니다.

```bash
npm install frontron
npx frontron init
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

이 구조는 수동 설치 사용자와 스타터 사용자가 함께 쓰는 공식 구조입니다.

## 4. 다음에 읽을 문서 고르기

### 먼저 전체 흐름을 이해하고 싶다면

1. [브리지 흐름 이해하기](/ko/guide/understand-bridge-flow)
2. [데스크톱 브리지 사용하기](/ko/guide/use-bridge)

### 이미 웹 앱이 있다면

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
- `bridge`, `menu`, `tray`, `hooks`, runtime/build 흐름은 모두 `frontron` 이 소유합니다.
- 공식 Rust 슬롯은 `frontron/rust` 로 고정되어 있습니다.
- `app:dev` 와 `app:build` 는 이미 스모크 테스트로 검증되고 있습니다.

## 6. 자주 보는 매뉴얼

- [공식 구조와 계약](/ko/guide/framework-first)
- [기존 프로젝트에 설치하기](/ko/guide/install-existing-project)
- [브리지 흐름 이해하기](/ko/guide/understand-bridge-flow)
- [데스크톱 브리지 사용하기](/ko/guide/use-bridge)
- [문제 해결](/ko/guide/troubleshooting)

::: tip
공식 계약의 중심은 항상 `frontron.config.ts` 입니다.
:::
