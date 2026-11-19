/**
 * 多 Agent 名册（lib/agents.js）的契约测试。
 *
 * 这块的核心不是「能不能记」，而是两条诚实性：
 *   1. 取不到身份就返回 undefined —— 绝不编一个「主 agent」的名字，
 *      因为面板上看错归属比看不出归属更糟。
 *   2. 只记身份与时间，不记 prompt / 输出 / 文件内容（由字段白名单保证）。
 *
 * 用真实模块，不打桩。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { AGENT_LIMIT, AgentRoster, agentOf, agentOfExec } from '../lib/agents.js'

const fakeAgent = (id, cwd) => ({
  id,
  session: cwd === undefined ? {} : { header: { cwd } },
})

/* ───────────────────────── 身份归一化 ───────────────────────── */

test('agentOf reads the direct id and folds the cwd into a short label', () => {
  const who = agentOf(fakeAgent('abcdef1234567890', 'C:\\projects\\demo'))
  assert.ok(who)
  assert.equal(who.id, 'abcdef1234567890')
  assert.equal(who.short, 'abcdef12', '短 id 取前 8 位')
  assert.equal(who.folder, 'demo')
  assert.equal(who.label, 'demo·abcdef12')
})

test('agentOf falls back to the session header id when the agent has none', () => {
  const who = agentOf({ session: { header: { id: 'from-header-id', cwd: 'D:\\work\\proj' } } })
  assert.ok(who)
  assert.equal(who.id, 'from-header-id')
  assert.equal(who.folder, 'proj')
})

test('agentOf returns undefined rather than inventing an identity', () => {
  for (const value of [undefined, null, {}, { id: '' }, { session: {} }, 'not-an-object']) {
    assert.equal(agentOf(value), undefined, `${JSON.stringify(value)} 不该被编出一个 id`)
  }
})

test('agentOf without cwd still yields a usable label', () => {
  const who = agentOf({ id: 'plain-id' })
  assert.ok(who)
  assert.equal(who.cwd, undefined)
  assert.equal(who.folder, '')
  assert.equal(who.label, 'plain-id')
})

test('agentOfExec treats a missing agent as a system-level call', () => {
  assert.equal(agentOfExec({ name: 'read' }), undefined)
  assert.equal(agentOfExec(undefined), undefined)
  assert.equal(agentOfExec({ agent: fakeAgent('with-agent') })?.id, 'with-agent')
})

test('the roster entry carries identity and timing only', () => {
  const who = agentOf(fakeAgent('agent-1', 'C:\\proj'))
  const keys = Object.keys(who).sort()
  assert.deepEqual(keys, ['cwd', 'folder', 'id', 'label', 'short'], '白名单之外不允许带别的字段进来')
})

/* ───────────────────────── 来去与计数 ───────────────────────── */

test('born / gone / touch track lifecycle and action counts', () => {
  const roster = new AgentRoster()
  const agent = fakeAgent('agent-1', 'C:\\proj')

  roster.born(agent, 1000)
  roster.touch(agent, 1100)
  roster.touch(agent, 1200)
  roster.gone(agent, 1300)

  const [entry] = roster.list()
  assert.equal(entry.id, 'agent-1')
  assert.equal(entry.bornAt, 1000)
  assert.equal(entry.goneAt, 1300)
  assert.equal(entry.actions, 2)

  const summary = roster.summary()
  assert.equal(summary.total, 1)
  assert.equal(summary.live, 0, '已经 disposed 的就不再算活着')
  assert.equal(summary.actions, 2)
})

test('duplicate created events do not create duplicate rows', () => {
  const roster = new AgentRoster()
  const agent = fakeAgent('agent-1', 'C:\\proj')
  roster.born(agent, 1000)
  roster.born(agent, 2000)
  assert.equal(roster.size, 1)
  assert.equal(roster.list()[0].bornAt, 1000, '第一次到来的时间不该被覆盖')
})

test('an agent seen for the first time at disposal still gets a row', () => {
  const roster = new AgentRoster()
  roster.gone(fakeAgent('late-agent'), 5000)
  assert.equal(roster.size, 1, '来过又走了不能查无此人')
  const [entry] = roster.list()
  assert.equal(entry.bornAt, undefined, '没看到它出生就不要编一个出生时间')
  assert.equal(entry.goneAt, 5000)
})

test('touch creates a row for agents that never fired created', () => {
  const roster = new AgentRoster()
  roster.touch(fakeAgent('quiet-agent'))
  assert.equal(roster.size, 1)
  assert.equal(roster.list()[0].actions, 1)
  assert.equal(roster.summary().live, 1)
})

test('ignored events do not pollute the roster', () => {
  const roster = new AgentRoster()
  roster.born(undefined)
  roster.gone(null)
  roster.touch({})
  assert.equal(roster.size, 0)
})

test('the roster is bounded and drops the oldest first', () => {
  const roster = new AgentRoster(3)
  for (let i = 0; i < 6; i += 1) roster.touch(fakeAgent(`agent-${i}`))
  assert.equal(roster.size, 3)
  const ids = roster.list().map((entry) => entry.id)
  assert.deepEqual(ids, ['agent-3', 'agent-4', 'agent-5'], '超上限应丢最早见过的')
})

test('list returns copies, so callers cannot mutate the roster by accident', () => {
  const roster = new AgentRoster()
  roster.touch(fakeAgent('agent-1'))
  const first = roster.list()
  first[0].actions = 999
  assert.equal(roster.list()[0].actions, 1)
})

test('clear empties the roster and the default limit is the documented one', () => {
  const roster = new AgentRoster()
  assert.equal(roster.limit, AGENT_LIMIT)
  roster.touch(fakeAgent('agent-1'))
  roster.clear()
  assert.equal(roster.size, 0)
  assert.deepEqual(roster.summary(), { total: 0, live: 0, actions: 0 })
})
