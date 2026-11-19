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
apply(host, { language: 'zh', timelineSize: 5, digestSize: 4, glossary: true, failureBook: true })

assert.equal(sections.length, 1, '应注册恰好一段静态提示词')
// 界面上的标签叫「一步一步解析」，提示词里的段标题叫「一步一步拆解动作」——
// 是同一件事的两种措辞，断言按真实文案写，不按印象写。
assert.ok(sections[0].text.includes('一步一步拆解动作'), '提示词里该有「一步一步拆解动作」段')
assert.ok(sections[0].text.includes('术语'), '提示词里该有术语卡片段')
assert.ok(!sections[0].text.includes('{{'), '提示词里不能残留模板变量')

assert.ok(contexts.length >= 2, '应注册「最近动作」与「运行时覆盖」两个动态上下文')
assert.ok(contexts.some(item => String(item.name).includes('recent-actions')), '缺最近动作上下文')

assert.equal(routes.length, 1, '应注册一条面板前缀路由')
assert.equal(routes[0].path, '/api/ai-action-translator', '面板路由前缀不对')

console.log(`[smoke] sections=${sections.length} contexts=${contexts.length} routes=${routes.length} effects=${effects.length}`)

/* ── 4. 喂真实事件：5 次工具结果（含 1 次失败）──────────────────────── */
const emit = listeners.find(item => item.event === 'tools/result')
assert.ok(emit, '应订阅 tools/result（只读观察）')
const results = [
  { name: 'read', args: { file_path: 'lib/index.js' }, result: { isError: false, durationMs: 3 } },
  { name: 'pwsh', args: { command: 'npm test' }, result: { isError: false, durationMs: 1200 } },
  { name: 'pwsh', args: { command: 'npm install left-pad' }, result: { isError: false, durationMs: 900 } },
  { name: 'write', args: { file_path: 'preview/x.txt' }, result: { isError: false, durationMs: 4 } },
  { name: 'pwsh', args: { command: 'node broken.mjs' }, result: { isError: true, error: 'SyntaxError: Unexpected token' } },
]
for (const item of results) {
  emit.handler({ name: item.name, arguments: item.args }, item.result)
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

const first = activity.timeline[0]
assert.equal(first.name, 'pwsh', '时间线最新一条应在最前')
assert.equal(first.isError, true, '最新一条应标记失败')
assert.equal(first.classId, 'exec', 'pwsh 应归到 exec 类')

console.log(`[smoke] timeline=${activity.timeline.length} errors=${activity.summary.errors} failures=${activity.failures.length} layer=${activity.failures[0].layer}`)

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
