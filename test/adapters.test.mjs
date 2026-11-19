import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const ADAPTERS = path.join(ROOT, 'adapters')
const CORE = path.join(ADAPTERS, '_core')

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))

/** 三家有钩子的宿主：配置目录 + 期望的信封形状。 */
const HOOKED = [
  { dir: 'claude-code', configDir: '.claude', envelope: 'top' },
  { dir: 'codebuddy', configDir: '.codebuddy', envelope: 'nested' },
  { dir: 'qwen-code', configDir: '.qwen', envelope: 'plain' },
]

/**
 * 把某一家的适配层「装」进一个临时项目目录，布局与用户真实安装后一致：
 *   <tmp>/.aiact/core/      ← adapters/_core 的副本
 *   <tmp>/.aiact/config.json
 *   <tmp>/.claude/...       ← 该宿主的配置目录
 * 然后按宿主的方式（cwd = 项目根）把事件喂给钩子脚本。
 */
/**
 * 手写的递归复制，刻意不用 fs.cpSync。
 * 实测：这台机器上 node v25.1.0 调 fs.cpSync(src, dest, { recursive: true }) 会直接把进程打崩
 * （退出码 -1073740791 = STATUS_STACK_BUFFER_OVERRUN，连异常都来不及抛），
 * 而同样的目录用 readdir + copyFileSync 逐个拷就正常。
 * 崩在测试夹具里比崩在产品代码里更值得记一笔：它会让「测试跑不起来」看起来像「实现坏了」。
 */
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const name of fs.readdirSync(src)) {
    const from = path.join(src, name)
    const to = path.join(dest, name)
    if (fs.statSync(from).isDirectory()) copyDir(from, to)
    else fs.copyFileSync(from, to)
  }
}

function install(host, config = { language: 'zh', mode: 'deny', level: 'high' }) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'aiact-adapter-'))
  fs.mkdirSync(path.join(project, '.aiact'), { recursive: true })
  copyDir(CORE, path.join(project, '.aiact', 'core'))
  fs.writeFileSync(path.join(project, '.aiact', 'config.json'), JSON.stringify(config, null, 2))
  copyDir(path.join(ADAPTERS, host.dir, host.configDir), path.join(project, host.configDir))
  return project
}

function runHookScript(host, project, event) {
  const script = path.join(host.configDir, 'hooks', 'aiact-guard.mjs')
  const result = spawnSync(process.execPath, [script], {
    cwd: project,
    input: JSON.stringify(event),
    encoding: 'utf8',
  })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

const bashCall = (command) => ({ tool_name: 'Bash', tool_input: { command } })

test('every generated settings file is valid JSON and wires the expected hook', () => {
  for (const host of HOOKED) {
    const file = path.join(ADAPTERS, host.dir, host.configDir, 'settings.json')
    const settings = readJson(file)
    const entries = settings.hooks?.PreToolUse
    assert.ok(Array.isArray(entries) && entries.length === 1, `${host.dir} 必须在 PreToolUse 上挂一条钩子`)
    const entry = entries[0]
    assert.equal(typeof entry.matcher, 'string')
    assert.ok(entry.matcher.length > 0, `${host.dir} 的 matcher 不能是空的，空 matcher 等于对所有工具生效`)
    const command = entry.hooks?.[0]?.command
    assert.equal(entry.hooks[0].type, 'command')
    assert.equal(command, `node ${host.configDir}/hooks/aiact-guard.mjs`)
  }
})

test('the default settings file is a settings file, not a note', () => {
  // 这条是防回归：早先版本在 settings.json 前面加了两行 `//` 注释，
  // 而宿主用 JSON.parse 读它 —— 那两行会让整份配置 parse 失败。
  // 而宿主对坏配置的处理通常是「当作没配」，于是钩子静默失效、界面却看着正常。
  for (const host of HOOKED) {
    const file = path.join(ADAPTERS, host.dir, host.configDir, 'settings.json')
    const raw = fs.readFileSync(file, 'utf8')
    assert.ok(!raw.includes('//'), `${host.dir} 的 settings.json 里不许有注释`)
    assert.doesNotThrow(() => JSON.parse(raw), `${host.dir} 的 settings.json 必须能被 JSON.parse 读`)
  }
})

test('the host-agnostic core never mentions a host by name', () => {
  const banned = ['claude', 'codebuddy', 'workbuddy', 'qwen', 'codex']
  const files = fs.readdirSync(CORE).filter((name) => name.endsWith('.mjs'))
  assert.ok(files.length >= 4)
  for (const name of files) {
    const text = fs.readFileSync(path.join(CORE, name), 'utf8').toLowerCase()
    for (const word of banned) {
      assert.ok(!text.includes(word), `adapters/_core/${name} 里出现了宿主名「${word}」——判定器一旦认识宿主，就会退化成那个宿主的补丁`)
    }
  }
})

test('the generator is idempotent against what is on disk', async () => {
  const mod = await import('../tools/build-adapters.mjs')
  // 生成器只导出 main 之类的副作用函数，所以这里走 CLI 的 --check 路径，等价且更接近用户用法。
  const result = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'build-adapters.mjs'), '--check'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, `生成物与生成器不一致，先跑一次 tools/build-adapters.mjs：\n${result.stdout}${result.stderr}`)
  assert.match(result.stdout, /ADAPTER_OK/)
  assert.ok(mod)
})

test('claude-code hook denies rm -rf through the top-level envelope', () => {
  const host = HOOKED[0]
  const project = install(host)
  const out = runHookScript(host, project, bashCall('rm -rf build'))
  assert.equal(out.status, 0)
  const payload = JSON.parse(out.stdout)
  assert.equal(payload.permissionDecision, 'deny')
  assert.equal(payload.hookEventName, 'PreToolUse')
  assert.equal(payload.hookSpecificOutput, undefined, 'top 信封不能再包一层')
  assert.match(payload.permissionDecisionReason, /递归删除|删除/)
})

test('claude-code hook says nothing when the command is harmless', () => {
  const host = HOOKED[0]
  const project = install(host)
  const out = runHookScript(host, project, bashCall('npm test'))
  assert.equal(out.status, 0)
  assert.equal(out.stdout, '', '放行时不该输出任何东西——多说一句都会被宿主当成干预')
  assert.equal(out.stderr, '')
})

test('codebuddy hook wraps the same verdict in hookSpecificOutput', () => {
  const host = HOOKED[1]
  const project = install(host)
  const out = runHookScript(host, project, bashCall('rm -rf build'))
  assert.equal(out.status, 0)
  const payload = JSON.parse(out.stdout)
  assert.equal(payload.hookSpecificOutput?.hookEventName, 'PreToolUse')
  assert.equal(payload.hookSpecificOutput?.permissionDecision, 'deny')
  assert.equal(payload.permissionDecision, undefined, 'nested 信封的字段必须收在里面')
})

test('the plain envelope blocks with exit code 2 and a human reason on stderr', () => {
  const host = HOOKED[2]
  const project = install(host)
  const out = runHookScript(host, project, bashCall('rm -rf build'))
  assert.equal(out.status, 2)
  assert.equal(out.stdout, '')
  assert.match(out.stderr, /ai-action-translator|拦下/)
})

test('mode off means the hook does nothing at all', () => {
  const host = HOOKED[0]
  const project = install(host, { language: 'zh', mode: 'off', level: 'high' })
  const out = runHookScript(host, project, bashCall('rm -rf build'))
  assert.equal(out.status, 0)
  assert.equal(out.stdout, '')
  assert.equal(out.stderr, '')
})

test('a broken policy file fails open and says so on stderr', () => {
  const host = HOOKED[0]
  const project = install(host)
  // 把规则文件换成一坨非法 JSON：钩子必须放行，而不是让用户所有命令都卡住。
  fs.writeFileSync(path.join(project, '.aiact', 'core', 'policy.json'), '{ this is not json')
  const out = runHookScript(host, project, bashCall('rm -rf build'))
  assert.equal(out.status, 0)
  assert.equal(out.stdout, '')
  assert.match(out.stderr, /已放行/)
})

test('garbage on stdin fails open instead of throwing', () => {
  const host = HOOKED[0]
  const project = install(host)
  const script = path.join(host.configDir, 'hooks', 'aiact-guard.mjs')
  const result = spawnSync(process.execPath, [script], { cwd: project, input: 'not json at all', encoding: 'utf8' })
  assert.equal(result.status, 0)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /已放行/)
})

test('every rule in policy.json still comes from lib/guard.js', async () => {
  const policy = readJson(path.join(CORE, 'policy.json'))
  const { GUARD_RULES } = await import('../lib/guard.js')
  assert.equal(policy.rules.length, GUARD_RULES.length)
  const ids = policy.rules.map((rule) => rule.id).sort()
  assert.deepEqual(ids, GUARD_RULES.map((rule) => rule.id).sort())
  for (const rule of policy.rules) {
    assert.ok(Array.isArray(rule.patterns))
    for (const pattern of rule.patterns) {
      assert.equal(typeof pattern.source, 'string')
      assert.doesNotThrow(() => new RegExp(pattern.source, pattern.flags))
    }
  }
  const total = policy.rules.reduce((sum, rule) => sum + rule.patterns.length, 0)
  const expect = GUARD_RULES.reduce((sum, rule) => sum + rule.patterns.length, 0)
  assert.equal(total, expect)
})

/**
 * 这三份 settings.json 是生成的配置，必须进仓库。
 * 但仓库根 `.gitignore` 里有一条 `settings.json`（本意是挡掉 DSH 运行期状态），
 * 文件名模式会匹配任意层级 —— 0.8.0 收尾时实测三份全被它吞掉了。
 * 后果很隐蔽：clone 下来只有钩子脚本、没有配置，钩子永不触发，
 * 而 README 却写着「✅ 可阻断」。
 */
test('the generated settings.json files are not swallowed by .gitignore', () => {
  const ignoreText = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8')
  assert.match(ignoreText, /!adapters\/\*\*\/settings\.json/, '.gitignore 必须给 adapters 里的 settings.json 开例外')

  for (const host of HOOKED) {
    const rel = `adapters/${host.dir}/${host.configDir}/settings.json`
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `${rel} 应该存在`)
    const out = spawnSync('git', ['check-ignore', '-v', '--no-index', rel], { cwd: ROOT, encoding: 'utf8' })
    if (out.error) continue // 没有 git 的环境就只靠上面那条文本断言
    // `git check-ignore -v` 的第一列是命中的规则；以 `!` 开头表示被否定 → 不忽略。
    assert.match(out.stdout, /^\S*:!/, `${rel} 仍然被 .gitignore 忽略，clone 下来会缺配置文件`)
  }
})
