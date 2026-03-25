import { defineConfig, type DefaultTheme } from "vitepress";

const siteTitle = "Frontron";
const siteDescription =
  "Framework-first desktop app layer for existing web projects";
const siteUrl = "https://frontron.andongmin.com";
const siteImage = "https://frontron.andongmin.com/logo.png";

type LocalePrefix = "" | "/ko";

interface LocaleThemeText {
  title: string;
  editLinkText: string;
  menuLabel: string;
  backToTopLabel: string;
  darkModeLabel: string;
  langMenuLabel: string;
  prevLabel: string;
  nextLabel: string;
  footerMessage: string;
  footerCopyright: string;
  guideNavLabel: string;
  maintainerNavLabel: string;
  frameworkSectionLabel: string;
  quickStartLabel: string;
  contractLabel: string;
  installExistingLabel: string;
  bridgeFlowLabel: string;
  manualSectionLabel: string;
  createProjectLabel: string;
  runDevelopmentLabel: string;
  customizeLabel: string;
  bridgeGuideLabel: string;
  structureLabel: string;
  buildLabel: string;
  outputLabel: string;
  troubleshootingLabel: string;
  referenceSectionLabel: string;
  featuresLabel: string;
  configLabel: string;
  supportMatrixLabel: string;
  recipesLabel: string;
  outlineLabel: string;
}

function withPrefix(prefix: LocalePrefix, path: string) {
  return prefix ? `${prefix}${path}` : path;
}

function createGuideSidebar(
  prefix: LocalePrefix,
  text: LocaleThemeText,
): DefaultTheme.Sidebar {
  const guideRoot = withPrefix(prefix, "/guide/");

  return {
    [guideRoot]: [
      {
        text: text.frameworkSectionLabel,
        items: [
          {
            text: text.quickStartLabel,
            link: guideRoot,
          },
          {
            text: text.contractLabel,
            link: withPrefix(prefix, "/guide/framework-first"),
          },
          {
            text: text.installExistingLabel,
            link: withPrefix(prefix, "/guide/install-existing-project"),
          },
          {
            text: text.bridgeFlowLabel,
            link: withPrefix(prefix, "/guide/understand-bridge-flow"),
          },
        ],
      },
      {
        text: text.manualSectionLabel,
        items: [
          {
            text: text.createProjectLabel,
            link: withPrefix(prefix, "/guide/create-project"),
          },
          {
            text: text.runDevelopmentLabel,
            link: withPrefix(prefix, "/guide/run-development"),
          },
          {
            text: text.customizeLabel,
            link: withPrefix(prefix, "/guide/customize-app"),
          },
          {
            text: text.bridgeGuideLabel,
            link: withPrefix(prefix, "/guide/use-bridge"),
          },
          {
            text: text.structureLabel,
            link: withPrefix(prefix, "/guide/understand-template"),
          },
          {
            text: text.buildLabel,
            link: withPrefix(prefix, "/guide/build-and-package"),
          },
          {
            text: text.outputLabel,
            link: withPrefix(prefix, "/guide/output-files"),
          },
          {
            text: text.troubleshootingLabel,
            link: withPrefix(prefix, "/guide/troubleshooting"),
          },
        ],
      },
      {
        text: text.referenceSectionLabel,
        items: [
          {
            text: text.featuresLabel,
            link: withPrefix(prefix, "/guide/features"),
          },
          {
            text: text.configLabel,
            link: withPrefix(prefix, "/guide/config"),
          },
          {
            text: text.supportMatrixLabel,
            link: withPrefix(prefix, "/guide/support-matrix"),
          },
          {
            text: text.recipesLabel,
            link: withPrefix(prefix, "/guide/recipes"),
          },
        ],
      },
    ],
  };
}

function createThemeConfig(
  prefix: LocalePrefix,
  text: LocaleThemeText,
): DefaultTheme.Config {
  return {
    logo: "/logo.svg",
    editLink: {
      pattern:
        "https://mail.google.com/mail/?view=cm&fs=1&to=andongmin94@gmail.com&su=Frontron%20Docs&body=",
      text: text.editLinkText,
    },
    socialLinks: [
      { icon: "github", link: "https://github.com/andongmin94/frontron" },
    ],
    nav: [
      {
        text: text.guideNavLabel,
        link: withPrefix(prefix, "/guide/"),
        activeMatch: `${withPrefix(prefix, "/guide/")}`,
      },
      {
        text: text.maintainerNavLabel,
        link: withPrefix(prefix, "/maintainer"),
      },
    ],
    sidebar: createGuideSidebar(prefix, text),
    sidebarMenuLabel: text.menuLabel,
    returnToTopLabel: text.backToTopLabel,
    darkModeSwitchLabel: text.darkModeLabel,
    langMenuLabel: text.langMenuLabel,
    docFooter: {
      prev: text.prevLabel,
      next: text.nextLabel,
    },
    footer: {
      message: text.footerMessage,
      copyright: text.footerCopyright,
    },
    outline: {
      level: [2, 3],
      label: text.outlineLabel,
    },
  };
}

const englishThemeText: LocaleThemeText = {
  title: "Frontron",
  editLinkText: "Contact by Gmail",
  menuLabel: "Menu",
  backToTopLabel: "Back to top",
  darkModeLabel: "Dark mode",
  langMenuLabel: "Languages",
  prevLabel: "Previous page",
  nextLabel: "Next page",
  footerMessage: "Released under the MIT License.",
  footerCopyright: "Copyright © 2024 Andongmin",
  guideNavLabel: "Guide",
  maintainerNavLabel: "Maintainer",
  frameworkSectionLabel: "Start Here",
  quickStartLabel: "Quick Start",
  contractLabel: "Official Contract",
  installExistingLabel: "Install into an Existing Project",
  bridgeFlowLabel: "Understand the Bridge Flow",
  manualSectionLabel: "Step-by-Step Guides",
  createProjectLabel: "Create a Project",
  runDevelopmentLabel: "Run in Development",
  customizeLabel: "Change App Name and Icon",
  bridgeGuideLabel: "Use the Desktop Bridge",
  structureLabel: "Understand the Generated Structure",
  buildLabel: "Build and Package",
  outputLabel: "Understand the Output Files",
  troubleshootingLabel: "Troubleshooting",
  referenceSectionLabel: "Reference",
  featuresLabel: "Features",
  configLabel: "Config",
  supportMatrixLabel: "Support Matrix",
  recipesLabel: "Recipes",
  outlineLabel: "On this page",
};

const koreanThemeText: LocaleThemeText = {
  title: "프론트론",
  editLinkText: "Gmail로 문의하기",
  menuLabel: "메뉴",
  backToTopLabel: "위로 가기",
  darkModeLabel: "다크 모드",
  langMenuLabel: "언어",
  prevLabel: "이전 페이지",
  nextLabel: "다음 페이지",
  footerMessage: "MIT 라이선스로 배포됩니다.",
  footerCopyright: "Copyright © 2024 안동민",
  guideNavLabel: "가이드",
  maintainerNavLabel: "개발자",
  frameworkSectionLabel: "시작하기",
  quickStartLabel: "빠른 시작",
  contractLabel: "공식 구조와 계약",
  installExistingLabel: "기존 프로젝트에 설치하기",
  bridgeFlowLabel: "브리지 흐름 이해하기",
  manualSectionLabel: "단계별 가이드",
  createProjectLabel: "프로젝트 만들기",
  runDevelopmentLabel: "개발 모드로 실행하기",
  customizeLabel: "앱 이름과 아이콘 바꾸기",
  bridgeGuideLabel: "데스크톱 브리지 사용하기",
  structureLabel: "생성된 구조 이해하기",
  buildLabel: "빌드와 패키징",
  outputLabel: "빌드 결과물 이해하기",
  troubleshootingLabel: "문제 해결",
  referenceSectionLabel: "레퍼런스",
  featuresLabel: "기능",
  configLabel: "설정",
  supportMatrixLabel: "지원 범위 표",
  recipesLabel: "스택별 레시피",
  outlineLabel: "목차",
};

export default defineConfig({
  title: siteTitle,
  description: siteDescription,
  head: [
    ["link", { rel: "icon", type: "image/png", href: "/logo.png" }],
    ["link", { rel: "organization", href: "https://github.com/andongmin94" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:title", content: siteTitle }],
    ["meta", { property: "og:image", content: siteImage }],
    ["meta", { property: "og:url", content: siteUrl }],
    ["meta", { property: "og:description", content: siteDescription }],
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
  locales: {
    root: {
      label: "English",
      lang: "en-US",
      title: englishThemeText.title,
      description: siteDescription,
      themeConfig: createThemeConfig("", englishThemeText),
    },
    ko: {
      label: "한국어",
      lang: "ko-KR",
      link: "/ko/",
      title: koreanThemeText.title,
      description: "기존 웹 프로젝트를 위한 framework-first desktop app layer",
      themeConfig: createThemeConfig("/ko", koreanThemeText),
    },
  },
  transformPageData(pageData) {
    const canonicalUrl = `${siteUrl}/${pageData.relativePath}`
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
