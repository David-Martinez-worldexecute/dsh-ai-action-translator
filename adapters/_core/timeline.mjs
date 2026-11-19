/**
 * 宿主无关的「事后时间线」。
 *
 * 之所以要它：不是每个宿主都允许在动作**之前**拦一下。有的只能在动作**之后**被通知。
 * 那种宿主上我们做不了守门，但至少能让用户回看「刚才到底跑了什么」——
 * 这比假装自己拦得住要诚实得多。
 *
 * 三条硬约束：
 *   1. **只追加**。绝不重写已有行：日志一旦能被覆盖，「它记录过什么」就不再可信。
 *   2. **参数必须脱敏**。密钥、口令、令牌只留 `key=***`；这是唯一允许出现在磁盘上的形态。
 *   3. **不联网、不出仓库**：文件落在项目根的 `.aiact/` 下，路径由调用方给。
 */
import fs from 'node:fs'
import path from 'node:path'

export const TIMELINE_DIR = '.aiact'
export const TIMELINE_FILE = 'timeline.jsonl'

/** 超过这个行数就裁掉最旧的，避免一年后几万行 JSONL 把磁盘和眼睛一起拖死。 */
export const TIMELINE_KEEP = 500
const MAX_VALUE = 90

/** 与 lib/index.js 的 summarizeArguments 同一套形状：多了就出问题的那几个键。 */
const SECRET_KEY_RE = /(pass(word|wd)?|secret|token|api[-_]?key|credential|authorization|cookie|session[-_]?id|private[-_]?key)/i

function truncate(value, limit = MAX_VALUE) {
  const text = String(value).replace(/\s+/g, ' ').trim()
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}

/**
 * 把工具参数压成一行可读的摘要，并把敏感键打成 ***。
 * 返回值里的 redacted 会写进时间线：用户看到 ⚠ 就知道「这里本来有值，被我藏了」。
 */
export function summarizeArguments(args) {
  if (args === undefined || args === null) return { summary: '', redacted: false }
  if (typeof args !== 'object') return { summary: truncate(args), redacted: false }

  const parts = []
  let redacted = false
  for (const [key, value] of Object.entries(args)) {
    if (SECRET_KEY_RE.test(key)) {
      parts.push(`${key}=***`)
      redacted = true
      continue
    }
    if (Array.isArray(value)) {
      parts.push(`${key}=[${value.length}]`)
      continue
    }
    if (value && typeof value === 'object') {
      parts.push(`${key}={…}`)
      continue
    }
    if (value === undefined) continue
    parts.push(`${key}=${truncate(value)}`)
  }
  return { summary: parts.join(' · '), redacted }
}

/** 把事件写成一行 JSONL。写完不回读——回读是 readTimeline 的事。 */
export function recordEvent(file, event) {
  const line = `${JSON.stringify(event)}\n`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.appendFileSync(file, line, 'utf8')
  return line.length
}

/** 读最近 limit 条（新的在后）。坏行直接跳过，不让一行写坏毁掉整份记录。 */
export function readTimeline(file, limit = TIMELINE_KEEP) {
  if (!fs.existsSync(file)) return []
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter((line) => line.trim() !== '')
  const rows = []
  for (const line of lines) {
    try {
      rows.push(JSON.parse(line))
    } catch {
      // 半行（进程被杀）不该让整份时间线不可读。
    }
  }
  return rows.slice(-limit)
}

/** 裁到最近 keep 行。只在超过阈值时调用，避免每次写都重排整个文件。 */
export function pruneTimeline(file, keep = TIMELINE_KEEP) {
  if (!fs.existsSync(file)) return 0
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter((line) => line.trim() !== '')
  if (lines.length <= keep) return 0
  const kept = lines.slice(-keep)
  fs.writeFileSync(file, `${kept.join('\n')}\n`, 'utf8')
  return lines.length - kept.length
}

/** 项目根下的默认路径：`<cwd>/.aiact/timeline.jsonl`。 */
export function timelinePath(cwd = process.cwd()) {
  return path.join(cwd, TIMELINE_DIR, TIMELINE_FILE)
}
