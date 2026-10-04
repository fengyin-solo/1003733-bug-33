import type { EntryRow, ProcessRecord } from './types'

/**
 * 泥沙异常判定规则（共享、纯函数、只读）。
 *
 * 共同起始根因在此收口：旧链路用「真值」判断字段是否缺测，0（含沙量合法的零值）
 * 与 '' / null / undefined 同为 falsy，被一起当成缺测；而且异常标记是写进行数据再
 * 持久化的副作用，每评估一次就追加一遍，刷新后旧标记又随 localStorage 复活。
 *
 * 规则：
 *  - 判定一律走 hasValue / isMissing：0、'0'、'0.000' 都是「有值」，只有空串、
 *    null、undefined、纯空白才算缺测；含沙量为 0 是合法实测值（清水中实测零）。
 *  - 本模块只读取原始字段派生异常，绝不写库，也绝不累积标记；多次调用结果一致，
 *    从根上杜绝「颗粒级配缺失被重复显示异常」与「刷新后对不上」。
 *  - legacy 行（历史迁移时字段就缺失）按原值兼容：缺字段只提示「历史缺测」，
 *    不计入异常，不阻断流程。
 *  - reviewCleared：人工复核已确认，覆盖系统自动判定，以人工终态为准。
 */

export const SEDIMENT_KEY = 'sediment'

export const SEDIMENT_FIELDS = {
  code: '记录编号',
  station: '站点编号',
  sampledAt: '采样时间',
  concentration: '含沙量',
  discharge: '输沙率',
  gradation: '颗粒级配',
  sampler: '采样人',
  statusText: '记录状态',
} as const

/** 判定异常时阻断审核的严重标记；提示类标记不阻断。 */
export type Severity = 'blocking' | 'info'

export type SedimentTag = {
  code:
    | 'concentration-missing'
    | 'discharge-missing'
    | 'gradation-missing'
    | 'history-missing'
    | 'review-cleared'
  label: string
  severity: Severity
}

export type SedimentEvaluation = {
  row: EntryRow
  tags: SedimentTag[]
  blocking: SedimentTag[]
  /** 行是否处于异常态：异常值状态，或存在阻断类自动异常（且未被人工复核覆盖）。 */
  abnormal: boolean
  pending: boolean
}

const TERMINAL_STATUSES = ['已通过', '异常值']
export const SEDIMENT_DRAFT_STATUS = '草稿'

/** 字段是否「有值」：0 是合法实测值，绝不能按缺测处理。 */
export function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false
  }
  if (typeof value === 'number') {
    return !Number.isNaN(value)
  }
  return String(value).trim() !== ''
}

export function isMissing(value: unknown): boolean {
  return !hasValue(value)
}

/** 解析数值；空值返回 null（与 0 严格区分）。无法解析同样返回 null。 */
export function parseNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isNaN(value) ? null : value
  }
  if (!hasValue(value)) {
    return null
  }
  const parsed = Number(String(value).trim())
  return Number.isNaN(parsed) ? null : parsed
}

/** 展示用文本：0 正常显示；缺测显示「缺测」，历史缺失另带标签说明。 */
export function formatCell(value: unknown, unit = ''): string {
  if (isMissing(value)) {
    return '缺测'
  }
  return `${String(value).trim()}${unit}`
}

function uniqueTags(tags: SedimentTag[]): SedimentTag[] {
  const seen = new Set<string>()
  return tags.filter((tag) => {
    if (seen.has(tag.code)) {
      return false
    }
    seen.add(tag.code)
    return true
  })
}

// 纯函数 + 按对象引用缓存：同一行对象在一次渲染周期内只算一次，结果稳定可复现。
const cache = new WeakMap<EntryRow, SedimentEvaluation>()

export function evaluateSediment(row: EntryRow): SedimentEvaluation {
  const hit = cache.get(row)
  if (hit) {
    return hit
  }

  const tags: SedimentTag[] = []
  const concentrationMissing = isMissing(row[SEDIMENT_FIELDS.concentration])
  const dischargeMissing = isMissing(row[SEDIMENT_FIELDS.discharge])
  const gradationMissing = isMissing(row[SEDIMENT_FIELDS.gradation])
  const anyMissing = concentrationMissing || dischargeMissing || gradationMissing
  const legacy = row.legacy === true

  if (concentrationMissing) {
    tags.push({
      code: 'concentration-missing',
      label: legacy ? '含沙量历史缺测' : '含沙量缺测',
      severity: legacy ? 'info' : 'blocking',
    })
  }
  if (dischargeMissing) {
    tags.push({
      code: 'discharge-missing',
      label: legacy ? '输沙率历史缺测' : '输沙率缺测',
      severity: legacy ? 'info' : 'blocking',
    })
  }
  if (gradationMissing) {
    tags.push({
      code: 'gradation-missing',
      label: legacy ? '颗粒级配历史缺测' : '颗粒级配缺失',
      severity: legacy ? 'info' : 'blocking',
    })
  }
  if (legacy && anyMissing) {
    tags.push({ code: 'history-missing', label: '历史数据·按原值兼容', severity: 'info' })
  }
  if (row.reviewCleared === true) {
    tags.push({ code: 'review-cleared', label: '人工复核已确认', severity: 'info' })
  }

  const blocking = uniqueTags(tags).filter((tag) => tag.severity === 'blocking')
  const manualOverride = row.reviewCleared === true
  const abnormal =
    !manualOverride && (String(row.status) === '异常值' || blocking.length > 0)
  const pending =
    !TERMINAL_STATUSES.includes(String(row.status)) && !manualOverride

  const result: SedimentEvaluation = {
    row,
    tags: uniqueTags(tags),
    blocking,
    abnormal,
    pending,
  }
  cache.set(row, result)
  return result
}

/** 台账首次留痕：同一动作只保留首次记录，重复提交沿用首次结果（幂等）。 */
export function appendLedger(
  existing: ProcessRecord[] | undefined,
  record: ProcessRecord,
): { records: ProcessRecord[]; reused: boolean } {
  const records = Array.isArray(existing) ? [...existing] : []
  const first = records.find((item) => item.action === record.action)
  if (first) {
    return { records, reused: true }
  }
  records.push(record)
  return { records, reused: false }
}

export function nowStamp(): string {
  const date = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/**
 * 据原始字段与处理结果重算一条泥沙记录的派生标记（abnormal / pending）。
 * 派生值永不信任历史快照，保证刷新前后一致。
 */
export function reconcileSediment(row: EntryRow): EntryRow {
  const evaluation = evaluateSediment(row)
  return { ...row, abnormal: evaluation.abnormal, pending: evaluation.pending }
}
