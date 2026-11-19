/**
 * 事前守门（lib/guard.js）的契约测试。
 *
 * 这块最该验的不是「正则写得全不全」，而是四条一旦破了就会伤人的性质：
 *   1. **默认不介入**：mode 为 off 时任何命令都放行 —— 插件装上去不该改变原有行为；
 *   2. **warn 只提醒不挡人**：`denyPayload` 必须返回 undefined，否则「提醒」变成「拦死」；
 *   3. **deny 真的挡得住**，而且只在「高风险规则」或「用户显式选了 medium」时挡；
 *   4. **静音规则默认静音**（覆盖写）：写文件是最高频动作，全都报会把真告警淹掉。
 *
 * 用真实模块，不打桩。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  GUARD_MODES,
  GUARD_LEVELS,
  GUARD_RULES,
  GUARD_RULE_BY_ID,
  GUARD_RULE_IDS,
  isHighRiskRule,
  evaluateGuard,
  denyPayload,
  guardSummary,
} from '../lib/guard.js'

const cmd = command => ({ command })

/* ───────────────────────── 常量与规则表 ───────────────────────── */

test('exposes the documented modes and levels', () => {
  assert.deepEqual(GUARD_MODES, ['off', 'warn', 'deny'])
  assert.deepEqual(GUARD_LEVELS, ['high', 'medium'])
})

test('rule ids are unique and every level is classified', () => {
  assert.equal(GUARD_RULES.length, 10, '规则数量变了就说明有增删，测试要跟着更新')
  assert.equal(new Set(GUARD_RULE_IDS).size, GUARD_RULE_IDS.length, '规则 id 不能重复')
  assert.equal(GUARD_RULE_BY_ID.size, GUARD_RULES.length, 'id 映射必须覆盖全部规则')
  for (const rule of GUARD_RULES) {
    assert.ok(['high', 'medium'].includes(rule.level), `${rule.id} 的 level 只能是 high/medium`)
    assert.ok(rule.label && rule.labelEn && rule.zh && rule.en, `${rule.id} 的四段文案缺一不可`)
    assert.equal(isHighRiskRule(rule.id), rule.level === 'high', `${rule.id} 的高风险判定要与 level 一致`)
  }
  assert.equal(isHighRiskRule('no-such-rule'), false, '未知规则不算高风险')
})

/* ───────────────────────── 默认不介入 ───────────────────────── */

test('mode off allows everything, including the worst command', () => {
  const verdict = evaluateGuard('pwsh', cmd('rm -rf /tmp/x'), { mode: 'off', level: 'high' })
  assert.equal(verdict.action, 'allow', 'off 就是 off——插件不该偷偷改变行为')
  assert.equal(verdict.rule, null)
  assert.equal(denyPayload(verdict), undefined)
})

test('read-only tools short-circuit even when their args look dangerous', () => {
  // read 的参数只是路径；不去跑正则既是省开销，也避免把「读了一个名字像命令的文件」误报成执行。
  const verdict = evaluateGuard('read', { path: 'rm -rf /' }, { mode: 'deny', level: 'high' })
  assert.equal(verdict.action, 'allow')
})

test('an empty tool name never throws', () => {
  const verdict = evaluateGuard('', {}, { mode: 'deny', level: 'high' })
  assert.equal(verdict.action, 'allow', '没有工具名时不该凭参数瞎猜')
})

/* ───────────────────────── 命中高风险 ───────────────────────── */

test('recognises a recursive delete and says what it means', () => {
  const verdict = evaluateGuard('pwsh', cmd('rm -rf build'), { mode: 'warn', level: 'high' })
  assert.equal(verdict.action, 'warn')
  assert.equal(verdict.rule.id, 'delete-recursive')
  assert.equal(verdict.risk.id, 'high')
  assert.ok(verdict.reason.includes('回收站'), '解释要说清「这是什么后果」，而不是只报一个名字')
  assert.equal(verdict.reasonEn, verdict.rule.en)
})

test('later spellings of the same intent hit the same rule', () => {
  for (const command of [
    'Remove-Item -LiteralPath C:\\tmp -Recurse',
    'Remove-Item -Force *',
    'rd /s /q build',
    'rmdir /s build',
  ]) {
    const verdict = evaluateGuard('pwsh', cmd(command), { mode: 'warn', level: 'high' })
    assert.equal(verdict.rule?.id, 'delete-recursive', `应命中递归删除：${command}`)
  }
})

test('recognises machine-level and credential-level actions', () => {
  assert.equal(evaluateGuard('pwsh', cmd('shutdown /s /t 0')).rule?.id, 'system-power')
  assert.equal(evaluateGuard('pwsh', cmd('Set-ExecutionPolicy Bypass')).rule?.id, 'permission-change')
  assert.equal(evaluateGuard('read', { path: 'C:\\Users\\lin\\.ssh\\id_rsa' }).rule?.id, 'credential-read')
  assert.equal(evaluateGuard('pwsh', cmd('git push --force origin main')).rule?.id, 'git-destructive')
})

test('system-path writing only applies to writing tools', () => {
  const write = evaluateGuard('write', { file_path: 'C:\\Windows\\System32\\drivers\\etc\\hosts' })
  assert.equal(write.rule?.id, 'write-system-path', 'write 类工具写系统目录要认出来')
  const shell = evaluateGuard('pwsh', cmd('Get-Content C:\\Windows\\win.ini'))
  assert.notEqual(shell.rule?.id, 'write-system-path', '读取不是写入，不该按「写系统目录」算')
})

test('matched args can be a JSON string too', () => {
  const verdict = evaluateGuard('pwsh', '{"command":"npm install left-pad"}')
  assert.equal(verdict.rule?.id, 'dependency-install', '参数是字符串时也要能匹配')
})

/* ───────────────────────── warn 与 deny 的分界 ───────────────────────── */

test('warn never blocks, even for a high-risk match', () => {
  const verdict = evaluateGuard('pwsh', cmd('shutdown /s'), { mode: 'warn', level: 'medium' })
  assert.equal(verdict.action, 'warn')
  assert.equal(denyPayload(verdict), undefined, 'warn 必须给 undefined，否则等于偷偷 deny')
})

test('deny blocks high-risk matches regardless of the selected level', () => {
  for (const level of ['high', 'medium']) {
    const verdict = evaluateGuard('pwsh', cmd('shutdown /s'), { mode: 'deny', level })
    assert.equal(verdict.action, 'deny', `level=${level} 时高风险规则都应该挡`)
    const payload = denyPayload(verdict)
    assert.equal(payload.kind, 'deny')
    assert.ok(payload.reason.includes('关机'), '拦下的理由要让用户看懂是哪一类动作')
    assert.ok(payload.reason.includes('临时放行'), '必须告诉用户怎么继续，不能只说「不行」')
  }
})

test('medium rules only deny when the user asked for medium scope', () => {
  const high = evaluateGuard('pwsh', cmd('npm install left-pad'), { mode: 'deny', level: 'high' })
  assert.equal(high.action, 'warn', '「只管高风险」时，装依赖不该真的挡人')
  assert.equal(denyPayload(high), undefined)

  const medium = evaluateGuard('pwsh', cmd('npm install left-pad'), { mode: 'deny', level: 'medium' })
  assert.equal(medium.action, 'deny', '选了「+ 中等」就要连装依赖一起挡')
})

/* ───────────────────────── 放行通道 ───────────────────────── */

test('a rule id on the allow list is skipped', () => {
  const verdict = evaluateGuard('pwsh', cmd('rm -rf build'), { mode: 'deny', level: 'high', allowRules: ['delete-recursive'] })
  assert.equal(verdict.action, 'allow', '用户点名放行的规则要真的放行')
})

test('a per-session allow set behaves like the allow list', () => {
  const verdict = evaluateGuard('pwsh', cmd('rm -rf build'), {
    mode: 'deny',
    level: 'high',
    sessionAllow: new Set(['delete-recursive']),
  })
  assert.equal(verdict.action, 'allow')
})

test('tool allow list is case-insensitive', () => {
  const verdict = evaluateGuard('Bash', cmd('rm -rf build'), {
    mode: 'deny',
    level: 'high',
    allowTools: ['bash'],
  })
  assert.equal(verdict.action, 'allow', '工具名大小写不同也该认出来')
})

test('an unrelated allow list does not swallow the match', () => {
  const verdict = evaluateGuard('pwsh', cmd('rm -rf build'), { mode: 'deny', level: 'high', allowRules: ['dependency-install'] })
  assert.equal(verdict.action, 'deny', '放行了别的规则，不等于放行这一条')
})

/* ───────────────────────── 静音规则（覆盖写） ───────────────────────── */

test('the quiet overwrite rule stays silent by default', () => {
  // 这条是设计承诺：写文件最高频，默认一条都不报；否则面板会被「可能覆盖」淹没。
  // 之前 evaluateGuard 漏读 includeQuiet，导致这条承诺失效——这条断言就是它的守卫。
  const verdict = evaluateGuard('write', { file_path: 'D:\\work\\a.txt', content: 'x' }, { mode: 'warn', level: 'medium' })
  assert.equal(verdict.action, 'allow', '覆盖写默认必须静音')
  assert.equal(verdict.rule, null)
})

test('the quiet rule reports once the user opts in', () => {
  const verdict = evaluateGuard('write', { file_path: 'D:\\work\\a.txt', content: 'x' }, {
    mode: 'warn',
    level: 'medium',
    includeQuiet: true,
  })
  assert.equal(verdict.action, 'warn')
  assert.equal(verdict.rule.id, 'in-place-overwrite')
})

test('quiet rules are still skippable by the allow list', () => {
  const verdict = evaluateGuard('write', { file_path: 'D:\\work\\a.txt' }, {
    mode: 'deny',
    level: 'medium',
    includeQuiet: true,
    allowRules: ['in-place-overwrite'],
  })
  assert.equal(verdict.action, 'allow')
})

/* ───────────────────────── 摘要 ───────────────────────── */

test('guardSummary describes the outcome without inventing one', () => {
  assert.equal(guardSummary(null), '')
  assert.equal(guardSummary({ action: 'allow', rule: null }), '', '没命中就没有摘要，不编一句「已检查」')
  const warn = evaluateGuard('pwsh', cmd('npm install left-pad'))
  assert.equal(guardSummary(warn), '注意到「安装 / 升级依赖」')
  const deny = evaluateGuard('pwsh', cmd('shutdown /s'), { mode: 'deny', level: 'high' })
  assert.equal(guardSummary(deny), '已拦下「关机 / 重启 / 磁盘级操作」')
})
