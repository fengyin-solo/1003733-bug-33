/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

/** 处理台账记录：每个动作在记录上留痕，重复提交沿用首次记录，不再新增。 */
export type ProcessRecord = {
  action: string
  at: string
  operator: string
  note?: string
}

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  /** 人工处理台账（提交、审核、补录、复核都写这里）。 */
  processing?: ProcessRecord[]
  /** 历史迁移记录：早期入库时字段就缺失，按原值兼容、不重复计异常。 */
  legacy?: boolean
  /** 人工复核已覆盖系统自动异常，以人工终态为准。 */
  reviewCleared?: boolean
  [field: string]: unknown
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
