/**
 * 浏览器半身（client.js）测试。
 *
 * client.js 是给浏览器用的 ModuleLoader 包，不能在 Node 里直接 import。
 * 这里用 node:vm 造一个最小浏览器环境：假的 window.__ModuleLoader__、假的 react、
 * 只提供 document.baseURI。因为插件只把 React 当渲染器用，__test 暴露的全是纯函数，
 * 所以不需要真的 React 也能验证「字段清单是否和后端一致」「请求体是否只含白名单字段」
 * 「校验是否能在本地挡住坏值」这些真正会出错的地方。
 *
 * 本测试不联网：fetch 一旦被调用就直接抛错。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { RUNTIME_KEYS } from '../lib/server.js'

const SOURCE = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8')

/** React 的最小替身：只占位，不渲染。 */
const ReactStub = {
  createElement: () => null,
  useState: () => [undefined, () => {}],
  useEffect: () => {},
  useCallback: fn => fn,
  useMemo: fn => fn(),
}

/**
 * 在隔离的 vm 上下文里加载 client.js。
 * baseURI 可定制，用来验证「根路径部署」与「子路径部署」都能解析出正确的接口前缀。
 */
function loadClient(baseURI = 'http://127.0.0.1:19387/index.html') {
  let loaded = null
  let moduleId = null
  const warnings = []

  const sandbox = {
    window: {
      __ModuleLoader__: {
        load: spec => {
          moduleId = spec.id
          loaded = spec.factory(name => {
            if (name === 'react') return ReactStub
            throw new Error(`unexpected require: ${name}`)
          })
        },
      },
    },
    console: { warn: message => warnings.push(String(message)), log: () => {}, error: () => {} },
    document: { baseURI },
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    fetch: () => {
      throw new Error('network access is not allowed in client.test.mjs')
    },
  }
  vm.createContext(sandbox)
  vm.runInContext(SOURCE, sandbox)

  assert.ok(loaded, 'client.js 应当调用 window.__ModuleLoader__.load')
  return { exported: loaded, moduleId, warnings }
}

test('client half loads through the ModuleLoader contract', () => {
  const { exported, moduleId } = loadClient()
  assert.equal(moduleId, 'dsh-ai-action-translator')
  assert.equal(exported.name, 'ai-action-translator')
  assert.deepEqual([...exported.inject], ['slots', 'locale'])
  assert.equal(typeof exported.apply, 'function')
  assert.equal(typeof exported.__test, 'object')
})

test('API_PATH is a same-origin path, never a hardcoded host', () => {
  const { exported } = loadClient()
  const { API_PATH } = exported.__test
  assert.equal(API_PATH, '/api/ai-action-translator')
  // 关键不变量：前缀必须是相对路径，否则会绕过会话票据或写死端口。
  assert.ok(API_PATH.startsWith('/'))
  assert.doesNotMatch(API_PATH, /^https?:|:\d/)
})

test('API_PATH follows a sub-path deployment', () => {
  const { exported } = loadClient('http://127.0.0.1:19387/nested/app.html')
  assert.equal(exported.__test.API_PATH, '/nested/api/ai-action-translator')
})

test('FIELD_IDS matches the backend RUNTIME_KEYS exactly', () => {
  const { exported } = loadClient()
  const { FIELD_IDS } = exported.__test
  assert.deepEqual([...FIELD_IDS].sort(), [...RUNTIME_KEYS].sort())
})

test('every field is classified by exactly one control type', () => {
  const { exported } = loadClient()
  const { FIELD_IDS, BOOL_FIELDS, TEXT_FIELDS, SELECTS, SPECIAL_FIELDS } = exported.__test
  const classified = [...BOOL_FIELDS, ...TEXT_FIELDS, ...SELECTS.map(item => item.id), ...SPECIAL_FIELDS]
  // 分类表漏一个字段 → 表单渲染不出它，保存时 toPayload 也拿不到它。
  assert.deepEqual(classified.slice().sort(), [...FIELD_IDS].sort())
  assert.equal(new Set(classified).size, classified.length, '字段被重复分类')
})

test('every field has a label in both languages', () => {
  const { exported } = loadClient()
  const { DICT, FIELD_IDS } = exported.__test
  assert.deepEqual(Object.keys(DICT.zh).sort(), Object.keys(DICT.en).sort())
  for (const id of FIELD_IDS) {
    assert.equal(typeof DICT.zh[`field.${id}`], 'string', `zh 缺少 field.${id}`)
    assert.equal(typeof DICT.en[`field.${id}`], 'string', `en 缺少 field.${id}`)
  }
})

test('toPayload sends exactly the whitelisted keys', () => {
  const { exported } = loadClient()
  const { toPayload, FIELD_IDS } = exported.__test
  const payload = toPayload({ persona: '学姐', digestSize: 3, sensitiveTools: 'a\n b \n\n' })
  assert.deepEqual(Object.keys(payload).sort(), [...FIELD_IDS].sort())
  assert.equal(payload.persona, '学姐')
  assert.equal(payload.digestSize, 3)
  // 注意：payload 由 vm 沙箱里的代码生成，数组原型属于另一个 realm。
  // deepStrictEqual 会连原型一起比，所以先展开成当前 realm 的数组。
  assert.deepEqual([...payload.sensitiveTools], ['a', 'b'])
})

test('toPayload clamps digestSize into range', () => {
  const { exported } = loadClient()
  const { toPayload } = exported.__test
  assert.equal(toPayload({ digestSize: 999 }).digestSize, 50)
  assert.equal(toPayload({ digestSize: -4 }).digestSize, 0)
  assert.equal(toPayload({ digestSize: 'abc' }).digestSize, 0)
})

test('toForm degrades gracefully on junk input', () => {
  const { exported } = loadClient()
  const { toForm } = exported.__test
  const empty = toForm(undefined)
  assert.equal(empty.digestSize, 8)
  assert.equal(empty.persona, '')
  assert.equal(empty.language, 'zh')
  assert.deepEqual(empty.sensitiveTools, '')

  const weird = toForm({ language: 'klingon', digestSize: 'x', sensitiveTools: [1, 'ok', null], persona: 42 })
  assert.equal(weird.language, 'zh', '未知枚举值应退回第一个选项')
  assert.equal(weird.digestSize, 8)
  assert.equal(weird.persona, '', '非字符串应退回空串')
  assert.equal(weird.sensitiveTools, 'ok')
})

test('validate blocks long persona and out-of-range digestSize', () => {
  const { exported } = loadClient()
  const { validate, PERSONA_LIMIT, DIGEST_MAX } = exported.__test
  // 跨 realm 数组不能直接 deepStrictEqual，统一用 length / join 比较。
  assert.equal(validate({ persona: '', digestSize: 5 }).length, 0)
  assert.equal(validate({ persona: 'x'.repeat(PERSONA_LIMIT + 1), digestSize: 5 }).length, 1)
  assert.equal(validate({ persona: '', digestSize: DIGEST_MAX + 1 }).length, 1)
})

test('apply registers a settings.section slot', () => {
  const { exported } = loadClient()
  const registered = []
  const ctx = {
    locale: {
      bind: () => key => key,
      register: (ns, dict) => registered.push({ kind: 'locale', ns, dict }),
    },
    effect: fn => fn(),
    slots: {
      inject: (name, cb) => { assert.equal(name, 'settings.section'); cb() },
      register: (spec, render) => { registered.push({ kind: 'slot', spec, render }); return () => {} },
    },
  }
  exported.apply(ctx)

  const locale = registered.find(entry => entry.kind === 'locale')
  assert.equal(locale.ns, 'plugin.aiActionTranslator')
  assert.ok(locale.dict.zh && locale.dict.en)

  const slot = registered.find(entry => entry.kind === 'slot')
  assert.equal(slot.spec.name, 'settings.section')
  assert.equal(slot.spec.id, 'ai-action-translator')
  assert.equal(slot.spec.locale, 'plugin.aiActionTranslator')
  assert.equal(typeof slot.spec.order, 'number')
  assert.equal(typeof slot.spec.label, 'function')
  assert.equal(typeof slot.render, 'function')
})

test('apply never throws when host services are missing', () => {
  const { exported, warnings } = loadClient()
  assert.doesNotThrow(() => exported.apply({}))
  assert.ok(warnings.length >= 1, '缺少服务时应记一条警告而不是炸掉设置页')
  assert.match(warnings[0], /ai-action-translator/)
})

/**
 * 2026-10 实际踩过的坑：插件加载时读了一个未声明服务而抛错，异常被吞，
 * 配置面板的路由从未注册。界面上的表现只有一句「加载失败：not found」，
 * 用户完全无法判断该做什么。所以 404/405 必须被单独识别，并说清怎么办。
 */
test('HTTP 404 is reported as a missing backend route, not an opaque not found', () => {
  const { exported } = loadClient()
  const { describeError, DICT } = exported.__test

  assert.equal(describeError({ status: 404 }).kind, 'missing')
  assert.equal(describeError({ status: 405 }).kind, 'missing')
  assert.equal(describeError({ status: 401 }).kind, 'gate')
  assert.equal(describeError({ status: 403 }).kind, 'gate')
  assert.equal(describeError({ status: 503 }).kind, 'gate')
  assert.equal(describeError({ status: undefined }).kind, 'offline')

  // 两侧都要有文案，且必须给出可执行的下一步，而不是只回显后端原文。
  for (const lang of ['zh', 'en']) {
    const text = DICT[lang]['fb.missing']
    assert.equal(typeof text, 'string', `${lang} 缺少 fb.missing`)
    assert.notEqual(text.trim(), '')
  }
  assert.match(DICT.zh['fb.missing'], /重启 DSH/)
  assert.match(DICT.en['fb.missing'], /Restart DSH/)
})
