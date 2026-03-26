# 지원 범위 표

이 페이지는 Frontron의 현재 Electron 표면을 과장 없이 정리한 capability map 입니다.

마이그레이션 전에 아래 세 가지를 먼저 판단할 수 있어야 합니다.

- Frontron이 지금 잘 다루는 것
- 조건부로만 다룰 수 있는 것
- 의도적으로 닫혀 있거나 아직 지원하지 않는 것

## 0. 검증 수준

- `Verified`: 이 저장소 안의 대표 테스트나 smoke coverage로 뒷받침되는 상태
- `Conditional`: 명확한 제약 안에서는 지원하지만 프로젝트 구조에 따라 달라질 수 있는 상태
- `Unsupported`: 현재 프레임워크 계약 밖의 상태

## 1. 앱 패턴별 적합도

Frontron은 데스크톱 앱이 여전히 "웹앱 하나 + 작은 데스크톱 셸" 구조일 때 가장 강합니다.

| 앱 패턴 | 적합도 | 검증 수준 | 설명 |
| --- | --- | --- | --- |
| 메인 창 + 설정/소개/도움말 창 | 적합 | Verified | 정적인 named window 구조와 잘 맞습니다 |
| 트레이 기반 hidden window | 적합 | Verified | `show: false` 와 tray, menu, hook, `bridge.windows.*` 조합으로 다룰 수 있습니다 |
| route 기반 named extra window | 적합 | Verified | 현재 Frontron이 의도한 multi-window 모델입니다 |
| transparent 또는 frameless utility 스타일 단일 창 | 조건부 | Conditional | `transparent`, `frame: false`, `alwaysOnTop` 는 가능하지만 overlay/click-through 지원을 주장하지는 않습니다 |
| child/modal window graph | 부적합 / 현재 미지원 | Unsupported | parent/child 또는 modal 관계를 1급 surface로 제공하지 않습니다 |
| 문서 창처럼 같은 종류의 창을 여러 개 여는 패턴 | 부적합 / 현재 미지원 | Unsupported | 창은 configured name 기준으로 식별되고 singleton처럼 재사용됩니다 |
| overlay 또는 click-through window | 부적합 / 현재 미지원 | Unsupported | `setIgnoreMouseEvents` 같은 계약과 overlay 전용 lifecycle surface가 없습니다 |
| remote-content viewer window | 부적합 / 현재 미지원 | Unsupported | 현재 계약은 route 기반, app-origin 기반 창 모델입니다 |
| `webviewTag`, `nodeIntegration`, custom `webPreferences`, direct preload global 이 필요한 앱 | 부적합 / 현재 미지원 | Unsupported | 이 영역은 의도적으로 닫혀 있습니다 |

## 2. 현재 multi-window 모델

Frontron의 현재 multi-window slice 는 **named, route-based, lazy singleton windows** 입니다.

- 창은 `windows` 에 미리 선언합니다.
- `windows.main` 이 있으면 그 창이 primary window 입니다. 없으면 첫 configured window 가 primary 가 됩니다.
- 각 창은 같은 앱 origin 안의 route 를 로드합니다.
- non-primary 창은 처음 열 때만 생성되고, 그 뒤에는 이름 기준으로 재사용됩니다.
- Frontron은 현재 임의의 runtime window instance 를 직접 생성하지 않습니다.
- Frontron은 현재 parent/child 관계, modal graph, 같은 이름 계열의 다중 인스턴스를 모델링하지 않습니다.

즉 Frontron은 작은 수의 named desktop window 는 잘 다루지만, raw Electron식 multi-window runtime 은 아닙니다.

현재 named-window 모델은 이 저장소 안의 representative bridge test와 runtime smoke coverage로 `Verified` 상태입니다.

## 3. 기본 window bridge surface

기본 bridge 는 창 제어를 지원하지만, raw Electron 보다 의도적으로 얇습니다.

| surface | 현재 계약 | 현재 제한 |
| --- | --- | --- |
| `bridge.window.*` | primary window 편의 API: `isVisible()`, `isFocused()`, `toggleVisibility()`, `showInactive()`, `minimize()`, `toggleMaximize()`, `hide()`, `get/setBounds()`, `get/setPosition()`, `get/setAlwaysOnTop()`, `get/setOpacity()`, `getState()`, `onMaximizedChanged()` | 여전히 parent/modal graph 제어나 임의 window 생성, raw `BrowserWindow` lifecycle hook 은 없습니다 |
| `bridge.windows.*` | configured named window 전용 제어: `open`, `isVisible`, `isFocused`, `show`, `showInactive`, `toggleVisibility`, `hide`, `focus`, `close`, `minimize`, `toggleMaximize`, `exists`, `get/setBounds`, `get/setPosition`, `get/setAlwaysOnTop`, `get/setOpacity`, `getState`, `listConfigured`, `listOpen` | 동적 인스턴스 생성, parent/modal 제어, named-window event subscription 은 없습니다 |
| `desktopContext.window.*` | main process 에서 쓰는 primary window helper | 여전히 primary window 범위입니다 |
| `desktopContext.windows.*` | main process 에서 쓰는 named configured window helper | renderer bridge 와 같은 named-singleton 제한을 가집니다 |

임의의 `BrowserWindow` lifecycle 제어가 필요하다면, 현재 Frontron은 그 요구에 맞는 추상화가 아닙니다.

## 4. 공식 `frontron.config.ts` surface

아래 영역은 현재 1급 제품 설정입니다.

| 영역 | 주요 필드 | 설명 |
| --- | --- | --- |
| 앱 메타데이터 | `app.name`, `app.id`, `app.icon`, `app.description`, `app.author`, `app.copyright` | 일반적인 제품 식별 정보 |
| 웹 연결 | `web.dev.command`, `web.dev.url`, `web.build.command`, `web.build.outDir` | 자동 추론이 부족할 때 명시 |
| 빌드 정책 | `build.outputDir`, `build.artifactName`, `build.publish`, `build.asar`, `build.compression`, `build.files`, `build.extraResources`, `build.extraFiles` | 기본 패키징 정책 |
| 플랫폼 패키징 | `build.windows.*`, `build.nsis.*`, `build.mac.*`, `build.linux.*` | 플랫폼별 일반 제품 결정 |
| 파일 연결 | `build.fileAssociations[]` | 패키징된 문서 타입 등록 |
| 창 설정 | `windows.*.route`, 크기, 프레임, 표시, 제목, `alwaysOnTop`, `transparent`, `skipTaskbar` | route 기반 named window 설정 |
| 안전한 런타임 튜닝 | `windows.*.zoomFactor`, `windows.*.sandbox`, `windows.*.spellcheck`, `windows.*.webSecurity` | 작은 안전 subset만 공식 지원 |
| 업데이트 | `updates.enabled`, `updates.provider`, `updates.url`, `updates.checkOnLaunch` | 현재 typed slice는 의도적으로 작음 |
| 딥링크 | `deepLinks.enabled`, `deepLinks.name`, `deepLinks.schemes` | 스킴 등록과 런타임 URL 수신 |
| 보안 정책 | `security.externalNavigation`, `security.newWindow` | 외부 이동 정책만 우선 지원 |
| 앱 레이어 모듈 | `bridge`, `menu`, `tray`, `hooks`, `rust` | `frontron`이 소유하지만 앱 레이어에서 설정 |

typed window surface 는 named application window 를 위한 것이지, 모든 raw `BrowserWindow` 패턴을 그대로 열어 주는 표면은 아닙니다.

## 5. guarded advanced-only 필드

아래 surface 는 typed surface 가 부족할 때만 쓰는 예외 경로입니다.

| surface | 용도 | 계속 막는 것 |
| --- | --- | --- |
| `build.advanced.electronBuilder` | 마지막 단계 패키징 예외 처리 | 프레임워크 소유 경로, package entry 연결, typed packaging 필드, raw `protocols`, raw `fileAssociations` |
| `windows.*.advanced` | 마지막 단계 `BrowserWindow` 예외 처리 | `webPreferences`, 아이콘 연결, 이미 typed 로 열린 필드 |

`advanced` 는 일반 경로가 아니라 best-effort escape hatch 입니다.

가능하면 항상 typed `build.*`, `windows.*` 부터 쓰는 편이 맞습니다.

## 6. 런타임 소유로 닫아 둔 필드

아래 값은 Frontron이 런타임과 빌드 orchestration 을 소유하기 때문에 의도적으로 닫아 둡니다.

| 닫힌 영역 | 닫아 두는 이유 |
| --- | --- |
| `preload` 경로 | preload 연결은 Frontron이 소유 |
| `contextIsolation` | bridge 보안 경계를 Frontron이 고정 |
| `nodeIntegration` | renderer 보안 기본값을 Frontron이 고정 |
| raw `session` / `partition` | 아직 typed surface 밖 |
| raw `webviewTag` 와 custom preload global | 공개 renderer 계약은 계속 `frontron/client` 하나 |
| 스테이징 경로와 생성 런타임 레이아웃 | 빌드 staging은 Frontron 소유 |
| 템플릿 내부 Electron 코어 로직 | `create-frontron` 은 계속 얇아야 함 |
| 임의의 `BrowserWindow` 인스턴스에 대한 직접 런타임 소유권 | 창 계약을 config-driven 상태로 유지 |

## 7. 프론트엔드 스택 지원 범위

현재 실사용 기준 지원 상태는 아래와 같습니다.

| 스택 | dev 추론 | build 추론 | 검증 수준 | 메모 |
| --- | --- | --- | --- | --- |
| Vite | 예 | 예 | Verified | 가장 잘 맞는 경로 |
| React with Vite | 예 | 예 | Verified | Vite와 동일 |
| Vue with Vite | 예 | 예 | Verified | Vite와 동일 |
| VitePress | 예 | 예 | Verified | `docs:dev`, `docs:build` 구조 지원 |
| Astro | 예 | 예 | Verified | 정적 출력 경로 지원 |
| Angular CLI | 예 | 예 | Verified | 현재 Angular `dist/<app>/browser` 경로 지원 |
| Next.js | 예 | 조건부 | Conditional | static export 흐름 기준 |
| Nuxt | 예 | 조건부 | Conditional | generate / prerender 흐름 기준 |
| 모노레포 앱 | 경우에 따라 | 경우에 따라 | Conditional | 보통 `web.dev`, `web.build` 명시 권장 |
| 래퍼 스크립트 | 경우에 따라 | 경우에 따라 | Conditional | 추론이 애매하면 `web.*` 명시 권장 |

## 8. 이 저장소 안의 대표 검증 근거

이 페이지의 가장 강한 `Verified` 주장은 현재 저장소의 테스트와 직접 연결됩니다.

- Vite, VitePress, Astro, Angular, Next static export, Nuxt generate 추론은 `packages/frontron/__tests__/cli.spec.ts` 에서 검증합니다
- named window bridge 동작은 `packages/frontron/__tests__/runtime-bridge.spec.ts`, `packages/frontron/__tests__/runtime-shell.spec.ts` 에서 검증합니다
- route 기반 named window runtime 로딩은 `packages/frontron/__tests__/runtime-smoke.spec.ts` 에서 검증합니다

`Conditional` 행은 대표 경로가 하나 검증되어 있더라도, 실제 프로젝트 구조가 문서의 제약과 맞아야만 성립합니다.

## 9. 자동 추론을 멈추고 명시 설정으로 넘어갈 때

아래 경우에는 `web.dev`, `web.build` 를 직접 적는 편이 맞습니다.

- `turbo run dev --filter web` 같은 래퍼 스크립트를 쓸 때
- 저장소 안에 프론트엔드 앱이 여러 개 있을 때
- 정적 출력 경로가 바로 보이지 않을 때
- 팀에서 데스크톱 연결 경로를 완전히 명시적으로 관리하고 싶을 때

확신이 없으면 먼저 아래를 실행하면 됩니다.

```bash
npx frontron check
```

그 다음 이 레시피 문서에서 해당 스택 예시를 그대로 따라가면 됩니다.

## 10. Frontron이 맞지 않는 경우

아래가 제품의 핵심 요구사항이라면, 현재 Frontron은 맞지 않을 가능성이 큽니다.

- configured named window 대신 임의의 runtime-created window 가 필요할 때
- 같은 종류의 창을 여러 개 띄워야 할 때
- modal 또는 parent/child window graph 가 필요할 때
- overlay 또는 click-through 동작이 필수일 때
- remote URL, `file://`, inline HTML 을 독립적인 window content mode 로 써야 할 때
- `webviewTag`, `nodeIntegration`, custom preload global, custom `webPreferences` 가 필요할 때

`npx frontron check` 는 이제 legacy `window.electron`, raw BrowserWindow 보안 옵션, overlay API, modal graph, remote `loadURL()` / `loadFile()`, `<webview>` 같은 대표 migration blocker 를 먼저 잡아 줍니다.

이 경우에는 Frontron의 현재 계약을 억지로 넓히기보다 raw Electron 이 더 잘 맞습니다.
