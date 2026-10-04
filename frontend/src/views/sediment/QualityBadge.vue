<template>
  <span class="badge" :class="klass">{{ label }}</span>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import type { SedimentViewRow } from '@/data/sediment-types'

const props = defineProps<{ row: SedimentViewRow }>()

const TEXT: Record<SedimentViewRow['quality'], string> = {
  '正常': '正常',
  '缺测': '缺测',
  '异常': '异常',
  '人工复核正常': '人工复核·正常',
}

const label = computed(() => TEXT[props.row.quality])
const klass = computed(() => ({
  'badge-ok': props.row.quality === '正常',
  'badge-missing': props.row.quality === '缺测',
  'badge-bad': props.row.quality === '异常',
  'badge-reviewed': props.row.quality === '人工复核正常',
}))
</script>
