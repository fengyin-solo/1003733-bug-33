<template>
  <table class="data-table">
    <thead>
      <tr>
        <th v-if="selectable" class="col-check">选择</th>
        <th>记录编号</th>
        <th>站点编号</th>
        <th>采样时间</th>
        <th>含沙量(kg/m³)</th>
        <th>输沙率(kg/s)</th>
        <th>颗粒级配</th>
        <th>采样人</th>
        <th v-if="showDevice">设备编号</th>
        <th>数据质量</th>
        <th>当前状态</th>
        <th>操作</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="row in rows" :key="row.id">
        <td v-if="selectable" class="col-check">
          <input
            type="checkbox"
            :checked="isSelected(row.id)"
            :disabled="row.status !== '待审核'"
            @change="toggle(row)"
          />
        </td>
        <td><RouterLink :to="`/sediment/${row.id}`" class="link">{{ row['记录编号'] }}</RouterLink></td>
        <td>{{ row['站点编号'] }}</td>
        <td>{{ row['采样时间'] }}</td>
        <!-- 0 原样显示为 0；缺测走统一徽标，不靠真值判断 -->
        <td>{{ row.display['含沙量'] }}</td>
        <td>{{ row.display['输沙率'] }}</td>
        <td>{{ row.display['颗粒级配'] }}</td>
        <td>{{ row.display['采样人'] }}</td>
        <td v-if="showDevice">{{ row['设备编号'] || '—' }}</td>
        <td>
          <div class="quality-cell">
            <QualityBadge :row="row" />
            <!-- 问题清单去重后只渲染一次，不再重复飘红 -->
            <span v-for="issue in row.issues" :key="issue" class="quality-issues">{{ issue }}</span>
          </div>
        </td>
        <td><span class="badge badge-muted">v{{ row.version }} · {{ row.status }}</span></td>
        <td class="row-actions">
          <RouterLink :to="`/sediment/${row.id}`" class="link">详情</RouterLink>
        </td>
      </tr>
      <tr v-if="!rows.length">
        <td :colspan="columnCount" class="empty-state">暂无泥沙监测记录</td>
      </tr>
    </tbody>
  </table>
</template>

<script setup lang="ts">
import QualityBadge from './QualityBadge.vue'
import type { SedimentViewRow } from '@/data/sediment-types'

const props = withDefaults(
  defineProps<{
    rows: SedimentViewRow[]
    selectable?: boolean
    showDevice?: boolean
    selected?: Set<number>
  }>(),
  { selectable: false, showDevice: false, selected: () => new Set<number>() },
)

const emit = defineEmits<{ (e: 'toggle', payload: { id: number; checked: boolean }): void }>()

const columnCount = props.selectable ? 12 : 11

function isSelected(id: number): boolean {
  return props.selected.has(id)
}

function toggle(row: SedimentViewRow) {
  emit('toggle', { id: row.id, checked: !props.selected.has(row.id) })
}
</script>
