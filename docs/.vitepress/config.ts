import { defineConfig } from "vitepress";
import { buildEnd } from "./buildEnd.config";

const ogTitle = "Frontron";
const ogDescription = "Desktop App Template";
const ogUrl = "https://frontron.andongmin.com";
const ogImage = "https://frontron.andongmin.com/frontron.svg";

export default defineConfig({
  title: "Frontron",
  description: "Desktop App Template",

  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/frontron.svg" }],
    [
      "link",
      { rel: "alternate", type: "application/rss+xml", href: "/blog.rss" },
    ],
    ["link", { rel: "organization", href: "https://github.com/andongmin94" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:title", content: ogTitle }],
    ["meta", { property: "og:image", content: ogImage }],
    ["meta", { property: "og:url", content: ogUrl }],
    ["meta", { property: "og:description", content: ogDescription }],
    ["meta", { name: "theme-color", content: "#646cff" }],
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
    logo: "/frontron.svg",

    editLink: {
      pattern: "https://github.com/andongmin94/frontron/issues",
      text: "가이드 수정 제안하기",
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
          text: "프론트론 가이드",
          items: [
            {
              text: "시작하기",
              link: "/guide/",
            },
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
  buildEnd,
});
