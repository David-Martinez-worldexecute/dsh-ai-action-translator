/**
 * 学习练习册（lib/drill.js）的契约测试。
 *
 * 这块最该验的不是「文案对不对」，而是三条一旦破了就会撒谎的性质：
 *   1. 攒不够就不出卡（不出「还没发生的事」）；
 *   2. 出卡幂等（提示词可能一次组装多次，不能因此刷出三张重复卡）；
 *   3. 卡片只引用真实记过的动作（没有的绝不补）。
 *
 * 用真实模块，不打桩。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { DrillBook, DRILL_MIN, DRILL_MAX, DRILL_WINDOW, drillEveryOf } from '../lib/drill.js'

const row = (name, extra = {}) => ({ at: 1_700_000_000_000, name, classId: 'read', summary: 'x', isError: false, ...extra })

/* ───────────────────────── 参数收敛 ───────────────────────── */

test('drillEveryOf clamps to the documented range', () => {
  assert.equal(drillEveryOf(0), DRILL_MIN, '0 应被抬到下限')
  assert.equal(drillEveryOf(1), DRILL_MIN)
  assert.equal(drillEveryOf(3), 3)
  assert.equal(drillEveryOf(99), DRILL_MAX, '99 应被压到上限')
  assert.equal(drillEveryOf(2.7), 3, '小数应按四舍五入取整')
})

test('drillEveryOf falls back when the value is not a number', () => {
  assert.equal(drillEveryOf(undefined, 3), 3)
  assert.equal(drillEveryOf('abc', 4), 4)
  assert.equal(drillEveryOf(null, 5), 5)
})

/* ───────────────────────── 出卡时机 ───────────────────────── */

test('does not hand out a card before enough actions were recorded', () => {
  const book = new DrillBook(3)
  book.record(row('a'))
  book.record(row('b'))
  assert.equal(book.card('zh'), '', '只有 2 条时不该出卡')
  assert.equal(book.cards, 0)
  assert.equal(book.pending, 2)
})

test('hands out a card once enough actions piled up, and quotes only real ones', () => {
  const book = new DrillBook(3)
  book.record(row('read', { summary: '读 lib/index.js' }))
  book.record(row('grep', { summary: '搜 guardMode' }))
  book.record(row('edit', { summary: '改 lib/guard.js', isError: true }))

  const text = book.card('zh')
  assert.ok(text.includes('学习练习册'), '应带段落标题')
  assert.ok(text.includes('read'), '应列出真实动作 read')
  assert.ok(text.includes('grep'))
  assert.ok(text.includes('edit'))
  assert.ok(text.includes('（失败）'), '失败动作要标出来')
  assert.ok(text.includes('你看到了什么'))
  assert.ok(text.includes('你能复述的技术点'))
  assert.ok(text.includes('下一步练习'))
  assert.ok(text.includes('不要编'), '必须明确禁止编造没列出的动作')
  assert.equal(book.cards, 1)
})

test('cards are idempotent: assembling the prompt twice does not duplicate', () => {
  const book = new DrillBook(2)
  book.record(row('a'))
  book.record(row('b'))
  assert.notEqual(book.card('zh'), '')
  assert.equal(book.card('zh'), '', '同一水位第二次必须返回空串')
  assert.equal(book.cards, 1, '卡数不能因为重复组装而涨')
})

test('a later batch produces exactly one more card', () => {
  const book = new DrillBook(2)
  book.record(row('a'))
  book.record(row('b'))
  book.card('zh')
  book.record(row('c'))
  book.record(row('d'))
  assert.notEqual(book.card('zh'), '')
  assert.equal(book.cards, 2)
})

test('every can be changed at runtime and takes effect for the next card', () => {
  const book = new DrillBook(3)
  book.record(row('a'))
  book.record(row('b'))
  assert.equal(book.card('zh'), '')
  book.setEvery(2)
  assert.equal(book.every, 2)
  assert.notEqual(book.card('zh'), '', '把阈值降到 2 之后，攒着的两条就该出卡了')
})

/* ───────────────────────── 窗口与水位 ───────────────────────── */

test('the window keeps only the newest actions and never lets the watermark drift past them', () => {
  const book = new DrillBook(10)
  for (let i = 0; i < DRILL_WINDOW + 6; i += 1) book.record(row(`t${i}`))
  assert.equal(book.size, DRILL_WINDOW, `最多留 ${DRILL_WINDOW} 条`)
  assert.ok(book.pending >= 0, '水位不能超过实际条数')
  assert.ok(book.pending <= DRILL_WINDOW)
})

test('clear resets both the rows and the watermark', () => {
  const book = new DrillBook(2)
  book.record(row('a'))
  book.record(row('b'))
  book.card('zh')
  book.clear()
  assert.equal(book.size, 0)
  assert.equal(book.pending, 0)
})

/* ───────────────────────── 文案与标签 ───────────────────────── */

test('english cards use english wording', () => {
  const book = new DrillBook(2)
  book.record(row('read'))
  book.record(row('write'))
  const text = book.card('en')
  assert.ok(text.includes('Learning drill'))
  assert.ok(text.includes('What you saw'))
  assert.ok(text.includes('Next practice'))
  assert.ok(!text.includes('下一步练习'), '英文卡里不该混进中文小标题')
})

test('class labels come from the provided resolver, not from a hardcoded map', () => {
  const book = new DrillBook(2)
  book.record(row('read', { classId: 'read' }))
  book.record(row('edit', { classId: 'write' }))
  const resolve = (id) => (id === 'read' ? '读取' : '写入')
  const text = book.card('zh', resolve)
  assert.ok(text.includes('[读取]'))
  assert.ok(text.includes('[写入]'))
})

test('unknown shapes are recorded with honest fallbacks instead of made-up values', () => {
  // every 最小是 DRILL_MIN（2），所以这里必须记两条才会出卡。
  const book = new DrillBook(2)
  book.record({})
  book.record({})
  assert.equal(book.pending, 2)
  const text = book.card('zh')
  assert.ok(text.includes('unknown'), '没有名字就写 unknown，不编一个工具名')
})

test('summary reports the numbers the panel shows', () => {
  const book = new DrillBook(2)
  book.record(row('a'))
  book.record(row('b'))
  book.card('zh')
  book.record(row('c'))
  const summary = book.summary()
  assert.equal(summary.size, 3)
  assert.equal(summary.pending, 1)
  assert.equal(summary.cards, 1)
  assert.equal(summary.every, 2)
})
