# 빠른 시작

이 페이지는 지금 Frontron을 어떤 순서로 쓰는 것이 맞는지 가장 빠르게 보여 줍니다.

기본 경로는 스타터입니다.

1. `create-frontron` 으로 프로젝트 생성
2. 이미 연결된 `frontron` CLI support 로 실행
3. 스타터를 커스터마이징하고 배포

데스크톱 브리지가 아직 추상적으로 느껴진다면 API 가이드보다 먼저 [브리지 흐름 이해하기](/ko/guide/understand-bridge-flow)를 읽는 편이 좋습니다.

## 1. 준비물

- Node.js `22+`
- npm, yarn, pnpm, bun 중 하나

::: tip
예시는 `npm` 기준이지만 같은 흐름을 다른 패키지 매니저에도 그대로 적용할 수 있습니다.
:::

## 2. 가장 짧은 공식 시작 경로

```bash
npm create frontron@latest my-app
cd my-app
npm install
npm run app:dev
```

나중에는:

```bash
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

이 구조가 공식 스타터 결과물입니다. 호환되는 수동 설치도 같은 구조를 쓸 수 있습니다.

## 4. 다음에 읽을 가이드

### 새 스타터 프로젝트로 시작하고 싶다면

1. [프로젝트 만들기](/ko/guide/create-project)
2. [개발 모드로 실행하기](/ko/guide/run-development)
3. [앱 이름과 아이콘 바꾸기](/ko/guide/customize-app)
4. [생성된 구조 이해하기](/ko/guide/understand-template)

### 이미 호환되는 웹앱이 있다면

1. [기존 프로젝트에 설치하기](/ko/guide/install-existing-project)
2. [개발 모드로 실행하기](/ko/guide/run-development)
3. [데스크톱 브리지 사용하기](/ko/guide/use-bridge)
4. [빌드와 패키징](/ko/guide/build-and-package)

### 먼저 개념부터 잡고 싶다면

1. [브리지 흐름 이해하기](/ko/guide/understand-bridge-flow)
2. [데스크톱 브리지 사용하기](/ko/guide/use-bridge)

## 5. 패키지 역할

- `create-frontron` 은 공식 스타터 생성기이며 메인 온보딩 경로입니다.
- `frontron` 은 `defineConfig`, config discovery, `frontron dev`, `frontron build`, `frontron check`, `frontron/client` 를 제공합니다.
- 스타터는 복붙된 Electron runtime 파일 대신 `frontron` 에 의존해 데스크톱 runtime/build support 를 받습니다.
- 공식 Rust 슬롯은 여전히 `frontron/rust` 입니다.

## 6. 자주 보는 문서

- [공식 계약](/ko/guide/framework-first)
- [프로젝트 만들기](/ko/guide/create-project)
- [개발 모드로 실행하기](/ko/guide/run-development)
- [브리지 흐름 이해하기](/ko/guide/understand-bridge-flow)
- [지원 범위 표](/ko/guide/support-matrix)
- [문제 해결](/ko/guide/troubleshooting)

::: tip
지금 계약은 스타터 경로부터 시작하지만, config 엔트리포인트는 여전히 `frontron.config.ts` 입니다.
:::
