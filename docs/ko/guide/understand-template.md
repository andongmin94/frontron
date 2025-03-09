# 생성된 구조 이해하기

처음부터 모든 파일을 읽을 필요는 없습니다.

생성된 Frontron 스타터를 처음 열었을 때는 어떤 폴더가 어떤 책임을 가지는지만 이해해도 충분합니다.

## 1. 가장 먼저 볼 파일

```text
src/
  components/
frontron.config.ts
frontron/
public/
package.json
```

## 2. `frontron.config.ts`

이 파일은 공식 config 엔트리포인트입니다.

처음에는 `./frontron/config` 를 다시 내보내는 얇은 엔트리포인트일 수 있다는 것만 알아도 충분합니다.

## 3. `frontron/`

이 폴더는 스타터가 미리 준비해 둔 app-layer 전용 공간입니다.

먼저 아래 이름부터 익히면 됩니다.

- `config.ts`: 데스크톱 앱 전체 설정
- `bridge/`: custom bridge namespace
- `hooks/`: dev/build 라이프사이클 hook
- `menu.ts`: 앱 메뉴 정의
- `tray.ts`: 시스템 트레이 정의
- `windows/`: route 기반 창 정의
- `rust/`: 공식 Rust 슬롯

## 4. `src/components/`

이 폴더에는 화면에 보이는 React UI 가 들어 있습니다.

예를 들어:

- `TitleBar.tsx`: 커스텀 타이틀바
- `App.tsx`: bridge 와 runtime 상태를 보여 주는 스타터 화면

스타터는 의도적으로 UI 를 작게 유지하므로, 처음에는 `TitleBar.tsx` 와 `App.tsx` 만 읽어도 충분합니다.

## 5. `public/`

이 폴더에는 정적 파일이 들어 있습니다.

스타터에서 가장 중요한 파일은 보통 `icon.ico` 입니다.

## 6. `package.json`

이 파일이 중요한 이유는 두 가지입니다.

- 스타터 앱을 어떤 명령으로 실행하고 빌드하는지 보여 줍니다
- 어떤 스크립트가 프로젝트를 `frontron` 과 연결하는지 보여 줍니다

대부분의 사용자에게 중요한 스크립트는 아래입니다.

- `npm run app:dev`
- `npm run app:build`
- `npm run dev`

## 7. 아직 몰라도 되는 것

처음 단계에서는 아래를 몰라도 괜찮습니다.

- 모든 Electron 라이프사이클 이벤트
- 모든 내부 빌드 옵션
- UI 구현의 모든 세부사항

지금 중요한 감각은 어떤 폴더를 먼저 열어야 하는지를 아는 것입니다.
