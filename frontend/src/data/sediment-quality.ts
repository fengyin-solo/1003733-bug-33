import type {
  QualityIssue,
  SedimentRow,
  SedimentViewRow,
} from './sediment-types'

/**
 * 唯一的「缺测」判定原语 —— 三个入口（列表/详情/设备入口）与所有派生统计都走这里。
 *
 * 关键约定：0 是合法实测值（清水期含沙量为零），绝不能当缺测。
 * 只有缺键、null、undefined、空串或历史占位文本「缺测」才算缺测。
 */
export function isMissing(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true
  }
  if (typeof value === 'number') {
    return Number.isNaN(value)
  }
  const text = String(value).trim()
  return text === '' || text === '缺测'
}

/** 读端展示：缺测统一显「缺测」，0 原样显示 0，其余按原值。 */
export function displayValue(value: unknown): string {
  if (typeof value === 'number') {
    return String(value)
  }
  return isMissing(value) ? '缺测' : String(value)
}

/**
 * 评估一条泥沙记录的质量问题，输出去重后的问题清单。
 * - 含沙量缺测：无法判断本次采样是否有效。
 * - 输沙率缺测：单项缺测，列表与详情各只报一次。
 * - 颗粒级配缺失：仅在含沙量 > 0 时才算异常；清水样（含沙量为 0）测不出级配属正常，不报。
 */
export function evaluateIssues(row: SedimentRow): QualityIssue[] {
  const issues: QualityIssue[] = []
  const concentrationMissing = isMissing(row['含沙量'])
  if (concentrationMissing) {
    issues.push('含沙量缺测')
  }
  if (isMissing(row['输沙率'])) {
    issues.push('输沙率缺测')
  }
  if (isMissing(row['颗粒级配']) && !concentrationMissing && Number(row['含沙量']) > 0) {
    issues.push('颗粒级配缺失')
  }
  // 去重保险：同一条记录上同一问题只保留一次（历史修复「重复显示异常」）。
  return [...new Set(issues)]
}

/**
 * 人工复核可以覆盖展示层结论，但不改原始观测值：
 * - 复核为正常：即使存在缺测项，也只标记为「人工复核正常」，不再飘红。
 * - 复核为异常：强制异常终态。
 * 覆盖结果落在记录字段里、随版本保存；原始字段一律不动。
 */
export function toViewRow(row: SedimentRow): SedimentViewRow {
  const issues = evaluateIssues(row)
  let quality: SedimentViewRow['quality']
  if (row.manualFlag === '正常') {
    quality = '人工复核正常'
  } else if (row.manualFlag === '异常') {
    quality = '异常'
  } else if (issues.length > 0) {
    // 颗粒级配缺失属数据异常；纯缺测项单独成类，便于区分补录与复核。
    quality = issues.includes('颗粒级配缺失') ? '异常' : '缺测'
  } else {
    quality = '正常'
  }
  return {
    ...row,
    issues,
    quality,
    display: {
      '含沙量': displayValue(row['含沙量']),
      '输沙率': displayValue(row['输沙率']),
      '颗粒级配': displayValue(row['颗粒级配']),
      '采样人': displayValue(row['采样人']),
    },
  }
}

export function isAbnormal(row: SedimentViewRow): boolean {
  return row.quality === '异常'
}
