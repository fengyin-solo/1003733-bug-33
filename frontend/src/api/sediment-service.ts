import { listRows, saveRows } from '@/data/local-store'
import {
  appendLedger,
  evaluateSediment,
  nowStamp,
  reconcileSediment,
  SEDIMENT_DRAFT_STATUS,
  SEDIMENT_FIELDS,
} from '@/data/sediment-rules'
import type { ActionResult, EntryRow, ProcessRecord } from '@/data/types'

/**
 * 泥沙审核工作流。
 *  - 每条草稿只留一条处理记录：台账按 action 首次留痕，重复提交沿用首次（幂等）。
 *  - 越权补录在入口直接拒绝；历史缺失字段（legacy）按原值兼容。
 *  - 批量并发审核：模块级互斥锁保证只有一个批次进入，全量预校验通过才提交，
 *    任一条失败整批回退（先在副本上算，commitAll 一次性落库），终态唯一。
 */

const MODULE = 'sediment'

export type OperatorContext = {
  operator: string
  can: (permission: string) => boolean
}

export type BackfillPatch = Partial<{
  concentration: string
  discharge: string
  gradation: string
}>

function snapshot(): EntryRow[] {
  return listRows(MODULE).map((row) => ({ ...row }))
}

function commit(rows: EntryRow[]): void {
  // 本服务只写泥沙模块：一次缓存替换 + 一次持久化即为原子提交，失败时根本不调用。
  saveRows(MODULE, rows)
}

function findRow(rows: EntryRow[], id: number): EntryRow | undefined {
  return rows.find((row) => Number(row.id) === Number(id))
}

function ledger(row: EntryRow, record: ProcessRecord): { row: EntryRow; reused: boolean } {
  const { records, reused } = appendLedger(row.processing, record)
  return { row: { ...row, processing: records }, reused }
}

/** 登记一条草稿（采集岗可操作）。 */
export function createDraft(
  patch: { station: string; sampledAt: string; sampler: string } & BackfillPatch,
  ctx: OperatorContext,
): ActionResult & { id?: number } {
  const rows = snapshot()
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id) ?? 0), 0) + 1
  const row: EntryRow = reconcileSediment({
    id,
    status: SEDIMENT_DRAFT_STATUS,
    pending: true,
    abnormal: false,
    [SEDIMENT_FIELDS.code]: `SEDI-${String(id).padStart(4, '0')}`,
    [SEDIMENT_FIELDS.station]: patch.station,
    [SEDIMENT_FIELDS.sampledAt]: patch.sampledAt,
    [SEDIMENT_FIELDS.sampler]: patch.sampler,
    [SEDIMENT_FIELDS.concentration]: patch.concentration ?? '',
    [SEDIMENT_FIELDS.discharge]: patch.discharge ?? '',
    [SEDIMENT_FIELDS.gradation]: patch.gradation ?? '',
    [SEDIMENT_FIELDS.statusText]: SEDIMENT_DRAFT_STATUS,
  })
  const stamped = ledger(row, {
    action: '登记草稿',
    at: nowStamp(),
    operator: ctx.operator,
  }).row
  rows.push(stamped)
  commit(rows)
  return { ok: true, message: `草稿 ${(stamped[SEDIMENT_FIELDS.code] as string) ?? id} 已登记`, id }
}

/** 提交审核：只允许草稿/已采集送审；重复提交沿用首次台账。 */
export function submitForReview(id: number, ctx: OperatorContext): ActionResult {
  const rows = snapshot()
  const target = findRow(rows, id)
  if (!target) {
    return { ok: false, message: `没有找到编号为 ${id} 的泥沙监测记录` }
  }
  if (target.status === '待审核') {
    return { ok: false, message: '该记录已在审核队列，重复提交沿用首次送审记录' }
  }
  if (!['草稿', '已采集'].includes(String(target.status))) {
    return { ok: false, message: `当前状态「${target.status}」不能提交审核` }
  }
  const blocking = evaluateSediment(target).blocking
  if (blocking.length > 0) {
    return {
      ok: false,
      message: `关键字段缺测，不能送审：${blocking.map((tag) => tag.label).join('、')}`,
    }
  }
  const { row, reused } = ledger(
    { ...target, status: '待审核', [SEDIMENT_FIELDS.statusText]: '待审核' },
    { action: '提交审核', at: nowStamp(), operator: ctx.operator },
  )
  rows[rows.indexOf(target)] = reconcileSediment(row)
  commit(rows)
  return {
    ok: true,
    message: reused ? '重复提交已沿用首次送审记录' : '已提交审核',
  }
}

/**
 * 越权闸门：补录历史缺测字段仅限复核岗。补录只填空字段，已有原值（含 0）不动；
 * legacy 标记在字段补齐后解除，补录写台账（不同字段补录是不同动作，各留一条）。
 */
export function backfillRecord(
  id: number,
  patch: BackfillPatch,
  ctx: OperatorContext,
): ActionResult {
  if (!ctx.can('sediment:backfill')) {
    return { ok: false, message: '越权操作被拒绝：补录仅限人工复核岗，值班员无权补录' }
  }
  const rows = snapshot()
  const target = findRow(rows, id)
  if (!target) {
    return { ok: false, message: `没有找到编号为 ${id} 的泥沙监测记录` }
  }
  const mapping = {
    concentration: SEDIMENT_FIELDS.concentration,
    discharge: SEDIMENT_FIELDS.discharge,
    gradation: SEDIMENT_FIELDS.gradation,
  } as const

  const next: EntryRow = { ...target }
  const filled: string[] = []
  for (const key of Object.keys(mapping) as (keyof BackfillPatch)[]) {
    const field = mapping[key]
    const value = patch[key]
    if (value === undefined || String(value).trim() === '') {
      continue
    }
    if (target[field] !== undefined && target[field] !== '' && target[field] !== null) {
      // 历史缺失字段按原值兼容：已有值（哪怕是 0）绝不被补录覆盖。
      continue
    }
    next[field] = key === 'gradation' ? String(value).trim() : Number(value)
    filled.push(field)
  }
  if (filled.length === 0) {
    return { ok: false, message: '没有可补录的空缺字段（已有原值保持不变）' }
  }
  // 全部缺失补齐后再解除历史兼容标记。
  const stillMissing = [
    SEDIMENT_FIELDS.concentration,
    SEDIMENT_FIELDS.discharge,
    SEDIMENT_FIELDS.gradation,
  ].some((field) => next[field] === '' || next[field] === undefined || next[field] === null)
  if (!stillMissing) {
    next.legacy = false
  }
  const stamped = ledger(next, {
    action: `补录${filled.join('、')}`,
    at: nowStamp(),
    operator: ctx.operator,
    note: '历史缺失字段按原值兼容，仅补空缺',
  }).row
  rows[rows.indexOf(target)] = reconcileSediment(stamped)
  commit(rows)
  return { ok: true, message: `补录完成：${filled.join('、')}` }
}

/**
 * 人工复核覆盖：复核岗可将带自动异常的记录直接确认为「已通过」，
 * 系统判定让位于人工终态（reviewCleared），并留痕。
 */
export function manualClear(id: number, ctx: OperatorContext): ActionResult {
  if (!ctx.can('sediment:manual-review')) {
    return { ok: false, message: '越权操作被拒绝：人工复核仅限复核岗' }
  }
  const rows = snapshot()
  const target = findRow(rows, id)
  if (!target) {
    return { ok: false, message: `没有找到编号为 ${id} 的泥沙监测记录` }
  }
  if (target.status === '已通过' && target.reviewCleared === true) {
    return { ok: false, message: '人工复核已确认，终态唯一，无需重复操作' }
  }
  const { row } = ledger(
    {
      ...target,
      status: '已通过',
      reviewCleared: true,
      abnormal: false,
      [SEDIMENT_FIELDS.statusText]: '已通过',
    },
    { action: '人工复核确认', at: nowStamp(), operator: ctx.operator, note: '人工终态覆盖系统自动异常' },
  )
  rows[rows.indexOf(target)] = reconcileSediment(row)
  commit(rows)
  return { ok: true, message: '人工复核已确认，自动异常标记已解除' }
}

export type BatchDecision = 'approve' | 'reject'

let batchInFlight = false

/**
 * 批量并发审核。
 * 互斥：已有批次进行中时，后来的并发批次立即拒绝（终态只接受一个批次写入）。
 * 原子：全量预校验，全部满足才统一落库；任一条不满足则整批回退、无部分写入。
 */
export function reviewBatch(
  ids: number[],
  decision: BatchDecision,
  ctx: OperatorContext,
): ActionResult {
  if (batchInFlight) {
    return { ok: false, message: '并发冲突：已有审核批次正在提交，本批未受理（每批只接受一个终态）' }
  }
  const uniqueIds = [...new Set(ids.map(Number))]
  if (uniqueIds.length === 0) {
    return { ok: false, message: '请先勾选需要审核的记录' }
  }
  batchInFlight = true
  try {
    const rows = snapshot()
    const targets = uniqueIds.map((id) => ({ id, row: findRow(rows, id) }))
    const missing = targets.filter((item) => !item.row).map((item) => item.id)
    if (missing.length > 0) {
      return { ok: false, message: `审核失败，整批回退：记录 ${missing.join('、')} 不存在` }
    }

    // 全量预校验：只受理待审核；通过还要求没有阻断类缺测。
    for (const item of targets) {
      const row = item.row as EntryRow
      if (row.status !== '待审核') {
        return {
          ok: false,
          message: `审核失败，整批回退：${row[SEDIMENT_FIELDS.code] ?? item.id} 当前为「${row.status}」，不在待审核状态`,
        }
      }
      if (decision === 'approve' && evaluateSediment(row).blocking.length > 0) {
        const labels = evaluateSediment(row).blocking.map((tag) => tag.label).join('、')
        return {
          ok: false,
          message: `审核失败，整批回退：${row[SEDIMENT_FIELDS.code] ?? item.id} 存在「${labels}」，请先补录或转人工复核`,
        }
      }
    }

    // 全部通过预校验后才在副本上统一变更，一次性提交。
    const next = rows.map((row) => {
      if (!uniqueIds.includes(Number(row.id))) {
        return row
      }
      const targetStatus = decision === 'approve' ? '已通过' : '异常值'
      const updated: EntryRow =
        decision === 'approve'
          ? { ...row, status: targetStatus, [SEDIMENT_FIELDS.statusText]: targetStatus }
          : { ...row, status: targetStatus, [SEDIMENT_FIELDS.statusText]: targetStatus }
      const stamped = ledger(updated, {
        action: decision === 'approve' ? '批量通过' : '批量标记异常',
        at: nowStamp(),
        operator: ctx.operator,
        note: `批量审核 ${uniqueIds.length} 条之一`,
      }).row
      return reconcileSediment(stamped)
    })
    commit(next)
    return {
      ok: true,
      message:
        decision === 'approve'
          ? `批量通过 ${uniqueIds.length} 条，终态已统一`
          : `批量标记异常 ${uniqueIds.length} 条，整批完成`,
    }
  } finally {
    batchInFlight = false
  }
}

export function isBatchBusy(): boolean {
  return batchInFlight
}

/** 测试钩子：模拟并发批次占用（生产代码不调用）。 */
export function __setBatchBusyForTest(value: boolean): void {
  batchInFlight = value
}
