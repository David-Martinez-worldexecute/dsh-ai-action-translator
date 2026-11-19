/**
 * 宿主无关的 hook 运行时。
 *
 * 各家的钩子协议长得不一样，但骨架是同一个：
 *   stdin 给一段 JSON → 我们判定 → stdout 给一段 JSON（或退出码）说「拦」还是「放」。
 * 差异只在三处，用 spec 描述，别在代码里分叉：
 *   envelope  —— 回复的信封形状：'top'（字段在顶层）/ 'nested'（包一层 hookSpecificOutput）/ 'plain'（只用退出码）
 *   namePath  —— 事件里「工具名」在哪
 *   argsPath  —— 事件里「工具参数」在哪
 *
 * 一条硬规矩：**脚本自身出错时一律放行**（fail-open），但必须把原因写到 stderr。
 * 理由不是偷懒：这个脚本装在用户每天都要用的工具链里，它一崩就让用户所有命令都跑不了，
 * 那用户会做的第一件事是把整个东西卸掉 —— 那时拦得住什么都无从谈起。
 * 所以「我坏了」必须可见，「我坏了」不能变成「我拦你」。
 */
import fs from 'node:fs'
import path from 'node:path'
import { loadPolicy, judge, denyMessage, warnMessage } from './judge.mjs'

/** 读完整 stdin。带超时：有的宿主不关管道，硬等会把整个工具调用挂住。 */
export function readStdin(stream = process.stdin, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let text = ''
    let done = false
    const finish = () => {
      if (done) return
      done = true
      resolve(text)
    }
    const timer = setTimeout(finish, timeoutMs)
    if (typeof timer.unref === 'function') timer.unref()
    try {
      stream.setEncoding('utf8')
      stream.on('data', (chunk) => { text += chunk })
      stream.on('end', () => { clearTimeout(timer); finish() })
      stream.on('error', () => { clearTimeout(timer); finish() })
    } catch {
      clearTimeout(timer)
      finish()
    }
  })
}

/** 坏 JSON 返回 null 而不是抛：钩子收到的可能是空串、也可能是别的东西。 */
export function parseHookInput(text) {
  if (typeof text !== 'string' || text.trim() === '') return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** 按点路径取值，任一层缺了就返回 undefined —— 不猜。 */
export function pick(object, keys) {
  let cursor = object
  for (const key of keys) {
    if (cursor === null || cursor === undefined || typeof cursor !== 'object') return undefined
    cursor = cursor[key]
  }
  return cursor
}

export function pickName(input, spec) {
  const value = pick(input, spec.namePath)
  return typeof value === 'string' ? value : ''
}

export function pickArgs(input, spec) {
  const value = pick(input, spec.argsPath)
  if (value === undefined) return pick(input, spec.namePath) === undefined ? {} : {}
  return value
}

/** 把 verdict 翻成该宿主能读的 stdout 文本 + 退出码。 */
export function formatVerdict(verdict, spec, language = 'zh') {
  const event = spec.event || 'PreToolUse'
  if (verdict.action === 'deny') {
    const reason = denyMessage(verdict, language)
    if (spec.envelope === 'plain') {
      return { stdout: '', stderr: reason, exitCode: 2 }
    }
    const body = { hookEventName: event, permissionDecision: 'deny', permissionDecisionReason: reason }
    const payload = spec.envelope === 'nested' ? { hookSpecificOutput: body } : body
    return { stdout: `${JSON.stringify(payload)}\n`, stderr: '', exitCode: 0 }
  }
  if (verdict.action === 'warn') {
    const note = warnMessage(verdict, language)
    // 提醒永远不阻断：这条路径的语义就是「放你过去，但你该知道」。
    if (spec.envelope === 'plain') return { stdout: '', stderr: note, exitCode: 0 }
    const body = { hookEventName: event, permissionDecision: 'allow', permissionDecisionReason: note }
    const payload = spec.envelope === 'nested' ? { hookSpecificOutput: body } : body
    return { stdout: `${JSON.stringify(payload)}\n`, stderr: '', exitCode: 0 }
  }
  // allow：什么都不说，是这一层最好的输出。
  return { stdout: '', stderr: '', exitCode: 0 }
}

/** 读配置：`.aiact/config.json`。缺了就全用默认（守门 off）。 */
export function readConfig(file) {
  const defaults = { language: 'zh', mode: 'off', level: 'high', allowRules: [], allowTools: [], includeQuiet: false, detail: 'brief' }
  if (!file || !fs.existsSync(file)) return defaults
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    return { ...defaults, ...(parsed && typeof parsed === 'object' ? parsed : {}) }
  } catch {
    return defaults
  }
}

/**
 * 跑一次钩子。返回 { exitCode, stdout, stderr }，由各家的薄脚本决定怎么用。
 * 注意：这里不写 process.exit —— 让调用方保留一次写日志的机会。
 */
export async function runHook(spec, options = {}) {
  const stdin = options.stdin !== undefined ? options.stdin : await readStdin()
  const input = parseHookInput(stdin)
  if (!input) {
    return { exitCode: 0, stdout: '', stderr: '[aiact] 钩子输入不是合法 JSON，已放行。\n' }
  }

  const configFile = path.resolve(spec.configPath || path.join(process.cwd(), '.aiact', 'config.json'))
  const config = readConfig(configFile)
  if (config.mode === 'off') return { exitCode: 0, stdout: '', stderr: '' }

  let policy
  try {
    policy = loadPolicy(path.resolve(spec.policyPath || path.join(path.dirname(configFile), 'core', 'policy.json')))
  } catch (error) {
    return { exitCode: 0, stdout: '', stderr: `[aiact] 读不到规则文件（${error.message}），已放行。\n` }
  }

  const name = pickName(input, spec)
  const args = pickArgs(input, spec)
  const verdict = judge(policy, name, args, {
    mode: config.mode,
    level: config.level,
    allowRules: config.allowRules,
    allowTools: config.allowTools,
    includeQuiet: config.includeQuiet,
  })

  const result = formatVerdict(verdict, spec, config.language === 'en' ? 'en' : 'zh')
  return { ...result, verdict }
}

/** 薄脚本共用的一行收尾：把 stdout/stderr 写出去并按约定退出。 */
export function emit(result) {
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  process.exitCode = result.exitCode
}
