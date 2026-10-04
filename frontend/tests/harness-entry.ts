import { listRows, resetRows, storageKey } from '../src/data/local-store'
import { evaluateSediment, formatCell, SEDIMENT_KEY } from '../src/data/sediment-rules'
import {
  __setBatchBusyForTest,
  backfillRecord,
  isBatchBusy,
  manualClear as manualClearSvc,
  reviewBatch,
  submitForReview,
} from '../src/api/sediment-service'

const MODULE = SEDIMENT_KEY

function rows() {
  return listRows(MODULE)
}

export function sedimentRows() {
  return rows()
}

/** 同模块缓存内重新取行（单例未失效时的“重读”）。 */
export function sedimentRowsFresh() {
  return rows().map((r) => ({ ...r }))
}

export function sedimentRowsMigrated() {
  return rows()
}

export const evaluate = evaluateSediment
export const format = formatCell

export function backfill(
  id: number,
  patch: Parameters<typeof backfillRecord>[1],
  ctx: { operator: string; can: (p: string) => boolean },
) {
  return backfillRecord(id, patch, ctx)
}

export function submit(id: number, ctx: { operator: string; can: (p: string) => boolean }) {
  return submitForReview(id, ctx)
}

export function batch(
  ids: number[],
  decision: 'approve' | 'reject',
  ctx: { operator: string; can: (p: string) => boolean },
) {
  return reviewBatch(ids, decision, ctx)
}

export function manualClear(id: number, ctx: { operator: string; can: (p: string) => boolean }) {
  return manualClearSvc(id, ctx)
}

export function setBusy(v: boolean) {
  __setBatchBusyForTest(v)
}

export function batchConcurrentStart(
  ids: number[],
  decision: 'approve' | 'reject',
  ctx: { operator: string; can: (p: string) => boolean },
) {
  return reviewBatch(ids, decision, ctx)
}

export { resetRows, storageKey, isBatchBusy }
