import { SEED_ROWS } from './seed'
import { reconcileSediment, SEDIMENT_KEY } from './sediment-rules'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
// v2：存储结构带版本号。v1 把「异常」当成数据的一部分固化在本地，修正判定后旧标记
// 仍随缓存复活，表现为「刷新后结果仍对不上」。v2 迁移时泥沙模块的派生标记一律按
// 原始字段重算，旧快照不再有发言权；其他模块沿用原值。
const STORAGE_KEY = 'hydrology-monitor-station:entries'
const STORE_VERSION = 2

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function baseline(): Record<string, EntryRow[]> {
  // 基线种子同样过一遍派生，保证首次播种就与规则一致。
  const seeded = clone(SEED_ROWS)
  if (Array.isArray(seeded[SEDIMENT_KEY])) {
    seeded[SEDIMENT_KEY] = seeded[SEDIMENT_KEY].map(reconcileSediment)
  }
  return seeded
}

type StoredShape =
  | { version: 2; rows: Record<string, EntryRow[]> }
  | Record<string, EntryRow[]>

function migrate(raw: string): { rows: Record<string, EntryRow[]>; upgraded: boolean } {
  const parsed = JSON.parse(raw) as StoredShape
  // v2：直接采用，结构完整才信任。
  if (
    parsed &&
    typeof parsed === 'object' &&
    (parsed as { version?: number }).version === 2 &&
    (parsed as { rows?: unknown }).rows
  ) {
    const rows = (parsed as { rows: Record<string, EntryRow[]> }).rows
    const fallback = baseline()
    return { rows: { ...fallback, ...rows }, upgraded: false }
  }

  // v1（或更旧）：按模块合并。非泥沙模块保持原值，做到历史字段按原值兼容；
  // 泥沙模块以旧 id 为锚合并，保留人工台账/状态，异常与待办标记重算。
  const legacy = parsed as Record<string, EntryRow[]>
  const fallback = baseline()
  const merged: Record<string, EntryRow[]> = {}
  for (const key of Object.keys(fallback)) {
    if (!Array.isArray(legacy[key])) {
      merged[key] = fallback[key]
      continue
    }
    if (key !== SEDIMENT_KEY) {
      merged[key] = clone(legacy[key])
      continue
    }
    merged[key] = fallback[key].map((fresh) => {
      const old = legacy[key].find((candidate) => Number(candidate.id) === Number(fresh.id))
      if (!old) {
        return fresh
      }
      // 原始测量字段一律以种子（已修正的零值/空值语义）为准；只保留人工处理痕迹。
      return reconcileSediment({
        ...fresh,
        status: old.status ?? fresh.status,
        processing: Array.isArray(old.processing) ? old.processing : fresh.processing,
        reviewCleared:
          typeof old.reviewCleared === 'boolean' ? old.reviewCleared : fresh.reviewCleared,
        legacy: fresh.legacy ?? old.legacy ?? false,
      })
    })
  }
  return { rows: merged, upgraded: true }
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = baseline()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    persist(fallback)
    return fallback
  }
  try {
    const { rows: migratedRows, upgraded } = migrate(raw)
    // 旧版数据迁移成功后立即以 v2 结构回写：只迁移一次，刷新不再走兼容路径。
    if (upgraded) {
      persist(migratedRows)
    }
    return migratedRows
  } catch {
    // 结构损坏：回退基线，避免半截数据让页面持续对不上。
    persist(fallback)
    return fallback
  }
}

function persist(rows: Record<string, EntryRow[]>): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: STORE_VERSION, rows }),
    )
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

/** 整表提交：批量流程先在副本上完成全部变更，成功才一次性落库（原子提交）。 */
export function commitAll(next: Record<string, EntryRow[]>): void {
  cache = next
  persist(next)
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  commitAll(next)
}

export function resetRows(key: string): EntryRow[] {
  const rows = baseline()[key] ?? []
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
