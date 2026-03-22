# 프로젝트 만들기

이 페이지는 Frontron으로 첫 프로젝트를 만드는 과정을 설명합니다.

처음에는 모든 파일을 다 이해할 필요가 없습니다. 어떤 명령이 프로젝트를 만들고, 어떤 공식 구조가 생기는지만 알면 충분합니다.

이미 웹 앱이 있다면 이 페이지 대신 [기존 프로젝트에 설치하기](/ko/guide/install-existing-project) 부터 보세요.

## 1. 준비 사항

시작하기 전에 아래를 확인해 주세요.

- Node.js `22+`
- npm, yarn, pnpm, bun 중 하나

## 2. 가장 단순한 생성 명령

```bash
npx create-frontron@latest my-app
```

이 명령은 `my-app` 폴더를 만들고 공식 Frontron 스타터를 넣어 줍니다.

CLI 는 아래 작업을 대신 해 줍니다.

- React + Vite 스타터 복사
- 프로젝트 이름으로 `package.json` 이름 설정
- 루트 `frontron.config.ts` 생성
- `frontron/` app-layer 구조 준비
- `app:dev`, `app:build` 스크립트 연결

## 3. 대화형 모드

아직 프로젝트 이름을 못 정했다면 아래처럼 실행할 수도 있습니다.

```bash
npm create frontron@latest
```

이 모드에서는 질문에 답하면서 이름을 정할 수 있습니다.

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
- `src/`: 기존 웹 프론트엔드 코드
- `frontron.config.ts`: 공식 config 엔트리포인트
- `frontron/`: app-layer 확장 공간
- `package.json`: `app:dev`, `app:build` 같은 실행 스크립트

## 5. 가장 쉬운 첫 흐름

처음에는 아래 순서로 움직이는 것이 가장 쉽습니다.

1. 프로젝트 생성
2. `npm install`
3. `npm run app:dev`
4. 눈에 보이는 것 하나 바꾸기
5. `npm run app:build`

::: tip
다음 페이지에서는 의존성을 설치하고 데스크톱 창을 실제로 띄워 봅니다.
:::
