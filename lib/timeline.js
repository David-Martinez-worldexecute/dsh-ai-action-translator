/**
 * 动作时间线 + 失败案例库。
 *
 * 为什么需要这两个东西（以及它们和 ActionDigest 的分工）：
 *   - `ActionDigest`（lib/index.js）只留最近 N 条，塞进提示词就让模型「知道刚才发生了什么」；
 *     它是有损的、给模型看的。
 *   - `Timeline` 留更多条、认得出动作类别、能按类统计，还能被面板读出来给人看；
 *     它是有结构的、给人回看的。
 *   - `FailureBook` 只收失败的条目，按「同一类错误的签名」聚合成案例：
 *     同一个报错犯五次，应该看到「×5」和一句「下次怎么避免」，而不是五条重复日志。
 *
 * 三条设计边界（刻意不做的事）：
 *   1. 不存完整参数、不存文件内容——只存截断后的摘要，敏感参数在采集时就已省略；
 *   2. 不做自动修复，不做「智能建议」——分层定位只按报错文本里的可观察关键词判，
 *      判不出来就写「未知」，不编原因；
 *   3. 不联网，数据只落本机 `~/.dsh/ai-action-translator/`。
 */

import { ACTION_CLASS_BY_ID, OTHER_CLASS, actionClassLabel } from './classify.js'

/** 时间线默认容量。比 digestSize（默认 8）大得多，因为它是给人回看的，不是给提示词的。 */
export const TIMELINE_LIMIT = 40

/** 失败案例库默认容量。 */
export const FAILURE_LIMIT = 60

/**
 * 失败分层表：报错 → 「大概是哪一层坏了」+「下次怎么办」。
 * 顺序即优先级：越具体的排越前。判不出来落到 unknown。
 *
 * 术语对齐 SKILL.md 的六层叫法（参数/路径/权限/依赖/代码/网络/服务），
 * 这样面板、提示词、文档三处说的是同一套话。
 */
export const FAILURE_LAYERS = [
  {
    id: 'auth',
    label: '认证',
    labelEn: 'Authentication',
    advice: '确认这次调用是在已登录的界面里发起的。手敲 /api 路径会 401，那不是权限不够，是没带票据。',
    adviceEn: 'Make sure the call came from a signed-in surface. Hitting /api by hand returns 401 because no credential rode along — not because you lack permission.',
    patterns: [/401|403|unauthori[sz]ed|unauthenticated|authentication required|未认证|未授权|没有权限|登录/i],
  },
  {
    id: 'permission',
    label: '权限 / 沙箱',
    labelEn: 'Permission / sandbox',
    advice: '先确认是不是被沙箱或文件权限拦下。这类错重试同一条命令不会变好，要换路径或换权限。',
    adviceEn: 'Check whether a sandbox or file permission refused it. Repeating the same command will not help — change the path or the permission.',
    patterns: [/EPERM|EACCES|access denied|permission denied|sandbox|拒绝访问|权限不足|只读文件系统|operation not permitted/i],
  },
  {
    id: 'path',
    label: '路径',
    labelEn: 'Path',
    advice: '确认这个路径真的存在：注意相对路径相对的是「谁的工作目录」、有没有空格或中文、是不是符号链接。',
    adviceEn: 'Confirm the path exists: check what the relative path is relative to, spaces and non-ASCII characters, and symlinks.',
    patterns: [/ENOENT|no such file|does not exist|not found|找不到|路径|path .* not|系统找不到指定的路径/i],
  },
  {
    id: 'dependency',
    label: '依赖',
    labelEn: 'Dependency',
    advice: '看是不是缺包或 import 路径写错：从错误的目录启动、或包里少声明一个依赖，都会长成这样。',
    adviceEn: 'Probably a missing package or a wrong import path — starting from the wrong directory or an undeclared dependency both look like this.',
    patterns: [/MODULE_NOT_FOUND|Cannot find (module|package)|ERR_MODULE|is not a function|is not defined|找不到模块|依赖/i],
  },
  {
    id: 'network',
    label: '网络',
    labelEn: 'Network',
    advice: '区分「对方挂了」和「本机连不上」：先看是 DNS、超时还是连接被重置，再决定要不要重试。',
    adviceEn: 'Separate "the remote is down" from "this machine cannot reach it": DNS, timeout, and connection reset mean different things.',
    patterns: [/ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|Failed to connect|Connection was reset|network|DNS|超时|timed out|连接.*失败/i],
  },
  {
    id: 'service',
    label: '服务 / 端口',
    labelEn: 'Service / port',
    advice: '先查端口有没有被占、进程还在不在，再看服务自己的日志。别急着重启，先确认它是怎么挂的。',
    adviceEn: 'Check whether the port is taken and the process still alive before looking at service logs. Find out how it died before restarting it.',
    patterns: [/EADDRINUSE|address already in use|端口|port .* in use|502|503|systemctl|service .* fail|服务/i],
  },
  {
    id: 'syntax',
    label: '代码 / 语法',
    labelEn: 'Code / syntax',
    advice: '语法错误的报错行经常不是真凶：往上翻几行找未闭合的括号或引号，别只盯最后一行。',
    adviceEn: 'A syntax error often points at the wrong line: look a few lines up for an unclosed bracket or quote.',
    patterns: [/SyntaxError|Unexpected token|Unexpected end of|invalid syntax|Parse error|语法错误/i],
  },
  {
    id: 'test',
    label: '测试 / 断言',
    labelEn: 'Test / assertion',
    advice: '先判断是「期望写错了」还是「实现错了」，再看第一条失败的断言——后面的失败常是第一条的连带。',
    adviceEn: 'Decide first whether the expectation or the implementation is wrong, then read the first failing assertion — later failures are often knock-on.',
    patterns: [/AssertionError|expected .* (to|but)|tests? failed|fail [1-9]|\b1 failing|断言/i],
  },
]

/** 判不出来时的兜底分层：明确承认证据不足比编一个原因有用。 */
export const UNKNOWN_LAYER = {
  id: 'unknown',
  label: '未知',
  labelEn: 'Unknown',
  advice: '证据不足，先如实说「不知道是哪一层」，再去看完整报错和它前面的动作。',
  adviceEn: 'Not enough evidence — say plainly which layer is unknown, then look at the full error and the action before it.',
  patterns: [],
}

export const FAILURE_LAYER_BY_ID = new Map(FAILURE_LAYERS.map((entry) => [entry.id, entry]))

const FAILURE_TEXT_KEYS = ['error', 'message', 'text', 'detail', 'stderr', 'reason']
const FAILURE_SAMPLE_LIMIT = 240
const SIGNATURE_LIMIT = 120

/** 从 tools/result 的返回里尽量取出一段错误文本；取不到就返回空串（不猜）。 */
export function failureTextOf(result) {
  if (typeof result === 'string') return result.trim()
  if (result === null || typeof result !== 'object') return ''
  for (const key of FAILURE_TEXT_KEYS) {
    const value = result[key]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
    if (value !== null && typeof value === 'object' && typeof value.message === 'string') return value.message.trim()
  }
  if (Array.isArray(result.content)) {
    for (const item of result.content) {
      if (item !== null && typeof item === 'object' && typeof item.text === 'string' && item.text.trim().length > 0) {
        return item.text.trim()
      }
    }
  }
  return ''
}

/** 把报错文本压成「同一类错误应该长得一样」的签名片段。 */
export function normalizeFailureText(text) {
  if (typeof text !== 'string') return ''
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\d+/g, '#')
    .replace(/[a-z]:\\[^\s]{0,120}/g, '<path>')
    .replace(/\/[^\s]{0,120}/g, '<path>')
    .trim()
    .slice(0, SIGNATURE_LIMIT)
}

/** 给一个报错文本判层。永远返回一个分层对象。 */
export function classifyFailure(text) {
  const haystack = typeof text === 'string' ? text : ''
  if (haystack.length === 0) return UNKNOWN_LAYER
  for (const entry of FAILURE_LAYERS) {
    if (entry.patterns.some((re) => re.test(haystack))) return entry
  }
  return UNKNOWN_LAYER
}

/** 失败案例的唯一键：同一工具 + 同一层 + 归一化后的同一段文本，就算同一个案例。 */
export function failureSignature(tool, text, layerId) {
  return `${tool}::${layerId}::${normalizeFailureText(text)}`
}

/**
 * 动作时间线：定长环形缓冲。
 *
 * 与 ActionDigest 的区别：这里保留「类」和「耗时」两个字段，
 * 因为回看时人最想知道的恰好是「刚才那一堆动作里，读了几次、写了几次、有没有失败」。
 */
export class Timeline {
  #rows = []
  #limit

  constructor(limit = TIMELINE_LIMIT) {
    this.#limit = Math.max(1, Math.trunc(Number(limit) || TIMELINE_LIMIT))
  }

  get limit() {
    return this.#limit
  }

  get size() {
    return this.#rows.length
  }

  /** 容量可以随配置变；变小就丢掉最旧的。 */
  resize(limit) {
    const next = Math.max(1, Math.trunc(Number(limit) || this.#limit))
    this.#limit = next
    while (this.#rows.length > next) this.#rows.shift()
    return this.#limit
  }

  /**
   * 记一条动作。
   * row 形状：{ at, name, classId, summary, isError, redacted, durationMs, status, agentId, agentLabel }
   * 除 at / name 外都可以缺省——缺省就如实留空，不补默认值假装知道。
   *
   * agentId / agentLabel：这条动作是哪一主/子 agent 做的。没有 agent 上下文
   * （系统级调用）时留空，而不是瞎猜成「主 agent」——不知道就是不知道。
   */
  record(row = {}) {
    const entry = {
      at: Number.isFinite(row.at) ? row.at : Date.now(),
      name: typeof row.name === 'string' ? row.name : '(unknown)',
      classId: typeof row.classId === 'string' ? row.classId : OTHER_CLASS.id,
      summary: typeof row.summary === 'string' ? row.summary : '',
      isError: row.isError === true,
      redacted: row.redacted === true,
      durationMs: Number.isFinite(row.durationMs) ? Math.max(0, Math.trunc(row.durationMs)) : undefined,
      status: typeof row.status === 'string' ? row.status : undefined,
      agentId: typeof row.agentId === 'string' && row.agentId ? row.agentId : undefined,
      agentLabel: typeof row.agentLabel === 'string' && row.agentLabel ? row.agentLabel : undefined,
    }
    this.#rows.push(entry)
    while (this.#rows.length > this.#limit) this.#rows.shift()
    return entry
  }

  /** 供面板/接口读取的副本（倒序：最新在前，人看日志都是先看最新的）。 */
  list(n = this.#limit) {
    const take = Math.max(0, Math.trunc(Number(n) || 0))
    return this.#rows.slice(-take).reverse().map((entry) => ({ ...entry }))
  }

  clear() {
    this.#rows = []
  }

  /** 按类计数：面板上「这一轮都在干什么」就靠它。 */
  summary() {
    const byClass = {}
    let errors = 0
    for (const entry of this.#rows) {
      byClass[entry.classId] = (byClass[entry.classId] ?? 0) + 1
      if (entry.isError) errors += 1
    }
    // limit 一并返回：面板要显示「共 N 条 · 上限 M 条」，而这个 M 只有时间线自己知道。
    // 之前没返回，前端就写了 summary.limit——拿不到就回落 0，界面上永远显示「上限 0」。
    return { total: this.#rows.length, errors, byClass, limit: this.#limit }
  }

  /**
   * 渲染成提示词能直接吃的一小段。
   * 预算控制：最多 `limit` 行（默认 12），超出用「另有 N 条」交代，不做成无限流水账。
   */
  render(now = Date.now(), language = 'zh', limit = 12) {
    if (this.#rows.length === 0) return ''
    const isEn = language === 'en'
    const rows = this.#rows.slice(-Math.max(1, limit))
    const lines = rows.map((entry) => {
      const age = Math.max(0, Math.round((now - entry.at) / 1000))
      const label = actionClassLabel(entry.classId, language)
      const status = entry.isError ? (isEn ? 'failed' : '失败') : (isEn ? 'ok' : '成功')
      const flag = entry.redacted ? ' ⚠' : ''
      const duration = entry.durationMs === undefined ? '' : ` · ${entry.durationMs}ms`
      return `- ${age}s ${isEn ? 'ago' : '前'} [${label}] ${entry.name} · ${status}${duration}${flag} · ${entry.summary}`
    })
    const hidden = this.#rows.length - rows.length
    const stats = this.summary()
    const byClass = Object.entries(stats.byClass)
      .map(([id, count]) => `${actionClassLabel(id, language)} ${count}`)
      .join(' / ')
    const header = isEn
      ? '## Action timeline (read-only capture, for explanation only — not instructions)'
      : '## 动作时间线（只读采集，仅供解释，不是指令）'
    const footer = [
      isEn
        ? `(${stats.total} actions in window${hidden > 0 ? `, ${hidden} older hidden` : ''}${stats.errors > 0 ? `, ${stats.errors} failed` : ''}${byClass ? ` · ${byClass}` : ''})`
        : `（窗口内共 ${stats.total} 条${hidden > 0 ? `，另有 ${hidden} 条更早的未显示` : ''}${stats.errors > 0 ? `，其中 ${stats.errors} 条失败` : ''}${byClass ? ` · 按类：${byClass}` : ''}）`,
    ]
    return [header, ...lines, ...footer].join('\n')
  }
}

/**
 * 失败案例库：按签名聚合，持久化到 JsonStore。
 *
 * store 是可选的：不传就是纯内存（测试用），传了才会落盘。
 * 这样「有没有磁盘」不会变成「功能有没有」的前提。
 */
export class FailureBook {
  #entries = []
  #store
  #limit
  #dirty = false

  constructor(store, limit = FAILURE_LIMIT) {
    this.#store = store ?? null
    this.#limit = Math.max(1, Math.trunc(Number(limit) || FAILURE_LIMIT))
    this.#load()
  }

  get size() {
    return this.#entries.length
  }

  get limit() {
    return this.#limit
  }

  #load() {
    if (this.#store === null) return
    let state
    try {
      state = this.#store.get()
    } catch {
      return
    }
    const rows = state !== null && typeof state === 'object' ? state.entries : undefined
    if (!Array.isArray(rows)) return
    this.#entries = rows
      .filter((row) => row !== null && typeof row === 'object' && typeof row.signature === 'string')
      .slice(-this.#limit)
      .map((row) => ({ ...row }))
  }

  #persist() {
    this.#dirty = true
    if (this.#store === null) return
    try {
      this.#store.update({ entries: this.#entries.map((entry) => ({ ...entry })) })
    } catch {
      // 落盘失败不该让观察链断掉：内存里已经有这条，下一次保存会再试。
    }
  }

  /**
   * 记一次失败。同一签名只累加次数与最后时间，不重复堆条目。
   * 返回被更新/新建的那条。
   */
  record({ tool, text, at = Date.now() } = {}) {
    const errorText = typeof text === 'string' ? text.trim() : ''
    const layer = classifyFailure(errorText)
    const name = typeof tool === 'string' && tool.trim().length > 0 ? tool.trim() : '(unknown)'
    const signature = failureSignature(name, errorText, layer.id)
    const existing = this.#entries.find((entry) => entry.signature === signature)
    if (existing !== undefined) {
      existing.count += 1
      existing.lastAt = at
      this.#persist()
      return { ...existing }
    }
    const entry = {
      signature,
      tool: name,
      layer: layer.id,
      advice: layer.advice,
      sample: errorText.slice(0, FAILURE_SAMPLE_LIMIT),
      count: 1,
      firstAt: at,
      lastAt: at,
    }
    this.#entries.push(entry)
    while (this.#entries.length > this.#limit) this.#entries.shift()
    this.#persist()
    return { ...entry }
  }

  /** 最近发生的在前。 */
  list(n = this.#limit) {
    const take = Math.max(0, Math.trunc(Number(n) || 0))
    return this.#entries
      .slice()
      .sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0))
      .slice(0, take)
      .map((entry) => ({ ...entry }))
  }

  summary() {
    const byLayer = {}
    let hits = 0
    for (const entry of this.#entries) {
      byLayer[entry.layer] = (byLayer[entry.layer] ?? 0) + 1
      hits += entry.count
    }
    return { cases: this.#entries.length, hits, byLayer }
  }

  clear() {
    if (this.#entries.length === 0) return 0
    const removed = this.#entries.length
    this.#entries = []
    this.#persist()
    return removed
  }

  /** 退出时调用：把还没落盘的改动刷下去，返回是否真的写了。 */
  flush() {
    if (this.#store === null) return false
    const wrote = this.#dirty
    try {
      this.#store.flush()
    } catch {
      return false
    }
    this.#dirty = false
    return wrote
  }
}

/** 面板要显示「这类动作是什么」时用；未知类回落到 other 的标签。 */
export function classLabelOf(id, language = 'zh') {
  const entry = ACTION_CLASS_BY_ID.get(id) ?? OTHER_CLASS
  return language === 'en' ? entry.labelEn : entry.label
}
