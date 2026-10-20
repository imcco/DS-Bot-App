// The steward preset, applied once the user asks. Bootstrap still makes only Chief.
// A second apply fills blank instructions and missing topics, and leaves the rest.
import { defineTool } from '@deepseek-ai/dsh-tools'
import { probeA2api } from './a2api.js'
import { output } from './tools.js'
import { CHIEF, INVEST, MEMORY_SCAFFOLDS, ROLES, STEWARD_ID, WEEKDAY_INVEST_BRIEF } from './steward-preset.js'

const BRIEF = '用户启用了管家团队。用中文做一次简短自我介绍，并问要从哪一件事开始。'

export function install(rt) {
  const { ctx, state } = rt

  const chiefBot = () => rt.findBot(CHIEF.name) ?? state.mainBotIds.map(id => rt.botOf(id)).find(Boolean)

  async function place(preset) {
    const existing = rt.findBot(preset.name)
    if (existing === undefined) {
      if (preset.main) return { key: preset.key, name: preset.name, action: 'missing' }
      const chief = chiefBot()
      let model
      if (chief?.model) {
        try { model = await rt.resolveModel(chief.model) } catch { model = undefined }
      }
      const bot = await rt.createBot({
        name: preset.name,
        role: preset.role,
        instructions: preset.instructions,
        color: preset.color,
        brief: BRIEF,
        createdBy: chief?.id,
        ...(model ? { model } : { pickModel: true }),
      })
      return { key: preset.key, name: preset.name, id: bot.id, action: 'created' }
    }
    const patch = {}
    if (String(existing.instructions ?? '').trim() === '') patch.instructions = preset.instructions
    const role = String(existing.role ?? '').trim()
    if (role === '' || (preset.key === 'chief' && role === 'Chief of Staff')) patch.role = preset.role
    if (Object.keys(patch).length === 0) return { key: preset.key, name: preset.name, id: existing.id, action: 'kept' }
    await rt.updateBot(existing.id, patch)
    return { key: preset.key, name: preset.name, id: existing.id, action: 'filled' }
  }

  function stewardView() {
    return {
      id: STEWARD_ID,
      roles: ROLES.map(preset => ({ key: preset.key, name: preset.name, role: preset.role, present: rt.findBot(preset.name) !== undefined })),
      topics: MEMORY_SCAFFOLDS.map(item => ({ scope: item.scope, topic: item.topic })),
      schedule: { id: WEEKDAY_INVEST_BRIEF.id, bot: WEEKDAY_INVEST_BRIEF.bot, title: WEEKDAY_INVEST_BRIEF.title, when: WEEKDAY_INVEST_BRIEF.when },
    }
  }

  async function seedMemory(roles) {
    if (rt.memoryEnabled === false || typeof rt.ensureMemoryTopic !== 'function') {
      return MEMORY_SCAFFOLDS.map(item => ({ scope: item.scope, topic: item.topic, action: 'skipped', reason: 'Memory is turned off' }))
    }
    const seeded = []
    for (const item of MEMORY_SCAFFOLDS) {
      if (item.scope === 'team') {
        const result = await rt.ensureMemoryTopic({ scope: { kind: 'team' }, topic: item.topic, note: item.note, label: 'the team memory' })
        seeded.push({ scope: 'team', topic: item.topic, action: result.changed ? 'created' : 'kept' })
        continue
      }
      const bot = roles.find(role => role.key === item.scope)
      if (bot?.id === undefined) {
        seeded.push({ scope: item.scope, topic: item.topic, action: 'skipped', reason: `${INVEST.name} is not on the team` })
        continue
      }
      const result = await rt.ensureMemoryTopic({ scope: { kind: 'bot', botId: bot.id }, topic: item.topic, note: item.note, label: `${bot.name}'s memory` })
      seeded.push({ scope: item.scope, topic: item.topic, action: result.changed ? 'created' : 'kept' })
    }
    for (const role of roles) {
      if (role.id === undefined) continue
      rt.renewMemory(role.id)
      rt.renewMemory(rt.chatOf(role.id))
    }
    return seeded
  }

  async function seedSchedule(roles) {
    const invest = roles.find(role => role.key === INVEST.key)
    const skipped = (reason) => ({ id: WEEKDAY_INVEST_BRIEF.id, title: WEEKDAY_INVEST_BRIEF.title, action: 'skipped', reason })
    if (invest?.id === undefined) return skipped(`${INVEST.name} is not on the team`)
    try {
      const view = await rt.scheduleEndpoint('schedules', {})
      if (view.available === false) return skipped('Automation tasks are off in DSH')
      const same = (view.tasks ?? []).some(task => task.botId === invest.id && task.title === WEEKDAY_INVEST_BRIEF.title)
      if (same) return { id: WEEKDAY_INVEST_BRIEF.id, title: WEEKDAY_INVEST_BRIEF.title, action: 'kept' }
      await rt.scheduleEndpoint('schedule-create', {
        target: invest.id,
        title: WEEKDAY_INVEST_BRIEF.title,
        prompt: WEEKDAY_INVEST_BRIEF.prompt,
        when: WEEKDAY_INVEST_BRIEF.when,
      })
      return { id: WEEKDAY_INVEST_BRIEF.id, title: WEEKDAY_INVEST_BRIEF.title, action: 'created' }
    } catch (error) {
      return skipped(error?.message ?? 'The schedule was not created')
    }
  }

  async function stewardApply() {
    await rt.bootstrap()
    const roles = []
    for (const preset of ROLES) roles.push(await place(preset))
    const memory = await seedMemory(roles)
    const schedule = await seedSchedule(roles)
    return { id: STEWARD_ID, roles, memory, schedule }
  }

  const summary = (report) => [
    'Steward team:',
    ...report.roles.map(role => `- ${role.name}: ${role.action}`),
    ...report.memory.map(item => `- memory ${item.scope}/${item.topic}: ${item.action}`),
    `- schedule ${report.schedule.title}: ${report.schedule.action}${report.schedule.reason ? ` (${report.schedule.reason})` : ''}`,
  ].join('\n')

  ctx.tools.register(defineTool({
    name: 'apply_steward_team',
    description: 'Main Bot only. Set up the steward team: Chief, Work and Invest, the memory topics preferences, projects, people and investing-rules, and the weekday invest brief. Safe to call again. Instructions that are already written stay as they are.',
    parameters: {},
    output,
    async execute(_args, exec) {
      await rt.load()
      if (!rt.isMain(rt.selfOf(exec.agent?.id))) return 'Only a Main Bot can set up the steward team.'
      try {
        return summary(await stewardApply())
      } catch (error) {
        return `Could not set up the steward team: ${error.message}`
      }
    },
  }))

  Object.assign(rt, { stewardView, stewardApply, a2apiHealth: () => probeA2api() })
}
