/**
 * lib/guard.js — 事前守门：把「危险动作」在**执行之前**认出来。
 *
 * 为什么需要它：
 *   在 0.6.0 之前，这个插件只订阅 `tools/result`（工具跑完之后的纯广播），
 *   所以它只能做事后旁白——`rm -rf` 已经把文件删掉了，学生才看到「这一步是删除」。
 *   内核还开放了 `tools/pre-execute`（waterfall，返回 `{ kind: 'deny', reason }`
 *   可以真的挡下这次调用），于是「解释」可以往前挪一站，变成「先拦一下再问」。
 *
 * 设计纪律（刻意为之）：
 *   1. **默认只警告、不拦截**（`mode: 'warn'`）。deny 是真的会挡住 AI，
 *      配置错就可能让人卡死在半路，所以默认值必须是「记录 + 提示」。
 *   2. 只按**可观察的文本**判断（命令字符串、文件路径、工具名），
 *      不猜模型意图、不做语义理解。
 *   3. 命中规则只说明「这类动作通常意味着什么」，不代替用户做决定。
 *   4. 规则表是数据，不是逻辑：加一条规则不需要改评估函数。
 */

import { commandTextOf } from './classify.js'

/** 三档模式：关闭 / 只记录 / 真的拦。 */
export const GUARD_MODES = ['off', 'warn', 'deny']

/** 拦截等级：deny 模式下只拦这个等级及以上的规则。 */
export const GUARD_LEVELS = ['high', 'medium']

/**
 * 风险等级。`high` = 不可逆或影响面超出当前项目；`medium` = 可回滚但会改变环境。
 */
export const RISK_LEVELS = {
  high: { id: 'high', label: '高风险', labelEn: 'High risk', zh: '不可逆或影响整台机器', en: 'irreversible or machine-wide' },
  medium: { id: 'medium', label: '中风险', labelEn: 'Medium risk', zh: '可回滚，但会改动环境', en: 'reversible, but changes the environment' },
}

/**
 * 规则表。顺序即优先级：先命中的规则说了算（`high` 排在前面）。
 *
 * 字段：
 *   id       稳定的机器名（写进配置、日志、测试）
 *   level    high / medium
 *   label    面板上给人看的短名
 *   zh / en  命中之后该怎么向用户解释（一句话，说「这意味着什么」，不替人决定）
 *   tools    只在哪些工具上生效；省略 = 所有工具
 *   patterns 对「命令文本」做匹配（正则，大小写不敏感）
 */
export const GUARD_RULES = [
  {
    id: 'delete-recursive',
    level: 'high',
    label: '递归删除',
    labelEn: 'Recursive delete',
    zh: '这条命令会把整个目录连同里面的东西一起删掉，而且通常不进回收站。',
    en: 'This removes a whole directory tree, and usually not into the recycle bin.',
    patterns: [
      /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b/i,
      /\brm\s+-[a-z]*r\b/i,
      /\brmdir\s+\/s\b/i,
      /\brd\s+\/s\b/i,
      /\bdel\s+(\/[a-z]\s*)*\/s\b/i,
      /\bRemove-Item\b[^\n]*-Recurse/i,
      /\bRemove-Item\b[^\n]*-Force[^\n]*\*/i,
      /\bClear-Content\b/i,
    ],
  },
  {
    id: 'system-power',
    level: 'high',
    label: '关机 / 重启 / 磁盘级操作',
    labelEn: 'Power, boot, or disk-level operation',
    zh: '这会动到整台机器（关机、改启动项、分区或格式化），不只是这个项目。',
    en: 'This touches the whole machine (power, boot entries, partitions, or formatting), not just this project.',
    patterns: [
      /\bshutdown\b/i,
      /\bRestart-Computer\b/i,
      /\bStop-Computer\b/i,
      /\bpoweroff\b/i,
      /\breboot\b/i,
      /\bbcdedit\b/i,
      /\bdiskpart\b/i,
      /\bFormat-Volume\b/i,
      /\bformat\s+[a-z]:/i,
      /\bmkfs(\.\w+)?\b/i,
    ],
  },
  {
    id: 'permission-change',
    level: 'high',
    label: '权限 / 安全策略变更',
    labelEn: 'Permission or security-policy change',
    zh: '这会改文件权限或执行策略，影响范围可能超出当前目录，而且事后很难全部还原。',
    en: 'This changes file permissions or execution policy. The effect can reach beyond this folder and is hard to fully undo.',
    patterns: [
      /\bicacls\b/i,
      /\btakeown\b/i,
      /\bcacls\b/i,
      /\bSet-ExecutionPolicy\b/i,
      /\bchmod\s+[0-7]{3,4}\b/i,
      /\bchown\b/i,
      /\breg\s+(add|delete)\b[^\n]*HK(LM|CR|U)\b/i,
    ],
  },
  {
    id: 'credential-read',
    level: 'high',
    label: '读取凭据 / 私钥',
    labelEn: 'Read credentials or private keys',
    zh: '这个路径通常放的是密钥或令牌。读出来意味着它可能被写进日志、上下文或聊天记录。',
    en: 'This path usually holds keys or tokens. Reading it means it may end up in logs, context, or chat history.',
    patterns: [
      /\.ssh\b/i,
      /\.gnupg\b/i,
      /\bid_(rsa|ed25519|ecdsa)\b/i,
      /\.credentials\.(yaml|yml|json)\b/i,
      /credentials\.json\b/i,
      /\.npmrc\b/i,
      /\.env(\.local)?\b/i,
      /\.pypirc\b/i,
      /secrets?\.(json|ya?ml)\b/i,
    ],
    /**
     * 唯一一条「即使工具是只读也要检查」的规则。
     *
     * 别把这条删了：`SKIP_TOOLS` 会把 read / cat / grep 直接放行（它们不执行命令），
     * 而凭据泄露恰恰**只发生在读类工具上**——不在这里开例外，这条规则永远不会命中。
     */
    alwaysCheck: true,
  },
  {
    id: 'git-destructive',
    level: 'high',
    label: '破坏性 Git 操作',
    labelEn: 'Destructive git operation',
    zh: '这会改写或丢弃已有提交 / 未提交的改动，本地能回滚，但已经推送出去就收不回来了。',
    en: 'This rewrites or discards commits or uncommitted work. Locally recoverable, but not once pushed.',
    patterns: [
      /\bgit\s+push\b[^\n]*(--force|-f)\b/i,
      /\bgit\s+reset\b[^\n]*--hard/i,
      /\bgit\s+clean\b[^\n]*-[a-z]*f/i,
      /\bgit\s+branch\b[^\n]*-D\b/i,
      /\bgit\s+checkout\b[^\n]*--\s+\./i,
      /\bgit\s+rebase\b/i,
    ],
  },
  {
    id: 'write-system-path',
    level: 'high',
    label: '写到系统目录',
    labelEn: 'Write into a system path',
    zh: '目标落在操作系统目录里，不属于这个项目，出问题会影响别的程序。',
    en: 'The target is inside an operating-system folder, not this project. A mistake there affects other programs.',
    tools: ['write', 'edit', 'write_file', 'create_file', 'append', 'patch', 'MultiEdit'],
    patterns: [
      /[a-z]:\\windows(\\|$)/i,
      /[a-z]:\\program files( \(x86\))?(\\|$)/i,
      /\/(etc|usr|bin|sbin|boot|sys|proc)\//i,
    ],
  },
  {
    id: 'dependency-install',
    level: 'medium',
    label: '安装 / 升级依赖',
    labelEn: 'Install or upgrade dependencies',
    zh: '这会改动依赖树并写入磁盘；锁文件会变，别人拉下来可能装出不一样的版本。',
    en: 'This changes the dependency tree and writes to disk; the lockfile changes, so someone else may install different versions.',
    patterns: [
      /\b(npm|pnpm|yarn)\s+(i|install|add|update|upgrade)\b/i,
      /\b(pip|pip3)\s+install\b/i,
      /\buv\s+(add|pip\s+install|sync)\b/i,
      /\b(apt|apt-get|dnf|yum|brew)\s+(install|upgrade)\b/i,
      /\b(winget|choco|scoop)\s+(install|upgrade)\b/i,
    ],
  },
  {
    id: 'service-stop',
    level: 'medium',
    label: '停止服务 / 杀进程',
    labelEn: 'Stop a service or kill a process',
    zh: '这会中断正在跑的东西；如果它正被别的任务依赖，那些任务会跟着失败。',
    en: 'This interrupts something that is running. Anything depending on it will fail too.',
    patterns: [
      /\bStop-Process\b/i,
      /\bStop-Service\b/i,
      /\bkill\b[^\n]*-?9/i,
      /\btaskkill\b/i,
      /\bsystemctl\s+(stop|disable)\b/i,
      /\bnet\s+stop\b/i,
      /\bsc\s+stop\b/i,
      /\bpkill\b/i,
    ],
  },
  {
    id: 'network-outbound',
    level: 'medium',
    label: '向外部发送数据',
    labelEn: 'Send data out',
    zh: '这条命令会连到外部地址；如果带了文件或参数，内容可能被发出去。',
    en: 'This connects to an outside address. If it carries a file or payload, that content leaves the machine.',
    patterns: [
      /\bcurl\b[^\n]*(-d|--data|-F|--form|-T|--upload-file)\b/i,
      /\bcurl\b[^\n]*-X\s*(POST|PUT|PATCH|DELETE)\b/i,
      /\bInvoke-(WebRequest|RestMethod)\b[^\n]*-(Method\s+)?(Post|Put|Patch|Delete)\b/i,
      /\b(ssh|scp|rsync)\b/i,
      /\bnc\s+-/i,
      /\bftp\b/i,
    ],
  },
  {
    id: 'in-place-overwrite',
    level: 'medium',
    label: '覆盖写入已有文件',
    labelEn: 'Overwrite an existing file',
    zh: '整份覆盖会把原来的内容替换掉，不像追加那样还能看出改了什么。',
    en: 'A full overwrite replaces the old content. Unlike an append, the previous version is no longer visible in the diff.',
    tools: ['write', 'write_file', 'create_file'],
    patterns: [],
    /** 由 `evaluateGuard` 另行判定：write 类工具永远算「可能覆盖」。 */
    always: true,
    /**
     * 默认静音：写文件是最高频的动作，每次都在面板里报一条「可能覆盖」只会淹掉
     * 真正该看的告警。想收这份噪声的人，在高级设置里打开 `guardQuiet` 才收。
     */
    quiet: true,
  },
]

/** 规则 id → 规则对象。 */
export const GUARD_RULE_BY_ID = new Map(GUARD_RULES.map(rule => [rule.id, rule]))

export const GUARD_RULE_IDS = GUARD_RULES.map(rule => rule.id)

const HIGH_RULE_IDS = new Set(GUARD_RULES.filter(rule => rule.level === 'high').map(rule => rule.id))

/** 判断某个规则 id 是不是高风险。 */
export function isHighRiskRule(ruleId) {
  return HIGH_RULE_IDS.has(ruleId)
}

/**
 * 取「这次调用要不要看」。只读工具（read / glob / grep 等）不跑命令正则，省开销；
 * 例外是标了 `alwaysCheck` 的规则（目前只有「读取凭据」），它们的触发点恰恰在只读工具上。
 */
export const GUARD_SKIP_TOOLS = new Set([
  'read', 'glob', 'grep', 'rg', 'ls', 'cat', 'decompress', 'search_context',
  'acp_status', 'retrieve_spill', 'list_agents', 'job_list', 'job_output',
])

/**
 * 评估一次工具调用。
 *
 * @param {string} toolName
 * @param {unknown} args 工具参数（对象或 JSON 字符串都行）
 * @param {{ mode?: string, level?: string, allowRules?: string[], allowTools?: string[], sessionAllow?: Set<string>, includeQuiet?: boolean }} [options]
 * @returns {{ action: 'allow'|'warn'|'deny', rule: object|null, risk: object|null, reason: string, reasonEn: string, text: string }}
 */
export function evaluateGuard(toolName, args, options = {}) {
  const mode = GUARD_MODES.includes(options.mode) ? options.mode : 'warn'
  const level = GUARD_LEVELS.includes(options.level) ? options.level : 'high'
  const allowRules = new Set(Array.isArray(options.allowRules) ? options.allowRules : [])
  const allowTools = new Set(Array.isArray(options.allowTools) ? options.allowTools.map(item => String(item).toLowerCase()) : [])
  const sessionAllow = options.sessionAllow instanceof Set ? options.sessionAllow : new Set()
  // 「静音规则」（目前只有覆盖写）默认不报：写文件是最高频动作，
  // 每次都在面板里报一条只会淹掉真正该看的告警。想收这份噪声的人显式打开。
  const includeQuiet = options.includeQuiet === true

  const name = typeof toolName === 'string' ? toolName : ''
  const text = commandTextOf(args)
  const allow = () => ({ action: 'allow', rule: null, risk: null, reason: '', reasonEn: '', text })

  if (mode === 'off') return allow()
  if (name && allowTools.has(name.toLowerCase())) return allow()
  // 只读工具不跑命令正则，但**不能整体放行**：标了 `alwaysCheck` 的规则
  // （读取凭据）恰恰只发生在读类工具上，这里一律 return allow() 会让它永远不命中。
  const skipTool = GUARD_SKIP_TOOLS.has(name)

  const normalized = typeof args === 'string' ? args : (() => {
    try {
      return JSON.stringify(args ?? {})
    } catch {
      return ''
    }
  })()

  // JSON.stringify 会把 Windows 路径里的反斜杠转义成两个（`C:\\Windows\\...`），
  // 而规则里写的是 `/[a-z]:\\windows/`（只认单个反斜杠）。不还原的话，
  // 「写到系统目录」这类规则在真实参数上永远不命中 —— 两种写法都喂给正则。
  const unescaped = normalized.replace(/\\\\/g, '\\')
  const haystack = `${text}\n${normalized}\n${unescaped}`

  for (const rule of GUARD_RULES) {
    if (skipTool && rule.alwaysCheck !== true) continue
    if (rule.tools && !rule.tools.includes(name)) continue
    if (allowRules.has(rule.id) || sessionAllow.has(rule.id)) continue
    if (rule.quiet === true && !includeQuiet) continue

    let hit = false
    if (rule.always) {
      hit = true
    } else if (rule.patterns.length > 0) {
      hit = rule.patterns.some(pattern => pattern.test(haystack))
    }
    if (!hit) continue

    const risk = RISK_LEVELS[rule.level] ?? RISK_LEVELS.medium
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

/**
 * 把一次评估结果变成 `tools/pre-execute` 需要的返回值。
 * 只有 deny 才真的挡下调用；warn 返回 `undefined`（放行，交给日志与面板）。
 */
export function denyPayload(verdict) {
  if (!verdict || verdict.action !== 'deny' || !verdict.rule) return undefined
  const label = verdict.rule.label
  return {
    kind: 'deny',
    reason: `[ai-action-translator] 拦下「${label}」：${verdict.reason} 如果确认要做，请在面板里临时放行这一类动作，或自己手动执行。`,
  }
}

/**
 * 一句话摘要，给日志与活动面板用。
 */
export function guardSummary(verdict) {
  if (!verdict || verdict.action === 'allow' || !verdict.rule) return ''
  const prefix = verdict.action === 'deny' ? '已拦下' : '注意到'
  return `${prefix}「${verdict.rule.label}」`
}
