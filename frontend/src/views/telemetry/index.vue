<template>
  <section class="page" data-module="telemetry">
    <header class="page-head">
      <div>
        <h2>遥测设备管理</h2>
        <p class="page-desc">维护遥测设备，围绕设备编号、设备类型、所属站点、通讯方式做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记遥测设备</button>
        <button class="btn" type="button" @click="exportRows">导出遥测设备清单</button>
      </div>
    </header>

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
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>本站最近含沙量（泥沙模块）</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>
            <template v-if="sedimentSnapshot(row)">
              <span :class="{ 'cell-zero': sedimentSnapshot(row)?.zero }">
                {{ sedimentSnapshot(row)?.text }}
              </span>
              <span
                v-for="tag in sedimentSnapshot(row)?.tags ?? []"
                :key="tag.code"
                class="chip"
                :class="tag.severity === 'blocking' ? 'danger' : 'info'"
              >
                {{ tag.label }}
              </span>
            </template>
            <span v-else class="muted">本站暂无泥沙记录</span>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无遥测设备数据，可先登记遥测设备</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条遥测设备记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { listRows } from '@/data/local-store'
import {
  evaluateSediment,
  formatCell,
  isMissing,
  parseNumber,
  SEDIMENT_FIELDS,
  SEDIMENT_KEY,
  type SedimentTag,
} from '@/data/sediment-rules'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('telemetry')
const columns = ["设备编号", "设备类型", "所属站点", "通讯方式", "安装日期", "最近维护日", "电池余量", "设备状态"]
const actions = ["报修设备", "确认修复", "停用设备"]
const statuses = ["正常运行", "信号异常", "低电量", "待维修", "已停用"]
const stats = [{"label": "设备总数", "value": 0}, {"label": "正常运行数", "value": 0}, {"label": "待维修数", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

// 跨模块取数：设备入口按「所属站点」关联泥沙模块最近一条记录。
// 关键：复用与泥沙列表、记录详情完全相同的 evaluateSediment，零值与缺测口径一致，
// 标签也是纯派生、按行缓存，不会因跨模块再渲染一遍而重复出现。
type Snapshot = { text: string; zero: boolean; tags: SedimentTag[] }
const snapshots = new Map<number, Snapshot>()

function latestSedimentByStation(station: string): EntryRow | undefined {
  const sameStation = listRows(SEDIMENT_KEY).filter(
    (row) => String(row[SEDIMENT_FIELDS.station] ?? '') === station,
  )
  if (sameStation.length === 0) {
    return undefined
  }
  return sameStation.reduce((latest, row) =>
    String(row[SEDIMENT_FIELDS.sampledAt] ?? '') >
    String(latest[SEDIMENT_FIELDS.sampledAt] ?? '')
      ? row
      : latest,
  )
}

function sedimentSnapshot(row: EntryRow): Snapshot | undefined {
  return snapshots.get(Number(row.id))
}

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '遥测设备登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    snapshots.clear()
    for (const row of payload.items) {
      const station = String(row['所属站点'] ?? '')
      const sediment = latestSedimentByStation(station)
      if (!sediment) {
        continue
      }
      const value = sediment[SEDIMENT_FIELDS.concentration]
      const evaluation = evaluateSediment(sediment)
      snapshots.set(Number(row.id), {
        // 含沙量为 0 在此同样显示「0 kg/m³」，缺测才显示「缺测」。
        text: isMissing(value)
          ? '含沙量缺测'
          : `${formatCell(value, ' kg/m³')} · ${String(sediment[SEDIMENT_FIELDS.sampledAt] ?? '')}`,
        zero: !isMissing(value) && parseNumber(value) === 0,
        tags: evaluation.tags,
      })
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '遥测设备列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.cell-zero {
  font-variant-numeric: tabular-nums;
  color: #1f2937;
}
.muted {
  color: var(--muted);
  font-size: 12px;
}
.chip {
  display: inline-block;
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 12px;
  margin-left: 4px;
  border: 1px solid transparent;
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
</style>
