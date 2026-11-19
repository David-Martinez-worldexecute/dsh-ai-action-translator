/**
 * 新模块行为测试：store / trust / server / page。
 * 全部走临时目录，绝不触碰用户真实的 ~/.dsh。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { JsonStore } from '../lib/store.js'
import { rejectionFor, authorityOf, isLoopbackHost } from '../lib/trust.js'
import { createConfigServer, validateOverrides, sanitizeOverrides, readJson, LogRing, RUNTIME_KEYS } from '../lib/server.js'
import { CONFIG_PAGE_HTML } from '../lib/page.js'
import { PRESETS, PRESET_IDS, presetPatch, presetList } from '../lib/presets.js'
import { Config } from '../lib/index.js'

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aat-mod-'))
}

function fakeReq({ method = 'GET', url = '/', headers = {} } = {}) {
  const stream = Readable.from([])
  stream.method = method
  stream.url = url
  stream.headers = headers
  return stream
}

function fakeRes() {
  const chunks = []
  return {
    statusCode: 0,
    headers: {},
    chunks,
    writeHead(status, headers) {
      this.statusCode = status
      this.headers = headers ?? {}
    },
    end(body) {
      if (body !== undefined) chunks.push(Buffer.from(body))
      this.finished = true
    },
    body() {
      const text = Buffer.concat(chunks).toString('utf8')
      try { return JSON.parse(text) } catch { return text }
    },
  }
}

const LOOPS = { host: '127.0.0.1:19387' }

/* ───────────────────────── JsonStore ───────────────────────── */

test('JsonStore persists, reloads, and replace() clears back to baseline', () => {
  const home = tmpHome()
  const file = path.join(home, 'settings.json')
  const store = new JsonStore(file, {}, { log: () => {} })
  assert.deepEqual(store.get(), {})
  store.update({ language: 'en', persona: 'coach' })
  assert.equal(store.flush(), true)
  assert.ok(fs.existsSync(file))

  const second = new JsonStore(file, {}, { log: () => {} })
  assert.equal(second.get().language, 'en')

  second.replace({})
  second.flush()
  const third = new JsonStore(file, {}, { log: () => {} })
  assert.deepEqual(third.get(), {})
})

test('JsonStore quarantines a corrupt file instead of crashing', () => {
  const home = tmpHome()
  const file = path.join(home, 'settings.json')
  fs.writeFileSync(file, '{ not valid json !!', 'utf8')
  const logs = []
  const store = new JsonStore(file, {}, { log: m => logs.push(m) })
  assert.deepEqual(store.get(), {})
  assert.ok(logs.some(m => m.includes('unreadable')))
  assert.ok(fs.readdirSync(home).some(f => f.includes('.corrupt-')))
})

/* ───────────────────────── trust fence ───────────────────────── */

test('fence allows loopback with same-origin Origin/Referer', () => {
  const req = fakeReq({ headers: { host: '127.0.0.1:19387', origin: 'http://127.0.0.1:19387', referer: 'http://127.0.0.1:19387/x' } })
  assert.equal(rejectionFor(req, undefined), undefined)
})

test('fence rejects non-loopback host and cross-site origin', () => {
  assert.equal(rejectionFor(fakeReq({ headers: { host: 'example.com' } }), undefined), 403)
  assert.equal(
    rejectionFor(fakeReq({ headers: { host: '127.0.0.1:19387', origin: 'http://evil.example' } }), undefined),
    403,
  )
  assert.equal(
    rejectionFor(fakeReq({ headers: { host: '127.0.0.1:19387', referer: 'http://evil.example/x' } }), undefined),
    403,
  )
})

test('fence allows the desktop relay Referer and honors connection admission', () => {
  assert.equal(rejectionFor(fakeReq({ headers: { host: '127.0.0.1:19387', referer: 'dsh-app://app/page' } }), undefined), undefined)
  assert.equal(rejectionFor(fakeReq({ headers: LOOPS }), { admit: () => ({ rejection: 401 }) }), 401)
  assert.equal(rejectionFor(fakeReq({ headers: LOOPS }), { admit: () => { throw new Error('boom') } }), 503)
  assert.equal(rejectionFor(fakeReq({ headers: LOOPS }), { requestRejection: () => 403 }), 403)
})

test('authorityOf normalizes hosts and isLoopbackHost whitelists only loopback', () => {
  assert.equal(authorityOf('127.0.0.1:19387').port, '19387')
  assert.equal(authorityOf('http://localhost:80/x').hostname, 'localhost')
  assert.equal(isLoopbackHost('[::1]:9000'), true)
  assert.equal(isLoopbackHost('10.0.0.1'), false)
})

/* ───────────────────────── route handler ───────────────────────── */

function makeDeps(home) {
  const state = { language: 'zh', persona: '学姐' }
  const saved = new JsonStore(path.join(home, 'settings.json'), {}, { log: () => {} })
  return {
    connection: undefined,
    getMerged: () => ({ ...state, ...(saved.get() ?? {}) }),
    saveOverrides: (patch) => {
      saved.update(patch)
      saved.flush()
      Object.assign(state, patch)
      return { settings: { ...state, ...(saved.get() ?? {}) }, feedback: '已保存' }
    },
    resetOverrides: () => {
      saved.replace({})
      Object.keys(state).forEach(k => delete state[k])
      state.language = 'zh'
      state.persona = '学姐'
      return { settings: { ...state }, feedback: '已恢复默认' }
    },
    meta: () => ({ savedAt: 1, saveCount: 1 }),
    health: () => ({ startedAt: 1, digestRows: 0, log: [] }),
    onRejection: () => {},
    onError: () => {},
  }
}

test('GET /settings returns merged config, meta, and health', async () => {
  const handler = createConfigServer(makeDeps(tmpHome()))
  const res = fakeRes()
  await handler(fakeReq({ url: '/api/ai-action-translator/settings', headers: LOOPS }), res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body().ok, true)
  assert.equal(res.body().settings.language, 'zh')
  assert.equal(res.headers['cache-control'], 'no-store')
})

test('GET / and /ui serve the config page HTML', async () => {
  const handler = createConfigServer(makeDeps(tmpHome()))
  for (const p of ['/api/ai-action-translator/', '/api/ai-action-translator/ui']) {
    const res = fakeRes()
    await handler(fakeReq({ url: p, headers: LOOPS }), res)
    assert.equal(res.statusCode, 200)
    assert.match(res.headers['content-type'], /text\/html/)
    assert.ok(res.body().includes('AI 动作翻译器'))
  }
})

test('POST /settings saves valid fields and rejects unknown ones', async () => {
  const home = tmpHome()
  const handler = createConfigServer(makeDeps(home))

  // 合法载荷：只含运行时可改字段。
  const req2 = Readable.from([Buffer.from(JSON.stringify({ persona: '教练', playfulness: 'cheerful' }))])
  req2.method = 'POST'
  req2.url = '/api/ai-action-translator/settings'
  req2.headers = { ...LOOPS, 'content-type': 'application/json' }
  const res2 = fakeRes()
  await handler(req2, res2)
  assert.equal(res2.statusCode, 200)
  assert.equal(res2.body().ok, true)
  assert.equal(res2.body().settings.persona, '教练')
  assert.equal(res2.body().settings.playfulness, 'cheerful')
  // 落盘验证：新开的 store 能读回刚保存的值。
  const persisted = new JsonStore(path.join(home, 'settings.json'), {}, { log: () => {} })
  assert.equal(persisted.get().persona, '教练')

  // 结构性字段 enabled 不允许运行时修改——这是设计内的拒绝。
  const structural = Readable.from([Buffer.from(JSON.stringify({ enabled: false }))])
  structural.method = 'POST'
  structural.url = '/api/ai-action-translator/settings'
  structural.headers = { ...LOOPS, 'content-type': 'application/json' }
  const resS = fakeRes()
  await handler(structural, resS)
  assert.equal(resS.statusCode, 400)
  assert.match(resS.body().error, /unknown setting fields.*enabled/)

  // 完全未知的字段同样拒绝。
  const bad = Readable.from([Buffer.from(JSON.stringify({ hacker: 1 }))])
  bad.method = 'POST'
  bad.url = '/api/ai-action-translator/settings'
  bad.headers = { ...LOOPS, 'content-type': 'application/json' }
  const res3 = fakeRes()
  await handler(bad, res3)
  assert.equal(res3.statusCode, 400)
  assert.match(res3.body().error, /unknown setting fields/)
})

test('POST /reset returns baseline settings', async () => {
  const handler = createConfigServer(makeDeps(tmpHome()))
  const req = Readable.from([])
  req.method = 'POST'
  req.url = '/api/ai-action-translator/reset'
  req.headers = LOOPS
  const res = fakeRes()
  await handler(req, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body().ok, true)
  assert.equal(res.body().settings.language, 'zh')
})

test('non-loopback request is fenced before any route logic', async () => {
  const handler = createConfigServer(makeDeps(tmpHome()))
  const res = fakeRes()
  await handler(fakeReq({ url: '/api/ai-action-translator/settings', headers: { host: 'evil.example' } }), res)
  assert.equal(res.statusCode, 403)
  assert.equal(res.body().error, 'forbidden')
})

test('OPTIONS returns 204 with CORS; unknown path 404; wrong method 405', async () => {
  const handler = createConfigServer(makeDeps(tmpHome()))
  const opt = fakeRes()
  await handler(fakeReq({ method: 'OPTIONS', url: '/api/ai-action-translator/settings', headers: LOOPS }), opt)
  assert.equal(opt.statusCode, 204)

  const notFound = fakeRes()
  await handler(fakeReq({ url: '/api/ai-action-translator/nope', headers: LOOPS }), notFound)
  assert.equal(notFound.statusCode, 404)

  const wrong = fakeRes()
  await handler(fakeReq({ method: 'PUT', url: '/api/ai-action-translator/settings', headers: LOOPS }), wrong)
  assert.equal(wrong.statusCode, 405)
})

/* ───────────────────────── sanitize & LogRing ───────────────────────── */

test('sanitizeOverrides drops wrong types and truncates long strings', () => {
  const out = sanitizeOverrides({
    persona: 'x'.repeat(1000),
    learningFocus: '文件读写',
    digestSize: 3.9,
    sensitiveTools: ['git', 42, ''],
    playfulness: 'cheerful',
    enabled: 'true',
  })
  assert.equal(out.persona.length, 600)
  assert.equal(out.learningFocus, '文件读写')
  assert.equal(out.digestSize, 3)
  assert.deepEqual(out.sensitiveTools, ['git'])
  assert.equal(out.playfulness, 'cheerful')
  assert.equal(out.enabled, undefined)
})

test('LogRing keeps a bounded tail', () => {
  const ring = new LogRing(3)
  for (let i = 1; i <= 5; i++) ring.push('warn', `w${i}`)
  assert.equal(ring.rows.length, 3)
  assert.deepEqual(ring.tail(2).map(r => r.text), ['w4', 'w5'])
})

test('readJson rejects oversized and malformed bodies', async () => {
  const big = Readable.from([Buffer.alloc(1024)])
  await assert.rejects(readJson(big, 512), /too large/)

  const bad = Readable.from([Buffer.from('not json')])
  await assert.rejects(readJson(bad), (error) => error.status === 400)
})

test('CONFIG_PAGE_HTML has no CDN or external network references', () => {
  assert.ok(CONFIG_PAGE_HTML.includes('AI 动作翻译器'))
  assert.doesNotMatch(CONFIG_PAGE_HTML, /https?:\/\//)
})

test('RUNTIME_KEYS never contains structural keys', () => {
  assert.equal(RUNTIME_KEYS.includes('enabled'), false)
  assert.equal(RUNTIME_KEYS.includes('order'), false)
})

/**
 * 字段表一致性守卫。
 *
 * 背景：0.4.0 的 stepParse 在 lib/index.js 里有完整实现（Config、normalize、提示词拼接），
 * 却没进 RUNTIME_KEYS / FIELD_IDS / 面板脚本 / 预设 / YAML —— 界面上看不见它，也改不了它，
 * 等于这条能力不存在。这里把「新增一个字段要接通的四层」钉死：
 * Config 的运行时字段 == 后端白名单 == 面板上的控件 == 面板的分类表。
 */
test('every runtime Config field reaches the backend whitelist and the served page', () => {
  const structural = ['enabled', 'order']
  // Config.dict 是 schemastery 的字段字典。它若改了内部结构，这条会先红 ——
  // 比字段悄悄漂移、用户在界面上改不到要好。
  const fields = Object.keys(Config.dict).filter(key => !structural.includes(key))

  assert.deepEqual([...RUNTIME_KEYS].sort(), fields.slice().sort())

  // 每个字段都必须真的渲染出一个控件，否则面板上根本改不到它。
  for (const key of fields) {
    assert.match(CONFIG_PAGE_HTML, new RegExp(`id=['"]${key}['"]`), `lib/page.js 缺少 ${key} 的控件`)
  }

  // 控件要进分类表，collect() 才知道怎么取值；digestSize / sensitiveTools 走单独分支。
  const grouped = []
  for (const name of ['CHECK', 'TEXT', 'SELECT']) {
    const found = new RegExp(`var ${name} = \\[([^\\]]*)\\]`).exec(CONFIG_PAGE_HTML)
    assert.ok(found, `lib/page.js 应定义 var ${name} = [...]`)
    for (const item of found[1].matchAll(/'([^']+)'/g)) grouped.push(item[1])
  }
  const specialMatch = /var SPECIAL = \[([^\]]*)\]/.exec(CONFIG_PAGE_HTML)
  assert.ok(specialMatch, 'lib/page.js 应定义 var SPECIAL = [...]')
  const special = [...specialMatch[1].matchAll(/'([^']+)'/g)].map(item => item[1])
  assert.deepEqual([...grouped, ...special].sort(), fields.slice().sort())
})

test('every preset opens the step-by-step parse switch', () => {
  // 三档预设都打开 stepParse：让人看懂 AI 在做什么，是这个插件的存在理由。
  // 嫌啰嗦的用户可以在面板上单独关掉，不必为此换一个预设。
  for (const entry of PRESETS) {
    assert.equal(entry.patch.stepParse, true, `${entry.id} 预设应默认打开 stepParse`)
  }
})

test('cordis.patch.yml ships the step-by-step parse default', () => {
  const yml = fs.readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  assert.match(yml, /^\s*stepParse: true$/m)
})

/**
 * 文档回归测试。
 *
 * 背景：0.2.0 的 README/SKILL/page 都让用户「在浏览器打开
 * http://127.0.0.1:19387/api/ai-action-translator/」，而这一条路必然被 dsh web 内核的
 * 票据校验拦成 401 —— 用户照做只会看到报错。这些断言把「说入口」这件事钉死：
 * 入口必须是设置页分区，必须提到 401 的原因，并且不能出现「本机浏览器打开」这种指令。
 */
test('docs point at the GUI settings section, not a typed URL', () => {
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8')
  assert.match(readme, /打开完整页面/)
  assert.match(readme, /401/)
  assert.doesNotMatch(readme, /本机浏览器打开/)

  const skill = fs.readFileSync(new URL('../SKILL.md', import.meta.url), 'utf8')
  assert.match(skill, /不要建议用户手敲/)
  assert.match(skill, /打开完整页面/)

  const page = fs.readFileSync(new URL('../lib/page.js', import.meta.url), 'utf8')
  assert.match(page, /不要手敲/)
})

test('page version tracks the package version', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const page = fs.readFileSync(new URL('../lib/page.js', import.meta.url), 'utf8')
  const found = /PAGE_VERSION = '([^']+)'/.exec(page)
  assert.ok(found, 'lib/page.js 应导出 PAGE_VERSION')
  assert.equal(found[1], pkg.version)
})

test('package exposes the client half to the DSH web shell', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.dsh.manifestVersion, 1)
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.equal(pkg.exports['./client'], './client.js')
  assert.ok(pkg.files.includes('client.js'))
  assert.ok(fs.existsSync(new URL('../client.js', import.meta.url)))
})

/* ───────────────── 配置预设（lib/presets.js） ───────────────── */

test('presets cover the three learner levels and stay in the runtime whitelist', () => {
  assert.equal(PRESETS.length, 3)
  assert.deepEqual(PRESET_IDS, ['novice', 'guided', 'deep'])

  for (const entry of PRESETS) {
    assert.ok(entry.label.length > 0, `${entry.id} 需要中文标签`)
    assert.ok(entry.labelEn.length > 0, `${entry.id} 需要英文标签`)
    assert.ok(entry.hint.length > 0, `${entry.id} 需要中文说明`)
    // 预设只能写运行时白名单里的字段：写 enabled/order 会被服务端 400 拒掉，
    // 也会让「切档」偷偷变成结构性变更。
    for (const key of Object.keys(entry.patch)) {
      assert.ok(RUNTIME_KEYS.includes(key), `${entry.id} 含非运行时字段: ${key}`)
    }
  }
})

test('presetPatch returns a copy and rejects unknown ids', () => {
  const patch = presetPatch('novice')
  assert.equal(patch.knowledgeLevel, 'plain')
  // 必须是副本：调用方改了不能污染全局预设表。
  patch.knowledgeLevel = 'deep'
  assert.equal(presetPatch('novice').knowledgeLevel, 'plain')
  assert.equal(presetPatch('nope'), undefined)
  assert.equal(presetPatch(''), undefined)
})

test('presetList ships the same shape the UIs render', () => {
  const list = presetList()
  assert.equal(list.length, 3)
  for (const item of list) {
    assert.deepEqual(Object.keys(item).sort(), ['hint', 'hintEn', 'id', 'label', 'labelEn', 'patch'])
  }
})

/* ───────────────── 新路由：/preset 与 /preview ───────────────── */

/** 构造一个最小 deps，只关心被新路由用到的字段。 */
function serverDeps(overrides = {}) {
  const saved = []
  return {
    saved,
    deps: {
      getMerged: () => ({ language: 'zh', knowledgeLevel: 'guided', digestSize: 8 }),
      saveOverrides: (patch) => {
        saved.push(patch)
        return { settings: { ...patch }, feedback: 'saved' }
      },
      resetOverrides: () => ({ settings: {}, feedback: 'reset' }),
      meta: () => ({ savedAt: 0, saveCount: saved.length }),
      health: () => ({ version: '0.3.1', digestRows: 0, log: [], stats: { observed: 0 } }),
      preview: (settings) => ({
        section: `LEVEL=${settings.knowledgeLevel}`,
        length: 10,
        knowledgeLevel: settings.knowledgeLevel,
        learningStage: settings.learningStage ?? 'framework',
        detail: settings.detail,
        frameworkMap: settings.frameworkMap,
        stageSummary: settings.stageSummary,
      }),
      ...overrides,
    },
  }
}

/** 带 JSON body 的假请求：readJson 依赖真实流事件，所以这里必须给真流。 */
function jsonReq({ method = 'POST', url = '/', body = {}, headers = {} } = {}) {
  const stream = Readable.from([Buffer.from(JSON.stringify(body))])
  stream.method = method
  stream.url = url
  stream.headers = { host: '127.0.0.1:19387', ...headers }
  return stream
}

async function call(handler, req) {
  const res = fakeRes()
  await handler(req, res)
  return res
}

test('GET /settings ships the preset list so both halves share one source of truth', async () => {
  const { deps } = serverDeps()
  const handler = createConfigServer(deps)
  const res = await call(handler, fakeReq({ url: '/settings', headers: LOOPS }))
  assert.equal(res.statusCode, 200)
  const body = res.body()
  assert.ok(Array.isArray(body.presets), '响应必须带 presets')
  assert.equal(body.presets.length, 3)
  assert.equal(body.presets[0].id, 'novice')
})

test('POST /preset applies the preset patch and rejects unknown ids', async () => {
  const { deps, saved } = serverDeps()
  const handler = createConfigServer(deps)

  const ok = await call(handler, jsonReq({ url: '/preset', body: { id: 'deep' } }))
  assert.equal(ok.statusCode, 200)
  assert.equal(saved.length, 1)
  assert.equal(saved[0].knowledgeLevel, 'deep')
  assert.equal(ok.body().ok, true)

  // 未知 id 必须被拒：否则前端拼错就会被当成「切档成功」。
  const bad = await call(handler, jsonReq({ url: '/preset', body: { id: 'ultra' } }))
  assert.equal(bad.statusCode, 400)
  assert.equal(saved.length, 1, '被拒的请求不许写盘')

  // 空 body 也不能通过。
  const empty = await call(handler, jsonReq({ url: '/preset', body: {} }))
  assert.equal(empty.statusCode, 400)
})

test('POST /preview really builds the prompt text and reflects draft edits', async () => {
  const { deps } = serverDeps()
  const handler = createConfigServer(deps)

  const plain = await call(handler, jsonReq({ url: '/preview', body: {} }))
  assert.equal(plain.statusCode, 200)
  const body = plain.body()
  assert.equal(body.ok, true)
  // 预览必须回真实构建出来的段落，而不是占位文案。
  assert.equal(body.preview.section, 'LEVEL=guided')
  assert.ok(body.sample.zh.length > 0, '要带上示例动作原文')

  // 草稿字段生效（用户在面板上改了还没保存时，预览要能体现）。
  const drafted = await call(handler, jsonReq({ url: '/preview', body: { overrides: { knowledgeLevel: 'deep' } } }))
  assert.equal(drafted.body().preview.section, 'LEVEL=deep')

  // 草稿里塞未知字段必须 400，不能让用户以为「预览了不存在的东西」。
  const bad = await call(handler, jsonReq({ url: '/preview', body: { overrides: { nope: 1 } } }))
  assert.equal(bad.statusCode, 400)
})

test('preset and preview reject GET with 405', async () => {
  const { deps } = serverDeps()
  const handler = createConfigServer(deps)
  for (const url of ['/preset', '/preview']) {
    const res = await call(handler, fakeReq({ method: 'GET', url, headers: LOOPS }))
    assert.equal(res.statusCode, 405, `${url} 应只允许 POST`)
  }
})

test('every activity payload key crosses the server whitelist', () => {
  // 背景（0.7.0 真踩过）：lib/index.js 的 activity() 加了字段，而 lib/server.js 的
  // GET /activity 是「字段白名单转发」——数据层加了、出口层没加，面板上永远是
  // undefined，测试却全绿（没有一条用例真的从 HTTP 响应里读这些新字段）。
  // 这里把两边对齐：activity() 的每个顶层键，都必须在 server 的响应对象里出现。
  const indexSource = fs.readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  const serverSource = fs.readFileSync(new URL('../lib/server.js', import.meta.url), 'utf8')

  const activityBody = /activity: \(\) => \{([\s\S]*?)\n {10}\},/.exec(indexSource)
  assert.ok(activityBody, 'lib/index.js 里应当能定位到 activity: () => { ... },')
  // 顶层键 = 14 个空格缩进 + 标识符 + 冒号；嵌套对象的子键缩进更深，不会被吃进来。
  const keys = [...activityBody[1].matchAll(/\n {14}([A-Za-z][A-Za-z0-9]*):/g)].map(match => match[1])
  assert.ok(keys.length >= 10, `activity() 的顶层字段应有 10 个以上，实际 ${keys.length}`)

  const responseBody = /return send\(200, \{([\s\S]*?)\n {8}\}\)/.exec(serverSource)
  assert.ok(responseBody, 'lib/server.js 里应当能定位到 /activity 的 return send(200, {...})')
  for (const key of keys) {
    assert.match(
      responseBody[1],
      new RegExp(`(^|\\s)${key}[,:]`, 'm'),
      `/activity 没转发 ${key} —— 数据层加了、出口层没加，面板上永远是 undefined`,
    )
  }
})

