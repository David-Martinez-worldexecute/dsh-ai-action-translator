#!/usr/bin/env node
/**
 * load-smoke.mjs —— 用一个假宿主把插件真正装载一次。
 *
 * 为什么需要它：单元测试是「按函数逐个验」，但它们证明不了
 * 「apply() 在宿主里跑起来、注册了段落、收到真实事件、面板能应答、卸载不炸」。
 * 这个脚本用一个最小的假 ctx（systemPrompt / on / inject / effect / logger）
 * 把 apply() 完整跑一遍，再用真实 HTTP 语义请求面板。
 *
 * 诚实边界：**它不是真装进 DSH**。真装需要 DSH 桌面版重启，
 * 那件事只有用户能做。这里证明的是「代码在接口层面能装载」。
 *
 * 用法：node scripts/load-smoke.mjs
 * 退出码 0 = 全部通过；非 0 = 有断言失败。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'

/* ── 1. 隔离数据目录：绝不在真实的 ~/.dsh 里写东西 ───────────────────── */
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aat-smoke-'))
process.env.DSH_HOME = home

const module = await import('../lib/index.js')
const { apply, name, inject } = module

console.log(`[smoke] DSH_HOME=${home}`)
assert.equal(name, 'ai-action-translator', '插件名不对')
assert.ok(Array.isArray(inject) && inject.includes('systemPrompt'), 'inject 必须声明 systemPrompt')

/* ── 2. 假宿主：只实现 apply() 真正会碰到的接口 ──────────────────────── */
const sections = []
const contexts = []
const listeners = []
const effects = []
const routes = []
const logs = []

const fakeReq = ({ method = 'GET', url = '/', headers = {} } = {}) => {
  const req = Readable.from([])
  req.method = method
  req.url = url
  req.headers = headers
  return req
}

const fakeRes = () => ({
  statusCode: 0,
  headers: {},
  chunks: [],
  writeHead(status, headers) {
    this.statusCode = status
    this.headers = { ...headers }
  },
  end(body) {
    if (body !== undefined) this.chunks.push(Buffer.from(String(body)))
  },
  body() {
    return Buffer.concat(this.chunks).toString('utf8')
  },
})

const LOOPS = {
  host: '127.0.0.1:19387',
  origin: 'http://127.0.0.1:19387',
  referer: 'http://127.0.0.1:19387/',
}

const host = {
  logger: {
    info: message => logs.push(['info', String(message)]),
    warn: message => logs.push(['warn', String(message)]),
    error: message => logs.push(['error', String(message)]),
  },
  systemPrompt: {
    section(entry) {
      sections.push(entry)
      return () => {}
    },
    context(entry) {
      contexts.push(entry)
      return () => {}
    },
  },
  on(event, handler) {
    listeners.push({ event, handler })
    return () => {}
  },
  effect(setup) {
    effects.push(setup)
  },
  inject(deps, callback) {
    assert.ok(Array.isArray(deps) && deps.includes('webServer'), 'inject 应请求 webServer')
    callback({
      reflect: { get: () => undefined },
      effect: setup => effects.push(setup),
      logger: host.logger,
      webServer: {
        register(spec, label) {
          routes.push({ ...spec, label })
          return () => {}
        },
      },
    })
  },
}

/* ── 3. 真装载 ──────────────────────────────────────────────────────── */
apply(host, {
  language: 'zh', timelineSize: 5, digestSize: 4,
  glossary: true, failureBook: true,
  // 0.7.0 的四个新开关：守门用 warn（不真的拦，只记一条）、练习册阈值放到 2 好观察。
  guardMode: 'warn', guardLevel: 'high',
  drill: true, drillEvery: 2,
})

assert.equal(sections.length, 1, '应注册恰好一段静态提示词')
// 界面上的标签叫「一步一步解析」，提示词里的段标题叫「一步一步拆解动作」——
// 是同一件事的两种措辞，断言按真实文案写，不按印象写。
assert.ok(sections[0].text.includes('一步一步拆解动作'), '提示词里该有「一步一步拆解动作」段')
assert.ok(sections[0].text.includes('术语'), '提示词里该有术语卡片段')
assert.ok(!sections[0].text.includes('{{'), '提示词里不能残留模板变量')

assert.ok(contexts.length >= 4, '应注册「最近动作」「运行时覆盖」「学习练习册」「本轮装配」四个动态上下文')
assert.ok(contexts.some(item => String(item.name).includes('recent-actions')), '缺最近动作上下文')
assert.ok(contexts.some(item => String(item.name).includes(':drill')), '缺学习练习册上下文')
assert.ok(contexts.some(item => String(item.name).includes(':assembly')), '缺本轮装配上下文')

assert.equal(routes.length, 1, '应注册一条面板前缀路由')
assert.equal(routes[0].path, '/api/ai-action-translator', '面板路由前缀不对')

console.log(`[smoke] sections=${sections.length} contexts=${contexts.length} routes=${routes.length} effects=${effects.length}`)

/* ── 4. 喂真实事件：5 次工具结果（含 1 次失败）──────────────────────── */
const emit = listeners.find(item => item.event === 'tools/result')
assert.ok(emit, '应订阅 tools/result（只读观察）')
// 0.7.0 新增的三个扩展点：订阅了才算真接上。
const preExecute = listeners.find(item => item.event === 'tools/pre-execute')
const agentBorn = listeners.find(item => item.event === 'agent/created')
const agentGone = listeners.find(item => item.event === 'agent/disposed')
assert.ok(preExecute, 'guardMode=warn 时应订阅 tools/pre-execute')
assert.ok(agentBorn, '应订阅 agent/created（多 Agent 名册）')
assert.ok(agentGone, '应订阅 agent/disposed（多 Agent 名册）')

// 造一个带工作目录的 agent，模拟「这条动作是子 agent 做的」。
const AGENT = { id: 'agent-smoke0001', session: { header: { id: 'sess-smoke-1', cwd: 'C:\\projects\\demo' } } }
agentBorn.handler({ agent: AGENT })

const results = [
  { name: 'read', args: { file_path: 'lib/index.js' }, result: { isError: false, durationMs: 3 } },
  { name: 'pwsh', args: { command: 'npm test' }, result: { isError: false, durationMs: 1200 } },
  { name: 'pwsh', args: { command: 'npm install left-pad' }, result: { isError: false, durationMs: 900 } },
  { name: 'write', args: { file_path: 'preview/x.txt' }, result: { isError: false, durationMs: 4 } },
  // 最后一条挂在 AGENT 名下：验证「时间线能显示是哪个 agent 做的」。
  { name: 'pwsh', args: { command: 'node broken.mjs' }, result: { isError: true, error: 'SyntaxError: Unexpected token' }, agent: AGENT },
]
for (const item of results) {
  emit.handler({ name: item.name, arguments: item.args, agent: item.agent }, item.result)
}

/* ── 5. 面板真的应答 ────────────────────────────────────────────────── */
const handler = routes[0].handler

const settingsRes = fakeRes()
await handler(fakeReq({ url: '/api/ai-action-translator/settings', headers: LOOPS }), settingsRes)
assert.equal(settingsRes.statusCode, 200, 'GET /settings 应返回 200')
const settingsPayload = JSON.parse(settingsRes.body())
assert.equal(settingsPayload.ok, true)
assert.equal(settingsPayload.settings.timelineSize, 5, 'GET /settings 应回显配置里的时间线容量')

const activityRes = fakeRes()
await handler(fakeReq({ url: '/api/ai-action-translator/activity', headers: LOOPS }), activityRes)
assert.equal(activityRes.statusCode, 200, 'GET /activity 应返回 200')
const activity = JSON.parse(activityRes.body())
assert.equal(activity.ok, true)
assert.equal(activity.timeline.length, 5, '应记到 5 条动作（容量恰好 5）')
assert.equal(activity.summary.errors, 1, '应有 1 条失败')
assert.ok(activity.failures.length >= 1, '失败案例库应有 1 条')
assert.equal(activity.failures[0].layer, 'syntax', 'SyntaxError 应归到 syntax 层')
assert.ok(Array.isArray(activity.classes) && activity.classes.length >= 8, '应下发动作分类表')
assert.ok(Array.isArray(activity.glossary) && activity.glossary.length >= 10, '应下发术语表')
// 0.7.0 新面板数据：多 Agent 名册、练习册水位、装配特性表、守门规则表。
assert.ok(Array.isArray(activity.agents) && activity.agents.length === 1, '名册里应有 1 个 agent')
assert.equal(activity.agents[0].id, 'agent-smoke0001', '名册条目 id 应与 created 事件一致')
assert.equal(activity.agents[0].folder, 'demo', 'folder 应取 cwd 最后一段')
assert.equal(activity.agentSummary.total, 1, 'agentSummary.total 应为 1')
assert.equal(activity.agentSummary.live, 1, '还没 disposed，live 应为 1')
assert.equal(activity.agentSummary.actions, 1, '只有 1 条动作带 agent')
assert.equal(activity.drill.pending, 5, '练习册应攒了 5 条待引用动作')
assert.equal(activity.drill.cards, 0, '还没出卡时 cards 应为 0')
assert.ok(Array.isArray(activity.assemble.features) && activity.assemble.features.length >= 9, '应下发装配特性表')
assert.ok(Array.isArray(activity.guardRules) && activity.guardRules.length >= 10, '应下发守门规则表')

const first = activity.timeline[0]
assert.equal(first.name, 'pwsh', '时间线最新一条应在最前')
assert.equal(first.isError, true, '最新一条应标记失败')
assert.equal(first.classId, 'exec', 'pwsh 应归到 exec 类')

console.log(`[smoke] timeline=${activity.timeline.length} errors=${activity.summary.errors} failures=${activity.failures.length} layer=${activity.failures[0].layer}`)

/* ── 5b. 练习册出卡 / 装配说明 / 子 agent 结束 / 守门放行 ────────────── */
const drillCtx = contexts.find(item => String(item.name).includes(':drill'))
const assemblyCtx = contexts.find(item => String(item.name).includes(':assembly'))
assert.ok(drillCtx && typeof drillCtx.text === 'function', '练习册上下文应能现取文本')
assert.ok(assemblyCtx && typeof assemblyCtx.text === 'function', '装配上下文应能现取文本')

// 练习册：攒够 drillEvery=2 条就该出卡，且只引用真跑过的动作。
const card = drillCtx.text()
assert.ok(card.includes('你看到了什么'), '练习册应出「你看到了什么」这张卡')
assert.ok(card.includes('pwsh'), '卡片应引用真跑过的动作（pwsh）')
assert.ok(!card.includes('{{'), '卡片里不能残留模板变量')
assert.equal(drillCtx.text(), '', '同一批动作只出一张卡（幂等），第二次应为空串')

// 装配说明：必须写明本轮生效什么、关掉了什么不要主动讲。
const assembly = assemblyCtx.text()
assert.ok(assembly.includes('本轮装配说明'), '装配上下文应带「本轮装配说明」')
assert.ok(assembly.includes('事前守门'), '装配上下文应交代守门状态')
assert.ok(assembly.includes('安全边界始终有效'), '装配上下文应重申安全边界不随开关改变')
assert.ok(!assembly.includes('{{'), '装配说明里不能残留模板变量')

// 子 agent 结束：历史条目保留、live 减 1。
agentGone.handler({ agent: AGENT })
const afterRes = fakeRes()
await handler(fakeReq({ url: '/api/ai-action-translator/activity', headers: LOOPS }), afterRes)
const after = JSON.parse(afterRes.body())
assert.equal(after.agentSummary.total, 1, 'disposed 之后名册条目仍保留（历史不丢）')
assert.equal(after.agentSummary.live, 0, 'disposed 之后 live 应为 0')
assert.equal(after.drill.cards, 1, '出过一张卡之后 cards 应为 1')

// 事前守门：warn 模式对删除命令应放行（只记一条），绝不拦。
let proceeded = false
const verdict = preExecute.handler(
  { name: 'pwsh', arguments: { command: 'rm -rf build' } },
  () => { proceeded = true },
)
assert.equal(proceeded, true, 'warn 模式必须放行，不能拦')
assert.equal(verdict, undefined, 'warn 模式不应返回 deny 对象')

console.log(`[smoke] card=${card.length}B assembly=${assembly.length}B agents=${after.agentSummary.total} live=${after.agentSummary.live}`)

/* ── 6. 卸载：effect 清理不能抛 ─────────────────────────────────────── */
let cleaned = 0
for (const setup of effects) {
  const teardown = setup()
  if (typeof teardown === 'function') {
    teardown()
    cleaned += 1
  }
}
console.log(`[smoke] cleaned=${cleaned} effects`)

fs.rmSync(home, { recursive: true, force: true })
console.log('SMOKE_OK')
