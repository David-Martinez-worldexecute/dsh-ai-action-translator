/**
 * 本地访问围栏（trust fence）。
 *
 * 为什么必须有这个文件：
 * DSH 内核自带的准入检查挂在 `/api` 这个前缀上。内核按“最长前缀优先”分派，
 * 而本插件的路由是 `/api/ai-action-translator`，比 `/api` 更长，
 * 因此本插件的处理函数会在内核检查之前被调用。
 * 换句话说：这段围栏不是重复劳动，而是本插件唯一的准入检查。
 *
 * 策略（只允许“本机浏览器访问本机服务”这一种形状）：
 *  1. Host 必须是回环地址（127.0.0.1 / [::1] / localhost）。→ 否则 403
 *  2. 若带 Origin：必须与 Host 同源（主机名 + 端口一致）。→ 否则 403
 *  3. 若带 Referer：同上；桌面外壳的中继 Referer（dsh-app://）单独放行。
 *  4. 若组合里提供了 connection 服务，则再让它做一次准入判定（401 / 503）。
 *
 * 本文件不写文件、不发网络请求、不读用户数据，只是纯函数判断。
 */

const LOOPBACK_NAMES = new Set(['127.0.0.1', '[::1]', '::1', 'localhost'])

/** 把 `host:port`、`http://host:port`、完整 URL 统一成 {scheme, hostname, port}。 */
export function authorityOf(value, defaultScheme = 'http') {
  if (typeof value !== 'string' || value.length === 0) return undefined
  const text = value.includes('://') ? value : `${defaultScheme}://${value}`
  try {
    const url = new URL(text)
    const scheme = url.protocol.replace(/:$/, '')
    return {
      scheme,
      hostname: url.hostname.toLowerCase(),
      port: url.port || (scheme === 'https' ? '443' : '80'),
    }
  } catch {
    return undefined
  }
}

/** 只认回环地址：这是“本机自己访问自己”的唯一合法形状。 */
export function isLoopbackHost(value) {
  const authority = authorityOf(value)
  if (authority === undefined) return false
  return LOOPBACK_NAMES.has(authority.hostname)
}

/** 桌面外壳的中继页 Referer，是已知的、非跨站的固定来源。 */
export function isDesktopRelayReferer(value) {
  return typeof value === 'string' && /^dsh-app:\/\//i.test(value)
}

function headerOf(req, name) {
  const headers = req?.headers
  if (headers === undefined || headers === null) return undefined
  const raw = typeof headers.get === 'function' ? headers.get(name) : headers[name]
  if (Array.isArray(raw)) return raw.length > 0 ? String(raw[0]) : undefined
  if (raw === undefined || raw === null) return undefined
  const text = String(raw)
  return text.length > 0 ? text : undefined
}

function sameAuthority(a, b) {
  return a !== undefined && b !== undefined && a.hostname === b.hostname && a.port === b.port
}

/**
 * 返回 undefined 表示放行；返回数字表示应当立刻以该状态码拒绝。
 * 顺序刻意如此：本机校验 → 同源校验 → 组合自带准入。
 */
export function rejectionFor(req, connection) {
  const host = headerOf(req, 'host')
  if (!isLoopbackHost(host)) return 403
  const hostAuthority = authorityOf(host)

  const origin = headerOf(req, 'origin')
  if (origin !== undefined && !sameAuthority(authorityOf(origin), hostAuthority)) return 403

  const referer = headerOf(req, 'referer')
  if (referer !== undefined && !isDesktopRelayReferer(referer)) {
    if (!sameAuthority(authorityOf(referer), hostAuthority)) return 403
  }

  if (connection !== undefined && connection !== null) {
    try {
      if (typeof connection.admit === 'function') {
        const verdict = connection.admit(req)
        if (typeof verdict === 'number') return verdict
        if (verdict !== undefined && verdict !== null && verdict.rejection !== undefined) {
          return Number(verdict.rejection)
        }
      } else if (typeof connection.requestRejection === 'function') {
        // 旧式接口：直接返回状态码。
        const legacy = connection.requestRejection(req)
        if (Number.isFinite(Number(legacy))) return Number(legacy)
      }
    } catch {
      // 准入服务自己坏了，不能当成“放行”。
      return 503
    }
  }

  return undefined
}

/** 拒绝原因只写进日志，不回给调用方，避免泄露内部判断细节。 */
export function logAdmissionRejection(logger, label) {
  return status => {
    logger?.warn?.(`[ai-action-translator] ${label} rejected with ${status}`)
  }
}
