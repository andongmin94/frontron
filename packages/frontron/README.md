# Frontron (런타임 패키지) <a href="https://npmjs.com/package/frontron"><img src="https://img.shields.io/npm/v/frontron" alt="npm package"></a>

이 패키지는 Frontron 생태계에서 (추후) 공용 런타임 헬퍼/유틸/타입을 제공하기 위한 **플레이스홀더** 입니다. 현재는 `create-frontron` CLI 를 통해 생성되는 템플릿 내부 구성에 집중하고 있으며, 공통 로직이 축적되면 여기로 이전될 예정입니다.

## 지금 Frontron 시작하기

새 프로젝트를 만들려면 CLI 를 사용하세요:

```bash
npm create frontron@latest
# 또는
npx create-frontron@latest
```

프롬프트에 따라 템플릿(react / next / ts / swc)을 선택하면 Electron + Vite + Tailwind + Shadcn UI 기반 구조가 생성됩니다.

자세한 가이드는 문서 사이트 참고: https://frontron.andongmin.com

## 예정된 기능 (이 패키지)

- 윈도우/트레이/IPC 추상화 유틸
- 다중 창/세션 매니저
- 업데이트/설정 저장 헬퍼 (electron-store 래핑 등)
- 타입 안정성을 위한 공용 Type 정의

## 현재 상태

코드 없음 (placeholder). 설치만 해도 기능 변화는 없습니다.

```bash
npm i frontron
```

기능이 추가되면 CHANGELOG 와 문서에 공지할 예정입니다.

## 라이선스

MIT © andongmin

이슈 / 제안: https://github.com/andongmin94/frontron/issues
