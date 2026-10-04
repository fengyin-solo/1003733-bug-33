<template>
  <section class="page" data-module="sediment-detail">
    <header class="page-head">
      <div>
        <h2>泥沙监测记录详情</h2>
        <p class="page-desc">
          <RouterLink to="/sediment" class="link">返回泥沙列表</RouterLink>
          · 原始观测值只读；缺测走管理员补录，质量分歧走人工复核。
        </p>
      </div>
    </header>

    <div v-if="!row" class="empty-state">没有这条泥沙监测记录，可能已被重置。</div>

    <div v-else class="detail-layout">
      <div>
        <div class="stat-row">
          <article class="stat-card">
            <span class="stat-label">数据质量</span>
            <QualityBadge :row="row" />
          </article>
          <article class="stat-card">
            <span class="stat-label">当前状态</span>
            <strong class="stat-value">{{ row.status }}</strong>
          </article>
          <article class="stat-card">
            <span class="stat-label">记录版本</span>
            <strong class="stat-value">v{{ row.version }}</strong>
          </article>
        </div>

        <table class="data-table">
          <tbody>
            <tr v-for="field in fields" :key="field.key">
              <th style="width: 160px;">{{ field.key }}</th>
              <td>{{ field.value }}</td>
            </tr>
          </tbody>
        </table>

        <div v-if="row.issues.length" class="batch-bar" style="margin-top: 12px;">
          质量问题（去重）：
          <span v-for="issue in row.issues" :key="issue" class="badge" :class="issue === '颗粒级配缺失' ? 'badge-bad' : 'badge-missing'">
            {{ issue }}
          </span>
        </div>

        <div class="form-actions" style="margin-top: 12px;">
          <button
            v-if="row.status === '草稿'"
            class="btn primary"
            type="button"
            @click="act(submitDraft(store.actor, row.id))"
          >
            提交审核
          </button>
          <button
            v-if="row.status === '待审核'"
            class="btn primary"
            type="button"
            @click="act(reviewSediment(store.actor, row.id, '已通过', reviewNote))"
          >
            审核通过
          </button>
          <button
            v-if="row.status === '待审核'"
            class="btn"
            type="button"
            @click="act(reviewSediment(store.actor, row.id, '已驳回', reviewNote))"
          >
            审核驳回
          </button>
        </div>
        <input
          v-if="row.status === '待审核'"
          v-model="reviewNote"
          class="form-grid"
          style="display:block; width: 100%; padding: 6px 8px;"
          placeholder="审核意见（可选）"
        />

        <!-- 补录：只有管理员可用，且只补缺失字段，0 与既有值不覆盖 -->
        <section style="margin-top: 16px;">
          <h3 style="font-size:14px;">管理员补录（历史缺测字段按原值兼容，仅补缺）</h3>
          <div class="form-grid">
            <label>
              <span>含沙量(kg/m³) {{ isMissing(row['含沙量']) ? '（当前缺测）' : '（已有值，不可补录）' }}</span>
              <input v-model="backfill['含沙量']" type="number" step="0.001" :disabled="!isMissing(row['含沙量'])" />
            </label>
            <label>
              <span>输沙率(kg/s) {{ isMissing(row['输沙率']) ? '（当前缺测）' : '（已有值，不可补录）' }}</span>
              <input v-model="backfill['输沙率']" type="number" step="0.01" :disabled="!isMissing(row['输沙率'])" />
            </label>
            <label class="full">
              <span>颗粒级配 {{ isMissing(row['颗粒级配']) ? '（当前缺测）' : '（已有值，不可补录）' }}</span>
              <input v-model="backfill['颗粒级配']" :disabled="!isMissing(row['颗粒级配'])" />
            </label>
          </div>
          <div class="form-actions">
            <button class="btn primary" type="button" @click="doBackfill">提交补录（仅管理员）</button>
          </div>
        </section>

        <!-- 人工复核：覆盖展示层结论，不改原始观测值 -->
        <section style="margin-top: 16px;">
          <h3 style="font-size:14px;">人工复核（审核员/管理员；覆盖质量标记，原始值不动）</h3>
          <div class="form-actions">
            <button class="btn primary" type="button" @click="act(overrideQuality(store.actor, row.id, '正常', '人工确认数据有效'))">
              复核为正常
            </button>
            <button class="btn" type="button" @click="act(overrideQuality(store.actor, row.id, '异常', '人工确认数据异常'))">
              复核为异常
            </button>
            <span class="muted" style="font-size:12px; color: var(--muted); align-self:center;">
              自动判定只提示，终判权在审核岗
            </span>
          </div>
        </section>
      </div>

      <aside class="timeline">
        <h3>处理记录</h3>
        <p class="muted" style="font-size:12px; color:var(--muted); margin-top:0;">
          草稿阶段每类动作只留首次一条；审核与复核各留一条。
        </p>
        <div v-for="(item, index) in timeline" :key="index" class="timeline-item">
          <b>{{ item.action }}</b>
          <span class="muted">{{ item.actor }} · {{ item.at }}</span>
          <div v-if="item.note" class="muted">{{ item.note }}</div>
        </div>
      </aside>
    </div>

    <footer class="page-foot">
      <span>当前身份：{{ store.role }}（{{ ROLE_CAN[store.role] }}）</span>
      <span v-if="message" :class="messageOk ? '' : 'error-text'">{{ message }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'

import {
  backfillSediment,
  getSediment,
  overrideQuality,
  reviewSediment,
  submitDraft,
} from '@/api/sediment-service'
import { isMissing } from '@/data/sediment-quality'
import type { DraftInput, ServiceResult, SedimentViewRow } from '@/data/sediment-types'
import { useSessionStore, ROLE_CAN } from '@/stores/session'
import QualityBadge from './QualityBadge.vue'

const route = useRoute()
const store = useSessionStore()

const row = ref<SedimentViewRow | null>(getSediment(Number(route.params.id)))
const message = ref('')
const messageOk = ref(true)
const reviewNote = ref('')
const backfill = reactive<{ '含沙量': string; '输沙率': string; '颗粒级配': string }>({
  '含沙量': '',
  '输沙率': '',
  '颗粒级配': '',
})

const fields = computed(() => {
  if (!row.value) {
    return []
  }
  const r = row.value
  return [
    { key: '记录编号', value: r['记录编号'] },
    { key: '站点编号', value: r['站点编号'] },
    { key: '采样时间', value: r['采样时间'] },
    { key: '含沙量(kg/m³)', value: `${r.display['含沙量']}${r['含沙量'] === 0 ? '（清水零值，有效）' : ''}` },
    { key: '输沙率(kg/s)', value: r.display['输沙率'] },
    { key: '颗粒级配', value: r.display['颗粒级配'] },
    { key: '采样人', value: r.display['采样人'] },
    { key: '设备编号', value: isMissing(r['设备编号']) ? '缺测（历史记录按原值兼容）' : r['设备编号'] },
    { key: '备注', value: isMissing(r['备注']) ? '—' : r['备注'] },
  ]
})

const timeline = computed(() => {
  if (!row.value) {
    return []
  }
  return [...row.value.draftRecords, ...row.value.reviewRecords]
})

function refresh() {
  row.value = getSediment(Number(route.params.id))
}

function act(result: ServiceResult) {
  messageOk.value = result.ok
  message.value = result.message
  if (result.ok) {
    refresh()
  }
}

function doBackfill() {
  if (!row.value) {
    return
  }
  const patch: Partial<Pick<DraftInput, '含沙量' | '输沙率' | '颗粒级配'>> = {}
  if (isMissing(row.value['含沙量']) && backfill['含沙量'] !== '') {
    patch['含沙量'] = backfill['含沙量']
  }
  if (isMissing(row.value['输沙率']) && backfill['输沙率'] !== '') {
    patch['输沙率'] = backfill['输沙率']
  }
  if (isMissing(row.value['颗粒级配']) && backfill['颗粒级配'] !== '') {
    patch['颗粒级配'] = backfill['颗粒级配']
  }
  const result = backfillSediment(store.actor, row.value.id, patch)
  act(result)
  if (result.ok) {
    backfill['含沙量'] = ''
    backfill['输沙率'] = ''
    backfill['颗粒级配'] = ''
  }
}
</script>
