<template>
  <div v-if="open" class="drawer-mask" @click.self="$emit('close')">
    <aside class="drawer">
      <header class="drawer-head">
        <h3>泥沙记录详情</h3>
        <button class="link" type="button" @click="$emit('close')">关闭</button>
      </header>

      <dl v-if="row" class="detail-grid">
        <template v-for="field in fields" :key="field">
          <dt>{{ field }}</dt>
          <dd>
            <span :class="{ 'cell-missing': isNumericMissing(field) }">
              {{ display(field) }}
            </span>
          </dd>
        </template>
        <dt>当前状态</dt>
        <dd>{{ row.status }}</dd>
      </dl>

      <div v-if="evaluation" class="tag-row">
        <span v-if="!evaluation.tags.length" class="chip ok">判定正常</span>
        <span
          v-for="tag in evaluation.tags"
          :key="tag.code"
          class="chip"
          :class="tag.severity === 'blocking' ? 'danger' : 'info'"
        >
          {{ tag.label }}
        </span>
      </div>

      <section v-if="canReview" class="backfill-box">
        <h4>补录缺失字段</h4>
        <p class="hint">仅可补填空字段；历史记录已有原值（含 0）保持不变。</p>
        <label v-for="item in backfillInputs" :key="item.key" class="backfill-item">
          <span>{{ item.label }}</span>
          <input v-model="patch[item.key]" :placeholder="`补录${item.label}`" />
        </label>
        <button class="btn primary" type="button" @click="submitBackfill">提交补录</button>
      </section>
      <section v-else class="backfill-box">
        <p class="hint">当前为值班员视角：补录历史缺测字段需切换到人工复核岗。</p>
      </section>

      <section class="ledger">
        <h4>处理记录（每动作仅留首次）</h4>
        <ul v-if="row?.processing?.length">
          <li v-for="(record, index) in row.processing" :key="`${record.action}-${index}`">
            <strong>{{ record.action }}</strong>
            <span>{{ record.operator }} · {{ record.at }}</span>
            <em v-if="record.note">{{ record.note }}</em>
          </li>
        </ul>
        <p v-else class="hint">暂无处理记录</p>
      </section>

      <p v-if="error" class="error-text">{{ error }}</p>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, watch, computed } from 'vue'

import { backfillRecord } from '@/api/sediment-service'
import { evaluateSediment, formatCell, isMissing, SEDIMENT_FIELDS } from '@/data/sediment-rules'
import type { EntryRow } from '@/data/types'

const props = defineProps<{
  open: boolean
  row: EntryRow | null
  operator: string
  canReview: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'changed'): void
}>()

const fields = [
  SEDIMENT_FIELDS.code,
  SEDIMENT_FIELDS.station,
  SEDIMENT_FIELDS.sampledAt,
  SEDIMENT_FIELDS.concentration,
  SEDIMENT_FIELDS.discharge,
  SEDIMENT_FIELDS.gradation,
  SEDIMENT_FIELDS.sampler,
]
const numericFields: Set<string> = new Set([SEDIMENT_FIELDS.concentration, SEDIMENT_FIELDS.discharge])
const units: Record<string, string> = {
  [SEDIMENT_FIELDS.concentration]: ' kg/m³',
  [SEDIMENT_FIELDS.discharge]: ' kg/s',
}

const backfillInputs = [
  { key: 'concentration', label: SEDIMENT_FIELDS.concentration },
  { key: 'discharge', label: SEDIMENT_FIELDS.discharge },
  { key: 'gradation', label: SEDIMENT_FIELDS.gradation },
] as const

type PatchKey = (typeof backfillInputs)[number]['key']

const evaluation = computed(() => (props.row ? evaluateSediment(props.row) : null))

const patch = reactive<Record<PatchKey, string>>({ concentration: '', discharge: '', gradation: '' })
const error = ref('')

watch(
  () => props.row?.id,
  () => {
    patch.concentration = ''
    patch.discharge = ''
    patch.gradation = ''
    error.value = ''
  },
)

function isNumericMissing(field: string): boolean {
  if (!props.row || !numericFields.has(field)) {
    return false
  }
  return isMissing(props.row[field])
}

function display(field: string): string {
  if (!props.row) {
    return ''
  }
  return formatCell(props.row[field], units[field] ?? '')
}

function submitBackfill() {
  if (!props.row) {
    return
  }
  error.value = ''
  const result = backfillRecord(
    Number(props.row.id),
    {
      concentration: patch.concentration,
      discharge: patch.discharge,
      gradation: patch.gradation,
    },
    { operator: props.operator, can: () => props.canReview },
  )
  if (!result.ok) {
    error.value = result.message
    return
  }
  emit('changed')
}
</script>

<style scoped>
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
}
.drawer-head h3 {
  margin: 0;
  font-size: 16px;
}
.detail-grid {
  display: grid;
  grid-template-columns: 96px 1fr;
  gap: 6px 12px;
  margin: 14px 0;
  font-size: 13px;
}
.detail-grid dt {
  color: var(--muted);
}
.detail-grid dd {
  margin: 0;
}
.cell-missing {
  color: #b42318;
}
.tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 10px 0;
}
.chip {
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
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
.chip.ok {
  background: #ecfdf3;
  color: #027a48;
  border-color: #abefc6;
}
.backfill-box,
.ledger {
  border-top: 1px solid var(--border);
  margin-top: 12px;
  padding-top: 10px;
}
.backfill-box h4,
.ledger h4 {
  margin: 0 0 8px;
  font-size: 13px;
}
.backfill-item {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 13px;
}
.backfill-item span {
  width: 64px;
  color: var(--muted);
}
.backfill-item input {
  flex: 1;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.hint {
  font-size: 12px;
  color: var(--muted);
}
.ledger ul {
  margin: 0;
  padding-left: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
}
.ledger li span,
.ledger li em {
  display: block;
  color: var(--muted);
  font-style: normal;
}
</style>
