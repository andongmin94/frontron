# 프로젝트 만들기

이 페이지는 Frontron으로 첫 프로젝트를 만드는 과정을 천천히 설명합니다.

처음에는 모든 파일을 이해할 필요가 없습니다. 지금 단계의 목표는 "새 프로젝트가 어떤 명령으로 만들어지고, 어디에 어떤 공식 구조가 생기는지"를 익히는 것입니다.

## 1. 준비할 것

시작하기 전에 아래 항목이 준비되어 있는지 확인해 주세요.

- Node.js `22+`
- npm / yarn / pnpm / bun 중 하나

## 2. 가장 간단한 생성 명령

```bash
npx create-frontron@latest my-app
```

이 명령은 `my-app`이라는 새 폴더를 만들고, 그 안에 Frontron 기본 템플릿을 넣어 줍니다.

CLI가 대신 해 주는 일은 대략 아래와 같습니다.

- 기본 React + Vite 웹 템플릿 복사
- 프로젝트 이름을 기준으로 `package.json` 이름 설정
- root `frontron.config.ts` 생성
- `frontron/` app-layer 기본 구조 준비
- `app:dev`, `app:build` 스크립트 연결

## 3. 이름을 아직 못 정했다면

아래처럼 대화형으로 실행할 수도 있습니다.

```bash
npm create frontron@latest
```

이 방식은 질문에 답하면서 프로젝트 이름을 정하고 싶은 사람에게 더 편합니다.

## 4. 프로젝트 폴더 안에는 무엇이 생기나요?

처음에는 아래 정도만 알아도 충분합니다.

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
- `frontron.config.ts`: 공식 config entrypoint
- `frontron/`: app-layer 확장 공간
- `package.json`: `app:dev`, `app:build` 같은 실행 명령

## 5. 여기서 가장 중요한 감각

처음 만든 프로젝트는 "비어 있는 폴더"가 아니라, 이미 실행과 빌드를 염두에 둔 기본 앱입니다.

그래서 초보자 입장에서는 처음부터 구조를 전부 외우기보다:

1. 생성하기
2. `npm install` 하기
3. `npm run app:dev`로 실행해 보기
4. 눈에 보이는 것 바꿔 보기
5. `npm run app:build`로 빌드해 보기

이 순서로 가는 편이 훨씬 쉽습니다.

::: tip
다음 단계에서는 의존성을 설치하고 실제로 앱 창을 띄워 보겠습니다.
:::
