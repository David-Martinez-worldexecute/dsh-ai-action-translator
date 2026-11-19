/**
 * 术语表：把 DSH 与工程里最常卡住初学者的词，各压成一句话。
 *
 * 为什么要有这个文件，而不是把术语解释直接写进提示词：
 *   1. 写进代码才能被单测——术语解释写错、写重复、和文档冲突，测试能抓到；
 *   2. 提示词只有有限预算，全表塞进去会撑爆；这里能按需取前 N 条；
 *   3. 同一个词在 SKILL.md、README、面板三处出现时，只有一份事实来源。
 *
 * 设计约束（重要）：
 *   - 每个词条只给「一句话」，不写论文。初学者要的是能立刻用于判断的最小定义。
 *   - 有歧义的词必须点破歧义（如 token 既指「令牌」也指「词元」）。
 *   - 不做同义词猜测：查不到就返回 undefined，让调用方如实说「没收录」。
 */

/**
 * 词条形状：
 *   term   —— 出现在文字里的原样拼写（大小写敏感的写法）
 *   zh/en  —— 一句话解释（不超过 60 字，强制自己说清）
 *   aliases—— 可能出现的其它写法，只用于查找，不用于显示
 */
export const GLOSSARY = [
  {
    term: 'waterfall',
    zh: '一种「接收方能插一脚、还能改结果」的钩子：事件按顺序传给每个监听者，谁都能改写往下传的值。',
    en: 'A hook where each listener can change the value passed to the next one — the result is what the last listener leaves behind.',
    aliases: ['waterfall hook'],
  },
  {
    term: 'emit',
    zh: '只通知、不收集返回值的广播。监听者拿到了也改不了调用方，所以用它做旁路观察是安全的。',
    en: 'A broadcast that collects no return value. Listeners cannot change the caller, which is why it is safe for side-channel observation.',
    aliases: ['event', 'broadcast'],
  },
  {
    term: 'peerDependency',
    zh: '由宿主提供、不跟着这个包装进 node_modules 的依赖：装它的人必须自己已经有一份。',
    en: 'A dependency the host provides; it is not installed with your package, so whoever installs you must already have one.',
    aliases: ['peer dependency', 'peerDependencies'],
  },
  {
    term: 'inject',
    zh: '声明「我需要用到某个服务」，由框架在它可用时把你叫起来，而不是你自己去 new 一个。',
    en: 'Declare that you need a service and let the framework call you when it is available, instead of constructing it yourself.',
    aliases: ['dependency injection', '依赖注入'],
  },
  {
    term: 'slot',
    zh: '界面上预留的一块位置，插件往里塞自己的界面，不用改宿主的前端代码。',
    en: 'A reserved place in the host UI where a plugin renders its own interface without patching host code.',
    aliases: ['插槽'],
  },
  {
    term: 'HMR',
    zh: '热更新：改完代码不重启进程就替换掉已加载的模块。只有前端包通常真的能做到，服务端代码常需重启。',
    en: 'Hot module replacement: swap loaded code without restarting. Usually reliable for client bundles; server code often still needs a restart.',
    aliases: ['hot module replacement', '热更新'],
  },
  {
    term: 'manifest',
    zh: '包里的「说明文件」，声明这个包会被怎么加载、挂到哪、暴露哪些入口。',
    en: 'The package\'s declaration file: how it is loaded, where it mounts, which entries it exposes.',
    aliases: ['清单'],
  },
  {
    term: 'ring buffer',
    zh: '固定大小的环形缓冲区：写满了就把最旧的挤掉，内存占用永远不涨。',
    en: 'A fixed-size buffer that overwrites the oldest entry when full, so memory never grows.',
    aliases: ['环形缓冲', '环形缓冲区'],
  },
  {
    term: 'atomic write',
    zh: '先写临时文件再整体改名覆盖：中途断电也只会留下旧文件，不会留半截坏文件。',
    en: 'Write a temp file, then rename over the target: a crash leaves the old file intact instead of a half-written one.',
    aliases: ['原子写', '原子写入'],
  },
  {
    term: 'loopback',
    zh: '只在本机内部走的地址（127.0.0.1 / ::1 / localhost），外部网络访问不到。',
    en: 'An address that only works inside this machine (127.0.0.1 / ::1 / localhost); the outside network cannot reach it.',
    aliases: ['回环', '本机地址'],
  },
  {
    term: '401',
    zh: 'HTTP「未认证」：服务器不知道你是谁。这里通常是没带上登录票据，而不是权限不够。',
    en: 'HTTP "Unauthorized": the server does not know who you are — usually a missing credential, not insufficient permission.',
    aliases: ['401 Unauthorized'],
  },
  {
    term: 'EPERM',
    zh: '操作系统层面的「不允许」：常见于沙箱禁止某个动作、或文件被别的进程占用。不是代码写错了。',
    en: 'An OS-level denial: often a sandbox blocking the action or a file held by another process. Not necessarily a code bug.',
    aliases: ['EACCES'],
  },
  {
    term: 'link:',
    zh: 'package.json 里指向本地目录的依赖写法：改动源目录立刻反映到使用方，不需要重新安装。',
    en: 'A dependency entry pointing at a local directory: edits show up immediately without reinstalling.',
    aliases: ['link dependency', '本地链接'],
  },
  {
    term: 'idempotent',
    zh: '同一件事做一次和做十次结果一样。写脚本时尽量做成这样，重跑才安全。',
    en: 'Doing it once and doing it ten times give the same result. Make scripts idempotent so re-running is safe.',
    aliases: ['幂等'],
  },
  {
    term: 'sandbox',
    zh: '给程序划定的活动范围：超出范围的动作会被拒绝，用来防止误伤本机。',
    en: 'A boundary around what a process may touch; actions outside it are refused to protect the machine.',
    aliases: ['沙箱'],
  },
  {
    term: 'token',
    zh: '这个词有两个意思，看到时要分清：登录用的「令牌」，和模型计费用的「词元」。',
    en: 'Two meanings — an authentication token, or a model billing token. Disambiguate when you see it.',
    aliases: ['令牌', '词元'],
  },
]

/** 小写索引：term 与 aliases 都指回同一条词条。 */
export const GLOSSARY_INDEX = (() => {
  const index = new Map()
  for (const entry of GLOSSARY) {
    index.set(entry.term.toLowerCase(), entry)
    for (const alias of entry.aliases ?? []) index.set(alias.toLowerCase(), entry)
  }
  return index
})()

/** 全部可查写法（测试与文档用）。 */
export const GLOSSARY_KEYS = [...GLOSSARY_INDEX.keys()]

/**
 * 查一个词。查不到返回 undefined —— 调用方据此如实说「没收录」，
 * 而不是编一个看起来合理的解释。
 */
export function lookupTerm(word) {
  if (typeof word !== 'string') return undefined
  return GLOSSARY_INDEX.get(word.trim().toLowerCase())
}

/**
 * 生成给提示词用的术语段。
 * 只取前 `limit` 条（默认 10）——术语太多会把讲解预算挤掉，反而更难懂。
 */
export function glossarySection(language = 'zh', limit = 10) {
  const rows = GLOSSARY.slice(0, Math.max(0, Math.trunc(Number(limit) || 0)))
  if (rows.length === 0) return ''
  const isEn = language === 'en'
  const lines = rows.map((entry) => `- **${entry.term}** — ${isEn ? entry.en : entry.zh}`)
  return [
    isEn
      ? '### Terms that usually need one plain sentence the first time they appear'
      : '### 首次出现就该给一句话的术语（只解释一次，不复述）',
    ...lines,
    isEn
      ? 'When a term is not in this list, explain it from its observable behaviour instead of inventing a definition.'
      : '不在表里的术语，按可观察行为现讲一句，不要编造定义。',
  ].join('\n')
}
