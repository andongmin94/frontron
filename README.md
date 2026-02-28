<div align="center">

<a href="https://frontron.andongmin.com">
<img src="https://frontron.andongmin.com/logo.svg" alt="logo" height="200" />
</a>

</div>

# Frontron <a href="https://npmjs.com/package/create-frontron"><img src="https://img.shields.io/npm/v/create-frontron" alt="npm package"></a>

Electron 기반 데스크톱 앱을 빠르게 시작하기 위한 CLI 템플릿 모음입니다.

## 개요

`create-frontron`은 Electron 앱 프로젝트를 바로 실행 가능한 상태로 생성합니다.

- 템플릿 2종 제공: `react` / `next`
- TypeScript 기반 Electron main/preload 기본 아키텍처
- Tailwind CSS + Shadcn 스타일 패턴 + 다수 UI 컴포넌트 포함
- Splash, Tray, IPC, 커스텀 TitleBar 기본 포함

## 템플릿 비교

| 템플릿 | 식별자 | 렌더러 | Electron 출력 | 패키징 출력 |
| ---- | ---- | ---- | ---- | ---- |
| React | `react` | Vite + React | `dist/electron` | `output/` |
| Next.js | `next` | Next.js App Router | `.electron` | `.build/` |

## 요구사항

- Node.js `22+`

## 빠른 시작

대화형:

```bash
npm create frontron@latest
```

비대화식:

```bash
npx create-frontron@latest my-app --template react
npx create-frontron@latest my-app --template next
```

## 생성 후 실행

```bash
cd my-app
npm install
npm run app
```

## 주요 명령어

| 명령어 | 설명 |
| ---- | ---- |
| `npm run dev` | 렌더러 개발 서버 실행 (`vite` 또는 `next dev`) |
| `npm run app` | 렌더러 + Electron 동시 실행 |
| `npm run build` | 렌더러 빌드 + Electron 컴파일 + 패키징 |
| `npm run lint` | ESLint 실행 |

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

- 공식 문서: https://frontron.andongmin.com
- 가이드: https://frontron.andongmin.com/guide/
- 이슈: https://github.com/andongmin94/frontron/issues

## 라이선스

MIT. 자세한 내용은 `LICENSE.md` 참고.
