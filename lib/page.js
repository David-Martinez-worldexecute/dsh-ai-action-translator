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

export const PAGE_VERSION = '0.3.1'

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
    <div class="row"><label for="sensitiveTools">敏感工具名单</label></div>
    <textarea id="sensitiveTools" placeholder="每行一个，支持以 * 结尾的前缀匹配"></textarea>
    <div class="hint">命中名单的工具，其参数在摘要中只显示「已省略」。不知道写什么？点下面的预设一键填：</div>
    <div class="row" style="margin-top:6px">
      <button type="button" data-preset="dev" style="padding:4px 12px;font-size:12px">开发者档</button>
      <button type="button" data-preset="careful" style="padding:4px 12px;font-size:12px">谨慎档（推荐）</button>
      <button type="button" data-preset="max" style="padding:4px 12px;font-size:12px">全开档</button>
    </div>
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
  </div>

  <div id="feedback" role="status" aria-live="polite"></div>
  <div id="status" class="boot">正在初始化面板…</div>
  <fieldset><legend>报错日志（最近 20 条）</legend><div id="logpanel">（空）</div></fieldset>
</div>

<script>
'use strict'
var BASE = location.pathname.replace(/\\/ui$/, '').replace(/\\/+$/, '')
var CHECK = ['frameworkMap', 'stageSummary', 'skillCollaboration', 'observeTools', 'actionDigest']
var TEXT = ['learningFocus', 'persona']
var SELECT = ['language', 'detail', 'learningStage', 'knowledgeLevel', 'playfulness', 'encouragement']
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
  payload.sensitiveTools = document.getElementById('sensitiveTools').value
    .split(/\\r?\\n/).map(function (s) { return s.trim() }).filter(Boolean)
  return payload
}
function apply(data) {
  var s = data.settings || {}
  CHECK.forEach(function (id) { document.getElementById(id).checked = s[id] !== false && s[id] !== undefined ? !!s[id] : false })
  SELECT.forEach(function (id) { if (s[id] !== undefined) document.getElementById(id).value = s[id] })
  document.getElementById('learningFocus').value = s.learningFocus || ''
  document.getElementById('persona').value = s.persona || ''
  document.getElementById('digestSize').value = (s.digestSize === undefined ? 8 : s.digestSize)
  document.getElementById('sensitiveTools').value = (s.sensitiveTools || []).join('\\n')
  var m = data.meta || {}
  setStatus('已加载 · 保存 ' + (m.saveCount || 0) + ' 次 · 上次保存 ' +
    (m.savedAt ? new Date(m.savedAt).toLocaleString() : '从未'), true)
  renderHealth(data.health)
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
function api(path, options) { return fetch(BASE + path, options).then(function (res) { return res.json() }) }
function load() {
  return api('/settings').then(function (data) {
    if (!data.ok) throw new Error(data.error || '读取失败')
    apply(data)
    feedback(true, '配置已刷新。')
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
load()
</script>
</body>
</html>
`
