---
layout: home

title: 프론트론
titleTemplate: CLI 기반 Electron 스타터

hero:
  name: Frontron
  text: 웹 친화적인 스타터로 데스크톱 앱을 시작하고, Frontron CLI로 실행하세요
  tagline: "`npm create frontron@latest` 로 시작한 뒤 `app:dev` 와 `app:build` 를 실행하세요."
  image:
    src: /logo.svg
    alt: Frontron
  actions:
    - theme: brand
      text: 빠른 시작
      link: /ko/guide/
    - theme: alt
      text: 프로젝트 만들기
      link: /ko/guide/create-project
    - theme: alt
      text: GitHub
      link: https://github.com/andongmin94/frontron

features:
  - title: 스타터로 바로 시작하기
    details: 공식 Frontron 스타터를 생성하고 곧바로 데스크톱 앱을 실행합니다.
    link: /ko/guide/create-project
    linkText: 스타터 가이드 열기
  - title: 브리지 흐름 이해하기
    details: 프론트엔드는 여전히 `frontron/client` 를 호출하고, 데스크톱 쪽은 support package가 처리합니다.
    link: /ko/guide/understand-bridge-flow
    linkText: 설명 열기
  - title: 기존 프로젝트 수동 설치
    details: 호환되는 기존 웹앱은 `frontron` 을 직접 설치해서 같은 config/CLI 흐름을 사용할 수 있습니다.
    link: /ko/guide/install-existing-project
    linkText: 매뉴얼 열기
  - title: 빌드와 패키징
    details: "`app:build` 가 무엇을 준비하고 결과물이 어디에 생기는지 확인합니다."
    link: /ko/guide/build-and-package
    linkText: 빌드 가이드 열기

---

## 자신에게 맞는 시작 경로를 고르세요

### 가장 빠르게 시작하고 싶다면

1. [프로젝트 만들기](/ko/guide/create-project)
2. [개발 모드로 실행하기](/ko/guide/run-development)
3. [앱 이름과 아이콘 바꾸기](/ko/guide/customize-app)
4. [생성된 구조 이해하기](/ko/guide/understand-template)

### 이미 호환되는 웹앱이 있다면

1. [기존 프로젝트에 설치하기](/ko/guide/install-existing-project)
2. [개발 모드로 실행하기](/ko/guide/run-development)
3. [데스크톱 브리지 사용하기](/ko/guide/use-bridge)
4. [빌드와 패키징](/ko/guide/build-and-package)

### 브리지가 추상적으로 느껴진다면

1. [브리지 흐름 이해하기](/ko/guide/understand-bridge-flow)
2. [데스크톱 브리지 사용하기](/ko/guide/use-bridge)

## Frontron 이 제공하는 것

- starter 생성을 위한 `create-frontron`
- CLI 와 runtime/build support 를 담당하는 `frontron`
- `frontron/client` 를 통한 데스크톱 브리지
- `frontron/rust` 의 선택적 Rust 슬롯

## 먼저 보기 좋은 매뉴얼

- [빠른 시작](/ko/guide/)
- [프로젝트 만들기](/ko/guide/create-project)
- [개발 모드로 실행하기](/ko/guide/run-development)
- [브리지 흐름 이해하기](/ko/guide/understand-bridge-flow)
- [문제 해결](/ko/guide/troubleshooting)
