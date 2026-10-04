<template>
  <form class="form-grid" @submit.prevent="submit">
    <label>
      <span>记录编号 *</span>
      <input v-model="form['记录编号']" placeholder="如 SEDI-2026-0007" />
    </label>
    <label>
      <span>站点编号 *</span>
      <input v-model="form['站点编号']" placeholder="如 ST-01" />
    </label>
    <label>
      <span>采样时间 *</span>
      <input v-model="form['采样时间']" placeholder="2026-10-01 08:00" />
    </label>
    <label>
      <span>设备编号</span>
      <input v-model="form['设备编号']" placeholder="如 TELE-0001，可空" />
    </label>
    <label>
      <span>含沙量(kg/m³) * —— 清水填 0，留空即缺测</span>
      <input v-model="form['含沙量']" type="number" step="0.001" placeholder="0 是合法实测值" />
    </label>
    <label>
      <span>输沙率(kg/s)</span>
      <input v-model="form['输沙率']" type="number" step="0.01" placeholder="缺测可留空" />
    </label>
    <label>
      <span>颗粒级配</span>
      <input v-model="form['颗粒级配']" placeholder="如 D50=0.031mm，清水可空" />
    </label>
    <label>
      <span>采样人</span>
      <input v-model="form['采样人']" />
    </label>
    <label class="full">
      <span>备注</span>
      <textarea v-model="form['备注']" rows="2"></textarea>
    </label>
    <div class="full form-actions">
      <button class="btn primary" type="submit">保存草稿</button>
      <button class="btn ghost" type="button" @click="reset">清空</button>
    </div>
  </form>
</template>

<script setup lang="ts">
import { reactive } from 'vue'

import type { DraftInput } from '@/data/sediment-types'

const emit = defineEmits<{ (e: 'save', payload: DraftInput): void }>()

const empty = (): DraftInput => ({
  '记录编号': '',
  '站点编号': '',
  '采样时间': '',
  '含沙量': '',
  '输沙率': '',
  '颗粒级配': '',
  '采样人': '',
  '设备编号': '',
  '备注': '',
})

const form = reactive<DraftInput>(empty())

function reset() {
  Object.assign(form, empty())
}

function submit() {
  emit('save', { ...form })
}
</script>
