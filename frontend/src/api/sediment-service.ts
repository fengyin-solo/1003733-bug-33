import { listRows, saveRows } from '@/data/local-store'
import { isMissing, toViewRow } from '@/data/sediment-quality'
import type {
  Actor,
  ActorRole,
  BatchVerdict,
  DraftInput,
  SedimentRecord,
  SedimentRow,
  SedimentStats,
  SedimentStatus,
  SedimentViewRow,
  ServiceResult,
} from '@/data/sediment-types'

const MODULE_KEY = 'sediment'
const TERMINAL_STATUSES: SedimentStatus[] = ['已通过', '已驳回']
const REVIEWER_ROLES: ActorRole[] = ['审核员', '管理员']

function nowText(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function load(): SedimentRow[] {
  // 历史数据可能没有 version/draftRecords 等字段：读取时按原值补默认结构，绝不回改原始观测字段。
  return listRows(MODULE_KEY).map((raw) => normalize(raw))
}

function normalize(raw: Record<string, unknown>): SedimentRow {
  return {
    ...(raw as SedimentRow),
    version: typeof raw.version === 'number' ? raw.version : 1,
    draftRecords: Array.isArray(raw.draftRecords) ? (raw.draftRecords as SedimentRecord[]) : [],
    reviewRecords: Array.isArray(raw.reviewRecords) ? (raw.reviewRecords as SedimentRecord[]) : [],
  }
}

function commit(rows: SedimentRow[]): void {
  // 仅一处落库出口；保存前数据保持原状（不写 issues/quality 等派生字段），刷新后由读端重算。
  // 泥沙行不带通用模块的 pending/abnormal 位，入库时按通用存储形状转换。
  saveRows(MODULE_KEY, rows as unknown as Parameters<typeof saveRows>[1])
}

function actorLabel(actor: Actor): string {
  return `${actor.role}·${actor.name}`
}

function assertRole(actor: Actor, roles: ActorRole[], verb: string): string | null {
  return roles.includes(actor.role)
    ? null
    : `越权操作已拒绝：${verb}需要${roles.join('或')}权限，当前身份「${actorLabel(actor)}」无权操作`
}

function nextId(rows: SedimentRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function parseNumber(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  const text = String(value ?? '').trim()
  return text === '' || text === '缺测' ? null : Number(text)
}

function findRow(rows: SedimentRow[], id: number): SedimentRow | undefined {
  return rows.find((row) => Number(row.id) === Number(id))
}

function mark(row: SedimentRecord, rows: SedimentRecord[], dedupe = true): SedimentRecord[] {
  // 每份草稿只留一条处理记录：同一动作（登记/提交）重复发生时沿用首次记录。
  if (dedupe && rows.some((item) => item.action === row.action)) {
    return rows
  }
  return [...rows, row]
}

/* -------------------------------- 读 -------------------------------- */

export function listSediment(filters: Record<string, string> = {}): SedimentViewRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  const view = load().map(toViewRow)
  if (pairs.length === 0) {
    return view
  }
  return view.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function getSediment(id: number): SedimentViewRow | null {
  const row = findRow(load(), id)
  return row ? toViewRow(row) : null
}

/** 设备入口跨模块取数：只按设备编号过滤，质量结论与列表/详情同源。 */
export function listSedimentByDevice(deviceId: string): SedimentViewRow[] {
  const key = deviceId.trim()
  return load()
    .filter((row) => String(row['设备编号'] ?? '') === key)
    .map(toViewRow)
}

export function sedimentStats(rows: SedimentViewRow[] = load().map(toViewRow)): SedimentStats {
  return {
    total: rows.length,
    missing: rows.filter((row) => row.quality === '缺测').length,
    abnormal: rows.filter((row) => row.quality === '异常').length,
    pending: rows.filter((row) => row.status === '待审核').length,
    draft: rows.filter((row) => row.status === '草稿').length,
    zeroConcentration: rows.filter((row) => row['含沙量'] === 0).length,
  }
}

/* -------------------------------- 草稿 -------------------------------- */

export function saveDraft(actor: Actor, input: DraftInput, id?: number): ServiceResult {
  const denied = assertRole(actor, ['值班员', '管理员'], '登记草稿')
  if (denied) {
    return { ok: false, message: denied }
  }
  if (isMissing(input['记录编号']) || isMissing(input['站点编号']) || isMissing(input['采样时间'])) {
    return { ok: false, message: '记录编号、站点编号、采样时间为必填项' }
  }
  const concentration = parseNumber(input['含沙量'])
  if (concentration === null) {
    // 登记时含沙量必须有值；确实没测到应走补录/复核，而不是悄悄存成 0。
    return { ok: false, message: '含沙量缺失，不能登记；如设备未上报请先核实再补录' }
  }

  const rows = load()
  const now = nowText()
  let target: SedimentRow
  if (id === undefined) {
    target = {
      id: nextId(rows),
      status: '草稿',
      version: 1,
      draftRecords: [],
      reviewRecords: [],
      '记录编号': String(input['记录编号']).trim(),
      '站点编号': String(input['站点编号']).trim(),
      '采样时间': String(input['采样时间']).trim(),
      '含沙量': concentration,
      '输沙率': parseNumber(input['输沙率'] ?? null),
      '颗粒级配': isMissing(input['颗粒级配']) ? null : String(input['颗粒级配']).trim(),
      '采样人': isMissing(input['采样人']) ? null : String(input['采样人']).trim(),
      '设备编号': isMissing(input['设备编号']) ? null : String(input['设备编号']).trim(),
      '备注': isMissing(input['备注']) ? null : String(input['备注']).trim(),
    }
    rows.push(target)
  } else {
    const existing = findRow(rows, id)
    if (!existing) {
      return { ok: false, message: `没有找到编号为 ${id} 的泥沙监测记录` }
    }
    if (TERMINAL_STATUSES.includes(existing.status)) {
      return { ok: false, message: `记录已是终态「${existing.status}」，不能再改草稿` }
    }
    target = existing
  }

  target['含沙量'] = concentration
  target['输沙率'] = parseNumber(input['输沙率'] ?? target['输沙率'])
  if (!isMissing(input['颗粒级配'])) {
    target['颗粒级配'] = String(input['颗粒级配']).trim()
  }
  if (!isMissing(input['采样人'])) {
    target['采样人'] = String(input['采样人']).trim()
  }
  if (!isMissing(input['设备编号'])) {
    target['设备编号'] = String(input['设备编号']).trim()
  }
  if (input['备注'] !== undefined) {
    target['备注'] = isMissing(input['备注']) ? null : String(input['备注']).trim()
  }
  target.version += 1
  target.draftRecords = mark(
    { action: '登记草稿', actor: actorLabel(actor), at: now },
    target.draftRecords,
  )
  commit(rows)
  return { ok: true, message: '草稿已保存（处理记录沿用首次登记）', data: toViewRow(target) }
}

export function submitDraft(actor: Actor, id: number): ServiceResult {
  const denied = assertRole(actor, ['值班员', '管理员'], '提交审核')
  if (denied) {
    return { ok: false, message: denied }
  }
  const rows = load()
  const row = findRow(rows, id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的泥沙监测记录` }
  }
  if (row.status === '待审核') {
    return { ok: true, message: '该记录已提交过，沿用首次提交记录，未重复登记' }
  }
  if (TERMINAL_STATUSES.includes(row.status)) {
    return { ok: false, message: `记录已是终态「${row.status}」，不能重复提交` }
  }
  row.status = '待审核'
  row.version += 1
  row.draftRecords = mark(
    { action: '提交审核', actor: actorLabel(actor), at: nowText() },
    row.draftRecords,
  )
  commit(rows)
  return { ok: true, message: '已提交审核', data: toViewRow(row) }
}

/* -------------------------------- 越权补录 -------------------------------- */

/**
 * 管理员补录历史缺测字段：
 * - 仅审核员/管理员可操作；
 * - 只填原值缺失（缺键/null/空串）的字段，已有值（含 0）一律不改；
 * - 原始观测值落库，留一条补录痕迹，version +1。
 */
export function backfillSediment(
  actor: Actor,
  id: number,
  patch: Partial<Pick<DraftInput, '含沙量' | '输沙率' | '颗粒级配'>>,
): ServiceResult {
  const denied = assertRole(actor, ['管理员'], '补录历史数据')
  if (denied) {
    return { ok: false, message: denied }
  }
  const rows = load()
  const row = findRow(rows, id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的泥沙监测记录` }
  }
  const fills: string[] = []
  if (patch['含沙量'] !== undefined && isMissing(row['含沙量'])) {
    const value = parseNumber(patch['含沙量'])
    if (value === null) {
      return { ok: false, message: '补录的含沙量必须是数值（0 也是合法值）' }
    }
    row['含沙量'] = value
    fills.push(`含沙量=${value}`)
  }
  if (patch['输沙率'] !== undefined && isMissing(row['输沙率'])) {
    const value = parseNumber(patch['输沙率'])
    if (value === null) {
      return { ok: false, message: '补录的输沙率必须是数值（0 也是合法值）' }
    }
    row['输沙率'] = value
    fills.push(`输沙率=${value}`)
  }
  if (patch['颗粒级配'] !== undefined && isMissing(row['颗粒级配'])) {
    if (isMissing(patch['颗粒级配'])) {
      return { ok: false, message: '补录的颗粒级配不能为空' }
    }
    row['颗粒级配'] = String(patch['颗粒级配']).trim()
    fills.push(`颗粒级配=${String(patch['颗粒级配']).trim()}`)
  }
  if (fills.length === 0) {
    return { ok: false, message: '没有可补录的缺测字段；已有原值（含 0）不允许覆盖' }
  }
  row.version += 1
  row.draftRecords = mark(
    { action: '管理员补录', actor: actorLabel(actor), at: nowText(), note: fills.join('，') },
    row.draftRecords,
  )
  commit(rows)
  return { ok: true, message: `补录完成：${fills.join('、')}`, data: toViewRow(row) }
}

/* --------------------------- 单条/批量审核（事务） --------------------------- */

function reviewOne(
  rows: SedimentRow[],
  id: number,
  expectedVersion: number,
  verdict: BatchVerdict,
  actor: Actor,
  note: string | undefined,
  now: string,
): string | null {
  const row = findRow(rows, id)
  if (!row) {
    return `编号 ${id} 不存在`
  }
  if (row.version !== expectedVersion) {
    // 乐观并发：同一批/另一会话已改过这条，拒绝制造第二个终态。
    return `编号 ${id} 版本已变化（期望 v${expectedVersion}，实际 v${row.version}），存在并发审核，请刷新后重试`
  }
  if (TERMINAL_STATUSES.includes(row.status)) {
    return `编号 ${id} 已为终态「${row.status}」，只接受一个终态`
  }
  if (row.status !== '待审核') {
    return `编号 ${id} 当前为「${row.status}」，不在待审核队列`
  }
  row.status = verdict
  row.version += 1
  row.reviewRecords = [
    ...row.reviewRecords,
    { action: verdict === '已通过' ? '审核通过' : '审核驳回', actor: actorLabel(actor), at: now, note },
  ]
  return null
}

/**
 * 批量审核：
 * 1) 先在副本上整批校验（权限、去重、版本、终态）；
 * 2) 任一条失败，整批回退，不写任何一条；
 * 3) 全部通过才一次性提交 —— 并发审核只接受一个终态。
 */
export function reviewBatch(
  actor: Actor,
  items: { id: number; version: number }[],
  verdict: BatchVerdict,
  note?: string,
): ServiceResult<SedimentViewRow[]> {
  const denied = assertRole(actor, REVIEWER_ROLES, '审核')
  if (denied) {
    return { ok: false, message: denied }
  }
  const ids = [...new Set(items.map((item) => item.id))]
  if (ids.length === 0) {
    return { ok: false, message: '请先勾选待审核记录' }
  }
  if (ids.length !== items.length) {
    return { ok: false, message: '同批内存在重复勾选，已整批拒绝' }
  }
  const working = load() // 独立副本：校验与写入都在它上面，失败直接丢弃、不落库 → 整批回退
  const now = nowText()
  for (const item of items) {
    const error = reviewOne(working, item.id, item.version, verdict, actor, note, now)
    if (error) {
      return { ok: false, message: `整批已回退：${error}` }
    }
  }
  commit(working)
  return {
    ok: true,
    message: `本批 ${items.length} 条已全部「${verdict}」`,
    data: ids.map((id) => toViewRow(findRow(working, id)!)),
  }
}

/** 单条审核走同一套事务路径，保证终态语义一致。 */
export function reviewSediment(
  actor: Actor,
  id: number,
  verdict: BatchVerdict,
  note?: string,
): ServiceResult {
  const row = findRow(load(), id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的泥沙监测记录` }
  }
  const result = reviewBatch(actor, [{ id, version: row.version }], verdict, note)
  return result.ok
    ? { ok: true, message: result.message, data: result.data?.[0] }
    : { ok: false, message: result.message }
}

/* -------------------------------- 人工复核 -------------------------------- */

/**
 * 人工复核覆盖质量展示（正常/异常），不碰原始观测值。
 * 决定开放：自动判定只负责提示，是否成立由审核人终判；覆盖留痕、version +1。
 */
export function overrideQuality(
  actor: Actor,
  id: number,
  flag: '正常' | '异常',
  note?: string,
): ServiceResult {
  const denied = assertRole(actor, REVIEWER_ROLES, '人工复核')
  if (denied) {
    return { ok: false, message: denied }
  }
  const rows = load()
  const row = findRow(rows, id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的泥沙监测记录` }
  }
  row.manualFlag = flag
  row.version += 1
  row.reviewRecords = [
    ...row.reviewRecords,
    { action: flag === '正常' ? '人工复核正常' : '人工复核异常', actor: actorLabel(actor), at: nowText(), note },
  ]
  commit(rows)
  return { ok: true, message: `人工复核：按${flag}处理（原始观测值未改动）`, data: toViewRow(row) }
}
