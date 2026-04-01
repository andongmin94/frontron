# 프로젝트 만들기

이 페이지는 Frontron의 기본 시작 경로를 설명합니다.

대부분의 사용자는 수동 설치보다 여기서 시작하는 편이 맞습니다.

이미 호환되는 웹앱이 있고 데스크톱 support 만 붙이고 싶다면 [기존 프로젝트에 설치하기](/ko/guide/install-existing-project) 를 보세요.

## 1. 준비 사항

- Node.js `22+`
- npm, yarn, pnpm, bun 중 하나

## 2. 기본 생성 명령

```bash
npm create frontron@latest my-app
```

또는:

```bash
npx create-frontron@latest my-app
```

이 명령은 `my-app` 폴더를 만들고 공식 Frontron 스타터를 넣어 줍니다.

생성기는 아래를 대신 처리합니다.

- React + Vite 스타터 복사
- 프로젝트 이름으로 `package.json` 이름 설정
- 루트 `frontron.config.ts` 생성
- `frontron/` app-layer 구조 준비
- `app:dev`, `app:build` 스크립트 연결

## 3. 대화형 모드

아직 프로젝트 이름을 정하지 않았다면 아래처럼 실행할 수도 있습니다.

```bash
npm create frontron@latest
```

이 모드에서는 프로젝트 이름을 질문으로 받습니다.

## 4. 어떤 파일이 생기나요?

처음에는 아래 구조만 이해해도 충분합니다.

```text
my-app/
  public/
  src/
  frontron.config.ts
  frontron/
    config.ts
    bridge/
    windows/
  package.json
  vite.config.ts
```

- `public/`: 아이콘 같은 정적 파일
- `src/`: 나중에 직접 바꿔 갈 스타터 웹 프론트엔드 코드
- `frontron.config.ts`: 공식 config 엔트리포인트
- `frontron/`: 데스크톱 쪽 app-layer 공간
- `package.json`: `app:dev`, `app:build` 같은 실행 스크립트

## 5. 가장 쉬운 첫 흐름

1. 스타터 프로젝트 생성
2. `npm install`
3. `npm run app:dev`
4. 눈에 보이는 것 하나 바꾸기
5. `npm run app:build`

::: tip
이 경로가 Frontron을 가장 빨리 끝까지 체험하는 방법입니다.
:::
