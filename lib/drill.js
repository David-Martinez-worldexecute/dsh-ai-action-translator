/**
 * 学习练习册（D 方向）：攒够 N 个真实动作，就让模型带用户过一遍。
 *
 * 为什么不是「每轮结束自动总结」：
 *   1. 我们只订阅 `tools/result`（纯广播），拿不到可靠的「这一轮结束了」信号；
 *      硬等一个不确定的轮次事件，插件会在别人的宿主版本上静默失效。
 *   2. 「攒够 N 个动作」是可观察的事实：数得出来、证明得了。
 *      所以触发条件写成「自上次出卡以来新增 ≥ every 条」，而不是「一轮结束」。
 *
 * 三条边界（刻意不做的事）：
 *   1. 卡片里只有**真实发生过的动作**（来自 tools/result 的 name / 类别 / 成败），
 *      不替模型写「用户学到了什么」——那是模型该现场生成的。
 *   2. `card()` 是幂等的：提示词组装可能一次调用多次，不能因此重复出卡。
 *      做法是记「已发到第几条」（emitted 水位），而不是清空数组。
 *   3. 出卡不落盘、不进时间线：它是提示词的一部分，不是给面板看的历史。
 */

/** 一次卡片最多引用多少个动作：太多会撑爆提示词，也会让用户看不完。 */
export const DRILL_WINDOW = 8

/** every 的合法区间：少于 2 条没有「过程」可讲，多于 10 条用户跟不动。 */
export const DRILL_MIN = 2
export const DRILL_MAX = 10

/** 把 outside 的值收敛成合法整数；非法一律回落到 fallback。 */
export function drillEveryOf(value, fallback = 3) {
  // `null` / `undefined` / 空串都是「没给」，不是「给了 0」：
  // 若直接 Number(value)，null 会变成 0 再被抬到下限 2，用户设的默认值就悄悄丢了。
  if (value === null || value === undefined || value === '') return fallback
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(DRILL_MIN, Math.min(DRILL_MAX, Math.round(number)))
}

export class DrillBook {
  #rows = []
  #every
  #emitted = 0
  #cards = 0

  constructor(every = 3) {
    this.#every = drillEveryOf(every)
  }

  get every() {
    return this.#every
  }

  setEvery(every) {
    this.#every = drillEveryOf(every, this.#every)
  }

  /** 已经发了多少张卡（面板用：证明它真的在工作，而不是「配了但没跑」）。 */
  get cards() {
    return this.#cards
  }

  /** 已记录但还没出卡的动作条数。 */
  get pending() {
    return this.#rows.length - this.#emitted
  }

  get size() {
    return this.#rows.length
  }

  clear() {
    this.#rows = []
    this.#emitted = 0
  }

  /**
   * 记一条动作。只保留能站得住的事实：
   *   at / name / classId / isError —— 来自 tools/result 广播
   * 摘要（summary）只用调用方已经脱敏过的那份，不在这里二次加工。
   */
  record(row = {}) {
    this.#rows.push({
      at: Number.isFinite(row.at) ? row.at : Date.now(),
      name: typeof row.name === 'string' && row.name ? row.name : 'unknown',
      classId: typeof row.classId === 'string' && row.classId ? row.classId : 'other',
      summary: typeof row.summary === 'string' ? row.summary : '',
      isError: row.isError === true,
      redacted: row.redacted === true,
    })
    // 只留最近 DRILL_WINDOW 条：卡片说的是「刚才这一段」，不是整场历史。
    if (this.#rows.length > DRILL_WINDOW) {
      const drop = this.#rows.length - DRILL_WINDOW
      this.#rows.splice(0, drop)
      this.#emitted = Math.max(0, this.#emitted - drop)
      // emitted 是相对下标，裁掉头部后同步左移，否则会误以为「都已出过卡」。
      if (this.#emitted > this.#rows.length) this.#emitted = this.#rows.length
    }
  }

  /**
   * 该不该出卡、出什么卡。
   * 返回空串 = 本轮不出卡（还没攒够，或开关关着）。
   * 出卡是幂等的：同一个水位只出一次，重复组装提示词不会重复要求。
   */
  card(language = 'zh', classLabelOf = null) {
    if (this.#rows.length - this.#emitted < this.#every) return ''
    const fresh = this.#rows.slice(this.#emitted)
    this.#emitted = this.#rows.length
    this.#cards += 1
    const label = (row) => {
      const named = typeof classLabelOf === 'function' ? classLabelOf(row.classId, language) : null
      return named || row.classId || 'other'
    }
    if (language === 'en') {
      const lines = fresh.map((row, index) => {
        const took = row.summary ? ` · ${row.summary}` : ''
        return `${index + 1}. [${label(row)}] ${row.name}${row.isError ? ' (failed)' : ''}${took}`
      })
      return [
        `## Learning drill (${fresh.length} fresh actions)`,
        'These actions really happened in this turn (from the tools/result broadcast; nothing invented):',
        ...lines,
        'At the end of your reply, add three short cards (two lines each at most):',
        '- What you saw: chain the actions above into one sentence of input -> process -> output.',
        '- The technical point you can repeat: pick ONE term or mechanism that actually appeared above, explain it in plain words, then give its precise name.',
        '- Next practice: one small action the user can finish in five minutes and verify alone.',
        'Do not invent actions that are not listed above. If something is unclear, say "I could not see that step clearly".',
      ].join('\n')
    }
    const lines = fresh.map((row, index) => {
      const took = row.summary ? ` · ${row.summary}` : ''
      return `${index + 1}. [${label(row)}] ${row.name}${row.isError ? '（失败）' : ''}${took}`
    })
    return [
      `## 学习练习册（本轮新攒了 ${fresh.length} 个动作）`,
      '下面是这一轮真实发生过的动作（来自 tools/result 广播，没有编造）：',
      ...lines,
      '请在回复末尾补三张小卡，每张最多两行：',
      '- 你看到了什么：把上面的动作按「输入 → 处理 → 输出」串成一句话。',
      '- 你能复述的技术点：只挑上面真的出现过的一个术语或机制，先用白话讲清，再给准确名字。',
      '- 下一步练习：给一个五分钟内能做完、且用户能自己验证的小动作。',
      '上面没列出来的动作不要编；哪一步没看清就直说「这一步我没看清」。',
    ].join('\n')
  }

  summary() {
    return { size: this.#rows.length, pending: this.pending, emitted: this.#emitted, cards: this.#cards, every: this.#every }
  }
}
