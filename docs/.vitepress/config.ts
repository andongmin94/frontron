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
      pattern: "https://github.com/andongmin94/frontron/edit/main/docs",
      text: "Suggest changes to this page",
    },

    socialLinks: [
      { icon: "github", link: "https://github.com/andongmin94/frontron" },
    ],

    footer: {
      message: `Released under the MIT License`,
      copyright: "Copyright © 2024 andongmin",
    },

    nav: [
      { text: "Guide", link: "/guide", activeMatch: "/guide" },
      { text: "Maintainer", link: "/maintainer" },
    ],

    sidebar: {
      "/guide/": [
        {
          text: "Guide",
          items: [
            {
              text: "Getting Started",
              link: "/guide/",
            },
            {
              text: "Features",
              link: "/guide/features",
            },
            {
              text: "Configuration",
              link: "/guide/config",
            }
          ],
        }
      ],
    },

    outline: {
      level: [2, 3],
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
