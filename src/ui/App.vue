<template>
  <Panel />
  <FloatingBall v-if="showBall" />
  <OverviewDrawer v-if="panelState.overviewOpen && settingsStore.enabled" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import Panel from './Panel.vue';
import FloatingBall from './FloatingBall.vue';
import OverviewDrawer from './OverviewDrawer.vue';
import { settingsStore } from '../store/ui-settings.ts';
import { panelState } from './panel-state.ts';

const showBall = computed(() => settingsStore.enabled && settingsStore.ui.ballVisible);
</script>
