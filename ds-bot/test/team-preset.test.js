import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply } from '../index.js'
import { A2API_MODELS_URL, probeA2api } from '../src/host/a2api.js'
import { CHIEF, INVEST, MEMORY_SCAFFOLDS, ROLES, WEEKDAY_INVEST_BRIEF, WORK } from '../src/host/steward-preset.js'
import { fakeContext } from './fake-ctx.js'

test('the steward preset names Chief, Work and Invest and one weekday brief', () => {
  assert.deepEqual(ROLES.map(role => role.name), ['Chief', 'Work', 'Invest'])
  assert.equal(CHIEF.role, '团队总管')
  assert.equal(WORK.role, '工作')
  assert.equal(INVEST.role, '投资')
  for (const role of ROLES) {
    assert.match(role.instructions, /\p{Script=Han}/u)
    assert.equal(role.instructions.includes('sk-'), false)
    assert.equal(role.role.length <= 24, true)
  }
  assert.deepEqual(MEMORY_SCAFFOLDS.map(item => `${item.scope}:${item.topic}`), [
    'team:preferences', 'team:projects', 'team:people', 'invest:investing-rules',
  ])
  assert.deepEqual(WEEKDAY_INVEST_BRIEF.when, {
    kind: 'weekly', time: '08:30', timeZone: 'Asia/Shanghai', weekdays: [1, 2, 3, 4, 5],
  })
  assert.equal(WEEKDAY_INVEST_BRIEF.bot, 'Invest')
})

test('the Agent2API check reads the local model list and drops everything else', async () => {
  const seen = []
  const fetchImpl = async (url, init) => {
    seen.push({ url, authorization: init.headers?.authorization, redirect: init.redirect })
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: [{ id: 'deepseek-v4' }, { id: 'bad id' }], key: 'secret-value' }),
    }
  }
  const result = await probeA2api({ fetchImpl })
  assert.deepEqual(result, { ok: true, url: A2API_MODELS_URL, status: 200, models: ['deepseek-v4'] })
  assert.equal(seen[0].url, A2API_MODELS_URL)
  assert.equal(seen[0].authorization, undefined)
  assert.equal(seen[0].redirect, 'manual')
  assert.equal(JSON.stringify(result).includes('secret'), false)

  const refused = await probeA2api({ fetchImpl: async () => ({ ok: false, status: 401, text: async () => '{"error":"nope","token":"abc"}' }) })
  assert.equal(refused.ok, false)
  assert.equal(refused.error, 'http 401')
  assert.equal(JSON.stringify(refused).includes('abc'), false)

  const redirect = await probeA2api({ fetchImpl: async () => ({ ok: false, status: 302, text: async () => '' }) })
  assert.equal(redirect.error, 'redirect')

  const down = await probeA2api({ fetchImpl: async () => { throw new Error('connect ECONNREFUSED') } })
  assert.equal(down.error, 'unreachable')
})

function scheduleService() {
  const tasks = new Map()
  let next = 1
  return {
    tasks,
    async create(sessionId, request) {
      const id = `schedule-${next++}`
      const kind = Object.keys(request).find(key => !['title', 'prompt'].includes(key))
      const record = { id, kind, title: request.title, prompt: request.prompt, timing: request[kind], scheduledAt: '2030-01-01T00:30:00.000Z' }
      tasks.set(id, { sessionId, record })
      return record
    },
    async catalog() {
      return [...tasks.values()].map(task => ({ ...task.record, sessionId: task.sessionId, status: 'active' }))
    },
    async delete() { return { deleted: true } },
  }
}

function start({ team, schedule } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-steward-'))
  if (team !== undefined) writeFileSync(join(home, 'state.json'), JSON.stringify(team))
  const ctx = fakeContext({ services: schedule ? { schedule } : {} })
  const workspaces = new Map()
  let sessions = 0
  Object.assign(ctx, {
    llm: { listProviders: () => [] },
    workspaceRegistry: {
      get: id => workspaces.get(id),
      resolveByPath: async () => undefined,
      create: async (path) => {
        const workspace = { id: `w${workspaces.size + 1}`, path }
        workspaces.set(workspace.id, workspace)
        return workspace
      },
      archiveSession: async () => {},
    },
    sessionController: {
      create: async () => ({ sessionId: `s${++sessions}` }),
      resolveAgent: async sessionId => ({ agent: { session: { id: sessionId }, followup() {} } }),
    },
    sessionTitle: { rename: async () => {} },
    sessions: { flush: async () => {} },
  })
  let route
  const register = ctx.connection.fetch.register
  ctx.connection.fetch.register = (options) => {
    route = options
    return register(options)
  }
  apply(ctx, { home })
  const call = async (endpoint, payload) => {
    const response = await route.fetch(new Request('http://localhost/api/bot', { method: 'POST', body: JSON.stringify({ endpoint, payload }) }))
    return response.json()
  }
  const stop = async () => {
    await ctx.dispose()
    rmSync(home, { recursive: true, force: true, maxRetries: 5 })
  }
  return { call, stop, home, ctx, schedule }
}

const saved = (bots, mainBotIds) => ({
  version: 1, mainBotIds, revision: 1, bots, rooms: {}, exchanges: [], exchangeTurns: {}, questions: {}, prefs: {},
})

test('applying the preset creates Work and Invest, topics and the weekday brief once', async (t) => {
  const schedule = scheduleService()
  const { call, stop, home } = start({ schedule })
  t.after(stop)
  const first = (await call('steward-apply', {})).value
  assert.equal(first.roles.find(role => role.key === 'chief').action, 'kept')
  assert.deepEqual(first.roles.filter(role => role.key !== 'chief').map(role => role.action), ['created', 'created'])
  assert.deepEqual(first.memory.map(item => item.action), ['created', 'created', 'created', 'created'])
  assert.equal(first.schedule.action, 'created')

  const state = JSON.parse(readFileSync(join(home, 'state.json'), 'utf8'))
  const bots = Object.values(state.bots)
  assert.deepEqual(bots.map(bot => bot.name).sort(), ['Chief', 'Invest', 'Work'])
  const chief = bots.find(bot => bot.name === 'Chief')
  assert.equal(chief.role, '团队总管')
  assert.match(chief.instructions, /apply_steward_team/)
  assert.match(bots.find(bot => bot.name === 'Work').instructions, /projects/)
  assert.match(bots.find(bot => bot.name === 'Invest').instructions, /investing-rules/)

  const index = readFileSync(join(home, 'memory', 'team', 'MEMORY.md'), 'utf8')
  assert.match(index, /\[\[preferences\]\]/)
  assert.match(index, /\[\[projects\]\]/)
  assert.match(index, /\[\[people\]\]/)
  const preferences = readFileSync(join(home, 'memory', 'team', 'preferences.md'), 'utf8')
  assert.match(preferences, /一条一事/)
  assert.equal(/^\s*[-*]\s+/m.test(preferences), false)
  const invest = bots.find(bot => bot.name === 'Invest')
  assert.match(readFileSync(join(home, 'memory', 'bots', invest.id, 'investing-rules.md'), 'utf8'), /不写账户或密码/)

  const [task] = [...schedule.tasks.values()]
  assert.equal(task.sessionId, invest.id)
  assert.equal(task.record.title, '工作日投资简报')
  assert.deepEqual(task.record.timing, { time: '08:30:00', time_zone: 'Asia/Shanghai', weekdays: [1, 2, 3, 4, 5] })

  const again = (await call('steward-apply', {})).value
  assert.deepEqual(again.roles.map(role => role.action), ['kept', 'kept', 'kept'])
  assert.deepEqual(again.memory.map(item => item.action), ['kept', 'kept', 'kept', 'kept'])
  assert.equal(again.schedule.action, 'kept')
  assert.equal(schedule.tasks.size, 1)
  assert.equal(Object.keys(JSON.parse(readFileSync(join(home, 'state.json'), 'utf8')).bots).length, 3)
})

test('an existing Chief keeps its own instructions, and a member cannot apply the preset', async (t) => {
  const team = saved({
    m1: { id: 'm1', sessionId: 'm1', name: 'Chief', role: '老板', instructions: '不要改我', createdAt: 1 },
    w0: { id: 'w0', sessionId: 'w0', name: 'Writer', role: '写手', instructions: '只写作', createdAt: 2 },
  }, ['m1'])
  const { call, stop, home, ctx } = start({ team })
  t.after(stop)
  const refused = await ctx.registeredTools.get('apply_steward_team').execute({}, { agent: { id: 'w0' } })
  assert.match(refused, /Only a Main Bot/)
  assert.equal(JSON.parse(readFileSync(join(home, 'state.json'), 'utf8')).bots.w0.name, 'Writer')

  const report = (await call('steward-apply', {})).value
  assert.equal(report.roles.find(role => role.key === 'chief').action, 'kept')
  assert.equal(report.schedule.action, 'skipped')
  const state = JSON.parse(readFileSync(join(home, 'state.json'), 'utf8'))
  assert.equal(state.bots.m1.instructions, '不要改我')
  assert.equal(state.bots.m1.role, '老板')
  assert.equal(Object.values(state.bots).some(bot => bot.name === 'Work'), true)
  assert.equal(Object.values(state.bots).some(bot => bot.name === 'Writer'), true)
})

test('a blank Chief of Staff receives the Chinese prompt', async (t) => {
  const team = saved({
    m1: { id: 'm1', sessionId: 'm1', name: 'Chief', role: 'Chief of Staff', instructions: '', createdAt: 1 },
  }, ['m1'])
  const { call, stop, home } = start({ team })
  t.after(stop)
  const report = (await call('steward-apply', {})).value
  assert.equal(report.roles.find(role => role.key === 'chief').action, 'filled')
  const chief = JSON.parse(readFileSync(join(home, 'state.json'), 'utf8')).bots.m1
  assert.equal(chief.role, '团队总管')
  assert.match(chief.instructions, /不亲自做深工作/)
})

test('the health endpoint reports the fixed local address', async (t) => {
  const { call, stop } = start({ team: saved({
    m1: { id: 'm1', sessionId: 'm1', name: 'Chief', role: '老板', instructions: '不要改我', createdAt: 1 },
  }, ['m1']) })
  t.after(stop)
  const health = (await call('a2api-health', {})).value
  assert.equal(health.url, A2API_MODELS_URL)
  assert.equal(Array.isArray(health.models), true)
  assert.equal(Object.hasOwn(health, 'body'), false)
  assert.equal(JSON.stringify(health).includes('authorization'), false)
})
