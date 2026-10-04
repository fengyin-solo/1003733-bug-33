<template>
  <section class="page" data-module="sediment">
    <header class="page-head">
      <div>
        <h2>泥沙监测管理</h2>
        <p class="page-desc">围绕记录编号、站点编号、采样时间、含沙量做登记、筛选与审核流转。含沙量为 0 是合法实测值，缺测与异常由统一规则只读判定。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="toggleRole">切换为{{ canReview ? '值班员' : '复核岗' }}</button>
        <button class="btn primary" type="button" @click="openCreate">登记泥沙监测记录</button>
        <button class="btn" type="button" @click="exportRows">导出泥沙监测清单</button>
      </div>
    </header>

    <p class="role-banner">
      当前身份：{{ store.operator }}（{{ store.roleLabel }}）
      <span v-if="canReview" class="chip info">可补录 · 可人工复核</span>
      <span v-else class="chip muted">补录/复核将被拒绝</span>
    </p>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <div class="batch-bar">
      <label class="select-all">
        <input type="checkbox" :checked="allSelectableChecked" @change="toggleSelectAll" />
        全选待审核
      </label>
      <button class="btn" type="button" :disabled="busy || !selectedIds.length" @click="runBatch('approve')">
        批量确认通过
      </button>
      <button class="btn" type="button" :disabled="busy || !selectedIds.length" @click="runBatch('reject')">
        批量标记异常
      </button>
      <span class="hint">已选 {{ selectedIds.length }} 条；并发批次互斥，失败整批回退。</span>
    </div>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th>选择</th>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>判定标签</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in evaluatedRows" :key="String(row.row.id)" :class="{ 'row-abnormal': row.abnormal }">
          <td>
            <input
              v-if="row.row.status === '待审核'"
              type="checkbox"
              :checked="selected.has(Number(row.row.id))"
              @change="toggleSelect(Number(row.row.id))"
            />
          </td>
          <td>{{ row.row['记录编号'] ?? '—' }}</td>
          <td>{{ row.row['站点编号'] ?? '—' }}</td>
          <td>{{ row.row['采样时间'] ?? '—' }}</td>
          <td :class="{ 'cell-zero': isConcentrationZero(row.row) }">
            {{ formatConcentration(row.row['含沙量']) }}
          </td>
          <td>{{ formatNumeric(row.row['输沙率']) }}</td>
          <td>{{ formatText(row.row['颗粒级配']) }}</td>
          <td>{{ row.row['采样人'] ?? '—' }}</td>
          <td>{{ row.row['记录状态'] ?? '—' }}</td>
          <td>
            <span v-if="!row.tags.length" class="chip ok">正常</span>
            <span
              v-for="tag in row.tags"
              :key="tag.code"
              class="chip"
              :class="tag.severity === 'blocking' ? 'danger' : 'info'"
            >
              {{ tag.label }}
            </span>
          </td>
          <td>{{ row.row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row.row)">记录详情</button>
            <button
              v-if="row.row.status === '草稿' || row.row.status === '已采集'"
              class="link"
              type="button"
              @click="submitOne(row.row)"
            >
              提交审核
            </button>
            <button
              v-if="canReview && row.abnormal"
              class="link"
              type="button"
              @click="clearOne(row.row)"
            >
              人工复核确认
            </button>
            <button
              v-if="canReview && row.blocking.length > 0"
              class="link"
              type="button"
              @click="openDetail(row.row)"
            >
              补录
            </button>
          </td>
        </tr>
        <tr v-if="!evaluatedRows.length">
          <td :colspan="columns.length + 4" class="empty-state">暂无泥沙监测数据，可先登记泥沙监测记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条泥沙监测记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <SedimentDetailDrawer
      :open="detailOpen"
      :row="detailRow"
      :operator="store.operator"
      :can-review="canReview"
      @close="detailOpen = false"
      @changed="onDetailChanged"
    />

    <div v-if="createOpen" class="drawer-mask" @click.self="createOpen = false">
      <aside class="drawer create-drawer">
        <header class="drawer-head">
          <h3>登记泥沙监测记录（草稿）</h3>
          <button class="link" type="button" @click="createOpen = false">关闭</button>
        </header>
        <label v-for="item in createInputs" :key="item.key" class="backfill-item form-row">
          <span>{{ item.label }}</span>
          <input v-model="draftForm[item.key]" :placeholder="item.placeholder" />
        </label>
        <p class="hint">含沙量/输沙率没有采到时留空即为缺测；如实测为 0 请填 0，系统不会误判。</p>
        <button class="btn primary" type="button" @click="submitCreate">保存草稿</button>
        <p v-if="createError" class="error-text">{{ createError }}</p>
      </aside>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import { downloadEntries, filterRows, listEntries, moduleMeta } from '@/api/local-service'
import {
  createDraft,
  manualClear,
  reviewBatch,
  submitForReview,
} from '@/api/sediment-service'
import {
  evaluateSediment,
  formatCell,
  isMissing,
  parseNumber,
  SEDIMENT_FIELDS,
} from '@/data/sediment-rules'
import { useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'
import SedimentDetailDrawer from './DetailDrawer.vue'

const store = useSessionStore()
const canReview = computed(() => store.can('sediment:backfill'))
const meta = moduleMeta('sediment')
const columns = ['记录编号', '站点编号', '采样时间', '含沙量', '输沙率', '颗粒级配', '采样人', '记录状态']
const filterFields = columns.slice(0, 3)

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const busy = ref(false)
const filters = ref<Record<string, string>>({})
const selected = ref<Set<number>>(new Set())

const detailOpen = ref(false)
const detailRow = ref<EntryRow | null>(null)
const createOpen = ref(false)
const createError = ref('')

const createInputs = [
  { key: 'station', label: '站点编号', placeholder: '如 STAT-0001' },
  { key: 'sampledAt', label: '采样时间', placeholder: '2026-10-04 08:00' },
  { key: 'sampler', label: '采样人', placeholder: '采样人姓名' },
  { key: 'concentration', label: '含沙量(kg/m³)', placeholder: '实测为 0 就填 0' },
  { key: 'discharge', label: '输沙率(kg/s)', placeholder: '可留空' },
  { key: 'gradation', label: '颗粒级配', placeholder: '可留空' },
] as const

type DraftKey = (typeof createInputs)[number]['key']
const draftForm = reactive<Record<DraftKey, string>>({
  station: '',
  sampledAt: '',
  sampler: '',
  concentration: '',
  discharge: '',
  gradation: '',
})

const evaluatedRows = computed(() =>
  rows.value.map((row) => evaluateSediment(row)),
)

const statusSummary = computed(() =>
  meta.statuses.map((status) => ({
    status,
    count: evaluatedRows.value.filter((item) => String(item.row.status) === status).length,
  })),
)

const stats = computed(() => [
  { label: '采样记录数', value: rows.value.length },
  {
    label: '待审核记录',
    value: evaluatedRows.value.filter((item) => item.row.status === '待审核').length,
  },
  { label: '异常记录数', value: evaluatedRows.value.filter((item) => item.abnormal).length },
  {
    label: '实测含沙量为 0',
    value: evaluatedRows.value.filter((item) => isConcentrationZero(item.row)).length,
  },
])

const selectableIds = computed(() =>
  evaluatedRows.value
    .filter((item) => item.row.status === '待审核')
    .map((item) => Number(item.row.id)),
)
const selectedIds = computed(() => [...selected.value])
const allSelectableChecked = computed(
  () => selectableIds.value.length > 0 && selectableIds.value.every((id) => selected.value.has(id)),
)

function isConcentrationZero(row: EntryRow): boolean {
  if (isMissing(row[SEDIMENT_FIELDS.concentration])) {
    return false
  }
  return parseNumber(row[SEDIMENT_FIELDS.concentration]) === 0
}

// 统一展示口径：0 原样显示，绝不显示成「缺测/—」。
function formatConcentration(value: unknown): string {
  return formatCell(value, ' kg/m³')
}
function formatNumeric(value: unknown): string {
  return formatCell(value, ' kg/s')
}
function formatText(value: unknown): string {
  return isMissing(value) ? '缺测' : String(value)
}

function toggleRole() {
  store.toggleRole()
}

function toggleSelect(id: number) {
  const next = new Set(selected.value)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  selected.value = next
}

function toggleSelectAll() {
  selected.value = allSelectableChecked.value
    ? new Set()
    : new Set(selectableIds.value)
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  createError.value = ''
  createOpen.value = true
}

function submitCreate() {
  createError.value = ''
  if (!draftForm.station.trim() || !draftForm.sampledAt.trim() || !draftForm.sampler.trim()) {
    createError.value = '站点编号、采样时间、采样人为必填项'
    return
  }
  const result = createDraft(
    {
      station: draftForm.station.trim(),
      sampledAt: draftForm.sampledAt.trim(),
      sampler: draftForm.sampler.trim(),
      concentration: draftForm.concentration.trim(),
      discharge: draftForm.discharge.trim(),
      gradation: draftForm.gradation.trim(),
    },
    { operator: store.operator, can: (p) => store.can(p) },
  )
  if (!result.ok) {
    createError.value = result.message
    return
  }
  createOpen.value = false
  reload()
}

function submitOne(row: EntryRow) {
  const result = submitForReview(Number(row.id), {
    operator: store.operator,
    can: (p) => store.can(p),
  })
  errorMessage.value = result.ok ? '' : result.message
  reload()
}

function clearOne(row: EntryRow) {
  const result = manualClear(Number(row.id), {
    operator: store.operator,
    can: (p) => store.can(p),
  })
  errorMessage.value = result.ok ? '' : result.message
  reload()
}

async function runBatch(decision: 'approve' | 'reject') {
  if (busy.value) {
    errorMessage.value = '已有审核批次在处理，请勿并发提交'
    return
  }
  busy.value = true
  errorMessage.value = ''
  // 模拟网络往返，放大并发窗口：互斥锁必须挡住第二批。
  await new Promise((resolve) => setTimeout(resolve, 150))
  const result = reviewBatch(
    [...selected.value],
    decision,
    { operator: store.operator, can: (p) => store.can(p) },
  )
  busy.value = false
  errorMessage.value = result.ok ? '' : result.message
  selected.value = new Set()
  reload()
}

function openDetail(row: EntryRow) {
  // 详情从最新列表取对象，保证与列表同一判定口径。
  const fresh = rows.value.find((item) => Number(item.id) === Number(row.id)) ?? row
  detailRow.value = fresh
  detailOpen.value = true
  errorMessage.value = ''
}

function onDetailChanged() {
  detailOpen.value = false
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    // 用共享过滤器但只取泥沙；判定完全交给 evaluateSediment 纯函数。
    const payload = listEntries(meta.key, filters.value)
    rows.value = filterRows(payload.items, {}).map((row) => ({ ...row }))
    total.value = payload.total
    selected.value = new Set([...selected.value].filter((id) =>
      rows.value.some((row) => Number(row.id) === id && row.status === '待审核'),
    ))
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '泥沙监测列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.page-actions {
  display: flex;
  gap: 8px;
}
.role-banner {
  font-size: 12px;
  color: var(--muted);
  display: flex;
  align-items: center;
  gap: 8px;
}
.batch-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 12px;
  margin-bottom: 10px;
  font-size: 13px;
}
.select-all {
  display: flex;
  align-items: center;
  gap: 6px;
}
.hint {
  color: var(--muted);
  font-size: 12px;
}
.row-abnormal {
  background: #fffafa;
}
.cell-zero {
  font-variant-numeric: tabular-nums;
}
.chip {
  display: inline-block;
  border-radius: 999px;
  padding: 1px 9px;
  font-size: 12px;
  border: 1px solid transparent;
  white-space: nowrap;
}
.chip.danger {
  background: #fef3f2;
  color: #b42318;
  border-color: #fecdca;
}
.chip.info {
  background: #fffaeb;
  color: #b54708;
  border-color: #fedf89;
}
.chip.ok {
  background: #ecfdf3;
  color: #027a48;
  border-color: #abefc6;
}
.chip.muted {
  background: #f1f5f9;
  color: var(--muted);
  border-color: var(--border);
}
.drawer-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.35);
  display: flex;
  justify-content: flex-end;
  z-index: 20;
}
.drawer {
  width: 460px;
  max-width: 92vw;
  background: #fff;
  height: 100%;
  padding: 18px 20px;
  overflow-y: auto;
}
.drawer-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.backfill-item {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  font-size: 13px;
}
.backfill-item span {
  width: 110px;
  color: var(--muted);
}
.backfill-item input {
  flex: 1;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
}
:deep(.btn:disabled) {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
