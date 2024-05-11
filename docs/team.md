---
layout: page
title: Meet the Team
description: The developers of Frontron.
---

<script setup>
import {
  VPTeamPage,
  VPTeamPageTitle,
  VPTeamPageSection,
  VPTeamMembers
} from 'vitepress/theme'
import { core } from './_data/team'
</script>

<VPTeamPage>
  <VPTeamPageTitle>
    <template #title>Meet the Team</template>
    <template #lead>
      The developers of Frontron.
    </template>
  </VPTeamPageTitle>
  <VPTeamMembers :members="core" />
</VPTeamPage>
