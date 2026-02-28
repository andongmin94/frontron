<div align="center">

<a href="https://frontron.andongmin.com">
<img src="/docs/public/logo.svg" alt="logo" height="200" />
</a>

</div>

# create-frontron <a href="https://npmjs.com/package/create-frontron"><img src="https://img.shields.io/npm/v/create-frontron" alt="npm package"></a>

Electron 앱 스캐폴딩 CLI입니다.

## 요구사항

- Node.js `22+`

## 사용법

대화형 생성:

```bash
npm create frontron@latest
```

템플릿 지정 생성:

```bash
npx create-frontron@latest my-app --template react
npx create-frontron@latest my-app --template next
```

옵션:

- `--template <react|next>` (`-t` 별칭)
- `--overwrite <yes|no|ignore>`

## 템플릿 목록

| 템플릿 | 식별자 | 렌더러 |
| ---- | ---- | ---- |
| React | `react` | Vite + React |
| Next.js | `next` | Next.js App Router |

## 생성 후 기본 명령어

```bash
cd my-app
npm install
npm run app
```

## 라이선스

MIT (`LICENSE` 참고)

문서: https://frontron.andongmin.com
