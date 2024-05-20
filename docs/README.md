------------------------------------------

# 1. <a href="https://frontron.vercel.app"><img src="https://frontron.vercel.app/frontron.svg" height=100px></a> 프론트론 소개

  ### **웹 프로젝트를 손 쉽게 데스크탑 앱으로 빌드**
    
  - 기간: 24.04.08 ~ 24.05.17 (6주)
  - 인원: 6명(BE_3, FE_3)
  - 트랙: 오픈소스

  ### 주요 기능
  
**Web to Desktop App**

- React, Next.js 기반 웹 프로젝트를 데스크탑 앱으로 빌드 지원
- Common Headless Components 48개 지원으로 앱 개발 지원
- 프론트엔드 기술을 앱의 GUI로 활용하여 형태 구현부와 기능 구현부를 분리

  
## 📃 문서
[💻 Notion](https://www.notion.so/andongmin/SSAFY-D101-06fab3c8bc5b4e51b39f4532eea1b98a)

------------------------------------------------------
  
# 2. 🔍 개발 환경
  
## 2-1. 환경 설정
    
  ### **👨‍💻 Front-end**
    
    - React : `18.3.0`
    - Electron `30.2.0`
    - Vite `5.3.2`
    - Tailwind CSS `3.4.3`

  ### **👨‍💻 Back-end**
    
    - Intellij : `2023.3.2`
    - JVM OpenJDK : `17`
    - Spring Boot : `3.2.5`
    
  ### **👩‍💻 CI/CD**  
    
    - AWS EC2
      - Nginx : `1.18.0`
      - Ubuntu : `20.04 LTS`
      - Docker : `25.0.2`
      - Jenkins :`2.443`
    - Docker Hub

## 2-2. 서비스 아키텍처
  
![image](https://github.com/frontron/.github/blob/main/profile/service-architecture.png)

------------------------------------------------------  

# 3. 🦈 주요 산출물
------------------------------------------------------
  ## 3-1. create frontron
![frontron1](https://github.com/frontron/.github/blob/main/profile/frontron1.png)

  - 프론트론 라이브러리 기반 템플릿 프로젝트 생성

  ## 3-2. install frontron
![frontron2](https://github.com/frontron/.github/blob/main/profile/frontron2.png)
  
  - 프론트론 라이브러리

  ## 3-3. frontron docs
![frontron3](https://github.com/frontron/.github/blob/main/profile/frontron3.png)

  - 프론트론 라이브러리 가이드 설명 웹 사이트

--------------------------

# 4. 🛡 배포
------------------------------------------------------
  - https
    - certbot과 Nginx를 통한 SSL 인증
    - EC2 제공 도메인 'http://k10d101.p.ssafy.io/' 사용하여 인증
  - 자동 배포
    - Gitlab에서 web hook 설정을 통해 jenkins 빌드 유발
    - jenkins의 shell script 실행 기능을 이용하여 git pull -> docker build -> run
    - Nginx로 reverse proxy 설정
  
  
--------------------------


# 5. 🖊 Cooperation
------------------------------------------------------
  
  ## Tools

    - Git

    - Jira

    - Notion

    - Mattermost
          
--------------------------

# 6. Ground rule
--------------------------------------------

### **생활 규칙**

- 출근/퇴근 인사
- 개인 일정 빠르게 공유해주기
- 카톡 및 MM 대답 및 확인 표시해주기

### **프로젝트**

- 매일 아침마다 회의하기(데일리 스크럼)
- 1일 1 커밋하기
- 커밋 컨벤션, 코드 컨벤션 잘 지키기
- 공부한 자료 잘 정리하기
- 추가적인 부분은 애자일하게
- 푸시할 때마다 코드리뷰하기

--------------------------------------------

# 7. 👨‍👩‍👧‍👦 팀원 소개
------------------------------------------------------
# 팀원 역할 및 담당

| 김상훈 | 김경범 | 박정환 | 임승환 | 조수현 | 편수지 |
| ----- | ------ | ----- | ------ | ----- | ------ |
| <a href="https://github.com/andongmin94"><img src="https://avatars.githubusercontent.com/u/110483588?v=4" alt="김상훈" width="100" height="100"></a> | <a href="https://github.com/dreamingbeom"><img src="https://avatars.githubusercontent.com/u/128280944?v=4" alt="김경범" width="100" height="100"></a> | <a href="https://github.com/Nam4o"><img src="https://avatars.githubusercontent.com/u/128338647?v=4" alt="박정환" width="100" height="100"></a> | <a href="https://github.com/Lim-seunghwan99"><img src="https://avatars.githubusercontent.com/u/139419039?v=4" alt="임승환" width="100" height="100"></a> | <a href="https://github.com/chosuhyeon0812"><img src="https://avatars.githubusercontent.com/u/119795734?v=4" alt="조수현" width="100" height="100"></a> |<a href="https://github.com/pyunsusie"><img src="https://avatars.githubusercontent.com/u/139519997?v=4" alt="편수지" width="100" height="100"></a> | 

| Contributors | Role | Position |
| ------------ | ---- | -------- |
| 김상훈 | 팀장 <br /> Frontend | - 라이브러리 코어 개발 |
| 김경범 | 팀원 <br /> Frontend | - 라이브러리 개발 및 Docs 개발 지원 |
| 박정환 | 팀원 <br /> Backend | - CI/CD 구축 및 백엔드 개발 |
| 임승환 | 팀원 <br /> Backend | - Showcase 프로젝트 개발 |
| 조수현 | 팀원 <br /> Backend | - CI/CD 구축 및 백엔드 개발 |
| 편수지 | 팀원 <br /> Frontend| - Docs 사이트 개발 |
