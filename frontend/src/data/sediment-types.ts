/** 泥沙模块专用类型。原始记录走通用 EntryRow 存储，视图只消费派生后的 SedimentViewRow。 */

export type SedimentStatus = '草稿' | '待审核' | '已通过' | '已驳回'

/** 记录上的每一步处理痕迹。草稿阶段同一动作只保留首次那条，审核动作各一条。 */
export type SedimentRecord = {
  action: string
  actor: string
  at: string
  note?: string
}

/**
 * 泥沙监测原始记录。
 * - 含沙量/输沙率/颗粒级配缺键、null 或空串才表示缺测，0 是合法实测值（清水）。
 * - 历史数据可能缺「输沙率/颗粒级配/设备编号/采样人」等字段，按原值（缺测）兼容，不回填。
 */
export type SedimentRow = {
  id: number
  status: SedimentStatus
  version: number
  /** 草稿阶段的登记/提交痕迹；审核通过/驳回写到 reviewRecords。 */
  draftRecords: SedimentRecord[]
  reviewRecords: SedimentRecord[]
  manualFlag?: '正常' | '异常'
  '记录编号': string
  '站点编号': string
  '采样时间': string
  '含沙量': number | null
  '输沙率': number | null
  '颗粒级配': string | null
  '采样人': string | null
  '设备编号'?: string | null
  '备注'?: string | null
  [field: string]: unknown
}

export type QualityIssue =
  | '含沙量缺测'
  | '输沙率缺测'
  | '颗粒级配缺失'

/** 列表/详情/设备入口三处共用的派生行，派生字段永不入库。 */
export type SedimentViewRow = SedimentRow & {
  issues: QualityIssue[]
  /** 去重后的单一质量结论，供三个入口一致渲染。 */
  quality: '正常' | '缺测' | '异常' | '人工复核正常'
  display: {
    '含沙量': string
    '输沙率': string
    '颗粒级配': string
    '采样人': string
  }
}

export type ActorRole = '值班员' | '审核员' | '管理员'

export type Actor = { name: string; role: ActorRole }

export type ServiceResult<T = SedimentViewRow> = {
  ok: boolean
  message: string
  data?: T
}

export type DraftInput = {
  '记录编号': string
  '站点编号': string
  '采样时间': string
  '含沙量': string | number
  '输沙率'?: string | number | null
  '颗粒级配'?: string | null
  '采样人'?: string | null
  '设备编号'?: string | null
  '备注'?: string | null
}

export type BatchVerdict = '已通过' | '已驳回'

export type SedimentStats = {
  total: number
  missing: number
  abnormal: number
  pending: number
  draft: number
  zeroConcentration: number
}
