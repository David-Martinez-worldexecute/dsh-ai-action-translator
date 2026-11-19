/**
 * 配置界面（服务端渲染的单页 HTML，无外部依赖、无 CDN）。
 *
 * 访问方式：从 DSH 设置页的「AI 动作翻译器」分区点「打开完整页面」，
 * 或从已登录的界面内以同源相对路径打开 api/ai-action-translator/。
 *
 * 不要手敲 http://127.0.0.1:19387/api/ai-action-translator/ ：
 * `dsh web` 内核把 `/api*` 锁在「启动令牌 → 签名 Cookie」之后，直接访问
 * 会先被内核以 401 拦下，请求到不了本插件。这是内核的票据保护，不是插件缺陷。
 *
 * 安全围栏只放行本机回环访问，见 lib/trust.js。
 *
 * 页面职责：
 *  - 展示并编辑所有「运行时可改」的个性化配置（含人物设定 persona）；
 *  - 保存（POST /settings）、刷新（GET /settings + /health）、恢复默认（POST /reset）；
 *  - 保存后立刻给出成功/失败反馈；底部展示插件最近的报错日志。
 * 本文件不联网、不执行任何系统命令。
 */

export const PAGE_VERSION = '0.8.0'

export const CONFIG_PAGE_HTML = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI 动作翻译器 · 配置面板</title>
<style>
  :root {
    color-scheme: dark;
    --hi: #38bdf8; --hi-soft: #38bdf826; --hi-line: #38bdf855;
    --ink: #dbe7f4; --ink-dim: #7d92ab; --card: #0c1421; --panel: #0a111c;
    --border: #1b2a41; --ok: #34d399; --ok-bg: #34d3991f; --er: #f87171; --er-bg: #f871711f;
    --warn: #fbbf24; --errlog: #fca5a5; --r: 12px;
  }
  * { box-sizing: border-box; }
  html { background: #060b13; }
  body {
    font-family: system-ui, "Segoe UI", "Microsoft YaHei", sans-serif;
    margin: 0; padding: 28px 16px 40px; line-height: 1.6; color: var(--ink);
    background:
      radial-gradient(900px 480px at 85% -120px, #38bdf81f, transparent 65%),
      radial-gradient(700px 420px at -80px 100%, #7c3aed1b, transparent 65%),
      #060b13;
  }
  .wrap { max-width: 880px; margin: 0 auto; padding: 0 4px; }
  .card { max-width: 860px; margin: 0 auto; padding: 24px 26px 28px; background: var(--card); border: 1px solid var(--border); border-radius: 16px; box-shadow: 0 18px 50px -18px #000000cc, 0 0 0 1px #38bdf80d; position: relative; overflow: hidden; }
  .card::before { content: ""; position: absolute; inset: 0 0 auto 0; height: 2px; background: linear-gradient(90deg, transparent, var(--hi), #7c3aedcc, transparent); opacity: .85; }
  .brand { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 4px; }
  h1 { font-size: 21px; margin: 0; letter-spacing: .5px; background: linear-gradient(90deg, #eaf6ff, var(--hi)); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .chip { font-size: 11px; color: var(--hi); background: var(--hi-soft); border: 1px solid var(--hi-line); border-radius: 999px; padding: 2px 10px; }
  .sub { color: var(--ink-dim); font-size: 12px; margin: 2px 0 22px; }
  fieldset { border: 1px solid var(--border); border-radius: var(--r); margin: 0 0 16px; padding: 14px 18px 16px; background: var(--panel); }
  legend { font-size: 13px; font-weight: 600; padding: 0 8px; color: var(--hi); letter-spacing: .5px; }
  .row { display: flex; align-items: center; gap: 10px; margin: 9px 0; flex-wrap: wrap; }
  .row > label { min-width: 132px; font-size: 13px; }
  select, input[type=text], input[type=number], textarea {
    font: inherit; padding: 7px 10px; border: 1px solid #26374f; border-radius: 8px;
    background: #0d1626; color: var(--ink); transition: border-color .18s, box-shadow .18s;
  }
  select:focus, input:focus, textarea:focus { outline: none; border-color: var(--hi); box-shadow: 0 0 0 3px var(--hi-soft); }
  textarea { width: 100%; min-height: 84px; resize: vertical; }
  .hint { font-size: 12px; color: var(--ink-dim); }
  .btns { display: flex; gap: 10px; margin: 6px 0 16px; flex-wrap: wrap; }
  /* 预设胶囊按钮：与主按钮区分，看起来像「选项」而不是「执行」 */
  #presetRow button { padding: 6px 16px; border-radius: 999px; border-color: var(--hi-line); background: var(--hi-soft); }
  .btnlike { display: inline-flex; align-items: center; font: inherit; padding: 8px 20px; border-radius: 9px; border: 1px solid #2a3c57; background: #101a2a; color: var(--ink); transition: border-color .18s, box-shadow .18s; }
  .btnlike:hover { border-color: var(--hi-line); box-shadow: 0 0 14px -4px var(--hi-line); }
  /* 统计卡片 */
  .stats { display: flex; gap: 22px; flex-wrap: wrap; }
  .stat { display: flex; flex-direction: column; min-width: 96px; }
  .stat-value { font-size: 20px; font-weight: 600; color: var(--hi); line-height: 1.3; }
  .stat-label { font-size: 11px; color: var(--ink-dim); }
  /* 预览出来的真实提示词段落 */
  pre { margin: 8px 0 0; padding: 12px; border: 1px solid var(--border); border-radius: var(--r); background: var(--panel); font-family: ui-monospace, Consolas, monospace; font-size: 12px; line-height: 1.6; max-height: 240px; overflow: auto; white-space: pre-wrap; word-break: break-word; }
  button { font: inherit; padding: 8px 20px; border-radius: 9px; border: 1px solid #2a3c57; cursor: pointer; background: #101a2a; color: var(--ink); transition: transform .12s, border-color .18s, box-shadow .18s; }
  button:hover { border-color: var(--hi-line); box-shadow: 0 0 14px -4px var(--hi-line); }
  button:active { transform: translateY(1px); }
  button.primary { background: linear-gradient(135deg, #0ea5e9, #6366f1); border-color: transparent; color: #fff; font-weight: 600; box-shadow: 0 6px 18px -8px #0ea5e9aa; }
  button:disabled { opacity: .55; cursor: wait; }
  #feedback { border-radius: 9px; padding: 10px 14px; font-size: 13px; margin: 12px 0; display: none; white-space: pre-wrap; border: 1px solid transparent; animation: slide-in .22s ease-out; }
  #feedback.ok { display: block; background: var(--ok-bg); color: var(--ok); border-color: #34d39944; }
  #feedback.err { display: block; background: var(--er-bg); color: var(--er); border-color: #f8717144; }
  #status { font-size: 12px; color: var(--ink-dim); margin: 12px 0; }
  #status.has { color: var(--hi); }
  #logpanel { border: 1px dashed #26374f; border-radius: 9px; padding: 10px 12px; font-size: 12px; max-height: 210px; overflow: auto; background: #08101b; font-family: ui-monospace, Consolas, monospace; }
  #logpanel div { margin: 2px 0; }
  #timelinepanel, #failurepanel, #glossarypanel { border: 1px dashed #26374f; border-radius: 9px; padding: 10px 12px; font-size: 12px; max-height: 210px; overflow: auto; background: #08101b; font-family: ui-monospace, Consolas, monospace; }
  #timelinepanel div, #failurepanel div, #glossarypanel div { margin: 2px 0; }
  .lv-warn { color: var(--warn); } .lv-error { color: var(--errlog); }
  code { background: #38bdf81a; padding: 1px 6px; border-radius: 4px; color: var(--hi); font-family: ui-monospace, Consolas, monospace; }
  @keyframes slide-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
  @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
  /* 自适应：窄屏全部改纵向排列，标签置顶 */
  @media (max-width: 620px) {
    body { padding: 14px 8px 28px; }
    .card { padding: 18px 14px 22px; border-radius: 13px; }
    .row { flex-direction: column; align-items: stretch; gap: 4px; }
    .row > label { min-width: 0; }
    .btns button { flex: 1 1 auto; }
  }
</style>
</head>
<body>
<div class="card">
  <div class="brand"><h1>AI 动作翻译器 · 配置面板</h1><span class="chip">v${PAGE_VERSION}</span></div>
  <div class="sub">改动保存到插件自己的 settings.json，下一轮对话自动生效；不需要重启 DSH。</div>

  <fieldset>
    <legend>基础</legend>
    <div class="row"><label for="language">讲解语言</label>
      <select id="language"><option value="zh">中文</option><option value="en">English</option></select></div>
    <div class="row"><label for="detail">详细程度</label>
      <select id="detail"><option value="thorough">详尽（动作前+动作后）</option><option value="brief">简洁（四要素）</option></select></div>
  </fieldset>

  <fieldset>
    <legend>学习</legend>
    <div class="row"><label for="learningStage">学习阶段</label>
      <select id="learningStage">
        <option value="foundation">基础：先看懂每一步动作</option>
        <option value="framework">项目框架：入口→配置→模块→输出</option>
        <option value="runtime">运行流程：数据怎么流动</option>
        <option value="code">代码结构：读到具体实现</option>
      </select></div>
    <div class="row"><label for="knowledgeLevel">讲解深度</label>
      <select id="knowledgeLevel">
        <option value="plain">白话优先</option>
        <option value="guided">引导模式（推荐）</option>
        <option value="balanced">均衡</option>
        <option value="deep">深入：调用链与异常路径</option>
      </select></div>
    <div class="row"><label for="learningFocus">学习方向</label>
      <input type="text" id="learningFocus" size="34" placeholder="例：文件读写、Agent 工具循环">
      <span class="hint">只影响讲解重点，不是授权</span></div>
    <div class="row"><label>一步一步解析</label><input type="checkbox" id="stepParse"><span class="hint">把动作拆成编号小步：用了什么工具、碰了哪个文件、处在项目哪一层</span></div>
    <div class="row"><label>框架地图</label><input type="checkbox" id="frameworkMap"><span class="hint">解释里保留「入口→…→测试」六层地图</span></div>
    <div class="row"><label>阶段小结</label><input type="checkbox" id="stageSummary"><span class="hint">每完成一小段任务给 2~4 句承上启下</span></div>
    <div class="row"><label>Skill 分工说明</label><input type="checkbox" id="skillCollaboration"><span class="hint">说明各学习 Skill 的职责边界</span></div>
  </fieldset>

  <fieldset>
    <legend>语气与人物设定</legend>
    <div class="row"><label for="playfulness">趣味性</label>
      <select id="playfulness"><option value="off">关闭</option><option value="gentle">温和（推荐）</option><option value="cheerful">活泼</option></select></div>
    <div class="row"><label for="encouragement">鼓励</label>
      <select id="encouragement"><option value="off">关闭</option><option value="gentle">温和</option><option value="active">积极</option></select></div>
    <div class="row"><label for="persona">人物设定</label></div>
    <textarea id="persona" maxlength="600"></textarea>
    <div class="hint">只决定语气、称呼和鼓励方式；写「越权、泄露、跳过确认」会被忽略。留空 = 使用默认学姐人设。上限 600 字。</div>
  </fieldset>

  <fieldset>
    <legend>观察与摘要</legend>
    <div class="row"><label>只读观察</label><input type="checkbox" id="observeTools"><span class="hint">记录最近工具动作（纯旁路，不影响执行）</span></div>
    <div class="row"><label>注入摘要</label><input type="checkbox" id="actionDigest"><span class="hint">把「最近动作」写进提示词动态段</span></div>
    <div class="row"><label for="digestSize">摘要条数</label>
      <input type="number" id="digestSize" min="0" max="50" step="1" size="4">
      <span class="hint">建议 3~8 条：太少缺上下文，太多反而看不清重点</span></div>
    <div class="row"><label>完整时间线</label><input type="checkbox" id="timeline"><span class="hint">记录最近动作的完整列表（只给面板回看，不写进提示词）</span></div>
    <div class="row"><label for="timelineSize">时间线条数</label>
      <input type="number" id="timelineSize" min="0" max="200" step="1" size="4">
      <span class="hint">0 = 不记录；建议 40</span></div>
    <div class="row"><label>术语卡片</label><input type="checkbox" id="glossary"><span class="hint">waterfall、peerDependency 这类词第一次出现时就地给一句话</span></div>
    <div class="row"><label>失败案例库</label><input type="checkbox" id="failureBook"><span class="hint">把报错按层归档（权限 / 路径 / 依赖 / 网络 / 服务 / 语法 / 测试），下次遇到同类先翻这里</span></div>
    <div class="row"><label>学习练习册</label><input type="checkbox" id="drill"><span class="hint">攒够几条真实动作就自动出一道复述练习（看到什么 / 技术点 / 下一步练什么），只引用真跑过的动作</span></div>
    <div class="row"><label for="drillEvery">每多少个动作出一道</label>
      <input type="number" id="drillEvery" min="2" max="10" step="1" size="4">
      <span class="hint">2–10，默认 3；太小会刷屏，太大会等很久</span></div>
    <div class="row"><label for="sensitiveTools">敏感工具名单</label></div>
    <textarea id="sensitiveTools" placeholder="每行一个，支持以 * 结尾的前缀匹配"></textarea>
    <div class="hint">命中名单的工具，其参数在摘要中只显示「已省略」。不知道写什么？点下面的预设一键填：</div>
    <div class="row" style="margin-top:6px">
      <button type="button" data-preset="dev" style="padding:4px 12px;font-size:12px">开发者档</button>
      <button type="button" data-preset="careful" style="padding:4px 12px;font-size:12px">谨慎档（推荐）</button>
      <button type="button" data-preset="max" style="padding:4px 12px;font-size:12px">全开档</button>
    </div>
    <div class="row" style="margin-top:10px;border-top:1px dashed var(--border);padding-top:10px">
      <label>高级选项</label><input type="checkbox" id="advancedMode">
      <span class="hint">展开下面这块：事前守门、放行名单。不确定就别开，默认全部关闭</span>
    </div>
  </fieldset>

  <fieldset id="advancedBlock" style="display:none">
    <legend>高级：事前守门（默认全关）</legend>
    <div class="hint" style="margin-bottom:8px">
      守门是<b>唯一会「介入」执行</b>的功能：AI 想做一个高风险动作时，插件可以在它动手前拦下。
      默认 <b>关闭</b>——它不监听任何执行事件。打开后也只读你的参数、不修改命令。
    </div>
    <div class="row"><label for="guardMode">守门模式</label>
      <select id="guardMode">
        <option value="off">关闭（默认，完全不介入）</option>
        <option value="warn">提醒（放行，但记一条警告）</option>
        <option value="deny">拦下（返回 deny，让 AI 换做法）</option>
      </select></div>
    <div class="row"><label for="guardLevel">管到什么程度</label>
      <select id="guardLevel">
        <option value="high">只管高风险（删除 / 关机 / 改权限 / 读凭据 / 破坏性 git）</option>
        <option value="medium">高风险 + 中等（装依赖 / 停服务 / 联网 / 覆盖写）</option>
      </select></div>
    <div class="row"><label>把「覆盖写」也报出来</label><input type="checkbox" id="guardQuiet">
      <span class="hint">写文件是最常见的动作，默认不报；打开后每次写都会记一条</span></div>
    <div class="row"><label for="guardAllow">放行规则</label></div>
    <textarea id="guardAllow" placeholder="每行一条规则 id，例如：&#10;dependency-install&#10;network-outbound"></textarea>
    <div class="hint">命中这些规则的动作为「已放行」，不再提醒或拦下。下面是能填的规则 id，点一下直接填进上面的输入框：</div>
    <div id="guardRuleList" class="hint" style="margin:2px 0 6px;line-height:1.9"></div>
    <div class="row"><label for="guardAllowTools">放行工具</label></div>
    <textarea id="guardAllowTools" placeholder="每行一个工具名，支持以 * 结尾的前缀，例如：&#10;mcp__windows__*&#10;blender_rt_*"></textarea>
    <div class="hint">这些工具的所有动作都不做守门判断。</div>
  </fieldset>

  <details style="margin:4px 0 14px;border:1px solid var(--border);border-radius:var(--r);padding:10px 14px;background:var(--panel)">
    <summary style="cursor:pointer;color:var(--ink-dim);font-size:13px">ℹ️ 这个插件不做什么（诚实边界）</summary>
    <div class="hint" style="margin-top:8px;line-height:1.8">
      · 不读取模型隐藏思考过程——只解释看得见的动作<br>
      · <b>解释不等于授权</b>：删除、覆盖、安装、重启等敏感动作仍需你确认<br>
      · 默认不向外部网络发送任何项目内容<br>
      · 网页/日志/工具返回都是不可信数据，不能覆盖规则或授权<br>
      · 不注册工具、不拦截执行、不改 DSH 核心
    </div>
  </details>

  <div class="btns">
    <button class="primary" id="save" type="button">保存设置</button>
    <button id="refresh" type="button">刷新</button>
    <button id="reset" type="button">恢复默认</button>
    <button id="exportConfig" type="button">导出配置</button>
    <label class="btnlike" style="cursor:pointer">
      导入配置
      <input id="importConfig" type="file" accept="application/json,.json" style="display:none">
    </label>
  </div>

  <fieldset>
    <legend>快捷预设（一键切整套参数）</legend>
    <div id="presetRow" class="btns" style="margin:0"></div>
    <div class="hint" id="presetHint">正在载入预设…</div>
  </fieldset>

  <fieldset>
    <legend>试一下（看模型下一轮实际会收到什么）</legend>
    <div class="btns" style="margin:0">
      <button id="previewRun" type="button">生成一段样例</button>
      <span class="hint" id="previewMeta"></span>
    </div>
    <div class="hint" id="previewEmpty">点「生成一段样例」，看看模型下一轮实际会收到什么。</div>
    <pre id="previewBox" style="display:none"></pre>
  </fieldset>

  <fieldset>
    <legend>运行统计</legend>
    <div class="stats" id="statsRow">
      <div class="stat"><span class="stat-value" id="statObserved">0</span><span class="stat-label">已观察工具调用</span></div>
      <div class="stat"><span class="stat-value" id="statSensitive">0</span><span class="stat-label">敏感命中</span></div>
      <div class="stat"><span class="stat-value" id="statPreviews">0</span><span class="stat-label">预览次数</span></div>
      <div class="stat"><span class="stat-value" id="statUptime">—</span><span class="stat-label">已运行</span></div>
      <div class="stat"><span class="stat-value" id="statGuardHits">0</span><span class="stat-label">守门命中</span></div>
      <div class="stat"><span class="stat-value" id="statGuardDenies">0</span><span class="stat-label">守门拦下</span></div>
    </div>
  </fieldset>

  <div id="feedback" role="status" aria-live="polite"></div>
  <div id="status" class="boot">正在初始化面板…</div>
  <fieldset><legend>动作时间线（最近动作，按时间倒序）</legend>
    <div class="hint" id="timelineMeta">正在载入…</div>
    <div id="timelinepanel">（空）</div></fieldset>
  <fieldset><legend>失败案例库（同类报错只记一条，累计次数）</legend>
    <div class="hint" id="failureMeta">正在载入…</div>
    <div id="failurepanel">（空）</div></fieldset>
  <fieldset><legend>术语卡片（第一次出现就地解释一句话）</legend>
    <div id="glossarypanel">（空）</div></fieldset>
  <fieldset><legend>报错日志（最近 20 条）</legend><div id="logpanel">（空）</div></fieldset>
</div>

<script>
'use strict'
var BASE = location.pathname.replace(/\\/ui$/, '').replace(/\\/+$/, '')
var CHECK = ['frameworkMap', 'stepParse', 'stageSummary', 'skillCollaboration', 'observeTools', 'actionDigest', 'timeline', 'glossary', 'failureBook', 'drill', 'guardQuiet', 'advancedMode']
var TEXT = ['learningFocus', 'persona']
var SELECT = ['language', 'detail', 'learningStage', 'knowledgeLevel', 'playfulness', 'encouragement', 'guardMode', 'guardLevel']

// 这几项不走上面三张表：三个数字输入 + 三个多行文本，由 collect() 单独取值。
// 单独声明是为了让「每个字段都要有控件」的守卫测试也能核对到它们。
var SPECIAL = ['digestSize', 'timelineSize', 'drillEvery', 'sensitiveTools', 'guardAllow', 'guardAllowTools']
var fb = document.getElementById('feedback')
var status = document.getElementById('status')

function feedback(ok, message) {
  fb.className = ok ? 'ok' : 'err'
  fb.textContent = message
}
function setStatus(text, has) {
  status.textContent = text
  status.classList.toggle('has', has === true)
}
function collect() {
  var payload = {}
  CHECK.forEach(function (id) { payload[id] = document.getElementById(id).checked })
  SELECT.forEach(function (id) { payload[id] = document.getElementById(id).value })
  payload.learningFocus = document.getElementById('learningFocus').value
  payload.persona = document.getElementById('persona').value
  payload.digestSize = Number(document.getElementById('digestSize').value || 0)
  payload.timelineSize = Number(document.getElementById('timelineSize').value || 0)
  payload.drillEvery = Number(document.getElementById('drillEvery').value || 0)
  payload.sensitiveTools = document.getElementById('sensitiveTools').value
    .split(/\r?\n/).map(function (s) { return s.trim() }).filter(Boolean)
  payload.guardAllow = document.getElementById('guardAllow').value
    .split(/\r?\n/).map(function (s) { return s.trim() }).filter(Boolean)
  payload.guardAllowTools = document.getElementById('guardAllowTools').value
    .split(/\r?\n/).map(function (s) { return s.trim() }).filter(Boolean)
  return payload
}
/** 「高级选项」开关：控制守门那块 fieldset 的显隐。默认收起，面板保持简洁。 */
function toggleAdvanced(open) {
  var block = document.getElementById('advancedBlock')
  if (!block) return
  block.style.display = open === true ? '' : 'none'
}
document.getElementById('advancedMode').addEventListener('change', function () {
  toggleAdvanced(this.checked)
})
function apply(data) {
  var s = data.settings || {}
  CHECK.forEach(function (id) { document.getElementById(id).checked = s[id] !== false && s[id] !== undefined ? !!s[id] : false })
  SELECT.forEach(function (id) { if (s[id] !== undefined) document.getElementById(id).value = s[id] })
  document.getElementById('learningFocus').value = s.learningFocus || ''
  document.getElementById('persona').value = s.persona || ''
  document.getElementById('digestSize').value = (s.digestSize === undefined ? 8 : s.digestSize)
  document.getElementById('timelineSize').value = (s.timelineSize === undefined ? 40 : s.timelineSize)
  document.getElementById('drillEvery').value = (s.drillEvery === undefined ? 3 : s.drillEvery)
  document.getElementById('sensitiveTools').value = (s.sensitiveTools || []).join('\n')
  document.getElementById('guardAllow').value = (s.guardAllow || []).join('\n')
  document.getElementById('guardAllowTools').value = (s.guardAllowTools || []).join('\n')
  toggleAdvanced(s.advancedMode === true)
  var m = data.meta || {}
  setStatus('已加载 · 保存 ' + (m.saveCount || 0) + ' 次 · 上次保存 ' +
    (m.savedAt ? new Date(m.savedAt).toLocaleString() : '从未'), true)
  renderPresets(data.presets)
  renderStats(data.health)
  renderHealth(data.health)
}
/** 预设按钮：由后端下发，点击即 POST /preset（服务端是唯一事实源）。 */
function renderPresets(presets) {
  if (!presets || !presets.length) return
  var row = document.getElementById('presetRow')
  var hint = document.getElementById('presetHint')
  row.innerHTML = ''
  presets.forEach(function (p) {
    var btn = document.createElement('button')
    btn.type = 'button'
    btn.textContent = p.label || p.id
    btn.title = p.hint || ''
    btn.addEventListener('click', function () {
      btn.disabled = true
      api('/preset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: p.id }) })
        .then(function (data) {
          if (!data.ok) throw new Error(data.error || '套用失败')
          apply(data)
          feedback(true, '预设「' + (p.label || p.id) + '」已套用并保存。')
        })
        .catch(function (error) { feedback(false, '套用失败：' + error.message) })
        .then(function () { btn.disabled = false })
    })
    row.appendChild(btn)
  })
  hint.textContent = presets.map(function (p) { return (p.label || p.id) + '：' + (p.hint || '') }).join(' · ')
}
/** 运行统计：真实计数，证明插件在工作。 */
function renderStats(health) {
  if (!health) return
  var s = health.stats || {}
  document.getElementById('statObserved').textContent = s.observed || 0
  document.getElementById('statSensitive').textContent = s.sensitive || 0
  document.getElementById('statPreviews').textContent = s.previews || 0
  document.getElementById('statUptime').textContent = formatUptime(health.uptimeMs)
  // 守门命中 / 拦下：数据层每个请求都在数，但面板之前没展示——
  // 开了守门却看不见它拦过几次，等于没有证据。
  document.getElementById('statGuardHits').textContent = s.guardHits || 0
  document.getElementById('statGuardDenies').textContent = s.guardDenies || 0
}
function formatUptime(ms) {
  var total = Number(ms)
  if (!isFinite(total) || total < 0) return '—'
  var sec = Math.floor(total / 1000)
  var day = Math.floor(sec / 86400)
  var hour = Math.floor((sec % 86400) / 3600)
  var min = Math.floor((sec % 3600) / 60)
  if (day > 0) return day + 'd ' + hour + 'h'
  if (hour > 0) return hour + 'h ' + min + 'm'
  if (min > 0) return min + 'm ' + (sec % 60) + 's'
  return sec + 's'
}
function renderHealth(health) {
  if (!health) return
  var panel = document.getElementById('logpanel')
  var rows = health.log || []
  if (rows.length === 0) { panel.textContent = '（空）'; return }
  panel.innerHTML = ''
  rows.forEach(function (r) {
    var div = document.createElement('div')
    div.className = r.level === 'error' ? 'lv-error' : r.level === 'warn' ? 'lv-warn' : ''
    div.textContent = new Date(r.at).toLocaleTimeString() + ' [' + r.level + '] ' + r.text
    panel.appendChild(div)
  })
}
function renderActivity(data) {
  if (!data || !data.ok) return
  var classes = {}
  ;(data.classes || []).forEach(function (item) { classes[item.id] = item.label })
  var tpanel = document.getElementById('timelinepanel')
  var rows = data.timeline || []
  if (rows.length === 0) {
    tpanel.textContent = '（还没有记录到动作。跑一轮对话，这里就会按时间列出每个工具调用。）'
  } else {
    tpanel.innerHTML = ''
    rows.forEach(function (r) {
      var div = document.createElement('div')
      div.className = r.isError ? 'lv-error' : ''
      var cls = classes[r.classId] || r.classId || '其它动作'
      var took = isFinite(r.durationMs) ? ' · ' + r.durationMs + 'ms' : ''
      // 多 Agent：只显示得出来的归属；没有 agent 上下文（系统级调用）就什么都不加，
      // 不猜成「主 agent」——看不见归属比看错归属安全。
      var who = r.agentLabel ? ' · ' + r.agentLabel : ''
      div.textContent = new Date(r.at).toLocaleTimeString() + ' [' + cls + '] ' + r.name + who +
        (r.isError ? ' · 失败' : '') + took + ' · ' + (r.summary || '') + (r.redacted ? ' ⚠' : '')
      tpanel.appendChild(div)
    })
  }
  var sum = data.summary || {}
  var crew = data.agentSummary || {}
  var crewText = crew.total ? ' · 参与 ' + crew.total + ' 个 agent（在跑 ' + (crew.live || 0) + '）' : ''
  document.getElementById('timelineMeta').textContent =
    '共 ' + (sum.total || 0) + ' 条 · 其中失败 ' + (sum.errors || 0) + ' 次 · 上限 ' + (sum.limit || 0) + crewText +
    '（时间线只给面板回看，不写进提示词）'
  var fpanel = document.getElementById('failurepanel')
  var cases = data.failures || []
  if (cases.length === 0) {
    fpanel.textContent = '（还没有失败案例。报错会按层归档，同一类只记一条并累计次数。）'
  } else {
    fpanel.innerHTML = ''
    cases.forEach(function (c) {
      var box = document.createElement('div')
      box.className = 'lv-warn'
      var head = document.createElement('div')
      head.textContent = '[' + c.layer + '] ' + c.tool + ' ×' + c.count + ' · ' + c.advice
      var body = document.createElement('div')
      body.textContent = c.sample
      box.appendChild(head)
      box.appendChild(body)
      fpanel.appendChild(box)
    })
  }
  var fsum = data.failureSummary || {}
  document.getElementById('failureMeta').textContent =
    '案例 ' + (fsum.cases || 0) + ' 个 · 累计命中 ' + (fsum.hits || 0) + ' 次'
  var gpanel = document.getElementById('glossarypanel')
  var terms = data.glossary || []
  gpanel.innerHTML = ''
  terms.slice(0, 8).forEach(function (g) {
    var div = document.createElement('div')
    div.textContent = g.term + ' — ' + g.zh
    gpanel.appendChild(div)
  })
  // 守门规则清单：用户要填「放行规则」却得自己打开 API 才知道 id，
  // 等于把可用性押在一个人人都不会去看的地方。直接列出来，点一下填进输入框。
  var rulePanel = document.getElementById('guardRuleList')
  if (rulePanel) {
    var rules = data.guardRules || []
    rulePanel.innerHTML = ''
    if (rules.length === 0) {
      rulePanel.textContent = '（没拿到规则清单，点上面的「刷新」再试一次。）'
    } else {
      rules.forEach(function (rule) {
        var chip = document.createElement('span')
        chip.textContent = rule.id + '（' + (rule.label || rule.id) + '）'
        chip.title = rule.zh || ''
        chip.style.cssText = 'display:inline-block;margin:0 8px 4px 0;padding:1px 6px;' +
          'border:1px solid var(--border);border-radius:4px;cursor:pointer'
        chip.addEventListener('click', function () {
          var box = document.getElementById('guardAllow')
          var current = box.value.trim()
          var lines = current ? current.split(/\r?\n/) : []
          var exists = false
          lines.forEach(function (line) { if (line.trim() === rule.id) exists = true })
          if (exists) return
          box.value = current ? current + '\n' + rule.id : rule.id
        })
        rulePanel.appendChild(chip)
      })
    }
  }
}
function api(path, options) { return fetch(BASE + path, options).then(function (res) { return res.json() }) }
function load() {
  return api('/settings').then(function (data) {
    if (!data.ok) throw new Error(data.error || '读取失败')
    apply(data)
    feedback(true, '配置已刷新。')
  }).then(function () {
    return api('/activity').then(renderActivity).catch(function () { /* 面板不可用时保持占位文案 */ })
  }).catch(function (error) { feedback(false, '读取失败：' + error.message) })
}
document.getElementById('save').addEventListener('click', function () {
  var button = this; button.disabled = true
  api('/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(collect()) })
    .then(function (data) {
      if (!data.ok) throw new Error(data.error || '保存失败')
      apply(data)
      feedback(true, data.feedback || '已保存，下一轮对话生效。')
    })
    .catch(function (error) { feedback(false, '保存失败：' + error.message) })
    .then(function () { button.disabled = false; return api('/health').then(renderHealth).catch(function () {}) })
})
document.getElementById('refresh').addEventListener('click', function () { load() })
document.getElementById('reset').addEventListener('click', function () {
  if (!confirm('恢复全部默认设置？已保存的个性化配置将被清除。')) return
  api('/reset', { method: 'POST' }).then(function (data) {
    if (!data.ok) throw new Error(data.error || '重置失败')
    apply(data)
    feedback(true, data.feedback || '已恢复默认设置。')
  }).catch(function (error) { feedback(false, '重置失败：' + error.message) })
})
// ─── 敏感工具预设按钮（新手不用手敲名单）───
var PRESETS = {
  dev: ['rm', 'del', 'Remove-Item', 'rmdir', 'git', 'npm', 'pnpm'],
  careful: ['rm', 'del', 'Remove-Item', 'rmdir', 'install', 'uninstall', 'update', 'git', 'npm', 'pnpm', 'node', 'python', 'uvx', 'kill', 'Stop-Process', 'Stop-Service', 'Restart'],
  max: ['*']
}
document.querySelectorAll('button[data-preset]').forEach(function (btn) {
  btn.addEventListener('click', function () {
    var list = PRESETS[btn.getAttribute('data-preset')] || []
    document.getElementById('sensitiveTools').value = list.join('\n')
    feedback(true, '已填入「' + btn.textContent + '」预设（' + list.length + ' 条）——记得点「保存设置」才生效哦')
  })
})

// ─── 试一下：把当前草稿发给 /preview，展示真实构建出来的提示词段落 ───
document.getElementById('previewRun').addEventListener('click', function () {
  var button = this
  button.disabled = true
  button.textContent = '生成中…'
  api('/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ overrides: collect() }) })
    .then(function (data) {
      if (!data.ok) throw new Error(data.error || '预览失败')
      var p = data.preview || {}
      var box = document.getElementById('previewBox')
      box.textContent = p.section || ''
      box.style.display = 'block'
      document.getElementById('previewEmpty').style.display = 'none'
      document.getElementById('previewMeta').textContent =
        (p.length || 0) + ' 字符 · ' + (p.knowledgeLevel || '') + ' / ' + (p.learningStage || '')
    })
    .catch(function (error) { feedback(false, '预览失败：' + error.message) })
    .then(function () {
      button.disabled = false
      button.textContent = '生成一段样例'
    })
})

// ─── 导出配置：只导出运行时字段，浏览器下载成 JSON ───
document.getElementById('exportConfig').addEventListener('click', function () {
  try {
    var blob = new Blob([JSON.stringify(collect(), null, 2)], { type: 'application/json' })
    var url = URL.createObjectURL(blob)
    var link = document.createElement('a')
    link.href = url
    link.download = 'ai-action-translator-settings.json'
    link.click()
    setTimeout(function () { URL.revokeObjectURL(url) }, 1000)
    feedback(true, '配置已导出。')
  } catch (error) { feedback(false, '导出失败：' + error.message) }
})

// ─── 导入配置：本地解析失败就只提示，不发请求（坏文件不该打到后端）───
document.getElementById('importConfig').addEventListener('change', function (event) {
  var file = event.target.files && event.target.files[0]
  if (!file) return
  var reader = new FileReader()
  reader.onload = function () {
    var parsed
    try { parsed = JSON.parse(String(reader.result || '')) }
    catch (e) { feedback(false, '这个文件不是合法的 JSON。'); return }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      feedback(false, '这个文件不是合法的 JSON。'); return
    }
    api('/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(parsed) })
      .then(function (data) {
        if (!data.ok) throw new Error(data.error || '导入失败')
        apply(data)
        feedback(true, '配置已导入并保存。')
      })
      .catch(function (error) { feedback(false, '导入失败：' + error.message) })
  }
  reader.onerror = function () { feedback(false, '这个文件不是合法的 JSON。') }
  reader.readAsText(file)
  event.target.value = ''
})

load()
</script>
</body>
</html>
`
