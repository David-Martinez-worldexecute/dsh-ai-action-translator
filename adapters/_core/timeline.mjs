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

/**
 * 文件涨到多大才值得去裁一次。
 *
 * 这里原来写的是 512 KB，那等于「超 500 行裁旧」永远不触发：一行约 150–250 字节，
 * 500 行才 75–125 KB，要涨到 512 KB 得两千多行。文档说一套、代码做另一套，
 * 而两边都不会报错 —— 只有用户某天发现文件很大才会察觉。
 * 阈值按「略高于 500 行的体量」定，和 TIMELINE_KEEP 说的是同一件事。
 */
export const TIMELINE_PRUNE_BYTES = 128 * 1024

const MAX_VALUE = 90

/** 与 lib/index.js 的 summarizeArguments 同一套形状：多了就出问题的那几个键。 */
const SECRET_KEY_RE = /(pass(word|wd)?|secret|token|api[-_]?key|credential|authorization|cookie|session[-_]?id|private[-_]?key)/i

/**
 * 值里面也可能有密钥 —— 而且这是更常见的情况。
 *
 * 实测踩到的：`{ command: 'npm test --token=supersecret' }` 的键是 `command`（不敏感），
 * 于是原来的实现原样落盘，`.aiact/timeline.jsonl` 里躺着明文令牌。
 * 只要看键名就能防住的说法是错的：命令、URL、header 里到处是 `--token=` 这种写法。
 *
 * 所以值也要过一遍。规则只认「敏感词 + 分隔符 + 值」这种形态，
 * 宁窄勿宽：宁可漏掉一种写法，也不要把正常参数糊成星号（那会让时间线失去用处）。
 */
const SCRUB_RULES = [
  // --token=xxx / token: xxx / "password":"xxx" / Authorization: Bearer xxx
  //
  // 值前面可能有 scheme 词（Bearer / Basic / Token / Digest），必须**保留它、只吃后面的凭据**。
  // 第一版没有这段，实测 `Authorization: Bearer abcdef123456` 被替换成
  // `Authorization: *** abcdef123456` —— 令牌原样留在盘上，看着还像脱敏过了。
  [
    /(\b(?:pass(?:word|wd)?|secret|token|api[-_]?key|credential|authorization|cookie|session[-_]?id|private[-_]?key)["']?\s*[=:]\s*)((?:Bearer|Basic|Token|Digest)\s+)?(?:"[^"]*"|'[^']*'|[^\s,;&"'}]+)/gi,
    '$1$2***',
  ],
  [/\b(gh[pousr]_[A-Za-z0-9]{20,})/g, '***'], // GitHub token
  [/\bsk-[A-Za-z0-9_-]{16,}/g, '***'], // OpenAI 风格
  [/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1***'], // 没有敏感词前缀时兜底
  [/(\/\/)[^/\s:@]+:[^/\s@]+@/g, '$1***:***@'], // https://user:pass@host
]

/** 把一段文本里的密钥换成 ***。返回 scrub 后的文本；是否改动过由调用方比较得出。 */
function scrubSecrets(text) {
  let out = String(text)
  for (const [pattern, replacement] of SCRUB_RULES) out = out.replace(pattern, replacement)
  return out
}

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
  if (typeof args !== 'object') {
    const text = String(args)
    const safe = scrubSecrets(text)
    return { summary: truncate(safe), redacted: safe !== text }
  }

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
    const raw = String(value)
    const safe = scrubSecrets(raw)
    if (safe !== raw) redacted = true
    parts.push(`${key}=${truncate(safe)}`)
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
