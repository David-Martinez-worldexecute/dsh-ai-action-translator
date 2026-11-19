/**
 * 多 Agent 名册：谁在干活、有几个、什么时候来、什么时候走。
 *
 * 为什么单独成文件：`tools/result` 的 `exec.agent` 只告诉你「这一条是谁做的」，
 * 但「一共有哪几个 agent、现在还有几个活着」只有另外三条路能拿到：
 *   - `ctx.on('agent/created', ({ agent }) => ...)`
 *   - `ctx.on('agent/disposed', ({ agent }) => ...)`
 *   - `ctx.agents.list()`
 * 把「身份归一化」和「名册」放在一起，时间线只负责记一行、不负责记名单。
 *
 * 四条设计边界（刻意不做的事）：
 *   1. 只记身份与时间（id / 工作目录 / 来去时刻 / 动作条数），
 *      不记 prompt、不记模型输出、不记文件内容。
 *   2. 面板上只显示短 id（前 8 位）——完整 id 留在数据里供核对，
 *      不因为「好看」就把它截掉不留下。
 *   3. 名册有上限：多 agent 跑一整天也不该无限长。
 *   4. 绝不注入提示词：这份名单只给面板回看，模型不会自己「知道」有几个兄弟。
 */

export const AGENT_LIMIT = 50

/** 从 cwd 取最后一段当人类可读的「在哪个项目里干活」。 */
function folderOf(cwd) {
  if (typeof cwd !== 'string' || cwd === '') return ''
  const parts = cwd.split(/[\\/]+/).filter(Boolean)
  return parts.length === 0 ? '' : parts[parts.length - 1]
}

/** 短 id：完整 id 太长，面板上一行放不下；核对时用完整 id。 */
function shortId(id) {
  const text = String(id)
  return text.length <= 8 ? text : text.slice(0, 8)
}

/**
 * 从 agent 对象（或 `exec.agent`）抽一份稳定身份。
 *
 * 字段名全是「可选探测」：内核的 Agent 形状没有公开文档，
 * 这里用 `?.` 逐层取，取不到就当没有，**不补默认值假装知道**。
 * 宁可显示一个短 id，也不要编一个「主代理 / 子代理」的结论。
 */
export function agentOf(agent) {
  if (!agent || typeof agent !== 'object') return undefined
  const session = agent.session && typeof agent.session === 'object' ? agent.session : {}
  const header = session.header && typeof session.header === 'object' ? session.header : {}
  const directId = typeof agent.id === 'string' && agent.id !== '' ? agent.id : undefined
  const headerId = typeof header.id === 'string' && header.id !== '' ? header.id : undefined
  const rawId = directId ?? headerId
  if (rawId === undefined) return undefined
  const cwd = typeof header.cwd === 'string' && header.cwd !== '' ? header.cwd : undefined
  const folder = folderOf(cwd)
  return {
    id: rawId,
    short: shortId(rawId),
    cwd,
    folder,
    label: folder === '' ? shortId(rawId) : `${folder}·${shortId(rawId)}`,
  }
}

/** 从 `tools/result` 的 exec 里抽身份；没有 agent 就是系统级调用，返回 undefined。 */
export function agentOfExec(exec) {
  if (!exec || typeof exec !== 'object') return undefined
  return agentOf(exec.agent)
}

/**
 * 名册：定长，按「第一次见到」排序，超出上限就丢最老的。
 *
 * 三种进入方式分开记：
 *   - `born()`  —— 收到 agent/created
 *   - `gone()`  —— 收到 agent/disposed
 *   - `touch()` —— 一次工具调用（没经历过 created 的 agent 也认得出）
 */
export class AgentRoster {
  #byId = new Map()
  #limit

  constructor(limit = AGENT_LIMIT) {
    this.#limit = Math.max(1, Math.trunc(Number(limit) || AGENT_LIMIT))
  }

  get limit() {
    return this.#limit
  }

  get size() {
    return this.#byId.size
  }

  /** 记一个 agent 的到来。重复 created 只补字段，不重复建条目。 */
  born(agent, at = Date.now()) {
    const who = agentOf(agent)
    if (who === undefined) return undefined
    const existing = this.#byId.get(who.id)
    if (existing !== undefined) {
      if (existing.bornAt === undefined) existing.bornAt = at
      if (existing.cwd === undefined && who.cwd !== undefined) {
        existing.cwd = who.cwd
        existing.folder = who.folder
        existing.label = who.label
      }
      return existing
    }
    const entry = { ...who, bornAt: at, goneAt: undefined, actions: 0 }
    this.#byId.set(who.id, entry)
    this.#trim()
    return entry
  }

  /** 记一个 agent 的离开。没见过它也要留一条，否则「来过又走了」就查无此人。 */
  gone(agent, at = Date.now()) {
    const who = agentOf(agent)
    if (who === undefined) return undefined
    const existing = this.#byId.get(who.id)
    if (existing !== undefined) {
      existing.goneAt = at
      return existing
    }
    const entry = { ...who, bornAt: undefined, goneAt: at, actions: 0 }
    this.#byId.set(who.id, entry)
    this.#trim()
    return entry
  }

  /** 一次工具调用：只累加计数，顺带补上从没见过的 agent。 */
  touch(agent, at = Date.now()) {
    const who = agentOf(agent)
    if (who === undefined) return undefined
    const existing = this.#byId.get(who.id)
    if (existing !== undefined) {
      existing.actions += 1
      return existing
    }
    const entry = { ...who, bornAt: at, goneAt: undefined, actions: 1 }
    this.#byId.set(who.id, entry)
    this.#trim()
    return entry
  }

  /** 面板/接口读取的副本（按第一次见到排序，最早在前）。 */
  list() {
    return [...this.#byId.values()].map((entry) => ({ ...entry }))
  }

  /** 面板顶部那几个数字：一共几个、还活着几个、累计干了多少活。 */
  summary() {
    let live = 0
    let actions = 0
    for (const entry of this.#byId.values()) {
      if (entry.goneAt === undefined) live += 1
      actions += entry.actions
    }
    return { total: this.#byId.size, live, actions }
  }

  clear() {
    this.#byId.clear()
  }

  #trim() {
    while (this.#byId.size > this.#limit) {
      const first = this.#byId.keys().next()
      if (first.done === true) return
      this.#byId.delete(first.value)
    }
  }
}
