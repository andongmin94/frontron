import { defineConfig } from 'vitepress'
import { transformerTwoslash } from '@shikijs/vitepress-twoslash'
import { buildEnd } from './buildEnd.config'

const ogDescription = 'GUI Library for Desktop App Development'
const ogImage = 'https://frontron.vercel.app/frontron.svg'
const ogTitle = 'Frontron'
const ogUrl = 'https://frontron.vercel.app'

export default defineConfig({
  title: 'Frontron',
  description: 'GUI Library for Desktop App Development',

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/frontron.svg' }],
    [
      'link',
      { rel: 'alternate', type: 'application/rss+xml', href: '/blog.rss' },
    ],
    ['link', { rel: 'organization', href: 'https://github.com/frontron' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: ogTitle }],
    ['meta', { property: 'og:image', content: ogImage }],
    ['meta', { property: 'og:url', content: ogUrl }],
    ['meta', { property: 'og:description', content: ogDescription }],
    ['meta', { name: 'theme-color', content: '#646cff' }],
    [
      'script',
      {
        src: 'https://cdn.usefathom.com/script.js',
        'data-site': 'CBDFBSLI',
        'data-spa': 'auto',
        defer: '',
      },
    ],
  ],

  themeConfig: {
    logo: '/frontron.svg',

    editLink: {
      pattern: 'https://github.com/frontron/frontron/edit/main/docs',
      text: 'Suggest changes to this page',
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/frontron/frontron' },
    ],

    footer: {
      message: `Released under the MIT License`,
      copyright: 'Copyright © 2024 andongmin',
    },

    nav: [
      { text: 'Guide', link: '/guide/', activeMatch: '/guide/' },
      { text: 'Config', link: '/config/', activeMatch: '/config/' },
      { text: 'Team', link: '/team' },
      { text: 'Showcase', link: '/blog' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Guide',
          items: [
            {
              text: 'Getting Started',
              link: '/guide/',
            },
            {
              text: 'Features',
              link: '/guide/features',
            }
          ],
        },
        {
          text: 'Components',
          items: [
            {
              text: 'Accordion',
              link: '/guide/components/accordion',
            },
            {
              text: 'Alert',
              link: '/guide/components/alert',
            },
            {
              text: 'Alert Dialog',
              link: '/guide/components/alert-dialog',
            },
            {
              text: 'Aspect Ratio',
              link: '/guide/components/aspect-ratio',
            },
            {
              text: 'Avatar',
              link: '/guide/components/avatar',
            },
            {
              text: 'Badge',
              link: '/guide/components/badge',
            },
            {
              text: 'Breadcrumb',
              link: '/guide/components/breadcrumb',
            },
            {
              text: 'Button',
              link: '/guide/components/button',
            },
            {
              text: 'Calendar',
              link: '/guide/components/calendar',
            },
            {
              text: 'Card',
              link: '/guide/components/card',
            },
            {
              text: 'Carousel',
              link: '/guide/components/carousel',
            },
            {
              text: 'Checkbox',
              link: '/guide/components/checkbox',
            },
            {
              text: 'Collapsible',
              link: '/guide/components/collapsible',
            },
            {
              text: 'Combobox',
              link: '/guide/components/combobox',
            },
            {
              text: 'Command',
              link: '/guide/components/command',
            },
            {
              text: 'Context Menu',
              link: '/guide/components/context-menu',
            },
            {
              text: 'Data Table',
              link: '/guide/components/data-table',
            },
            {
              text: 'Date Picker',
              link: '/guide/components/date-picker',
            },
            {
              text: 'Dialog',
              link: '/guide/components/dialog',
            },
            {
              text: 'Drawer',
              link: '/guide/components/drawer',
            },
            {
              text: 'Dropdown Menu',
              link: '/guide/components/dropdown-menu',
            },
            {
              text: 'Form',
              link: '/guide/components/form',
            },
            {
              text: 'Hover Card',
              link: '/guide/components/hover-card',
            },
            {
              text: 'Input',
              link: '/guide/components/input',
            },
            {
              text: 'Input OTP',
              link: '/guide/components/input-otp',
            },
            {
              text: 'Label',
              link: '/guide/components/label',
            },
            {
              text: 'Menubar',
              link: '/guide/components/menubar',
            },
            {
              text: 'Navigation Menu',
              link: '/guide/components/navigation-menu',
            },
            {
              text: 'Pagination',
              link: '/guide/components/pagination',
            },
            {
              text: 'Popover',
              link: '/guide/components/popover',
            },
            {
              text: 'Progress',
              link: '/guide/components/progress',
            },
            {
              text: 'Radio Group',
              link: '/guide/components/radio-group',
            },
            {
              text: 'Resizable',
              link: '/guide/components/resizable',
            },
            {
              text: 'Scroll Area',
              link: '/guide/components/scroll-area',
            },
            {
              text: 'Select',
              link: '/guide/components/select',
            },
            {
              text: 'Separator',
              link: '/guide/components/separator',
            },
            {
              text: 'Sheet',
              link: '/guide/components/sheet',
            },
            {
              text: 'Skeleton',
              link: '/guide/components/skeleton',
            },
            {
              text: 'Slider',
              link: '/guide/components/slider',
            },
            {
              text: 'Sonner',
              link: '/guide/components/sonner',
            },
            {
              text: 'Switch',
              link: '/guide/components/switch',
            },
            {
              text: 'Table',
              link: '/guide/components/table',
            },
            {
              text: 'Tabs',
              link: '/guide/components/tabs',
            },
            {
              text: 'Textarea',
              link: '/guide/components/textarea',
            },
            {
              text: 'Toast',
              link: '/guide/components/toast',
            },
            {
              text: 'Toggle',
              link: '/guide/components/toggle',
            },
            {
              text: 'Toggle Group',
              link: '/guide/components/toggle-group',
            },
            {
              text: 'Tooltip',
              link: '/guide/components/tooltip',
            },
          ],
        }
      ],
      '/config/': [
        {
          text: 'Config',
          items: [
            {
              text: 'React',
              link: '/config/',
            },
            {
              text: ' Next.js Page Router',
              link: '/config/next-page',
            },
            {
              text: 'Next.js App Router',
              link: '/config/next-app',
            }
          ],
        },
      ],
    },

    outline: {
      level: [2, 3],
    },
  },
  transformPageData(pageData) {
    const canonicalUrl = `${ogUrl}/${pageData.relativePath}`
      .replace(/\/index\.md$/, '/')
      .replace(/\.md$/, '/')
    pageData.frontmatter.head ??= []
    pageData.frontmatter.head.unshift([
      'link',
      { rel: 'canonical', href: canonicalUrl },
    ])
    return pageData
  },
  markdown: {
    codeTransformers: [transformerTwoslash()],
  },
  buildEnd,
})
