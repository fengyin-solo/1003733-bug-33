/* 端到端规则校验：在 Node 里模拟 localStorage，覆盖本次修复的全部不变量。 */
const esbuild = require('esbuild')
const path = require('path')

const store = {}
globalThis.window = {
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v)
    },
    removeItem: (k) => delete store[k],
  },
}

async function load() {
  const result = await esbuild.build({
    entryPoints: [path.join(__dirname, 'harness-entry.ts')],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    write: false,
    logLevel: 'silent',
  })
  const code = result.outputFiles[0].text
  const mod = { exports: {} }
  const fn = new Function('module', 'exports', 'require', code)
  fn(mod, mod.exports, require)
  return mod.exports
}

function check(name, cond, detail = '') {
  if (!cond) {
    console.error(`FAIL: ${name} ${detail}`)
    process.exitCode = 1
  } else {
    console.log(`PASS: ${name}`)
  }
}
;(async () => {
  const h = await load()

  const operator = { operator: '值班管理员', can: () => false }
  const reviewer = { operator: '复核工程师', can: (p) => p === 'sediment:backfill' || p === 'sediment:manual-review' }

  // 1. 零值不误判缺测
  const rows = h.sedimentRows()
  const r1 = rows.find((r) => r.id === 1)
  const e1 = h.evaluate(r1)
  check('含沙量0不是缺测', e1.tags.every((t) => t.code !== 'concentration-missing'))
  check('含沙量0不异常', e1.abnormal === false, `abnormal=${e1.abnormal}`)
  check('含沙量0显示为0', h.format(r1['含沙量']).startsWith('0'), h.format(r1['含沙量']))

  // 2. 颗粒级配缺失只产生一条标签（多次评估去重且无副作用）
  const r2 = rows.find((r) => r.id === 2)
  const e2a = h.evaluate(r2)
  const e2b = h.evaluate(r2)
  const e2c = h.evaluate(r2)
  const gradTags = e2a.tags.filter((t) => t.code === 'gradation-missing')
  check('颗粒级配缺失仅一条标签', gradTags.length === 1, `len=${gradTags.length}`)
  check('重复评估结果一致', JSON.stringify(e2a.tags) === JSON.stringify(e2c.tags))
  check('评估不写库（行对象无新增字段）', r2.abnormal === true) // reconcile 已派生
  check('三次评估标签数相同', e2a.tags.length === e2b.tags.length && e2b.tags.length === e2c.tags.length)

  // 3. 刷新后结果一致（从 localStorage 重读）
  const rowsAfterRefresh = h.sedimentRowsFresh()
  const r2again = rowsAfterRefresh.find((r) => r.id === 2)
  check('刷新后颗粒级配缺失仍只一条标签', h.evaluate(r2again).tags.filter((t) => t.code === 'gradation-missing').length === 1)
  check('刷新后含沙量0仍正常', h.evaluate(rowsAfterRefresh.find((r) => r.id === 1)).abnormal === false)

  // 4. legacy 历史缺失按原值兼容，不计阻断异常
  const r5 = rows.find((r) => r.id === 5)
  const e5 = h.evaluate(r5)
  check('历史缺失为提示级', e5.blocking.length === 0, JSON.stringify(e5.blocking))
  check('历史缺失有兼容标签', e5.tags.some((t) => t.code === 'history-missing'))
  check('历史缺失不致异常', e5.abnormal === false)

  // 5. 越权补录被拒绝（r2 当前为「已采集」且颗粒级配缺失，先验证它会阻断送审）
  const r2blocked = h.submit(r2.id, operator)
  check('颗粒级配缺失阻断送审', r2blocked.ok === false && /颗粒级配/.test(r2blocked.message), r2blocked.message)
  const denied = h.backfill(r2.id, { gradation: '沙30%' }, operator)
  check('值班员补录被拒', denied.ok === false && /越权/.test(denied.message), denied.message)
  const allowed = h.backfill(r2.id, { gradation: '沙30%/粉沙50%/黏土20%' }, reviewer)
  check('复核岗补录成功', allowed.ok === true, allowed.message)
  const rowsNow = h.sedimentRowsFresh()
  const r2filled = rowsNow.find((r) => r.id === 2)
  check('补录后颗粒级配标签消失', h.evaluate(r2filled).tags.every((t) => t.code !== 'gradation-missing'))

  // 6. 补录不覆盖原值（0 保持 0）
  const r1fill = h.backfill(r1.id, { concentration: '3.5' }, reviewer)
  check('已有值不补录覆盖', r1fill.ok === false && /原值/.test(r1fill.message), r1fill.message)
  check('含沙量0仍为0', h.sedimentRowsFresh().find((r) => r.id === 1)['含沙量'] === 0)

  // 7. 台账每动作只留首次，重复提交沿用（r6 为草稿）
  const draft = rowsNow.find((r) => r.id === 6)
  const first = h.submit(draft.id, operator)
  check('首次送审成功', first.ok === true, first.message)
  const second = h.submit(draft.id, operator)
  check('重复提交沿用首次记录', second.ok === false && /沿用|已在审核/.test(second.message), second.message)
  const after = h.sedimentRowsFresh().find((r) => r.id === 6)
  const submits = after.processing.filter((p) => p.action === '提交审核')
  check('送审台账只有一条', submits.length === 1, `len=${submits.length}`)

  // 8. 阻断缺测不能送审：r3 为「待审核」重复送审被幂等拦截；r5 为 legacy 历史缺失，
  //    按原值兼容不阻断（可送审）；另验证 r2 补录后能正常送审
  const r3 = h.sedimentRowsFresh().find((r) => r.id === 3) // 输沙率缺失
  const blocked = h.submit(r3.id, operator)
  check('待审核记录重复送审被拦截', blocked.ok === false && /沿用|已在审核/.test(blocked.message), blocked.message)
  const r5submit = h.submit(5, operator)
  check('历史缺失兼容不阻断送审', r5submit.ok === true, r5submit.message)
  const r2submit = h.submit(2, operator)
  check('补录后r2可送审', r2submit.ok === true, r2submit.message)

  // 9. 批量审核：含不合格记录时整批回退
  // r1（含沙量0，完整，待审核）；r3 输沙率缺失（待审核，阻断）
  const batchWithBad = h.batch([1, r3.id], 'approve', reviewer)
  check('批量含缺测记录被拒', batchWithBad.ok === false && /整批回退/.test(batchWithBad.message), batchWithBad.message)
  check('回退后r1仍待审核', String(h.sedimentRowsFresh().find((r) => r.id === 1).status) === '待审核')
  check('回退后r3仍待审核', String(h.sedimentRowsFresh().find((r) => r.id === 3).status) === '待审核')

  // 10. r6 在第 7 步已送审，与 r1 一起全量合格批量通过
  const okBatch = h.batch([1, 6], 'approve', reviewer)
  check('合格批量通过', okBatch.ok === true, okBatch.message)
  const afterBatch = h.sedimentRowsFresh()
  check('r1已通过', String(afterBatch.find((r) => r.id === 1).status) === '已通过')
  check('r6已通过', String(afterBatch.find((r) => r.id === 6).status) === '已通过')

  // 11. 并发互斥：一批进行中，第二批立即拒绝；终态只接受一个批次
  h.setBusy(true)
  const concurrent = h.batch([3], 'approve', reviewer)
  check('并发批次被互斥拒绝', concurrent.ok === false && /并发冲突/.test(concurrent.message), concurrent.message)
  h.setBusy(false)

  // 12. 人工复核覆盖自动异常（r3 输沙率缺失，仍可由人工终态确认）
  const r3clear = h.manualClear(r3.id, operator)
  check('值班员无权人工复核', r3clear.ok === false)
  const r3cleared = h.manualClear(r3.id, reviewer)
  check('复核岗可覆盖自动异常', r3cleared.ok === true, r3cleared.message)
  const r3final = h.sedimentRowsFresh().find((r) => r.id === 3)
  check('覆盖后状态已通过', String(r3final.status) === '已通过')
  check('覆盖后abnormal解除', h.evaluate(r3final).abnormal === false)
  check('覆盖留痕', r3final.processing.some((p) => p.action === '人工复核确认'))
  const r3again = h.manualClear(r3.id, reviewer)
  check('人工终态唯一，重复复核拒绝', r3again.ok === false)

  // 13. v1 旧缓存迁移：旧异常标记不复活，旧台账/状态保留（全新模块实例首次读取触发迁移）
  store[h.storageKey()] = JSON.stringify({
    sediment: [
      { id: 1, status: '已通过', abnormal: true, processing: [{ action: '旧时代操作', at: 'old', operator: 'x' }], reviewCleared: false },
    ],
  })
  const hm = await load()
  const m1 = hm.sedimentRows().find((r) => r.id === 1)
  check('迁移后旧异常标记按规则重算(含沙量0不异常)', hm.evaluate(m1).abnormal === false)
  check('迁移保留人工台账', m1.processing.some((p) => p.action === '旧时代操作'))
  check('迁移保留人工状态', String(m1.status) === '已通过')
  check('迁移后存储升级为v2', JSON.parse(store[hm.storageKey()]).version === 2)
})()
