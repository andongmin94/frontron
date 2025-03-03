---
layout: page
title: 프론트론 개발자
description: 프론트론 개발자
---

<script setup>
import {
  VPTeamPage,
  VPTeamMembers
} from 'vitepress/theme'

const developer = [
  {
    avatar: 'https://avatars.githubusercontent.com/u/110483588?v=4',
    name: '안동민',
    title: '유지보수 담당자',
    desc: 'Frontron을 만들고 확장하며 유지보수합니다.',
    links: [
      { icon: 'github', link: 'https://github.com/andongmin94' },
    ]
  }
]
</script>

<VPTeamPage>
  <VPTeamMembers :members="developer" />
</VPTeamPage>
