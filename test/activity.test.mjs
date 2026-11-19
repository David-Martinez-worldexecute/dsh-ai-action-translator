/**
 * 动作时间线 / 术语表 / 失败案例库 / 只读活动接口的契约测试。
 *
 * 用真实模块，不打桩内部逻辑——这几块的价值恰恰在「按真实报错文本判层」，
 * 打桩就把最该验的那一步绕过去了。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'

import {
  ACTION_CLASSES,
  OTHER_CLASS,
  classifyTool,
  refineExec,
} from '../lib/classify.js'
import { GLOSSARY, GLOSSARY_KEYS, lookupTerm, glossarySection } from '../lib/glossary.js'
import {
  Timeline,
  FailureBook,
  failureTextOf,
  normalizeFailureText,
  classifyFailure,
  failureSignature,
  FAILURE_LAYERS,
  TIMELINE_LIMIT,
} from '../lib/timeline.js'
import { createConfigServer } from '../lib/server.js'
import { buildSectionText } from '../lib/index.js'

/* ───────────────────────── 分类器 ───────────────────────── */

test('classifyTool maps the tools a beginner actually sees', () => {
  const cases = [
    ['read', 'read'],
    ['grep', 'read'],
    ['glob', 'read'],
    ['write', 'write'],
    ['edit', 'write'],
    ['pwsh', 'exec'],
    ['mcp__windows__Click', 'desktop'],
    ['generate_image', 'media'],
    ['word_create', 'media'],
    ['memory_judge', 'memory'],
    ['present', 'media'],
  ]
  for (const [tool, expected] of cases) {
    assert.equal(classifyTool(tool, {})?.id, expected, `${tool} 应归到 ${expected}`)
  }
})

test('classifyTool always returns a class object, never undefined', () => {
  for (const name of ['', '   ', 'some_unknown_tool', undefined, null]) {
    const result = classifyTool(name, {})
    assert.ok(result, `${String(name)} 不应返回 undefined`)
    assert.equal(typeof result.id, 'string')
    assert.equal(typeof result.label, 'string')
    assert.equal(typeof result.labelEn, 'string')
  }
  assert.equal(classifyTool('', {})?.id, OTHER_CLASS.id)
  assert.equal(classifyTool('some_unknown_tool', {})?.id, OTHER_CLASS.id)
})

test('every action class carries both languages and a hint', () => {
  assert.ok(ACTION_CLASSES.length >= 10)
  for (const entry of ACTION_CLASSES) {
    assert.match(entry.id, /^[a-z]+$/)
    assert.ok(entry.label.length > 0)
    assert.ok(entry.labelEn.length > 0)
    assert.ok(entry.hint.length > 0)
    assert.ok(entry.hintEn.length > 0)
  }
})

test('exec subclasses tell dependency install, service control, and git apart', () => {
  assert.equal(refineExec({ command: 'npm install left-pad' })?.id, 'deps')
  assert.equal(refineExec({ command: 'pip install numpy' })?.id, 'deps')
  assert.equal(refineExec({ command: 'Stop-Process -Name node' })?.id, 'service')
  assert.equal(refineExec({ command: 'npm run dev:web' })?.id, 'service')
  assert.equal(refineExec({ command: 'git push origin main' })?.id, 'git')
  assert.equal(refineExec({ command: 'echo hello' }), undefined)
  assert.equal(classifyTool('pwsh', { command: 'git commit -m "x"' })?.id, 'git')
})

/* ───────────────────────── 失败分层 ───────────────────────── */

test('failureTextOf reads the error text out of several result shapes', () => {
  assert.equal(failureTextOf({ error: 'boom' }), 'boom')
  assert.equal(failureTextOf({ stderr: 'bad things' }), 'bad things')
  assert.equal(failureTextOf({ content: [{ text: 'from content' }] }), 'from content')
  assert.equal(failureTextOf({ isError: true }), '')
  assert.equal(failureTextOf(undefined), '')
})

test('classifyFailure puts common errors on the right layer', () => {
  const cases = [
    ['dsh web authentication required', 'auth'],
    ['Error: EPERM: operation not permitted', 'permission'],
    ['Error: ENOENT: no such file or directory', 'path'],
    ['ERR_MODULE_NOT_FOUND: Cannot find package', 'dependency'],
    ['Failed to connect to github.com:443 after 21108 ms', 'network'],
    ['SyntaxError: Unexpected token', 'syntax'],
  ]
  for (const [text, layerId] of cases) {
    assert.equal(classifyFailure(text).id, layerId, `${text} 应判成 ${layerId}`)
  }
  assert.equal(classifyFailure('').id, 'unknown')
  assert.equal(classifyFailure('something totally unclassified').id, 'unknown')
  assert.ok(FAILURE_LAYERS.some((entry) => entry.id === 'test'))
})

test('the same error text normalizes to one signature even with different numbers and paths', () => {
  const a = 'Error: ENOENT: no such file or directory, open C:\\work\\one.txt:12'
  const b = 'Error: ENOENT: no such file or directory, open C:\\other\\two.txt:99'
  assert.equal(normalizeFailureText(a), normalizeFailureText(b))
  assert.equal(
    failureSignature('read', a, 'path'),
    failureSignature('read', b, 'path'),
  )
  assert.notEqual(failureSignature('read', a, 'path'), failureSignature('write', a, 'path'))
})

/* ───────────────────────── 时间线 ───────────────────────── */

test('Timeline keeps only the newest rows and counts by class', () => {
  const timeline = new Timeline(3)
  assert.equal(timeline.limit, 3)
  for (let i = 0; i < 5; i += 1) {
    timeline.record({ at: 1000 + i, name: `tool${i}`, classId: i === 4 ? 'write' : 'read', isError: i === 2 })
  }
  assert.equal(timeline.size, 3)
  const rows = timeline.list(3)
  assert.equal(rows.length, 3)
  assert.equal(rows[0].name, 'tool4', '最新的一条应排在最前')
  const summary = timeline.summary()
  assert.equal(summary.total, 3)
  // 挤掉的是 i=0、i=1；i=2 那条失败仍在窗口内，所以 errors 应当是 1。
  assert.equal(summary.errors, 1)
  assert.deepEqual(summary.byClass, { read: 2, write: 1 })
})

test('Timeline resize drops the oldest rows when the cap shrinks', () => {
  const timeline = new Timeline(10)
  for (let i = 0; i < 6; i += 1) timeline.record({ at: i, name: `t${i}` })
  assert.equal(timeline.resize(2), 2)
  assert.equal(timeline.size, 2)
  assert.deepEqual(timeline.list(2).map((row) => row.name), ['t5', 't4'])
})

test('Timeline render stays small and says how many older rows were hidden', () => {
  const timeline = new Timeline(40)
  for (let i = 0; i < 20; i += 1) {
    timeline.record({ at: 5000 + i * 1000, name: 'read', classId: 'read', summary: `file${i}.js` })
  }
  const text = timeline.render(5000 + 19_000, 'zh', 5)
  const lines = text.split('\n')
  assert.equal(lines.length, 7, '1 行标题 + 5 行正文 + 1 行脚注')
  assert.match(lines[0], /动作时间线/)
  assert.match(lines[0], /不是指令/)
  assert.match(text, /另有 15 条更早的未显示/)
  assert.match(text, /按类：读文件与搜索 20/)
})

test('Timeline renders nothing before the first action', () => {
  assert.equal(new Timeline(5).render(Date.now(), 'zh'), '')
})

/* ───────────────────────── 失败案例库 ───────────────────────── */

function memoryStore(initial = { entries: [] }) {
  let state = initial
  return {
    get: () => state,
    update: (patch) => { state = { ...state, ...patch } },
    replace: (next) => { state = next },
    dispose: () => {},
  }
}

test('FailureBook merges the same error into one case and counts hits', () => {
  const book = new FailureBook(null, 10)
  const text = 'Error: ENOENT: no such file or directory, open C:\\a\\b.txt'
  book.record({ tool: 'read', text, at: 1 })
  book.record({ tool: 'read', text: text.replace(': 1', ':'), at: 2 })
  assert.equal(book.size, 1, '同一签名只留一条')
  const [entry] = book.list(10)
  assert.equal(entry.count, 2)
  assert.equal(entry.layer, 'path')
  assert.ok(entry.advice.length > 0)
  assert.ok(entry.sample.length > 0)
  assert.deepEqual(book.summary(), { cases: 1, hits: 2, byLayer: { path: 1 } })
})

test('FailureBook keeps different tools and different layers apart', () => {
  const book = new FailureBook(null, 10)
  book.record({ tool: 'read', text: 'ENOENT: no such file', at: 1 })
  book.record({ tool: 'write', text: 'ENOENT: no such file', at: 2 })
  book.record({ tool: 'pwsh', text: 'ETIMEDOUT connecting', at: 3 })
  assert.equal(book.size, 3)
  const layers = book.list(10).map((entry) => entry.layer).sort()
  assert.deepEqual(layers, ['network', 'path', 'path'])
})

test('FailureBook pages through a store and reloads its cases', () => {
  const store = memoryStore()
  const first = new FailureBook(store, 10)
  first.record({ tool: 'read', text: 'EACCES: permission denied', at: 7 })
  first.flush()

  const second = new FailureBook(store, 10)
  assert.equal(second.size, 1)
  assert.equal(second.list(1)[0].layer, 'permission')
})

test('FailureBook stops at its cap and keeps the newest cases', () => {
  const book = new FailureBook(null, 2)
  book.record({ tool: 'a', text: 'ENOENT one', at: 1 })
  book.record({ tool: 'b', text: 'ETIMEDOUT two', at: 2 })
  book.record({ tool: 'c', text: 'SyntaxError three', at: 3 })
  assert.equal(book.size, 2)
  const tools = book.list(2).map((entry) => entry.tool).sort()
  assert.deepEqual(tools, ['b', 'c'])
})

/* ───────────────────────── 术语表 ───────────────────────── */

test('the glossary covers the words this plugin itself uses', () => {
  for (const key of ['waterfall', 'peerDependency', 'inject', 'slot', 'HMR', 'manifest', 'loopback']) {
    const entry = lookupTerm(key)
    assert.ok(entry, `${key} 应在术语表里`)
    assert.ok(entry.zh.length > 0)
    assert.ok(entry.en.length > 0)
  }
  assert.equal(lookupTerm('definitely-not-a-term'), undefined)
  assert.ok(GLOSSARY_KEYS.length >= 10)
  assert.equal(new Set(GLOSSARY.map((entry) => entry.term)).size, GLOSSARY.length)
})

test('glossarySection is bounded and honors the language switch', () => {
  const zh = glossarySection('zh', 4)
  assert.match(zh, /首次出现就该给一句话的术语/)
  assert.equal(zh.split('\n').length, 6, '1 行标题 + 4 条 + 1 行尾注')
  assert.match(zh, /waterfall/)

  const en = glossarySection('en', 3)
  assert.match(en, /Terms that usually need one plain sentence/)
  assert.equal(en.split('\n').length, 5)

  assert.equal(glossarySection('zh', 0), '')
})

/* ───────────────────────── 提示词接线 ───────────────────────── */

test('buildSectionText includes the term cards only when glossary is on', () => {
  const on = buildSectionText({ language: 'zh', glossary: true })
  assert.match(on, /首次出现就该给一句话的术语/)
  assert.match(on, /waterfall/)

  const off = buildSectionText({ language: 'zh', glossary: false })
  assert.doesNotMatch(off, /首次出现就该给一句话的术语/)
})

test('the timeline is deliberately absent from the prompt text', () => {
  // 时间线只给面板回看：提示词里只该有 digest（最近 8 条），不该有完整时间线。
  const text = buildSectionText({ language: 'zh', detail: 'thorough' })
  assert.doesNotMatch(text, /动作时间线/)
})

/* ───────────────────────── 只读活动接口 ───────────────────────── */

function fakeReq({ method = 'GET', url = '/', headers = {} } = {}) {
  const req = Readable.from([])
  req.method = method
  req.url = url
  req.headers = headers
  return req
}

function fakeRes() {
  const res = { statusCode: 0, headers: {}, chunks: [] }
  res.writeHead = (status, headers) => { res.statusCode = status; Object.assign(res.headers, headers ?? {}) }
  res.end = (body) => { if (body !== undefined) res.chunks.push(Buffer.from(String(body))) }
  res.body = () => Buffer.concat(res.chunks).toString('utf8')
  return res
}

const LOOPS = {
  host: '127.0.0.1:19387',
  origin: 'http://127.0.0.1:19387',
  referer: 'http://127.0.0.1:19387/ui',
}

function makeDeps(activity) {
  return {
    connection: undefined,
    getMerged: () => ({ language: 'zh' }),
    saveOverrides: () => ({ settings: { language: 'zh' }, feedback: '已保存' }),
    resetOverrides: () => ({ settings: { language: 'zh' }, feedback: '已恢复默认' }),
    preview: () => ({ section: '', length: 0 }),
    meta: () => ({ savedAt: 1, saveCount: 2 }),
    health: () => ({ startedAt: 0, digestRows: 0, log: [] }),
    onRejection: () => {},
    onError: () => {},
    activity,
  }
}

function activityFixture() {
  const timeline = new Timeline(5)
  timeline.record({ at: 1, name: 'read', classId: 'read', summary: 'a.js' })
  timeline.record({ at: 2, name: 'pwsh', classId: 'exec', summary: 'npm test', isError: true })
  const failures = new FailureBook(null, 10)
  failures.record({ tool: 'pwsh', text: 'SyntaxError: Unexpected token', at: 2 })
  return {
    timeline: timeline.list(5),
    summary: { ...timeline.summary(), limit: timeline.limit },
    failures: failures.list(10),
    failureSummary: failures.summary(),
    classes: ACTION_CLASSES,
    glossary: GLOSSARY,
  }
}

test('GET /activity returns the read-only review payload', async () => {
  const handler = createConfigServer(makeDeps(activityFixture))
  const res = fakeRes()
  await handler(fakeReq({ url: '/api/ai-action-translator/activity', headers: LOOPS }), res)
  assert.equal(res.statusCode, 200)
  const payload = JSON.parse(res.body())
  assert.equal(payload.ok, true)
  assert.equal(payload.timeline.length, 2)
  assert.equal(payload.timeline[0].name, 'pwsh', '最新动作在前')
  assert.equal(payload.summary.total, 2)
  assert.equal(payload.summary.errors, 1)
  assert.equal(payload.failures.length, 1)
  assert.equal(payload.failures[0].layer, 'syntax')
  assert.equal(payload.failureSummary.hits, 1)
  assert.ok(Array.isArray(payload.classes) && payload.classes.length > 0)
  assert.ok(Array.isArray(payload.glossary) && payload.glossary.length > 0)
  assert.deepEqual(payload.meta, { savedAt: 1, saveCount: 2 })
})

test('GET /activity honors limit and rejects non-GET', async () => {
  const handler = createConfigServer(makeDeps(activityFixture))
  const limited = fakeRes()
  await handler(fakeReq({ url: '/api/ai-action-translator/activity?limit=1', headers: LOOPS }), limited)
  assert.equal(JSON.parse(limited.body()).timeline.length, 1)

  const post = fakeRes()
  await handler(fakeReq({ method: 'POST', url: '/api/ai-action-translator/activity', headers: LOOPS }), post)
  assert.equal(post.statusCode, 405)
})

test('GET /activity degrades to an empty payload when the plugin has no data source', async () => {
  const handler = createConfigServer(makeDeps(undefined))
  const res = fakeRes()
  await handler(fakeReq({ url: '/api/ai-action-translator/activity', headers: LOOPS }), res)
  assert.equal(res.statusCode, 200)
  const payload = JSON.parse(res.body())
  assert.equal(payload.ok, true)
  assert.deepEqual(payload.timeline, [])
  assert.deepEqual(payload.failures, [])
  assert.equal(payload.summary.total, 0)
})

test('the default timeline cap is bigger than the digest cap', () => {
  // digest 默认 8 条给提示词；时间线默认 40 条给人回看。这个大小关系是设计意图，不是巧合。
  assert.ok(TIMELINE_LIMIT >= 40)
})
