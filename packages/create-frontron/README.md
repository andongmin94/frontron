<div align="center">

<a href="https://frontron.andongmin.com">
<img src="/docs/public/logo.svg" alt="logo" height="200" />
</a>

</div>

# create-frontron <a href="https://npmjs.com/package/create-frontron"><img src="https://img.shields.io/npm/v/create-frontron" alt="npm package"></a>

`frontron`이 연결된 framework-first starter를 생성하는 CLI입니다.

## 목표 역할

`create-frontron`은 최종적으로 얇은 starter generator만 담당합니다.

- `frontron` dependency 추가
- root `frontron.config.ts` 생성
- 선택적 `frontron/` app-layer 폴더 시드
- 공식 `frontron/rust` 슬롯 scaffold
- 최신 호환 web starter 제공

아래 항목은 이 패키지가 장기적으로 소유하지 않아야 합니다.

- Electron runtime logic
- packaging/build ownership
- copied main/preload/builder core
- template-only special structure

## 현재 상태

현재 템플릿은 framework-first starter output을 생성합니다.

- root `frontron.config.ts`와 `frontron/` app-layer 구조를 생성합니다.
- `app:dev`와 `app:build`는 `frontron` CLI를 사용합니다.
- starter는 `frontron/bridge`에 config-driven custom namespace 예제도 함께 생성합니다.
- starter는 `frontron/menu`, `frontron/tray`, `frontron/hooks` 예제도 함께 생성합니다.
- starter는 공식 `frontron/rust` 슬롯 scaffold도 함께 생성하고, 기본값은 `enabled: false`로 둡니다.
- starter는 `rust.bridge.math.add`, `rust.bridge.math.average`, `rust.bridge.health.isReady`, `rust.bridge.file.hasTxtExtension`, `rust.bridge.system.cpuCount` 예제도 함께 시드해서 더 넓은 config-driven Rust bridge 흐름을 보여 줍니다.
- starter의 TypeScript 설정은 `.frontron/types/frontron-client.d.ts` 생성 파일도 함께 읽도록 준비되어 있습니다.
- starter는 과한 pre-bundled UI kit 없이 작은 기본 UI만 포함합니다.
- starter 안의 copied runtime/build files는 제거되었습니다.

## 요구사항

- Node.js `22+`

## 사용법

프로젝트 생성:

```bash
npm create frontron@latest
npx create-frontron@latest my-app
```

기본 템플릿은 React이며, 별도 선택 없이 바로 생성됩니다.

옵션:

- `--overwrite <yes|no|ignore>`

## 생성 후 기본 명령어

```bash
cd my-app
npm install
npm run app:dev
```

- `npm run dev`: 웹 미리보기 전용
- `npm run app:dev`: 데스크톱 브리지까지 포함한 공식 개발 모드

## 목표 output shape

starter output은 manual install 사용자와 같은 공식 구조로 수렴해야 합니다.

```text
my-app/
  src/
  public/
  package.json
  vite.config.ts
  frontron.config.ts
  frontron/
```

starter output 자체가 이제 위 공식 구조를 따릅니다.
starter output은 built-in `bridge.native.*` 상태 API와 config-driven `bridge.math.*`, `bridge.health.isReady()`, `bridge.file.hasTxtExtension()`, `bridge.system.cpuCount()` 예제도 함께 제공합니다.

## 라이선스

MIT (`LICENSE` 참고)

문서: https://frontron.andongmin.com
