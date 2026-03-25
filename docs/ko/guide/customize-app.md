# 앱 이름과 아이콘 바꾸기

가장 좋은 첫 커스터마이징은 눈에 바로 보이는 것을 바꾸는 일입니다.

이 페이지는 아이콘과 앱 이름을 어떻게 바꾸는지, 그리고 그 값들이 framework-first 구조에서 어디에 있는지를 설명합니다.

## 1. 아이콘 바꾸기

기본 아이콘 파일은 아래와 같습니다.

```text
public/
  icon.ico
```

아이콘은 루트 `frontron.config.ts` 에서 이렇게 연결됩니다.

```ts
app: {
  icon: './public/icon.ico',
}
```

`app.icon` 을 생략하면 Frontron 기본 아이콘이 대신 사용됩니다.

이 파일을 내 아이콘으로 바꾸면 다음 빌드에서 패키징 결과에 반영됩니다.

## 2. 앱 이름과 앱 ID 바꾸기

주요 앱 메타데이터는 루트 `frontron.config.ts` 에 있습니다.

대부분의 사용자가 먼저 바꾸는 값은 아래 두 가지입니다.

- `app.name`
- `app.id`

쉽게 생각하면:

- `app.name`: 패키징과 앱 메타데이터에 보이는 제품 이름
- `app.id`: 데스크톱 앱 식별자

## 3. 화면에 보이는 텍스트 바꾸기

스타터 UI 에 직접 보이는 텍스트를 바꾸고 싶다면 아래 파일을 보세요.

- `src/components/TitleBar.tsx`
- `src/App.tsx`

창 정의 자체는 `frontron/windows/index.ts` 에 있습니다.

## 4. 추천하는 첫 변경 순서

1. `public/icon.ico` 교체
2. 루트 `frontron.config.ts` 의 `app.name` 변경
3. 루트 `frontron.config.ts` 의 `app.id` 변경
4. `src/components/TitleBar.tsx` 의 화면 텍스트 변경

이 순서가 가장 단순하고 결과도 바로 확인하기 쉽습니다.

## 5. 바꾸면 무엇이 달라지나요?

- 개발 모드에서는 화면 텍스트 변화가 바로 보입니다
- 빌드 후에는 `output/` 안의 아이콘과 앱 메타데이터가 바뀝니다

::: tip
처음부터 모든 브랜딩 요소를 한 번에 바꾸지 말고, 아이콘과 눈에 보이는 이름부터 바꾸는 것이 좋습니다.
:::
