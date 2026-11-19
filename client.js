/**
 * AI 动作翻译器 · 浏览器半身（client half）
 *
 * 为什么需要这个文件：
 *   `dsh web` 内核把 `/api*` 和首页锁在「启动令牌 → 签名 Cookie」之后。用户若在浏览器
 *   地址栏直接输入插件地址，内核会先回 401（正文 `dsh web authentication required`），
 *   请求根本到不了插件。这是内核的票据保护，不是插件缺陷。
 *
 *   把配置界面做成「长在已登录 GUI 里的一个设置分区」，就绕开了这个问题：分区代码运行在
 *   已经通过校验的页面里，向同源 `${API_PATH}/*` 发请求时浏览器自动带上会话 Cookie，
 *   永远命中不到 401 分支。因此本插件的主入口是一个分区，而不是一个网址。
 *
 * 为什么没有构建步骤：
 *   与 dsh-our-free-model / dsh-plan-mode-plus 同构——手写 ModuleLoader 包，`react`
 *   由外壳提供，不引入任何依赖。全部样式取自主题变量，跟随明暗主题。
 *
 * 本文件不联网、不执行系统命令、不读写用户项目；只与本机同源插件路由通信。
 */
window.__ModuleLoader__.load({
  id: 'dsh-ai-action-translator',
  factory: require => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const { createElement: h, useState, useEffect, useCallback, useMemo } = React

    const NS = 'plugin.aiActionTranslator'

    /** 服务依赖：slots 提供设置分区坑位，locale 提供界面文案与语言。 */
    const inject = ['slots', 'locale']

    // ── 界面文案 ────────────────────────────────────────────────────────────────
    const DICT = {
      zh: {
        nav: 'AI 动作翻译器',
        title: 'AI 动作翻译器 · 配置',
        intro: '这里的改动保存到插件自己的 settings.json，下一轮对话自动生效，不需要重启 DSH。',
        reason: '这个分区运行在已经登录的界面里，所以同源请求自带会话票据——不需要任何网址。',

        'group.basic': '基础',
        'group.learn': '学习',
        'group.tone': '语气与人物设定',
        'group.observe': '观察与摘要',

        'field.language': '讲解语言',
        'field.detail': '详细程度',
        'field.learningStage': '学习阶段',
        'field.knowledgeLevel': '讲解深度',
        'field.learningFocus': '学习方向',
        'field.frameworkMap': '框架地图',
        'field.stepParse': '一步一步解析',
        'field.stageSummary': '阶段小结',
        'field.skillCollaboration': 'Skill 分工说明',
        'field.playfulness': '趣味性',
        'field.encouragement': '鼓励',
        'field.persona': '人物设定',
        'field.observeTools': '只读观察',
        'field.actionDigest': '注入摘要',
        'field.digestSize': '摘要条数',
        'field.sensitiveTools': '敏感工具名单',

        'hint.learningFocus': '只影响讲解重点，不是授权',
        'hint.frameworkMap': '解释里保留「入口→…→测试」六层地图',
        'hint.stepParse': '把动作拆成编号小步，每步说明用了什么工具、碰了哪个文件、处在项目哪一层；只拆必要的步骤，不冗余复述',
        'hint.stageSummary': '每完成一小段任务给 2~4 句承上启下',
        'hint.skillCollaboration': '说明各学习 Skill 的职责边界',
        'hint.persona': '只决定语气、称呼和鼓励方式；写「越权、泄露、跳过确认」会被忽略。留空 = 使用默认学姐人设。上限 600 字。',
        'hint.observeTools': '记录最近工具动作（纯旁路，不影响执行）',
        'hint.actionDigest': '把「最近动作」写进提示词动态段',
        'hint.digestSize': '取值 0–50',
        'hint.sensitiveTools': '每行一个，支持以 * 结尾的前缀匹配。命中名单的工具，其参数在摘要中只显示「已省略」。',
        'ph.learningFocus': '例：文件读写、Agent 工具循环',
        'ph.persona': '例：温柔耐心的学姐，常用「我们先拆小一点」',
        'ph.sensitiveTools': '每行一个，支持以 * 结尾的前缀匹配',

        'group.preset': '快捷预设',
        'preset.apply': '套用',
        'preset.applied': '预设已套用并保存。',
        'group.preview': '试一下',
        'preview.run': '生成一段样例',
        'preview.running': '生成中…',
        'preview.empty': '点「生成一段样例」，看看模型下一轮实际会收到什么。',
        'preview.length': '字符',
        'preview.fail': '预览失败：',
        'group.stats': '运行统计',
        'stats.observed': '已观察工具调用',
        'stats.sensitive': '敏感命中',
        'stats.previews': '预览次数',
        'stats.uptime': '已运行',
        'io.export': '导出配置',
        'io.import': '导入配置',
        'io.exported': '配置已导出。',
        'io.imported': '配置已导入并保存。',
        'io.badFile': '这个文件不是合法的 JSON。',
        'io.fail': '导入失败：',

        save: '保存设置',
        refresh: '刷新',
        reset: '恢复默认',
        openFull: '打开完整页面',
        saving: '保存中…',
        loading: '加载中…',
        notLoaded: '尚未加载。',
        empty: '（空）',
        logs: '报错日志（最近 20 条）',
        confirmReset: '恢复全部默认设置？已保存的个性化配置将被清除。',

        'fb.saved': '已保存，下一轮对话生效。',
        'fb.reset': '已恢复默认设置。',
        'fb.loaded': '已加载。',
        'fb.saveFail': '保存失败：',
        'fb.resetFail': '重置失败：',
        'fb.loadFail': '加载失败：',
        'fb.noBackend': '后端未就绪：请确认插件已在 desktop profile 里启用（enabled: true），或稍后重试。',
        'fb.missing': '后端路由未挂载（404）。常见原因是插件加载时读取了一个未声明的宿主服务而报错，异常被吞掉后路由就没注册。请重启 DSH 让修复后的插件重新加载；若仍失败，看下面的报错日志。',
        'fb.gate': '检测到内核票据拦截（401）。请从 DSH 设置页进入本分区，不要手敲地址。',
        'fb.needFix': '请先修正下列字段：',

        status: (n, at) => `保存次数 ${n}，上次保存 ${at}。`,
        never: '从未',
        digestRows: '摘要缓存',
        rows: '条',
        apiPath: '接口前缀',
      },
      en: {
        nav: 'AI Action Translator',
        title: 'AI Action Translator · Config',
        intro: 'Changes are saved to the plugin\'s own settings.json and take effect on the next turn. No DSH restart needed.',
        reason: 'This section runs inside the already-signed-in GUI, so same-origin requests carry the session ticket automatically — no URL required.',

        'group.basic': 'Basics',
        'group.learn': 'Learning',
        'group.tone': 'Tone & persona',
        'group.observe': 'Observation & digest',

        'field.language': 'Language',
        'field.detail': 'Detail',
        'field.learningStage': 'Learning stage',
        'field.knowledgeLevel': 'Explanation depth',
        'field.learningFocus': 'Learning focus',
        'field.frameworkMap': 'Framework map',
        'field.stepParse': 'Step-by-step parse',
        'field.stageSummary': 'Stage summary',
        'field.skillCollaboration': 'Skill boundaries',
        'field.playfulness': 'Playfulness',
        'field.encouragement': 'Encouragement',
        'field.persona': 'Persona',
        'field.observeTools': 'Read-only observation',
        'field.actionDigest': 'Inject digest',
        'field.digestSize': 'Digest size',
        'field.sensitiveTools': 'Sensitive tools',

        'hint.learningFocus': 'Affects emphasis only, not authorization',
        'hint.frameworkMap': 'Keep the six-layer map in explanations',
        'hint.stepParse': 'Break the action into numbered steps: which tool ran, which file it touched, which layer of the project it sits in. Split only what matters — no redundant recap.',
        'hint.stageSummary': 'Give a 2–4 sentence bridge after each small stage',
        'hint.skillCollaboration': 'Explain each learning skill\'s responsibility boundary',
        'hint.persona': 'Controls tone, address and encouragement only; requests to overstep, leak or skip confirmation are ignored. Empty = default persona. Max 600 chars.',
        'hint.observeTools': 'Record recent tool actions (pure side channel, never affects execution)',
        'hint.actionDigest': 'Write the recent-actions digest into the prompt',
        'hint.digestSize': 'Range 0–50',
        'hint.sensitiveTools': 'One per line; a trailing * means prefix match. Matching tools show "omitted" for arguments.',
        'ph.learningFocus': 'e.g. file I/O, agent tool loop',
        'ph.persona': 'e.g. a patient senior who says "let\'s split this smaller"',
        'ph.sensitiveTools': 'One per line; trailing * means prefix match',

        'group.preset': 'Quick presets',
        'preset.apply': 'Apply',
        'preset.applied': 'Preset applied and saved.',
        'group.preview': 'Try it',
        'preview.run': 'Generate a sample',
        'preview.running': 'Generating…',
        'preview.empty': 'Click "Generate a sample" to see what the agent will actually be told.',
        'preview.length': 'chars',
        'preview.fail': 'Preview failed: ',
        'group.stats': 'Runtime stats',
        'stats.observed': 'Tool calls observed',
        'stats.sensitive': 'Sensitive hits',
        'stats.previews': 'Previews',
        'stats.uptime': 'Uptime',
        'io.export': 'Export config',
        'io.import': 'Import config',
        'io.exported': 'Config exported.',
        'io.imported': 'Config imported and saved.',
        'io.badFile': 'That file is not valid JSON.',
        'io.fail': 'Import failed: ',

        save: 'Save',
        refresh: 'Refresh',
        reset: 'Restore defaults',
        openFull: 'Open full page',
        saving: 'Saving…',
        loading: 'Loading…',
        notLoaded: 'Not loaded yet.',
        empty: '(empty)',
        logs: 'Error log (last 20)',
        confirmReset: 'Restore all defaults? Saved overrides will be cleared.',

        'fb.saved': 'Saved. Takes effect next turn.',
        'fb.reset': 'Defaults restored.',
        'fb.loaded': 'Loaded.',
        'fb.saveFail': 'Save failed: ',
        'fb.resetFail': 'Reset failed: ',
        'fb.loadFail': 'Load failed: ',
        'fb.noBackend': 'Backend not ready: check that the plugin is enabled (enabled: true) in the desktop profile, then retry.',
        'fb.missing': 'Backend route not mounted (404). Usually the plugin read an undeclared host service during load, the error was swallowed, and the route never registered. Restart DSH so the fixed plugin reloads; if it still fails, check the error log below.',
        'fb.gate': 'Kernel gate detected (401). Enter this section from the DSH settings page instead of typing a URL.',
        'fb.needFix': 'Fix these fields first: ',

        status: (n, at) => `Saves: ${n}, last save ${at}.`,
        never: 'never',
        digestRows: 'Digest cache',
        rows: 'rows',
        apiPath: 'API prefix',
      },
    }

    // ── 字段清单（必须与 lib/server.js 的 RUNTIME_KEYS 完全一致） ───────────────
    /** 运行时可改的全部字段。多写一个后端会 400，少写一个界面就改不到。 */
    const FIELD_IDS = [
      'language', 'detail', 'learningStage', 'knowledgeLevel',
      'stageSummary', 'skillCollaboration', 'frameworkMap', 'stepParse',
      'learningFocus', 'playfulness', 'encouragement', 'persona',
      'actionDigest', 'digestSize', 'observeTools', 'sensitiveTools',
    ]

    const BOOL_FIELDS = ['frameworkMap', 'stepParse', 'stageSummary', 'skillCollaboration', 'observeTools', 'actionDigest']
    const TEXT_FIELDS = ['learningFocus', 'persona']
    // 这两个字段用专用控件（数字输入 / 多行文本），不走上面三张分类表。
    const SPECIAL_FIELDS = ['digestSize', 'sensitiveTools']

    /** 下拉字段与候选项：值 → [中文, English]。 */
    const SELECTS = [
      { id: 'language', options: [['zh', '中文', 'Chinese'], ['en', 'English', 'English']] },
      { id: 'detail', options: [['thorough', '详尽（动作前+动作后）', 'Thorough (before + after)'], ['brief', '简洁（四要素）', 'Brief (four elements)']] },
      {
        id: 'learningStage',
        options: [
          ['foundation', '基础：先看懂每一步动作', 'Foundation: read each action'],
          ['framework', '项目框架：入口→配置→模块→输出', 'Framework: entry → config → modules → output'],
          ['runtime', '运行流程：数据怎么流动', 'Runtime: how data flows'],
          ['code', '代码结构：读到具体实现', 'Code: down to the implementation'],
        ],
      },
      {
        id: 'knowledgeLevel',
        options: [
          ['plain', '白话优先', 'Plain first'],
          ['guided', '引导模式（推荐）', 'Guided (recommended)'],
          ['balanced', '均衡', 'Balanced'],
          ['deep', '深入：调用链与异常路径', 'Deep: call chain & error paths'],
        ],
      },
      { id: 'playfulness', options: [['off', '关闭', 'Off'], ['gentle', '温和（推荐）', 'Gentle (recommended)'], ['cheerful', '活泼', 'Cheerful']] },
      { id: 'encouragement', options: [['off', '关闭', 'Off'], ['gentle', '温和', 'Gentle'], ['active', '积极', 'Active']] },
    ]

    const PERSONA_LIMIT = 600
    const DIGEST_MIN = 0
    const DIGEST_MAX = 50
    const REQUEST_TIMEOUT = 8000

    /**
     * 接口前缀按页面的 base 解析，因此根路径部署与子路径部署都正确。
     * 解析失败（无 document 的宿主）退回根路径原值。
     */
    const API_PATH = (() => {
      try { return new URL('api/ai-action-translator', document.baseURI).pathname } catch { return '/api/ai-action-translator' }
    })()

    /** 把网络/协议错误转成用户看得懂的一句话，并区分「票据拦截」与「后端缺失」。 */
    function describeError(error) {
      const status = error && error.status
      if (status === 401) return { kind: 'gate' }
      if (status === 403 || status === 503) return { kind: 'gate' }
      // 404/405 表示「请求到了，但这个路由没人接」——通常意味着宿主那半边没挂上路由。
      if (status === 404 || status === 405) return { kind: 'missing' }
      if (status === undefined) return { kind: 'offline' }
      return { kind: 'text', text: String((error && error.message) || error) }
    }

    /**
     * 同源 JSON 请求。
     * - redirect: 'error' —— 被内部跳转时立刻失败，而不是把 HTML 当 JSON 解析；
     * - 8 秒超时兜底 —— 后端挂起时不让分区永久转圈拖住设置页；
     * - 非 2xx 抛出带 status 的错误，交给调用方降级。
     */
    async function api(path, options) {
      const { timeout = REQUEST_TIMEOUT, ...rest } = options ?? {}
      const ctrl = typeof AbortController === 'function' ? new AbortController() : undefined
      const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout) : undefined
      try {
        const response = await fetch(`${API_PATH}${path}`, { ...rest, redirect: 'error', signal: ctrl && ctrl.signal })
        const text = await response.text()
        let payload
        try { payload = text === '' ? {} : JSON.parse(text) } catch { payload = { error: text.slice(0, 200) } }
        if (!response.ok) {
          const error = new Error(payload && payload.error ? String(payload.error) : `HTTP ${response.status}`)
          error.status = response.status
          throw error
        }
        return payload
      } finally {
        if (timer !== undefined) clearTimeout(timer)
      }
    }

    const post = (path, body) => api(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

    /** 把后端返回的 settings 收敛成表单状态：类型不对就退回默认值，绝不让界面炸掉。 */
    function toForm(settings) {
      const source = settings && typeof settings === 'object' ? settings : {}
      const form = {}
      for (const id of BOOL_FIELDS) form[id] = source[id] === true
      for (const id of TEXT_FIELDS) form[id] = typeof source[id] === 'string' ? source[id] : ''
      for (const entry of SELECTS) {
        const value = source[entry.id]
        const known = entry.options.some(option => option[0] === value)
        form[entry.id] = known ? value : entry.options[0][0]
      }
      const raw = Number(source.digestSize)
      form.digestSize = Number.isFinite(raw) ? Math.min(DIGEST_MAX, Math.max(DIGEST_MIN, Math.trunc(raw))) : 8
      form.sensitiveTools = Array.isArray(source.sensitiveTools)
        ? source.sensitiveTools.filter(item => typeof item === 'string').join('\n')
        : ''
      return form
    }

    /** 表单状态 → 请求体。只发送白名单字段（后端对未知字段直接 400）。 */
    function toPayload(form) {
      const payload = {}
      for (const id of BOOL_FIELDS) payload[id] = form[id] === true
      for (const id of TEXT_FIELDS) payload[id] = String(form[id] ?? '')
      for (const entry of SELECTS) payload[entry.id] = String(form[entry.id] ?? entry.options[0][0])
      const size = Number(form.digestSize)
      payload.digestSize = Number.isFinite(size) ? Math.min(DIGEST_MAX, Math.max(DIGEST_MIN, Math.trunc(size))) : 0
      payload.sensitiveTools = String(form.sensitiveTools ?? '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
      return payload
    }

    /** 提交前的本地校验：能在这里挡住的，就不要浪费一次请求。 */
    function validate(form) {
      const problems = []
      if (String(form.persona ?? '').length > PERSONA_LIMIT) problems.push(`persona ≤ ${PERSONA_LIMIT}`)
      const size = Number(form.digestSize)
      if (!Number.isFinite(size) || size < DIGEST_MIN || size > DIGEST_MAX) problems.push(`digestSize ${DIGEST_MIN}–${DIGEST_MAX}`)
      return problems
    }

    /** 毫秒 → 人读的「x 天 y 小时」/「x 分 y 秒」。未知或非法值显示 —。 */
    function formatUptime(ms) {
      const total = Number(ms)
      if (!Number.isFinite(total) || total < 0) return '—'
      const sec = Math.floor(total / 1000)
      const day = Math.floor(sec / 86400)
      const hour = Math.floor((sec % 86400) / 3600)
      const min = Math.floor((sec % 3600) / 60)
      if (day > 0) return `${day}d ${hour}h`
      if (hour > 0) return `${hour}h ${min}m`
      if (min > 0) return `${min}m ${sec % 60}s`
      return `${sec}s`
    }

    // ── 样式（跟随宿主主题变量；科技感：青色高亮 + 发光 + 大圆角；窄屏自适应收纵向） ──
    const HI = 'var(--dsh-color-accent, #38bdf8)'
    const S = {
      root: { display: 'block', fontSize: '13px', lineHeight: 1.7, color: 'var(--dsh-color-text, inherit)' },
      intro: { fontSize: '12px', opacity: 0.72, margin: '0 0 14px' },
      group: { border: '1px solid var(--dsh-color-border, #8884)', borderRadius: '12px', margin: '0 0 14px', padding: '12px 16px', background: 'color-mix(in srgb, ' + HI + ' 3%, transparent)' },
      legend: { fontSize: '12px', fontWeight: 600, padding: '0 8px', color: HI, letterSpacing: '0.5px' },
      row: { display: 'flex', alignItems: 'center', gap: '10px', margin: '8px 0', flexWrap: 'wrap' },
      label: { minWidth: '120px', fontSize: '12px' },
      hint: { fontSize: '11px', opacity: 0.66 },
      input: { font: 'inherit', padding: '6px 9px', border: '1px solid var(--dsh-color-border, #8888)', borderRadius: '8px', background: 'transparent', color: 'inherit', transition: 'border-color .18s, box-shadow .18s' },
      textarea: { width: '100%', minHeight: '72px', resize: 'vertical', font: 'inherit', padding: '7px 10px', border: '1px solid var(--dsh-color-border, #8888)', borderRadius: '8px', background: 'transparent', color: 'inherit' },
      btns: { display: 'flex', gap: '9px', margin: '4px 0 14px', flexWrap: 'wrap', alignItems: 'center' },
      button: { font: 'inherit', padding: '7px 18px', borderRadius: '9px', border: '1px solid var(--dsh-color-border, #8888)', cursor: 'pointer', background: 'transparent', color: 'inherit', textDecoration: 'none', transition: 'border-color .18s, box-shadow .18s' },
      primary: { font: 'inherit', padding: '7px 18px', borderRadius: '9px', border: '1px solid transparent', cursor: 'pointer', background: 'linear-gradient(135deg, #0ea5e9, #6366f1)', color: '#fff', fontWeight: 600, boxShadow: '0 6px 16px -8px #0ea5e9aa' },
      ok: { borderRadius: '9px', padding: '9px 12px', fontSize: '12px', margin: '10px 0', background: '#22c55e1c', border: '1px solid #22c55e55', whiteSpace: 'pre-wrap' },
      err: { borderRadius: '9px', padding: '9px 12px', fontSize: '12px', margin: '10px 0', background: '#ef44441a', border: '1px solid #ef444455', whiteSpace: 'pre-wrap' },
      status: { fontSize: '11px', opacity: 0.72, margin: '10px 0' },
      logs: { border: '1px dashed var(--dsh-color-border, #8886)', borderRadius: '9px', padding: '9px 12px', fontSize: '11px', maxHeight: '190px', overflow: 'auto' },
      logRow: { margin: '2px 0', fontFamily: 'ui-monospace, Consolas, monospace' },
      warn: { color: 'var(--dsh-color-warning, #fbbf24)' },
      error: { color: 'var(--dsh-color-danger, #f87171)' },
      code: { opacity: 0.72, fontSize: '11px', fontFamily: 'ui-monospace, Consolas, monospace' },
      presetRow: { display: 'flex', gap: '8px', margin: '4px 0 10px', flexWrap: 'wrap', alignItems: 'center' },
      chip: { fontSize: '12px', padding: '5px 12px', borderRadius: '999px', border: '1px solid ' + HI, background: 'transparent', color: 'inherit', cursor: 'pointer' },
      metrics: { display: 'flex', gap: '18px', flexWrap: 'wrap', fontSize: '12px', margin: '4px 0' },
      metric: { display: 'flex', flexDirection: 'column', minWidth: '92px' },
      metricValue: { fontSize: '18px', fontWeight: 600, color: HI, lineHeight: 1.3 },
      metricLabel: { fontSize: '11px', opacity: 0.66 },
      pre: { margin: '6px 0 0', padding: '10px 12px', border: '1px solid var(--dsh-color-border, #8884)', borderRadius: '9px', background: 'color-mix(in srgb, ' + HI + ' 4%, transparent)', fontSize: '11px', lineHeight: 1.6, maxHeight: '220px', overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'ui-monospace, Consolas, monospace' },
      // 注意：React 内联样式不支持 @media；自适应靠 flexWrap + 容器塌缩自然完成。
    }

    /**
     * 设置分区主体。
     *
     * 生命周期：挂载时拉一次 /settings（含 health），之后只有用户点按钮才发请求——
     * 不做轮询，避免两个窗口同时开着时刷日志、并发写同一份 settings.json。
     */
    function SettingsSection(props) {
      const { t } = props
      const [form, setForm] = useState(undefined)
      const [meta, setMeta] = useState({})
      const [health, setHealth] = useState(undefined)
      const [feedback, setFeedback] = useState(undefined)
      const [busy, setBusy] = useState(false)
      /** 预设表由后端下发（lib/presets.js 是唯一事实源），前端不自己维护一份。 */
      const [presets, setPresets] = useState([])
      /** 「试一下」返回的真实提示词段落；undefined = 还没点过。 */
      const [preview, setPreview] = useState(undefined)

      const describe = useCallback((error) => {
        const info = describeError(error)
        if (info.kind === 'gate') return t('fb.gate')
        if (info.kind === 'missing') return t('fb.missing')
        if (info.kind === 'offline') return t('fb.noBackend')
        return info.text
      }, [t])

      const absorb = useCallback((payload) => {
        setForm(toForm(payload && payload.settings))
        setMeta((payload && payload.meta) || {})
        setHealth(payload && payload.health)
        // 预设表只在后端返回时更新：切档后不重新下发也不会清空按钮。
        if (payload && Array.isArray(payload.presets)) setPresets(payload.presets)
      }, [])

      const load = useCallback((quiet) => {
        setBusy(true)
        return api('/settings')
          .then(payload => {
            absorb(payload)
            if (!quiet) setFeedback({ ok: true, text: String((payload && payload.feedback) || t('fb.loaded')) })
          })
          .catch(error => setFeedback({ ok: false, text: `${t('fb.loadFail')}${describe(error)}` }))
          .then(() => { setBusy(false) })
      }, [absorb, describe, t])

      useEffect(() => { load(true) }, [load])

      const set = useCallback((id, value) => {
        setForm(current => (current === undefined ? current : { ...current, [id]: value }))
      }, [])

      const save = useCallback(() => {
        if (form === undefined) return
        const problems = validate(form)
        if (problems.length > 0) {
          setFeedback({ ok: false, text: `${t('fb.needFix')}${problems.join('; ')}` })
          return
        }
        setBusy(true)
        post('/settings', toPayload(form))
          .then(payload => {
            absorb(payload)
            setFeedback({ ok: true, text: String((payload && payload.feedback) || t('fb.saved')) })
          })
          .catch(error => setFeedback({ ok: false, text: `${t('fb.saveFail')}${describe(error)}` }))
          .then(() => { setBusy(false) })
      }, [absorb, describe, form, t])

      const reset = useCallback(() => {
        if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm(t('confirmReset'))) return
        setBusy(true)
        post('/reset', undefined)
          .then(payload => {
            absorb(payload)
            setPreview(undefined)
            setFeedback({ ok: true, text: String((payload && payload.feedback) || t('fb.reset')) })
          })
          .catch(error => setFeedback({ ok: false, text: `${t('fb.resetFail')}${describe(error)}` }))
          .then(() => { setBusy(false) })
      }, [absorb, describe, t])

      /** 一键切档：预设表来自后端，前端只负责发 id。 */
      const applyPreset = useCallback((id) => {
        setBusy(true)
        post('/preset', { id })
          .then(payload => {
            absorb(payload)
            setPreview(undefined)
            setFeedback({ ok: true, text: String(t('preset.applied')) })
          })
          .catch(error => setFeedback({ ok: false, text: `${t('fb.saveFail')}${describe(error)}` }))
          .then(() => { setBusy(false) })
      }, [absorb, describe, t])

      /**
       * 「试一下」：把**当前草稿**（含还没保存的改动）发给 /preview，
       * 后端用真实构建函数生成提示词段落回传。这样用户改完立刻能看见效果。
       */
      const runPreview = useCallback(() => {
        if (form === undefined) return
        setBusy(true)
        post('/preview', { overrides: toPayload(form) })
          .then(payload => setPreview(payload && payload.preview))
          .catch(error => setFeedback({ ok: false, text: `${t('preview.fail')}${describe(error)}` }))
          .then(() => { setBusy(false) })
      }, [describe, form, t])

      /** 导出配置：只导出运行时字段，浏览器下载成 JSON。 */
      const exportConfig = useCallback(() => {
        if (form === undefined) return
        try {
          const blob = new Blob([JSON.stringify(toPayload(form), null, 2)], { type: 'application/json' })
          const url = URL.createObjectURL(blob)
          const link = document.createElement('a')
          link.href = url
          link.download = 'ai-action-translator-settings.json'
          link.rel = 'noreferrer'
          link.click()
          setTimeout(() => URL.revokeObjectURL(url), 1000)
          setFeedback({ ok: true, text: String(t('io.exported')) })
        } catch (error) {
          setFeedback({ ok: false, text: `${t('io.fail')}${String(error && error.message ? error.message : error)}` })
        }
      }, [form, t])

      /**
       * 导入配置：先本地解析 + 白名单过一遍，再走正常的保存接口。
       * 解析失败只提示、不发请求——坏文件不该打到后端。
       */
      const importConfig = useCallback((file) => {
        if (!file) return
        const reader = new FileReader()
        reader.onload = () => {
          let parsed
          try {
            parsed = JSON.parse(String(reader.result || ''))
          } catch {
            setFeedback({ ok: false, text: String(t('io.badFile')) })
            return
          }
          if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            setFeedback({ ok: false, text: String(t('io.badFile')) })
            return
          }
          setBusy(true)
          post('/settings', toPayload(toForm(parsed)))
            .then(payload => {
              absorb(payload)
              setPreview(undefined)
              setFeedback({ ok: true, text: String(t('io.imported')) })
            })
            .catch(error => setFeedback({ ok: false, text: `${t('io.fail')}${describe(error)}` }))
            .then(() => { setBusy(false) })
        }
        reader.onerror = () => setFeedback({ ok: false, text: String(t('io.badFile')) })
        reader.readAsText(file)
      }, [absorb, describe, t])

      const row = (id, control, hint) => h('div', { style: S.row, key: id },
        h('label', { style: S.label, htmlFor: `aat-${id}` }, t(`field.${id}`)),
        control,
        hint ? h('span', { style: S.hint }, hint) : null,
      )

      const select = (entry) => h('select', {
        id: `aat-${entry.id}`, style: S.input, value: form[entry.id],
        onChange: event => set(entry.id, event.target.value),
      }, entry.options.map(option => h('option', { key: option[0], value: option[0] }, option[1])))

      const checkbox = (id) => h('input', {
        id: `aat-${id}`, type: 'checkbox', checked: form[id] === true,
        onChange: event => set(id, event.target.checked),
      })

      const text = (id, placeholder, maxLength) => h('input', {
        id: `aat-${id}`, type: 'text', size: 36, style: S.input, value: form[id],
        placeholder: placeholder === undefined ? undefined : t(placeholder),
        maxLength: maxLength === undefined ? undefined : maxLength,
        onChange: event => set(id, event.target.value),
      })

      const textarea = (id, placeholder, maxLength) => h('textarea', {
        id: `aat-${id}`, style: S.textarea, value: form[id],
        placeholder: placeholder === undefined ? undefined : t(placeholder),
        maxLength: maxLength === undefined ? undefined : maxLength,
        onChange: event => set(id, event.target.value),
      })

      const selectMap = useMemo(() => {
        const map = {}
        for (const entry of SELECTS) map[entry.id] = entry
        return map
      }, [])

      const head = h('div', null,
        h('div', { style: { fontWeight: 600, marginBottom: '2px' } }, t('title')),
        h('div', { style: S.intro }, t('intro')),
      )

      if (form === undefined) {
        return h('div', { style: S.root }, head,
          h('div', { style: S.status }, busy ? t('loading') : t('notLoaded')),
          feedback ? h('div', { style: feedback.ok ? S.ok : S.err }, feedback.text) : null,
        )
      }

      const logRows = (health && Array.isArray(health.log)) ? health.log : []
      const savedAt = meta && meta.savedAt ? new Date(meta.savedAt).toLocaleString() : t('never')

      return h('div', { style: S.root },
        head,

        // ── 快捷预设：一键切整套参数（预设表来自后端，前后端同源） ──
        presets.length > 0 ? h('fieldset', { style: S.group },
          h('legend', { style: S.legend }, t('group.preset')),
          h('div', { style: S.presetRow }, presets.map(entry => h('button', {
            key: entry.id,
            type: 'button',
            style: S.chip,
            disabled: busy,
            title: t('preset.apply') + ' ' + (entry.label || entry.id),
            onClick: () => applyPreset(entry.id),
          }, entry.label || entry.id))),
          h('div', { style: S.hint }, presets.map(entry => `${entry.label || entry.id}：${entry.hint || ''}`).join(' · ')),
        ) : null,

        h('fieldset', { style: S.group },
          h('legend', { style: S.legend }, t('group.basic')),
          row('language', select(selectMap.language)),
          row('detail', select(selectMap.detail)),
        ),

        h('fieldset', { style: S.group },
          h('legend', { style: S.legend }, t('group.learn')),
          row('learningStage', select(selectMap.learningStage)),
          row('knowledgeLevel', select(selectMap.knowledgeLevel)),
          row('learningFocus', text('learningFocus', 'ph.learningFocus'), t('hint.learningFocus')),
          row('stepParse', checkbox('stepParse'), t('hint.stepParse')),
          row('frameworkMap', checkbox('frameworkMap'), t('hint.frameworkMap')),
          row('stageSummary', checkbox('stageSummary'), t('hint.stageSummary')),
          row('skillCollaboration', checkbox('skillCollaboration'), t('hint.skillCollaboration')),
        ),

        h('fieldset', { style: S.group },
          h('legend', { style: S.legend }, t('group.tone')),
          row('playfulness', select(selectMap.playfulness)),
          row('encouragement', select(selectMap.encouragement)),
          h('div', { style: S.row }, h('label', { style: S.label, htmlFor: 'aat-persona' }, t('field.persona'))),
          textarea('persona', 'ph.persona', PERSONA_LIMIT),
          h('div', { style: S.hint }, t('hint.persona')),
        ),

        h('fieldset', { style: S.group },
          h('legend', { style: S.legend }, t('group.observe')),
          row('observeTools', checkbox('observeTools'), t('hint.observeTools')),
          row('actionDigest', checkbox('actionDigest'), t('hint.actionDigest')),
          row('digestSize', h('input', {
            id: 'aat-digestSize', type: 'number', min: DIGEST_MIN, max: DIGEST_MAX, step: 1, size: 4, style: S.input,
            value: form.digestSize, onChange: event => set('digestSize', event.target.value),
          }), t('hint.digestSize')),
          h('div', { style: S.row }, h('label', { style: S.label, htmlFor: 'aat-sensitiveTools' }, t('field.sensitiveTools'))),
          textarea('sensitiveTools', 'ph.sensitiveTools'),
          h('div', { style: S.hint }, t('hint.sensitiveTools')),
        ),

        h('div', { style: S.btns },
          h('button', { type: 'button', style: S.primary, disabled: busy, onClick: save }, busy ? t('saving') : t('save')),
          h('button', { type: 'button', style: S.button, disabled: busy, onClick: () => load(false) }, t('refresh')),
          h('button', { type: 'button', style: S.button, disabled: busy, onClick: reset }, t('reset')),
          h('button', { type: 'button', style: S.button, disabled: busy || form === undefined, onClick: exportConfig }, t('io.export')),
          h('label', { style: S.button, title: t('io.import') },
            t('io.import'),
            h('input', {
              type: 'file', accept: 'application/json,.json', style: { display: 'none' },
              onChange: event => {
                const file = event.target && event.target.files && event.target.files[0]
                importConfig(file)
                // 清空 value：否则同一个文件选第二次不会触发 change。
                if (event.target) event.target.value = ''
              },
            }),
          ),
          h('a', {
            style: S.button, href: `${API_PATH}/`, target: '_blank', rel: 'noreferrer',
            title: t('reason'),
          }, t('openFull')),
        ),

        feedback ? h('div', { style: feedback.ok ? S.ok : S.err, role: 'status' }, feedback.text) : null,

        // ── 试一下：显示模型下一轮真实会收到的段落 ──
        h('fieldset', { style: S.group },
          h('legend', { style: S.legend }, t('group.preview')),
          h('div', { style: S.btns },
            h('button', { type: 'button', style: S.button, disabled: busy, onClick: runPreview },
              busy ? t('preview.running') : t('preview.run')),
            preview ? h('span', { style: S.hint }, `${preview.length} ${t('preview.length')} · ${preview.knowledgeLevel || ''} / ${preview.learningStage || ''}`) : null,
          ),
          preview
            ? h('pre', { style: S.pre }, preview.section)
            : h('div', { style: S.hint }, t('preview.empty')),
        ),

        // ── 运行统计：真实计数，证明插件在工作 ──
        h('fieldset', { style: S.group },
          h('legend', { style: S.legend }, t('group.stats')),
          h('div', { style: S.metrics },
            ...[
              [t('stats.observed'), health && health.stats ? health.stats.observed : 0],
              [t('stats.sensitive'), health && health.stats ? health.stats.sensitive : 0],
              [t('stats.previews'), health && health.stats ? health.stats.previews : 0],
              [t('stats.uptime'), formatUptime(health && health.uptimeMs)],
            ].map(([label, value]) => h('div', { style: S.metric, key: String(label) },
              h('span', { style: S.metricValue }, String(value === undefined ? 0 : value)),
              h('span', { style: S.metricLabel }, label),
            )),
          ),
        ),

        h('div', { style: S.status },
          `${t('status')(Number(meta.saveCount) || 0, savedAt)} · ${t('digestRows')} ${health && health.digestRows !== undefined ? health.digestRows : 0} ${t('rows')} · ${t('apiPath')} `,
          h('code', { style: S.code }, API_PATH),
        ),

        h('fieldset', { style: S.group },
          h('legend', { style: S.legend }, t('logs')),
          h('div', { style: S.logs },
            logRows.length === 0 ? t('empty') : logRows.map((entry, index) => h('div', {
              key: `${entry.at}-${index}`,
              style: entry.level === 'error' ? { ...S.logRow, ...S.error } : entry.level === 'warn' ? { ...S.logRow, ...S.warn } : S.logRow,
            }, `${new Date(entry.at).toLocaleTimeString()} [${entry.level}] ${entry.text}`)),
          ),
        ),
      )
    }

    /** 把界面文案注册进宿主的 locale 服务；返回销毁函数交给 ctx.effect 回收。 */
    function apply(ctx) {
      try {
        const t = ctx.locale && typeof ctx.locale.bind === 'function' ? ctx.locale.bind(NS) : (key) => key
        ctx.effect(() => ctx.locale.register(NS, DICT), 'ai-action-translator: dictionaries')

        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'ai-action-translator',
          order: 45,
          label: () => t('nav'),
          locale: NS,
        }, props => h(SettingsSection, { ...props, t })))
      } catch (error) {
        // 界面层永远不许把宿主设置页拖垮：缺服务、坑位改名都只记一条警告。
        console.warn('[dsh-ai-action-translator] client half unavailable:', error && error.message ? error.message : error)
      }
    }

    exports.apply = apply
    exports.inject = inject
    exports.name = 'ai-action-translator'
    // 无浏览器测试接缝：node:vm 里注入 stub 后可直接检查字段清单与路径解析。
    exports.__test = { DICT, NS, FIELD_IDS, BOOL_FIELDS, TEXT_FIELDS, SPECIAL_FIELDS, SELECTS, PERSONA_LIMIT, DIGEST_MIN, DIGEST_MAX, API_PATH, toForm, toPayload, validate, describeError }
    return module.exports
  },
})
