import { defineConfig } from "vitepress";

const ogTitle = "Frontron";
const ogDescription = "Desktop App Template";
const ogUrl = "https://frontron.andongmin.com";
const ogImage = "https://frontron.andongmin.com/logo.png";

export default defineConfig({
  title: "Frontron",
  description: "Desktop App Template",

  head: [
    ["link", { rel: "icon", type: "image/png", href: "/logo.png" }],
    ["link", { rel: "organization", href: "https://github.com/andongmin94" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:title", content: ogTitle }],
    ["meta", { property: "og:image", content: ogImage }],
    ["meta", { property: "og:url", content: ogUrl }],
    ["meta", { property: "og:description", content: ogDescription }],
    ["meta", { name: "theme-color", content: "#1573FF" }],
    [
      "script",
      {
        src: "https://cdn.usefathom.com/script.js",
        "data-site": "CBDFBSLI",
        "data-spa": "auto",
        defer: "",
      },
    ],
  ],

  themeConfig: {
    logo: "/logo.svg",

    editLink: {
      pattern:
        "https://mail.google.com/mail/?view=cm&fs=1&to=andongmin94@gmail.com&su=Frontron%20문의&body=",
      text: "Gmail로 문의하기",
    },

    socialLinks: [
      { icon: "github", link: "https://github.com/andongmin94/frontron" },
    ],

    sidebarMenuLabel: "메뉴",

    returnToTopLabel: "위로 가기",

    darkModeSwitchLabel: "다크 모드",

    docFooter: {
      prev: "이전 페이지",
      next: "다음 페이지",
    },

    footer: {
      message: `Released under the MIT License`,
      copyright: "Copyright © 2024 안동민",
    },

    nav: [
      { text: "프론트론 가이드", link: "/guide", activeMatch: "/guide" },
      { text: "프론트론 개발자", link: "/maintainer" },
    ],

    sidebar: {
      "/guide/": [
        {
          text: "빠른 시작",
          items: [
            {
              text: "한 번에 따라하기",
              link: "/guide/",
            },
          ],
        },
        {
          text: "단계별 튜토리얼",
          items: [
            {
              text: "프로젝트 만들기",
              link: "/guide/create-project",
            },
            {
              text: "개발 모드로 실행하기",
              link: "/guide/run-development",
            },
            {
              text: "앱 이름과 아이콘 바꾸기",
              link: "/guide/customize-app",
            },
            {
              text: "생성된 구조 이해하기",
              link: "/guide/understand-template",
            },
            {
              text: "빌드와 패키징",
              link: "/guide/build-and-package",
            },
            {
              text: "빌드 결과물 이해하기",
              link: "/guide/output-files",
            },
            {
              text: "문제 해결",
              link: "/guide/troubleshooting",
            },
          ],
        },
        {
          text: "레퍼런스",
          items: [
            {
              text: "기능",
              link: "/guide/features",
            },
            {
              text: "설정",
              link: "/guide/config",
            },
          ],
        },
      ],
    },

    outline: {
      level: [2, 3],
      label: "목차", // ← 추가: 원하는 한글로 변경
    },
  },
  transformPageData(pageData) {
    const canonicalUrl = `${ogUrl}/${pageData.relativePath}`
      .replace(/\/index\.md$/, "/")
      .replace(/\.md$/, "/");
    pageData.frontmatter.head ??= [];
    pageData.frontmatter.head.unshift([
      "link",
      { rel: "canonical", href: canonicalUrl },
    ]);
    return pageData;
  },
  vite: {
    server: {
      port: 3000,
      host: "0.0.0.0",
    },
  },
});
