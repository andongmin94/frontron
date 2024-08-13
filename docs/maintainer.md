---
layout: page
title: Meet the Maintainer
description: The developers of Frontron.
---

<script setup>
import {
  VPTeamPage,
  VPTeamPageTitle,
  VPTeamPageSection,
  VPTeamMembers
} from 'vitepress/theme'

const developer = [
  {
    avatar: 'https://avatars.githubusercontent.com/u/110483588?v=4',
    name: 'andongmin',
    title: 'Developer',
    desc: 'A knight of Information processing.',
    links: [
      { icon: 'github', link: 'https://github.com/andongmin94' },
    ]
  }
]
</script>

<VPTeamPage>
  <VPTeamPageTitle>
    <template #title>Frontron Developer</template>
  </VPTeamPageTitle>
  <VPTeamMembers :members="developer" />
</VPTeamPage>