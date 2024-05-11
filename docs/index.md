---
layout: home

title: Frontron
titleTemplate: GUI Library for Desktop App Development

hero:
  name: Frontron
  text: GUI Library for Desktop App Development
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
      link: https://github.com/frontron/frontron
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
