<template>
  <section class="page" data-module="sediment">
    <header class="page-head">
      <div>
        <h2>泥沙监测管理</h2>
        <p class="page-desc">
          维护泥沙监测记录。含沙量 0 为合法实测值（清水），缺测另有标记；数据质量由统一判定源派生，列表、详情与设备入口结论一致。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="showForm = !showForm">
          {{ showForm ? '收起登记表单' : '登记泥沙监测记录' }}
        </button>
        <button class="btn" type="button" @click="exportRows">导出泥沙监测清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in statCards" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <DraftForm v-if="showForm" @save="handleSaveDraft" />

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>记录编号</span>
        <input v-model="filters['记录编号']" placeholder="按记录编号检索" />
      </label>
      <label class="filter-item">
        <span>站点编号</span>
        <input v-model="filters['站点编号']" placeholder="按站点编号检索" />
      </label>
      <label class="filter-item">
        <span>设备编号</span>
        <input v-model="filters['设备编号']" placeholder="按设备编号检索" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <div class="batch-bar">
      <span>已勾选待审核 <strong>{{ selectedIds.size }}</strong> 条（按记录当前版本做乐观并发校验）</span>
      <span class="spacer"></span>
      <input v-model="reviewNote" placeholder="审核意见（可选）" style="width: 220px; padding: 4px 8px;" />
      <button class="btn primary" type="button" :disabled="!selectedIds.size" @click="batchReview('已通过')">
        批量通过
      </button>
      <button class="btn" type="button" :disabled="!selectedIds.size" @click="batchReview('已驳回')">
        批量驳回
      </button>
    </div>

    <SedimentTable
      :rows="rows"
      selectable
      show-device
      :selected="selectedIds"
      @toggle="toggleSelect"
    />

    <footer class="page-foot">
      <span>共 {{ rows.length }} 条泥沙监测记录 · 当前身份：{{ store.role }}（{{ roleHint }}）</span>
      <span v-if="message" :class="messageOk ? '' : 'error-text'">{{ message }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import { downloadEntries, moduleMeta } from '@/api/local-service'
import {
  listSediment,
  reviewBatch,
  saveDraft,
  sedimentStats,
} from '@/api/sediment-service'
import { useSessionStore } from '@/stores/session'
import type { BatchVerdict, DraftInput, SedimentViewRow } from '@/data/sediment-types'
import DraftForm from './DraftForm.vue'
import SedimentTable from './SedimentTable.vue'
import { ROLE_CAN } from '@/stores/session'

const meta = moduleMeta('sediment')
const store = useSessionStore()
const roleHint = computed(() => ROLE_CAN[store.role])

const rows = ref<SedimentViewRow[]>([])
const filters = reactive<Record<string, string>>({})
const showForm = ref(false)
const message = ref('')
const messageOk = ref(true)
const reviewNote = ref('')
// 勾选态带上记录版本：提交时若版本已变，说明并发审核已先行落终态 → 整批回退。
const selected = reactive(new Map<number, number>())
const selectedIds = computed(() => new Set(selected.keys()))

const statuses = ['草稿', '待审核', '已通过', '已驳回']
const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => row.status === status).length,
  })),
)

const statCards = computed(() => {
  const stats = sedimentStats(rows.value)
  return [
    { label: '记录总数', value: stats.total },
    { label: '含沙量为零（清水，非缺测）', value: stats.zeroConcentration },
    { label: '缺测记录', value: stats.missing },
    { label: '异常记录', value: stats.abnormal },
    { label: '待审核', value: stats.pending },
    { label: '草稿', value: stats.draft },
  ]
})

function notify(ok: boolean, text: string) {
  messageOk.value = ok
  message.value = text
}

function toggleSelect(payload: { id: number; checked: boolean }) {
  const row = rows.value.find((item) => item.id === payload.id)
  if (!row) {
    return
  }
  if (payload.checked) {
    selected.set(payload.id, row.version)
  } else {
    selected.delete(payload.id)
  }
}

function handleSaveDraft(input: DraftInput) {
  const result = saveDraft(store.actor, input)
  notify(result.ok, result.message)
  if (result.ok) {
    showForm.value = false
    reload()
  }
}

function batchReview(verdict: BatchVerdict) {
  const items = [...selected.entries()].map(([id, version]) => ({ id, version }))
  const result = reviewBatch(store.actor, items, verdict, reviewNote.value || undefined)
  notify(result.ok, result.message)
  if (result.ok) {
    selected.clear()
    reviewNote.value = ''
    reload()
  } else if (result.message.includes('版本')) {
    // 并发失败后以库里最新版本为准，避免勾选态继续持有旧版本号。
    reload()
    selected.clear()
  }
}

function resetFilters() {
  for (const key of Object.keys(filters)) {
    filters[key] = ''
  }
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function reload() {
  message.value = ''
  rows.value = listSediment(filters)
}

onMounted(reload)
</script>
