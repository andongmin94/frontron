# 생성된 프로젝트 구조 이해하기

처음에는 모든 파일을 다 읽을 필요가 없습니다.

Frontron이 만든 프로젝트를 처음 볼 때는 "어떤 폴더가 무슨 역할을 하는지"만 이해해도 충분합니다.

## 1. 가장 먼저 볼 폴더

```text
src/
  components/
frontron.config.ts
frontron/
public/
package.json
```

## 2. `frontron.config.ts`

이 파일은 공식 config entrypoint입니다.

처음에는 이 파일이 `./frontron/config`를 다시 내보내는 얇은 entrypoint라는 것만 알아도 충분합니다.

## 3. `frontron/`

이 폴더는 app-layer 전용 공간입니다.

초보자는 아래 파일 이름부터 익히면 됩니다.

- `config.ts`: 앱 전체 설정
- `bridge/`: custom bridge namespace를 모아 두는 폴더
- `hooks/`: dev/build lifecycle hook를 두는 폴더
- `menu.ts`: 앱 메뉴 정의
- `tray.ts`: 시스템 트레이 정의
- `windows/`: route 기반 창 설정

## 4. `src/components/`

이 폴더는 화면에 보이는 React 컴포넌트가 들어 있는 곳입니다.

예를 들어:

- `TitleBar.tsx`: 창 상단 커스텀 타이틀바
- `App.tsx`: bridge 연결 상태를 보여 주는 기본 화면

starter는 의도적으로 작은 UI만 포함하므로, 처음에는 `TitleBar.tsx`와 `App.tsx`만 봐도 충분합니다.

## 5. `public/`

정적 파일이 들어 있는 폴더입니다.

초보자에게 가장 중요한 파일은 `icon.ico`입니다.

## 6. `package.json`

이 파일은 아래 두 관점에서 중요합니다.

- 어떤 명령으로 앱을 실행/빌드하는지
- 어떤 package와 script가 `frontron`을 연결하는지

즉, 처음 쓰는 사람에게는 "실행 명령과 의존성 연결을 보는 곳"이라고 이해하는 게 가장 쉽습니다.

## 6. 지금은 무엇을 몰라도 괜찮나요?

처음 단계에서는 아래를 몰라도 괜찮습니다.

- 모든 Electron 라이프사이클 이벤트
- UI 컴포넌트 내부 구현
- 빌드 도구의 세부 옵션

지금 필요한 것은 "어떤 문제를 만나면 어떤 폴더를 먼저 보면 되는지"를 아는 감각입니다.
