<div align="center">

<a href="https://frontron.andongmin.com">
<img src="https://frontron.andongmin.com/logo.svg" alt="logo" height="200" />
</a>

</div>

# Frontron <a href="https://npmjs.com/package/create-frontron"><img src="https://img.shields.io/npm/v/create-frontron" alt="npm package"></a>

Electron 기반 데스크톱 앱을 빠르게 시작할 수 있도록 도와주는 CLI 스캐폴딩 도구입니다.

## 개요

`create-frontron`은 하나의 명령어만으로 바로 실행 가능한 Electron 앱 프로젝트를 생성해 줍니다. 복잡한 초기 설정 없이 개발에만 집중할 수 있습니다.

- React와 Next.js 두 가지 템플릿을 제공합니다.
- TypeScript 기반의 Electron main/preload 아키텍처가 기본으로 구성됩니다.
- Tailwind CSS, Shadcn UI 스타일 패턴과 다양한 UI 컴포넌트가 함께 포함됩니다.
- Splash 화면, 시스템 트레이, IPC 통신, 커스텀 TitleBar가 기본 탑재되어 있습니다.

## 템플릿 비교

두 가지 템플릿 중 프로젝트 성격에 맞는 것을 선택하시면 됩니다.

| 템플릿 | 식별자 | 렌더러 | Electron 출력 경로 | 패키징 출력 경로 |
| ---- | ---- | ---- | ---- | ---- |
| React | `react` | Vite + React | `dist/electron` | `output/` |
| Next.js | `next` | Next.js App Router | `.electron` | `.build/` |

## 요구사항

- Node.js `22+` 버전이 필요합니다.

## 빠른 시작

아래 명령어를 실행하면 대화형 프롬프트를 통해 프로젝트를 생성할 수 있습니다.

```bash
npm create frontron@latest
```

템플릿을 직접 지정하여 한 번에 생성하는 것도 가능합니다.

```bash
npx create-frontron@latest my-app --template react
npx create-frontron@latest my-app --template next
```

## 생성 후 실행

프로젝트가 생성되면 아래 명령어로 바로 실행해 볼 수 있습니다.

```bash
cd my-app
npm install
npm run app
```

## 주요 명령어

생성된 프로젝트에서 사용할 수 있는 주요 명령어입니다.

| 명령어 | 설명 |
| ---- | ---- |
| `npm run dev` | 렌더러 개발 서버를 실행합니다 (`vite` 또는 `next dev`) |
| `npm run app` | 렌더러와 Electron을 동시에 실행합니다 |
| `npm run build` | 렌더러 빌드, Electron 컴파일, 패키징을 순차적으로 수행합니다 |
| `npm run lint` | ESLint를 실행하여 코드 품질을 검사합니다 |

## 저장소 구조

```text
frontron/
  docs/                        # VitePress 문서 사이트
  packages/
    create-frontron/           # CLI 및 템플릿 소스
      src/                     # CLI 로직
      template-react/          # React 템플릿
      template-next/           # Next.js 템플릿
    frontron/                  # 런타임 패키지(placeholder)
```

## 문서

더 자세한 내용은 공식 문서에서 확인하실 수 있습니다.

- 공식 문서: https://frontron.andongmin.com
- 가이드: https://frontron.andongmin.com/guide/
- 이슈: https://github.com/andongmin94/frontron/issues

## 라이선스

MIT 라이선스를 따릅니다. 자세한 내용은 `LICENSE.md`를 참고해 주세요.
