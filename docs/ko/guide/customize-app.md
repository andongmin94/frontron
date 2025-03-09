# 앱 이름과 아이콘 바꾸기

가장 좋은 첫 커스터마이징은 눈에 바로 보이는 것을 바꾸는 일입니다.

이 페이지는 아이콘과 앱 이름을 어떻게 바꾸는지, 그리고 그 값들이 현재 starter 중심 구조에서 어디에 있는지를 설명합니다.

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

## 2. 앱 이름과 앱 ID 바꾸기

주요 앱 메타데이터는 루트 `frontron.config.ts` 에 있습니다.

먼저 바꾸는 값은 보통 아래 두 가지입니다.

- `app.name`
- `app.id`

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
