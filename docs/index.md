---
layout: home

title: Frontron
titleTemplate: The Easiest frontend GUI for desktop app development

hero:
  name: Frontron
  text: Frontend GUI for Desktop App Development
  tagline:  Made in D101(self-directed) of SSAFY 10th.
  image:
    src: /frontron.svg
    alt: Frontron
  actions:
    - theme: brand
      text: Get Started
      link: /guide/
    - theme: alt
      text: View on GitHub
      link: https://github.com/andongmin94/frontron
---

<script setup>
import { onMounted } from 'vue'

onMounted(() => {
  const urlParams = new URLSearchParams(window.location.search)
  if (urlParams.get('uwu') != null) {
    const img = document.querySelector('.VPHero .VPImage.image-src')
    img.src = '/icon.png'
    img.alt = 'frontron'
  }
})
</script>
