import type { CommandInfo } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { AFFIRMATIONS } from '../hooks/affirmations'
import { fieldColumns, submitLabelFor } from '../hooks/fit'

const PANE = {
  plugin: 'side-prompt',
  component: 'Pane',
  requestId: 'side-prompt',
  surface: 'terminal',
  props: {
    title: 'Side prompt',
    isFocused: true,
    bodyColumns: 52,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

// `/side` as the person types it at the composer, in a wide fullscreen terminal.
const RUN_SIDE = {
  command: 'side',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 120 },
} as const

// The test runner has timers; the mod API's types do not declare them.
declare const setTimeout: (run: () => void, ms: number) => unknown

const FORK_ANSWER = {
  value: {
    isAnswered: true,
    text: 'four',
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  },
} as const

const until = async (check: () => boolean | Promise<boolean>) => {
  for (let tries = 0; tries < 200; tries += 1) {
    if (await check()) {
      return
    }
    await new Promise(resolve => setTimeout(() => resolve(undefined), 5))
  }
  throw new Error('the pane never reached the state the test waits for')
}

test('the prompt field sends its text as the person\'s own prompt', async ($, on) => {
  const sent: string[] = []
  on('prompt.submit', (_, e) => {
    sent.push(e.text)

    return { text: e.text }
  })

  const ui = await $.ui.mount(PANE)
  await ui.input({ key: 'prompt', text: 'look at the diff', kind: 'change' })
  await ui.input({ key: 'prompt', text: 'look at the diff', kind: 'submit' })

  expect(sent).toEqual(['look at the diff'])
  // Once sent, no "queued" or "sent" note is left on screen.
  expect(await ui.find({ type: 'Text', text: /Prompt (queued|sent)/ })).toBeUndefined()
  await ui.unmount()
})

test('the btw field asks a fork, shows the answer boxed, and toasts', async ($, on) => {
  const asked: string[] = []
  const toasts: string[] = []
  on('clock.now', () => ({ value: 1000 }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('model.fork', (_, e) => {
    asked.push(e.prompt)

    return FORK_ANSWER
  })

  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-btw' })
  expect(await ui.find({ type: 'Text', text: /^ btw $/ })).toBeUndefined()
  await ui.input({ key: 'btw', text: 'what is 2+2', kind: 'change' })
  await ui.input({ key: 'btw', text: 'what is 2+2', kind: 'submit' })

  expect(asked).toEqual(['what is 2+2'])
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe('four')
  // The answer box carries its name on its top border.
  expect(await ui.find({ type: 'Text', text: /^ btw $/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Answered|Asking/ })).toBeUndefined()
  expect(toasts).toEqual(['btw answered (0.0s)'])
  await ui.unmount()
})

test('a fork with no answer says why in the pane and in a toast', async ($, on) => {
  const toasts: string[] = []
  on('clock.now', () => ({ value: 1000 }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('model.fork', () => ({ value: { isAnswered: false, reason: 'nothing-to-fork' } }))

  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-btw' })
  await ui.input({ key: 'btw', text: 'anything', kind: 'submit' })

  expect(await ui.find({ type: 'Text', text: /Nothing to ask about yet/ })).toBeDefined()
  expect(toasts).toHaveLength(1)
  await ui.unmount()
})

test('the btw field asks while a sent prompt is still waiting', async ($, on) => {
  let isPromptPending = false
  let release = () => {}
  on('clock.now', () => ({ value: 1000 }))
  on('ui.toast', () => ({ value: undefined }))
  on(
    'prompt.submit',
    (_, e) =>
      new Promise(resolve => {
        isPromptPending = true
        release = () => {
          isPromptPending = false
          resolve({ text: e.text })
        }
      }),
  )
  let wasPromptPending = false
  on('model.fork', () => {
    wasPromptPending = isPromptPending
    release()

    return FORK_ANSWER
  })

  const ui = await $.ui.mount(PANE)
  // The prompt never settles until the fork has been asked, so awaiting it
  // here would wait forever: start it, and wait until it is pending.
  const sent = ui.input({ key: 'prompt', text: 'long task', kind: 'submit' })
  await until(() => isPromptPending)
  await ui.press({ key: 'tab-btw' })
  await ui.input({ key: 'btw', text: 'what is 2+2', kind: 'submit' })
  await sent

  expect(wasPromptPending).toBe(true)
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe('four')
  await ui.unmount()
})

test('while the fork is slow the pane says so, then shows the answer', async ($, on) => {
  let isForkPending = false
  let release = () => {}
  on('clock.now', () => ({ value: 1000 }))
  on('ui.toast', () => ({ value: undefined }))
  on(
    'model.fork',
    () =>
      new Promise(resolve => {
        isForkPending = true
        release = () => resolve(FORK_ANSWER)
      }),
  )

  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-btw' })
  const asking = ui.input({ key: 'btw', text: 'what is 2+2', kind: 'submit' })
  await until(async () => isForkPending && (await ui.find({ type: 'Text', text: /Asking/ })) !== undefined)
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()

  release()
  await asking

  expect((await ui.find({ type: 'Markdown' }))?.text).toBe('four')
  await ui.unmount()
})

test('the tabs show one field at a time', async ($) => {
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ key: 'prompt' })).toBeDefined()
  expect(await ui.find({ key: 'btw' })).toBeUndefined()

  await ui.press({ key: 'tab-btw' })
  expect(await ui.find({ key: 'btw' })).toBeDefined()
  expect(await ui.find({ key: 'prompt' })).toBeUndefined()

  await ui.press({ key: 'tab-prompt' })
  expect(await ui.find({ key: 'prompt' })).toBeDefined()
  await ui.unmount()
})

test('a note an earlier version saved is declined, not left on screen', async ($, on) => {
  // What the code before this edit wrote stays through the reload.
  on('state.get', (_, e) =>
    e.plugin === 'side-prompt' && e.key === 'note'
      ? { value: { value: 'Answered in 14.1s (Claude working when asked: yes).', version: 1 } }
      : { value: { value: undefined, version: 0 } },
  )

  const ui = await $.ui.mount(PANE)

  expect(await ui.find({ type: 'Text', text: /Answered in/ })).toBeUndefined()
  await ui.unmount()
})

test('an empty field sends nothing', async ($, on) => {
  const sent: string[] = []
  on('prompt.submit', (_, e) => {
    sent.push(e.text)

    return { text: e.text }
  })

  const ui = await $.ui.mount(PANE)
  await ui.input({ key: 'prompt', text: '   ', kind: 'submit' })

  expect(sent).toEqual([])
  await ui.unmount()
})

test('the pane says Claude is working between turn start and turn end', async ($, on) => {
  on('turn.start', () => ({ turnId: 't1' }))
  on('turn.complete', () => ({ text: '' }))

  await $.turn.start({ text: 'go', turnId: 't1' })
  let ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /Claude is working/ })).toBeDefined()
  await ui.unmount()

  await $.turn.complete({
    turnId: 't1',
    reason: 'answer',
    answer: '',
    durationMs: 1000,
    isAborted: false,
  })
  ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /Claude is working/ })).toBeUndefined()
  await ui.unmount()
})

test('the pane opens on an affirmation and moves to the next when a turn ends', async ($, on) => {
  on('turn.complete', () => ({ text: '' }))

  let ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: AFFIRMATIONS[0] }))?.text).toBe(AFFIRMATIONS[0])
  await ui.unmount()

  await $.turn.complete({
    turnId: 't1',
    reason: 'answer',
    answer: '',
    durationMs: 1000,
    isAborted: false,
  })
  ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: AFFIRMATIONS[1] }))?.text).toBe(AFFIRMATIONS[1])
  await ui.unmount()
})

test('a session start picks an affirmation from the list', async ($, on) => {
  on('command.register', () => ({ value: { command: 'side' } }))
  on('clock.now', () => ({ value: 3 * 60_000 }))
  on('store.get', () => ({ value: false }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: AFFIRMATIONS[3] }))?.text).toBe(AFFIRMATIONS[3])
  await ui.unmount()
})

const BAND = {
  plugin: 'side-prompt',
  component: 'AbovePrompt',
  surface: 'terminal',
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

test('the band button opens the pane at once, and gives the row back once it is open', async ($, on) => {
  const stored: Record<string, unknown> = {}
  const opened: { id: string; focus?: true }[] = []
  on('store.set', (_, e) => {
    stored[e.key] = e.value

    return { value: undefined }
  })
  on('ui.open', (_, e) => {
    opened.push({ id: e.id, focus: e.focus })

    return { value: { isPlaced: true } }
  })
  // Nothing draws beneath the mod: this stands for the engine's own band.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  let ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Button' })).toBeDefined()
  await ui.press({ key: 'side' })
  await ui.unmount()

  expect(opened).toEqual([{ id: 'side-prompt', focus: true }])
  expect(stored.wasOpen).toBe(true)

  ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /engine/ })).toBeDefined()
  await ui.unmount()
})

test('/side is registered to run while Claude is working', async ($, on) => {
  let spec: { name: string; immediate?: true } | undefined
  on('command.register', (_, e) => {
    spec = e

    return { value: { command: e.name } }
  })
  on('clock.now', () => ({ value: 1000 }))
  on('store.get', () => ({ value: false }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(spec?.name).toBe('side')
  expect(spec?.immediate).toBe(true)
})

test('/side opens the pane and remembers it, then closes it and forgets', async ($, on) => {
  const stored: Record<string, unknown> = {}
  const opened: { id: string; focus?: true }[] = []
  let panes: { id: string; title: string; isShown: boolean; isFocused: boolean; isPlaced: boolean }[] = []
  on('store.set', (_, e) => {
    stored[e.key] = e.value

    return { value: undefined }
  })
  on('ui.panes', () => ({ value: panes }))
  on('ui.open', (_, e) => {
    opened.push({ id: e.id, focus: e.focus })
    panes = [{ id: e.id, title: 'Side prompt', isShown: true, isFocused: true, isPlaced: true }]

    return { value: { isPlaced: true } }
  })
  on('ui.close', () => {
    panes = []

    return { value: undefined }
  })

  const first = await $.command.run(RUN_SIDE)
  expect(first.text).toMatch(/opened/)
  expect(opened).toEqual([{ id: 'side-prompt', focus: true }])
  expect(stored.wasOpen).toBe(true)

  const second = await $.command.run(RUN_SIDE)
  expect(second.text).toMatch(/closed/)
  expect(stored.wasOpen).toBe(false)
})

test('a new session reopens the pane only if it was open last time', async ($, on) => {
  let wasOpen: unknown = true
  const opened: string[] = []
  on('command.register', () => ({ value: { command: 'side' } }))
  on('clock.now', () => ({ value: 1000 }))
  on('store.get', () => ({ value: wasOpen }))
  on('ui.open', (_, e) => {
    opened.push(e.id)

    return { value: { isPlaced: true } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await until(() => opened.length === 1)
  expect(opened).toEqual(['side-prompt'])

  wasOpen = false
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await new Promise(resolve => setTimeout(() => resolve(undefined), 30))
  expect(opened).toEqual(['side-prompt'])
})

test('the btw answer shows on the btw tab only', async ($, on) => {
  on('clock.now', () => ({ value: 1000 }))
  on('ui.toast', () => ({ value: undefined }))
  on('model.fork', () => FORK_ANSWER)

  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-btw' })
  await ui.input({ key: 'btw', text: 'what is 2+2', kind: 'submit' })
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe('four')

  await ui.press({ key: 'tab-prompt' })
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
  await ui.unmount()
})

// The pane's room, in the shape the engine hands a Pane hook.
const paneIn = (room: { placement: 'dock' | 'inline'; bodyRows: number; bodyColumns: number }) =>
  ({
    ...PANE,
    props: {
      ...PANE.props,
      placement: room.placement,
      bodyColumns: room.bodyColumns,
      scroll: { offset: 0, bodyRows: room.bodyRows },
    },
  }) as const

test('the engine model: at 52 columns `send` keeps half the field, a longer label keeps more', () => {
  expect(fieldColumns(52, 'send')).toBe(26)
  expect(fieldColumns(52, 'send prompt')).toBe(38)
  expect(submitLabelFor(52, ['send', 'send prompt', 'send · esc to main'])).toBe('send prompt')
  // Wide enough that the newline hint costs less than any longer label.
  expect(submitLabelFor(120, ['send', 'send prompt', 'send · esc to main'])).toBe('send')
})

test('docked, the prompt field fills the pane below its chrome, whatever it holds', async $ => {
  let ui = await $.ui.mount(paneIn({ placement: 'dock', bodyRows: 40, bodyColumns: 52 }))
  expect((await ui.find({ key: 'prompt' }))?.props.rows).toBe(36)
  expect((await ui.find({ key: 'prompt' }))?.props.submitLabel).toBe('send prompt')
  await ui.unmount()

  ui = await $.ui.mount(paneIn({ placement: 'dock', bodyRows: 20, bodyColumns: 52 }))
  await ui.input({ key: 'prompt', text: 'x'.repeat(2000), kind: 'change' })
  expect((await ui.find({ key: 'prompt' }))?.props.rows).toBe(16)
  await ui.unmount()
})

test('inline, the prompt field grows with its text up to the room', async $ => {
  const ui = await $.ui.mount(paneIn({ placement: 'inline', bodyRows: 20, bodyColumns: 52 }))
  expect((await ui.find({ key: 'prompt' }))?.props.rows).toBe(3)

  // 38 columns of field: 5 rows of text and one spare.
  await ui.input({ key: 'prompt', text: 'x'.repeat(38 * 5), kind: 'change' })
  expect((await ui.find({ key: 'prompt' }))?.props.rows).toBe(6)

  await ui.input({ key: 'prompt', text: 'x'.repeat(2000), kind: 'change' })
  expect((await ui.find({ key: 'prompt' }))?.props.rows).toBe(16)
  await ui.unmount()
})

test('the btw field grows with its question, up to a third of the pane', async $ => {
  const ui = await $.ui.mount(paneIn({ placement: 'dock', bodyRows: 30, bodyColumns: 52 }))
  await ui.press({ key: 'tab-btw' })
  expect((await ui.find({ key: 'btw' }))?.props.rows).toBe(2)

  await ui.input({ key: 'btw', text: 'x'.repeat(2000), kind: 'change' })
  expect((await ui.find({ key: 'btw' }))?.props.rows).toBe(10)
  await ui.unmount()
})

const COMMANDS: CommandInfo[] = [
  { name: 'compact', description: 'Clear history but keep a summary', source: 'builtin' },
  { name: 'cost', description: 'Show the session cost', source: 'builtin' },
  { name: 'review-kit:review', description: 'Review the current diff', source: 'plugin' },
]

test('a slash command runs as a command, not as a prompt to Claude', async ($, on) => {
  const sent: string[] = []
  const ran: { command: string; args: string }[] = []
  on('command.list', () => ({ value: COMMANDS }))
  on('prompt.submit', (_, e) => {
    sent.push(e.text)

    return { text: e.text }
  })
  on('command.run', (_, e) => {
    ran.push({ command: e.command, args: e.args })

    return { text: '' }
  })

  const ui = await $.ui.mount(PANE)
  await ui.input({ key: 'prompt', text: '/compact keep the plan', kind: 'submit' })
  // A plugin's command answers to its bare name when no other shares it.
  await ui.input({ key: 'prompt', text: '/review the diff', kind: 'submit' })

  expect(ran).toEqual([
    { command: 'compact', args: 'keep the plan' },
    { command: 'review-kit:review', args: 'the diff' },
  ])
  expect(sent).toEqual([])
  expect(await ui.find({ type: 'Text', text: /queued/ })).toBeUndefined()
  await ui.unmount()
})

test('text starting with / that names no command stays in the field, never sent', async ($, on) => {
  const sent: string[] = []
  on('command.list', () => ({ value: COMMANDS }))
  on('prompt.submit', (_, e) => {
    sent.push(e.text)

    return { text: e.text }
  })

  const ui = await $.ui.mount(PANE)
  await ui.input({ key: 'prompt', text: '/nope', kind: 'change' })
  await ui.input({ key: 'prompt', text: '/nope', kind: 'submit' })
  expect(await ui.find({ type: 'Text', text: /No command \/nope\./ })).toBeDefined()
  expect((await ui.find({ key: 'prompt' }))?.props.value).toBe('/nope')

  // The engine takes no plugin prompt that starts with /, a path included.
  const path = '/tmp/notes.md is stale'
  await ui.input({ key: 'prompt', text: path, kind: 'change' })
  await ui.input({ key: 'prompt', text: path, kind: 'submit' })
  expect(await ui.find({ type: 'Text', text: /No command \/tmp\/notes\.md\./ })).toBeDefined()
  expect((await ui.find({ key: 'prompt' }))?.props.value).toBe(path)
  expect(sent).toEqual([])
  await ui.unmount()
})

test('editing the draft clears the last note', async ($, on) => {
  on('command.list', () => ({ value: COMMANDS }))

  const ui = await $.ui.mount(PANE)
  await ui.input({ key: 'prompt', text: '/nope', kind: 'submit' })
  expect(await ui.find({ type: 'Text', text: /No command/ })).toBeDefined()

  await ui.input({ key: 'prompt', text: '/co', kind: 'change' })
  expect(await ui.find({ type: 'Text', text: /No command \/nope/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^\/compact {2}\/cost$/ })).toBeDefined()
  await ui.unmount()
})

test('while the draft is a slash command, the row under it lists what it could be', async ($, on) => {
  on('command.list', () => ({ value: COMMANDS }))

  const ui = await $.ui.mount(PANE)
  await ui.input({ key: 'prompt', text: '/co', kind: 'change' })
  expect((await ui.find({ type: 'Text', text: /^\/compact/ }))?.text).toBe('/compact  /cost')

  await ui.input({ key: 'prompt', text: '/cost ', kind: 'change' })
  expect(await ui.find({ type: 'Text', text: /^\/cost: Show the session cost$/ })).toBeDefined()

  await ui.input({ key: 'prompt', text: '/zz', kind: 'change' })
  expect(await ui.find({ type: 'Text', text: /No command starts with \/zz/ })).toBeDefined()
  await ui.unmount()
})
