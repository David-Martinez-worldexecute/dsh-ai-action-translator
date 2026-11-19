/**
 * 提示词动态装配（E 方向）。
 *
 * 要解决的问题（真实存在，不是想象）：
 *   `buildSectionText(cfg)` 生成的长段策略是**静态**的——启动时按 YAML 基线注册一次。
 *   用户在面板里关掉「一步一步解析」「框架地图」「Skill 协作」之后，
 *   静态段里那几节文字仍然在提示词里，模型可能照着它讲用户并不想要的东西。
 *
 * 为什么不用「按配置重新注册 section」：
 *   宿主对 section 的注册是启动期行为，改配置后重启才生效（0.6.0 的设计前提）。
 *   而 `systemPrompt.context` 的 text 可以是函数——**每次组装提示词时现取**。
 *   于是正确做法是：静态段保持不动，用一个动态 context 把「本轮实际生效的装配」
 *   明确写出来，并显式告诉模型「这些没开，不要主动讲」。
 *
 * 边界：
 *   1. 只描述开关状态与颗粒度，不重复策略正文（正文已在静态段里）。
 *   2. 不裁剪静态段本身（做不到，也不该偷偷改注册内容）。
 *   3. 安全类边界（敏感工具、守门）**永不省略**：它不是可选项，写死在文本里。
 */

/** 面板上一共有哪些「会改变讲解行为」的开关；id 与 Config 字段名保持一致。 */
export const ASSEMBLE_FEATURES = [
  { id: 'stepParse', zh: '一步一步拆解动作', en: 'numbered step-by-step breakdown' },
  { id: 'frameworkMap', zh: '项目框架地图（入口→配置→核心→工具→输出→测试）', en: 'project map (entry -> config -> core -> tools -> output -> tests)' },
  { id: 'stageSummary', zh: '阶段小结', en: 'stage summaries' },
  { id: 'skillCollaboration', zh: '与其他学习 Skill 协作', en: 'collaboration with other learning skills' },
  { id: 'actionDigest', zh: '最近动作摘要', en: 'recent-actions digest' },
  { id: 'timeline', zh: '动作时间线（只给人看）', en: 'action timeline (human-facing only)' },
  { id: 'glossary', zh: '术语卡片', en: 'term cards' },
  { id: 'failureBook', zh: '失败案例库', en: 'failure book' },
  { id: 'drill', zh: '学习练习册', en: 'learning drill' },
]

/** 这些开关打开时会往提示词里塞内容；关掉后要明确告知模型「本轮没有这块」。 */
const PROMPT_FACING = ['stepParse', 'frameworkMap', 'stageSummary', 'skillCollaboration', 'actionDigest', 'drill']

const DETAIL_LABEL = {
  zh: { brief: '简洁：只讲当前这一步', normal: '标准：讲清这一步与相邻一步', thorough: '详细：补术语与底层逻辑' },
  en: { brief: 'brief: only the current step', normal: 'standard: current step plus its neighbour', thorough: 'thorough: terms and underlying mechanics' },
}

// 下面三张表的 key 必须与 lib/index.js 的 Config 完全一致（不一致就回落到 key 本身，
// 提示词里会冒出 `runtime` 这种半截英文）。当前真实取值：
//   detail         = brief | thorough
//   learningStage  = foundation | framework | runtime | code
//   knowledgeLevel = plain | guided | balanced | deep
// 多留一档没坏处（回落到 fallback），少一档才是 bug。
const STAGE_LABEL = {
  zh: {
    foundation: '基础词汇层（先把「这是什么东西」对上号）',
    framework: '项目框架层（先建地图，再选一个局部深入）',
    runtime: '运行时与调用链层（请求怎么走、谁调谁）',
    code: '代码结构层（读具体文件与函数）',
  },
  en: {
    foundation: 'basic vocabulary (what the thing is called)',
    framework: 'project framework (map first, then one local deep dive)',
    runtime: 'runtime and call chain (how a request travels)',
    code: 'code structure (specific files and functions)',
  },
}

const LEVEL_LABEL = {
  zh: {
    plain: '只讲人话，不给术语',
    guided: '引导：先白话，再术语，再补一层原理',
    balanced: '白话与术语并行，按需补充',
    deep: '可以直接用术语，并补底层机制',
  },
  en: {
    plain: 'plain words only',
    guided: 'guided: plain words, then terms, then one layer deeper',
    balanced: 'balanced: plain words and terms side by side',
    deep: 'terms are fine; add the underlying mechanics',
  },
}

const pick = (table, language, key, fallback = '') => {
  const row = table[language === 'en' ? 'en' : 'zh'] || {}
  return row[key] || fallback || String(key || '')
}

/**
 * 生成「本轮装配说明」。
 *
 * @param {object} current 归一化后的当前配置（getMerged() 的返回值）
 * @param {object} [options] { language } —— 语言优先取配置本身，options 只做兜底
 * @returns {string} 空串表示不需要额外说明（所有相关开关都开着时只说颗粒度）
 */
export function assembleText(current, options = {}) {
  if (!current || typeof current !== 'object') return ''
  const language = (options.language || current.language) === 'en' ? 'en' : 'zh'
  const off = PROMPT_FACING.filter((id) => current[id] === false || current[id] === undefined)
  const detail = pick(DETAIL_LABEL, language, current.detail, current.detail)
  const stage = pick(STAGE_LABEL, language, current.learningStage, current.learningStage)
  const level = pick(LEVEL_LABEL, language, current.knowledgeLevel, current.knowledgeLevel)
  const guard = current.guardMode && current.guardMode !== 'off'

  if (language === 'en') {
    const lines = [
      '## Assembly note for this turn (generated from the live settings)',
      `- Depth: ${detail}`,
      `- Stage: ${stage}`,
      `- Explanation level: ${level}`,
      `- Pre-flight guard: ${guard ? `on (${current.guardMode})` : 'off — it listens to no execution events, do not describe it as protecting anything'}`,
    ]
    if (off.length > 0) {
      const names = ASSEMBLE_FEATURES.filter((item) => off.includes(item.id)).map((item) => item.en)
      lines.push(`- Switched off this turn, so do not volunteer them: ${names.join('; ')}`)
      lines.push('  If the user asks about one of them, say plainly that it is off and how to turn it on. Never pretend it is active.')
    }
    lines.push('- Security boundaries from the policy section always apply, whatever is switched off.')
    return lines.join('\n')
  }
  const lines = [
    '## 本轮装配说明（按当前设置现算）',
    `- 解释深度：${detail}`,
    `- 所处阶段：${stage}`,
    `- 讲解档位：${level}`,
    `- 事前守门：${guard ? `已开（${current.guardMode}）` : '关闭——它不监听任何执行事件，不要把「已经帮你拦下风险」当成事实来讲'}`,
  ]
  if (off.length > 0) {
    const names = ASSEMBLE_FEATURES.filter((item) => off.includes(item.id)).map((item) => item.zh)
    lines.push(`- 本轮关掉、不要主动讲：${names.join('；')}`)
    lines.push('  用户主动问起时，如实说「这项现在是关的」以及怎么打开；不要假装它在生效。')
  }
  lines.push('- 无论开关怎么设，策略段里的安全边界始终有效。')
  return lines.join('\n')
}
