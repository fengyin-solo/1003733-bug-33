<template>
  <section class="page" data-module="sediment-device">
    <header class="page-head">
      <div>
        <h2>设备泥沙数据入口</h2>
        <p class="page-desc">
          从遥测设备跨模块查看该设备上报的含沙量记录。质量结论与泥沙列表、记录详情同源：含沙量 0 有效，缺测单独标注。
        </p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" to="/telemetry">返回遥测设备</RouterLink>
        <RouterLink class="btn ghost" to="/sediment">泥沙监测列表</RouterLink>
      </div>
    </header>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>设备编号</span>
        <input v-model="deviceId" placeholder="如 TELE-0001" />
      </label>
      <button class="btn" type="submit">查询</button>
    </form>

    <SedimentTable :rows="rows" />

    <footer class="page-foot">
      <span>设备 {{ deviceId || '（未指定）' }} 下共 {{ rows.length }} 条记录</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import { listSedimentByDevice } from '@/api/sediment-service'
import type { SedimentViewRow } from '@/data/sediment-types'
import SedimentTable from './SedimentTable.vue'

const route = useRoute()
const deviceId = ref(String(route.query.device ?? ''))
const rows = ref<SedimentViewRow[]>([])

function reload() {
  rows.value = deviceId.value.trim() ? listSedimentByDevice(deviceId.value) : []
}

watch(() => route.query.device, (value) => {
  deviceId.value = String(value ?? '')
  reload()
})

onMounted(reload)
</script>
