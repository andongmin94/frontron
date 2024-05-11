import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import TwoslashFloatingVue from '@shikijs/vitepress-twoslash/client'
import '@shikijs/vitepress-twoslash/style.css'
import './styles/vars.css'
import SvgImage from './components/SvgImage.vue'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('SvgImage', SvgImage)
    app.use(TwoslashFloatingVue)
  },
} satisfies Theme
