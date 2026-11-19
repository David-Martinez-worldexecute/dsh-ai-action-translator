/**
 * 配置界面的 HTTP 路由层。
 *
 * 为什么必须有围栏：内核的准入检查挂在 /api 前缀上，而本插件路由
 * /api/ai-action-translator 更长、优先命中，所以本插件必须自带准入检查
 * （见 lib/trust.js）：只放行「本机浏览器访问本机服务」这一种形状。
 *
 * 路由表（method + 子路径）：
 *   GET  /            → 配置页面（HTML）
 *   GET  /settings    → 当前生效配置 + 元信息 + 健康状态（刷新按钮用这个）
 *   POST /settings    → 校验并保存个性化配置，立即生效
 *   POST /reset       → 清空已保存的个性化配置，回到 YAML 基线
 *   GET  /health      → 运行状态 + 最近报错日志
 *   OPTIONS *         → 204（预检）
 *
 * 本文件不决定配置语义（语义在 lib/index.js 的 normalize 与闭包里），
 * 只负责 HTTP 协议：围栏、方法分派、请求体上限、状态码、错误信封。
 */

import { rejectionFor } from './trust.js'
import { CONFIG_PAGE_HTML } from './page.js'
import { presetList, presetPatch, PRESET_IDS, SAMPLE_ACTION } from './presets.js'

const BODY_LIMIT = 64 * 1024

/** 运行时可改的配置键。enabled / order 是结构性设置，只能走 YAML。 */
export const RUNTIME_KEYS = [
  'language', 'detail', 'learningStage', 'knowledgeLevel',
  'stageSummary', 'skillCollaboration', 'frameworkMap', 'stepParse',
  'learningFocus', 'playfulness', 'encouragement', 'persona',
  'actionDigest', 'digestSize', 'timeline', 'timelineSize',
  'glossary', 'failureBook', 'observeTools', 'sensitiveTools',
]

/** 有界报错日志环：只存文本与时间戳，供 /health 与页面展示。 */
export class LogRing {
  constructor(limit = 50) {
    this.limit = Math.max(1, limit)
    this.rows = []
  }

  push(level, text) {
    this.rows.push({ at: Date.now(), level: String(level), text: String(text).slice(0, 300) })
    if (this.rows.length > this.limit) this.rows.splice(0, this.rows.length - this.limit)
    return this.rows[this.rows.length - 1]
  }

  tail(n = 20) {
    return this.rows.slice(-Math.max(0, n))
  }
}

/** 读 JSON 请求体；超限 413、坏 JSON 400。错误对象自带 status，向上冒泡。 */
export function readJson(req, limit = BODY_LIMIT) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let settled = false
    const fail = (status, message) => {
      if (settled) return
      settled = true
      reject(Object.assign(new Error(message), { status }))
    }
    req.on('data', (chunk) => {
      if (settled) return
      size += chunk.length
      if (size > limit) {
        try { req.destroy?.() } catch { /* 已经断了就算了 */ }
        return fail(413, 'request body too large')
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (settled) return
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        if (text.trim().length === 0) return resolve({})
        const parsed = JSON.parse(text)
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return fail(400, 'request body must be a JSON object')
        }
        settled = true
        resolve(parsed)
      } catch {
        fail(400, 'request body is not valid JSON')
      }
    })
    req.on('error', (error) => fail(400, String(error?.message ?? error)))
  })
}

/** 服务端白名单净化：类型不对的值一律丢弃，长度一律裁剪，不依赖浏览器自觉。 */
export function sanitizeOverrides(body) {
  const patch = {}
  for (const key of RUNTIME_KEYS) {
    if (!Object.hasOwn(body, key)) continue
    const value = body[key]
    if (typeof value === 'boolean') patch[key] = value
    else if (typeof value === 'number' && Number.isFinite(value)) patch[key] = Math.trunc(value)
    else if (typeof value === 'string') patch[key] = value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 600)
    else if (Array.isArray(value)) {
      patch[key] = value
        .filter((item) => typeof item === 'string' && item.length > 0)
        .map((item) => item.slice(0, 64))
        .slice(0, 50)
    }
  }
  return patch
}

/** 校验 PATCH：未知键直接 400（宁可拒绝，也不静默忽略用户的输入）。 */
export function validateOverrides(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'body must be a JSON object', status: 400 }
  }
  const unknown = Object.keys(body).filter((key) => !RUNTIME_KEYS.includes(key))
  if (unknown.length > 0) {
    return { error: `unknown setting fields: ${unknown.join(', ')}`, status: 400 }
  }
  return { patch: sanitizeOverrides(body) }
}

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
}

/**
 * deps（全部由 lib/index.js 提供）：
 *   connection        组合里的 connection 服务（可能不存在，围栏会退化为本机校验）
 *   getMerged()       当前生效的完整配置（YAML 基线 + 已保存覆盖，已 normalize）
 *   saveOverrides(p)  保存并返回 { settings, feedback }
 *   resetOverrides()  清空覆盖并返回 { settings, feedback }
 *   meta()            { savedAt, saveCount }
 *   health()          { startedAt, digestRows, log }
 *   activity()        时间线 / 失败案例库 / 分类表 / 术语表（只读，不进提示词）
 *   preview(draft)    用草稿配置生成一段真实提示词（「试一下」用）
 *   onRejection(s)    准入拒绝回调（记日志用）
 *   onError(e)        处理过程异常回调
 */
export function createConfigServer(deps) {
  return async function handler(req, res) {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const routePath = url.pathname
      .replace(/^\/api\/ai-action-translator/, '')
      .replace(/\/+$/, '') || '/'
    const method = String(req.method ?? 'GET').toUpperCase()

    const send = (status, payload, extraHeaders = {}) => {
      const body = JSON.stringify(payload)
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        ...extraHeaders,
      })
      res.end(body)
    }

    // 围栏先于一切处理：非本机 / 跨站请求在这里就结束。
    const rejection = rejectionFor(req, deps.connection)
    if (rejection !== undefined) {
      try { deps.onRejection?.(rejection) } catch { /* 日志失败不影响拒绝 */ }
      return send(rejection, {
        error: rejection === 401 ? 'unauthorized'
          : rejection === 503 ? 'admission unavailable'
            : 'forbidden',
      })
    }

    try {
      if (method === 'OPTIONS') {
        res.writeHead(204, { ...CORS_HEADERS, 'content-length': 0 })
        return res.end()
      }

      if (routePath === '/' || routePath === '/ui') {
        if (method !== 'GET') return send(405, { error: 'method not allowed' }, { allow: 'GET, OPTIONS' })
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'content-length': String(Buffer.byteLength(CONFIG_PAGE_HTML, 'utf8')),
        })
        return res.end(CONFIG_PAGE_HTML)
      }

      if (routePath === '/settings') {
        if (method === 'GET') {
          return send(200, {
            ok: true,
            settings: deps.getMerged(),
            meta: deps.meta(),
            health: deps.health(),
            presets: presetList(),
          })
        }
        if (method === 'POST') {
          const body = await readJson(req)
          const check = validateOverrides(body)
          if (check.error !== undefined) return send(check.status, { ok: false, error: check.error })
          const saved = deps.saveOverrides(check.patch)
          return send(200, { ok: true, settings: saved.settings, meta: deps.meta(), health: deps.health(), feedback: saved.feedback })
        }
        return send(405, { error: 'method not allowed' }, { allow: 'GET, POST, OPTIONS' })
      }

      /**
       * POST /preset  { id }
       *
       * 一键切档：把预设 patch 叠加到当前已保存配置上（不是替换），
       * 所以用户手调过的 persona / learningFocus 不会被悄悄抹掉。
       * 预设表在 lib/presets.js，服务端是唯一事实源。
       */
      if (routePath === '/preset') {
        if (method !== 'POST') return send(405, { error: 'method not allowed' }, { allow: 'POST, OPTIONS' })
        const body = await readJson(req)
        const id = typeof body.id === 'string' ? body.id : ''
        if (!PRESET_IDS.includes(id)) {
          return send(400, { ok: false, error: `unknown preset: ${id || '(empty)'}` })
        }
        const saved = deps.saveOverrides(presetPatch(id))
        return send(200, { ok: true, settings: saved.settings, meta: deps.meta(), health: deps.health(), feedback: saved.feedback })
      }

      /**
       * POST /preview  { overrides? }
       *
       * 「试一下」：用**当前生效配置**（可叠加未保存的草稿字段）真实生成一次
       * 提示词段落，回给面板展示。这里不编造效果——调用的是 index.js 里
       * 构建提示词的那个函数，面板看到的就是下一轮模型会看到的东西。
       */
      if (routePath === '/preview') {
        if (method !== 'POST') return send(405, { error: 'method not allowed' }, { allow: 'POST, OPTIONS' })
        const body = await readJson(req)
        // 草稿字段先过一遍白名单：未知键 400，避免用户以为「预览了我没保存的东西」。
        let draft = {}
        if (body.overrides !== undefined) {
          const check = validateOverrides(body.overrides)
          if (check.error !== undefined) return send(check.status, { ok: false, error: check.error })
          draft = check.patch
        }
        const preview = deps.preview({ ...deps.getMerged(), ...draft })
        return send(200, { ok: true, preview, sample: SAMPLE_ACTION })
      }

      if (routePath === '/reset') {
        if (method !== 'POST') return send(405, { error: 'method not allowed' }, { allow: 'POST, OPTIONS' })
        const result = deps.resetOverrides()
        return send(200, { ok: true, settings: result.settings, meta: deps.meta(), health: deps.health(), feedback: result.feedback })
      }

      /**
       * GET /activity  时间线 + 失败案例库 + 分类表 + 术语表（只读，不进提示词）。
       * 时间线是「人类回看」用的，不会被注入模型上下文；
       * 想让它影响讲解，只能靠 digest（最近动作摘要）。
       */
      if (routePath === '/activity') {
        if (method !== 'GET') return send(405, { error: 'method not allowed' }, { allow: 'GET, OPTIONS' })
        const activity = typeof deps.activity === 'function'
          ? deps.activity()
          : { timeline: [], summary: { total: 0, errors: 0, byClass: {}, limit: 0 }, failures: [], failureSummary: { cases: 0, hits: 0, byLayer: {} }, classes: [], glossary: [] }
        const rawLimit = Number.parseInt(url.searchParams.get('limit') ?? '', 10)
        const timeline = Number.isFinite(rawLimit) && rawLimit > 0
          ? activity.timeline.slice(0, rawLimit)
          : activity.timeline
        return send(200, {
          ok: true,
          timeline,
          summary: activity.summary,
          failures: activity.failures,
          failureSummary: activity.failureSummary,
          classes: activity.classes,
          glossary: activity.glossary,
          meta: deps.meta(),
        })
      }

      if (routePath === '/health') {
        if (method !== 'GET') return send(405, { error: 'method not allowed' }, { allow: 'GET, OPTIONS' })
        return send(200, { ok: true, health: deps.health(), meta: deps.meta() })
      }

      return send(404, { error: 'not found', path: routePath })
    } catch (error) {
      try { deps.onError?.(error) } catch { /* 记日志本身不许再抛 */ }
      const status = Number.isFinite(Number(error?.status)) ? Number(error.status) : 500
      return send(status, { ok: false, error: String(error?.message ?? error) })
    }
  }
}
