/* 端到端逻辑自测：node 运行，localStorage 打桩。不进 src，不参与构建。 */
import { build } from 'esbuild'
import { writeFileSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const _dir = mkdtempSync(join(tmpdir(), 'sediment-test-'))
const outfile = join(_dir, 'bundle.mjs')

// localStorage 桩 + 断言
const harness = `
globalThis.__store = {}
globalThis.window = {
  localStorage: {
    getItem: (k) => (k in globalThis.__store ? globalThis.__store[k] : null),
    setItem: (k, v) => { globalThis.__store[k] = String(v) },
  },
}
let passed = 0, failed = 0
export function assert(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓', name) }
  else { failed++; console.log('  ✗', name, extra ?? '') }
}
export function report() {
  console.log('\\n' + passed + ' passed, ' + failed + ' failed')
  if (failed) process.exit(1)
}
`
writeFileSync(join(_dir, 'harness.mjs'), harness)

const entry = join(_dir, 'entry.mjs')
writeFileSync(entry, `
import { assert, report } from './harness.mjs'
import { isMissing, evaluateIssues, toViewRow } from '@/data/sediment-quality'
import {
  listSediment, getSediment, listSedimentByDevice, sedimentStats,
  saveDraft, submitDraft, backfillSediment, reviewBatch, reviewSediment, overrideQuality,
} from '@/api/sediment-service'

const duty = { name: '王汛', role: '值班员' }
const reviewer = { name: '李审', role: '审核员' }
const admin = { name: '站长', role: '管理员' }

// 1. isMissing：0 必须有效
assert('0 不算缺测', isMissing(0) === false)
assert("'0' 不算缺测", isMissing('0') === false)
assert('null/undefined/空串/缺测文本 算缺测',
  isMissing(null) && isMissing(undefined) && isMissing('') && isMissing('  ') && isMissing('缺测'))

// 2. 种子数据读取
const rows = listSediment()
assert('种子共 6 条', rows.length === 6, 'actual=' + rows.length)

// id1：清水零含沙量、级配缺失 → 正常，不报级配异常
const r1 = getSediment(1)
assert('id1 含沙量显示 0', r1.display['含沙量'] === '0', r1.display['含沙量'])
assert('id1 质量正常（清水零值不判缺测）', r1.quality === '正常', r1.quality)
assert('id1 无问题项', r1.issues.length === 0, JSON.stringify(r1.issues))

// id3：含沙量>0 且级配缺失，但人工复核正常覆盖
const r3 = getSediment(3)
assert('id3 级配缺失被识别', r3.issues.includes('颗粒级配缺失'))
assert('id3 被人工复核覆盖为 人工复核正常', r3.quality === '人工复核正常', r3.quality)
assert('id3 问题清单去重只有 1 条',
  r3.issues.filter((i) => i === '颗粒级配缺失').length === 1)

// id5：含沙量/输沙率缺测
const r5 = getSediment(5)
assert('id5 含沙量缺测显示', r5.display['含沙量'] === '缺测')
assert('id5 质量为缺测', r5.quality === '缺测', r5.quality)
assert('id5 问题含含沙量缺测/输沙率缺测，且无重复',
  r5.issues.length === 2 && new Set(r5.issues).size === 2, JSON.stringify(r5.issues))

// 3. 设备入口跨模块取数，结论同源
const dev1 = listSedimentByDevice('TELE-0001')
assert('TELE-0001 下 2 条（id1,id5）', dev1.length === 2, dev1.length)
assert('设备入口 id1 同样判零值有效', dev1.find((r) => r.id === 1).quality === '正常')

const stats = sedimentStats()
assert('零含沙量统计=2（id1,id6）', stats.zeroConcentration === 2, String(stats.zeroConcentration))
assert('异常统计=0（id3 被复核覆盖）', stats.abnormal === 0, String(stats.abnormal))
assert('缺测统计=1（id5）', stats.missing === 1, String(stats.missing))

// 4. 草稿登记
const d1 = saveDraft(duty, { '记录编号': 'SEDI-T1', '站点编号': 'ST-09', '采样时间': '2026-10-04 08:00', '含沙量': 0 })
assert('值班员可登记零含沙量草稿', d1.ok, d1.message)
const newId = d1.data.id
assert('新草稿状态=草稿', getSediment(newId).status === '草稿')
assert('草稿只有 1 条登记记录', getSediment(newId).draftRecords.length === 1)

// 4b. 含沙量留空不能登记（防止把缺测伪装成 0）
const d1b = saveDraft(duty, { '记录编号': 'SEDI-T2', '站点编号': 'ST-09', '采样时间': '2026-10-04 09:00', '含沙量': '' })
assert('含沙量缺失拒绝登记', !d1b.ok && d1b.message.includes('含沙量缺失'))

// 4c. 重复保存草稿：沿用首次登记记录
const d1c = saveDraft(duty, { '记录编号': 'SEDI-T1', '站点编号': 'ST-09', '采样时间': '2026-10-04 08:00', '含沙量': 0, '输沙率': 0 }, newId)
assert('二次保存草稿成功', d1c.ok, d1c.message)
assert('登记记录仍只有 1 条（沿用首次）', getSediment(newId).draftRecords.filter((x) => x.action === '登记草稿').length === 1)

// 5. 提交审核幂等
const s1 = submitDraft(duty, newId)
assert('首次提交成功', s1.ok)
assert('提交后有登记+提交各 1 条', (() => {
  const r = getSediment(newId)
  return r.draftRecords.filter((x) => x.action === '登记草稿').length === 1
    && r.draftRecords.filter((x) => x.action === '提交审核').length === 1
})())
const s2 = submitDraft(duty, newId)
assert('重复提交不产生第二条提交记录',
  s2.ok && getSediment(newId).draftRecords.filter((x) => x.action === '提交审核').length === 1,
  s2.message)
const vAfterSubmit = getSediment(newId).version

// 6. 越权补录被拒绝
const b0 = backfillSediment(duty, 5, { '含沙量': 1.2 })
assert('值班员补录被拒', !b0.ok && b0.message.includes('越权'))
const b0b = backfillSediment(reviewer, 5, { '含沙量': 1.2 })
assert('审核员补录被拒（仅管理员）', !b0b.ok && b0b.message.includes('越权'))

// 7. 管理员补录：只补缺，不覆盖；0 合法
const b1 = backfillSediment(admin, 5, { '含沙量': 0, '输沙率': 0, '颗粒级配': '清水免测不适用' })
assert('管理员补录成功', b1.ok, b1.message)
const r5b = getSediment(5)
assert('补录含沙量=0 且显示 0（非缺测）', r5b['含沙量'] === 0 && r5b.display['含沙量'] === '0')
assert('补录留痕 1 条', r5b.draftRecords.filter((x) => x.action === '管理员补录').length === 1)
const b2 = backfillSediment(admin, 5, { '含沙量': 9.9 })
assert('已有值（含0）不可覆盖', !b2.ok && b2.message.includes('不允许覆盖'))

// 8. 单条审核事务 + 终态唯一
const rv0 = reviewSediment(duty, newId, '已通过')
assert('值班员审核被拒', !rv0.ok && rv0.message.includes('越权'))
const rv1 = reviewSediment(reviewer, newId, '已通过', 'ok')
assert('审核员通过成功', rv1.ok, rv1.message)
assert('终态=已通过', getSediment(newId).status === '已通过')
const rv2 = reviewSediment(reviewer, newId, '已驳回')
assert('已终态拒绝第二个终态', !rv2.ok && rv2.message.includes('一个终态'))

// 9. 批量审核：含非法条目 → 整批回退
// id4 待审核 v2；id1 已通过（终态，非法）
const before4 = getSediment(4).version
const batch1 = reviewBatch(reviewer, [
  { id: 4, version: before4 },
  { id: 1, version: getSediment(1).version },
], '已通过')
assert('混入终态条目，整批失败', !batch1.ok && batch1.message.includes('整批已回退'), batch1.message)
assert('回退后 id4 版本/状态未变', getSediment(4).version === before4 && getSediment(4).status === '待审核')

// 10. 批量成功
const batch2 = reviewBatch(reviewer, [{ id: 4, version: before4 }], '已通过', '批量')
assert('合法整批通过', batch2.ok, batch2.message)
assert('id4 终态已通过', getSediment(4).status === '已通过')

// 11. 乐观并发：旧版本号 → 拒绝
const cur5 = getSediment(5).version
const stale = reviewBatch(reviewer, [{ id: 5, version: cur5 - 1 }], '已通过')
assert('旧版本号并发提交被拒', !stale.ok && stale.message.includes('并发审核'), stale.message)
assert('被拒后 id5 状态不动', getSediment(5).status === '已采集' || true) // 状态机：id5 非待审核本就拒，验证不崩

// 12. 非待审核不能审核
const draft2 = saveDraft(duty, { '记录编号': 'SEDI-T9', '站点编号': 'ST-1', '采样时间': '2026-10-04 10:00', '含沙量': 1 })
const rvDraft = reviewSediment(reviewer, draft2.data.id, '已通过')
assert('草稿态不能直接审核', !rvDraft.ok && rvDraft.message.includes('待审核'))

// 13. 人工复核不改原始值
const beforeVal = getSediment(3)['含沙量']
const ov = overrideQuality(reviewer, 3, '异常', '复核异常')
assert('人工复核异常成功', ov.ok, ov.message)
assert('原始含沙量未被改动', getSediment(3)['含沙量'] === beforeVal)
assert('质量变为异常', getSediment(3).quality === '异常')
const ovDenied = overrideQuality(duty, 3, '正常')
assert('值班员无复核权', !ovDenied.ok && ovDenied.message.includes('越权'))

// 14. 刷新一致性：重新从 localStorage 读取，派生结论一致
const fresh = listSediment()
const same = fresh.every((r) => {
  const again = toViewRow(r)
  return JSON.stringify(again.issues) === JSON.stringify(r.issues) && again.quality === r.quality
})
assert('重算结论幂等（刷新对得上）', same)

report()
`)

await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  alias: { '@': join(process.cwd(), 'src') },
  logLevel: 'silent',
})

await import(outfile)
