# CLI 와 스타터 계약

이 페이지는 0.8.4 / 0.8.5 시기의 제품 감성을 다시 기준으로 잡은 현재 Frontron 계약을 설명합니다.

## 목표

지금 Frontron 의 중심 분리는 아래와 같습니다.

- `create-frontron` 은 메인 starter/template 진입점
- `frontron` 은 그 스타터 뒤에서 동작하는 support CLI/runtime package

## 공식 시작 흐름

기본 지원 흐름은 아래입니다.

1. `npm create frontron@latest` 실행
2. 의존성 설치
3. `npm run app:dev` 실행
4. 나중에 `npm run app:build` 실행

## 공식 구조

생성된 스타터는 여전히 같은 공식 구조를 사용합니다.

```text
my-app/
  src/
  public/
  package.json
  vite.config.ts
  frontron.config.ts
  frontron/
```

`frontron/` 은 계속 app-layer 전용 공간입니다.

## 책임 분리

`create-frontron` 이 소유하는 것:

- starter 생성
- starter 기본값과 템플릿 파일
- 첫 실행 개발자 경험

`frontron` 이 소유하는 것:

- config discovery
- CLI 명령
- runtime/build support
- bridge/runtime helper
- `frontron/client`
- Rust 슬롯 지원

## 현재 상태

저장소는 이미 이 분리를 구현하고 있습니다.

- starter 사용자는 `create-frontron` 으로 시작합니다
- 생성된 프로젝트는 `frontron` 에 의존합니다
- `frontron` 은 `frontron dev`, `frontron build`, `frontron check`, `defineConfig` 를 계속 제공합니다
- 호환되는 수동 설치도 같은 config 구조를 쓸 수 있습니다

## 수동 경로

수동 설치도 여전히 가능하지만, 이제는 보조 경로입니다.

1. `frontron` 설치
2. `frontron.config.ts` 추가
3. `app:dev`, `app:build` 스크립트 추가
4. CLI 로 실행

## 렌더러 계약

렌더러 코드는 계속 `frontron/client` 만 사용해야 합니다.

제품 방향은 바뀌었지만, 렌더러-facing API 는 바뀌지 않았습니다.
