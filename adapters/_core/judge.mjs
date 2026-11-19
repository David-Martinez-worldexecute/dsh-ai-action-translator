/**
 * 宿主无关的守门判定器。
 *
 * 这个文件里**不允许出现任何宿主名字**（测试会扫）。原因不是洁癖：
 * 一旦这里出现「某个宿主怎么怎么样」，它就不再是判定器，而变成了那个宿主的补丁，
 * 下一个宿主接进来时就得在这里加 if —— 判定规则会随着宿主数量分裂成 N 份。
 * 所有宿主差异都关在 adapter 那一层（怎么读 stdin、怎么把 verdict 包成返回值）。
 *
 * 数据源只有同目录的 policy.json，而它由 tools/build-policy.mjs 从 lib/guard.js 导出。
 * 也就是说：规则的真源仍然只有一处，这里是消费方。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_POLICY = path.join(HERE, 'policy.json')

/** 与 lib/classify.js 的 commandTextOf 同语义：从参数里尽量只取出「真正要执行的那段文本」。 */
const SHELL_ARG_KEYS = ['command', 'cmd', 'script', 'code', 'args', 'input']

export function commandTextOf(args) {
  if (typeof args === 'string') return args
  if (!args || typeof args !== 'object') return ''
  for (const key of SHELL_ARG_KEYS) {
    const value = args[key]
    if (typeof value === 'string' && value.trim() !== '') return value
    if (Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string')) {
      return value.join(' ')
    }
  }
  return ''
}

/**
 * 读 policy.json 并把 source/flags 拼回真正的 RegExp。
 * 传 file 是为了让测试能喂一份合成策略进来，不必改真实产物。
 */
export function loadPolicy(file = DEFAULT_POLICY) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  const rules = (Array.isArray(raw.rules) ? raw.rules : []).map((rule) => ({
    ...rule,
    patterns: (Array.isArray(rule.patterns) ? rule.patterns : []).map(
      (pattern) => new RegExp(pattern.source, pattern.flags),
    ),
  }))
  return {
    modes: Array.isArray(raw.modes) ? raw.modes : ['off', 'warn', 'deny'],
    levels: Array.isArray(raw.levels) ? raw.levels : ['high', 'medium'],
    skipTools: new Set(Array.isArray(raw.skipTools) ? raw.skipTools : []),
    rules,
  }
}

const RISK = {
  high: { id: 'high', label: '高风险', labelEn: 'high risk', zh: '不可逆或影响整台机器', en: 'irreversible or machine-wide' },
  medium: { id: 'medium', label: '中等', labelEn: 'medium risk', zh: '可恢复但代价明显', en: 'recoverable but costly' },
}

/**
 * 判定一次动作。options 与 lib/guard.js 的 evaluateGuard 同名同义：
 *   mode: 'off' | 'warn' | 'deny'（默认 warn —— 宁可提醒也不静默放行）
 *   level: 'high' | 'medium'（medium 档也把中等风险算进去）
 *   allowRules: string[]（用户手动放行的规则 id）
 *   allowTools: string[]（用户手动放行的工具名，支持 `*` 结尾的前缀）
 *   sessionAllow: Set<string>（本次会话内临时放行过的规则）
 *   includeQuiet: boolean（把默认静音的规则也报出来）
 */
export function judge(policy, toolName, args, options = {}) {
  const { modes, levels, skipTools, rules } = policy
  const mode = modes.includes(options.mode) ? options.mode : 'warn'
  const level = levels.includes(options.level) ? options.level : 'high'
  const allowRules = new Set(Array.isArray(options.allowRules) ? options.allowRules : [])
  const allowTools = new Set(
    Array.isArray(options.allowTools) ? options.allowTools.map((item) => String(item).toLowerCase()) : [],
  )
  const sessionAllow = options.sessionAllow instanceof Set ? options.sessionAllow : new Set()
  const includeQuiet = options.includeQuiet === true
  const name = typeof toolName === 'string' ? toolName : ''
  const text = commandTextOf(args)

  const allow = () => ({ action: 'allow', rule: null, risk: null, reason: '', reasonEn: '', text })
  if (mode === 'off') return allow()

  // 工具名放行：先精确、再前缀（`mcp__windows__*` 这种）。
  if (name) {
    const lowered = name.toLowerCase()
    if (allowTools.has(lowered)) return allow()
    for (const pattern of allowTools) {
      if (pattern.endsWith('*') && lowered.startsWith(pattern.slice(0, -1))) return allow()
    }
  }

  const skipTool = skipTools.has(name)
  const normalized = typeof args === 'string'
    ? args
    : (() => {
      try {
        return JSON.stringify(args ?? {})
      } catch {
        return ''
      }
    })()
  // 参数常被序列化成 `C:\\Windows`，而规则写的是 `C:\Windows`。
  // 不把反斜杠还原一次，「写系统目录」这类规则永远不会命中，而且静默。
  const unescaped = normalized.replace(/\\\\/g, '\\')
  const haystack = `${text}\n${normalized}\n${unescaped}`

  for (const rule of rules) {
    // 只读工具上不套规则，除非规则标了 alwaysCheck（读凭据恰恰只发生在读类工具上）。
    if (skipTool && rule.alwaysCheck !== true) continue
    if (rule.tools && !rule.tools.includes(name)) continue
    if (allowRules.has(rule.id) || sessionAllow.has(rule.id)) continue
    // quiet 规则默认不报（例如覆盖写太常见），但用户勾了 guardQuiet 就要看见。
    if (rule.quiet === true && !includeQuiet) continue

    let hit = false
    if (rule.always) hit = true
    else if (rule.patterns.length > 0) hit = rule.patterns.some((pattern) => pattern.test(haystack))
    if (!hit) continue

    const risk = RISK[rule.level] ?? RISK.medium
    // 高风险规则在任何档位都拦；中等风险只在 medium 档才拦。
    const shouldDeny = mode === 'deny' && (level === 'medium' || rule.level === 'high')
    return {
      action: shouldDeny ? 'deny' : 'warn',
      rule,
      risk,
      reason: rule.zh,
      reasonEn: rule.en,
      text,
    }
  }

  return allow()
}

/** 给用户看的一句话拒绝理由（各宿主把这段原样塞进自己的拒绝字段）。 */
export function denyMessage(verdict, language = 'zh') {
  const label = language === 'en' ? verdict.rule?.labelEn ?? verdict.rule?.id : verdict.rule?.label ?? verdict.rule?.id
  const why = language === 'en' ? verdict.reasonEn : verdict.reason
  if (language === 'en') {
    return `[ai-action-translator] Blocked "${label}": ${why} If you really mean it, allow this rule in the AI Action Translator settings, or run it yourself.`
  }
  return `[ai-action-translator] 拦下「${label}」：${why} 如果确认要做，请在 AI 动作翻译器的设置里放行这一类动作，或自己手动执行。`
}

/** 警告用的短句：不拦，但让人看见。 */
export function warnMessage(verdict, language = 'zh') {
  const label = language === 'en' ? verdict.rule?.labelEn ?? verdict.rule?.id : verdict.rule?.label ?? verdict.rule?.id
  const why = language === 'en' ? verdict.reasonEn : verdict.reason
  if (language === 'en') return `[ai-action-translator] Heads-up — "${label}": ${why}`
  return `[ai-action-translator] 提醒 ——「${label}」：${why}`
}
