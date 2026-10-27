import { atom, read, update } from 'claude-code'
import type { CommandInfo, EngineInterface, Register } from 'claude-code'

import { AFFIRMATIONS } from './affirmations'
import { countOf, forkPrompt, sessionText } from './btw'
import { btwRows, fieldColumns, promptRows, submitLabelFor } from './fit'
import { parseSlash, resolveCommand, slashHint } from './slash'
import type { SlashCommand } from './slash'

const PANE = 'side-prompt'
// The `$.store` key that remembers the pane was open when the session ended.
const WAS_OPEN = 'wasOpen'

const prompt = atom({ plugin: 'side-prompt', key: 'prompt' } as const, '')
const btw = atom({ plugin: 'side-prompt', key: 'btw' } as const, '')
// Change the tag when what `note` holds changes: it declines the value an
// earlier version stored, which outlives a reload.
const note = atom({ plugin: 'side-prompt', key: 'note' } as const, '', { shape: 'note-2' })
// Each btw question follows on from the ones before it until the person clears them.
const thread = atom({ plugin: 'side-prompt', key: 'thread' } as const, [], { shape: 'thread-1' })
// How many of the thread's exchanges are already in the main conversation.
const added = atom({ plugin: 'side-prompt', key: 'added' } as const, 0)
const isWorking = atom({ plugin: 'side-prompt', key: 'isWorking' } as const, false)
const affirmationAt = atom({ plugin: 'side-prompt', key: 'affirmationAt' } as const, 0)
const isPaneOpen = atom({ plugin: 'side-prompt', key: 'isPaneOpen' } as const, false)
const tab = atom({ plugin: 'side-prompt', key: 'tab' } as const, 'prompt')

const TABS = ['prompt', 'btw'] as const

// Shortest first; `submitLabelFor` picks the one that leaves the field the most room.
const PROMPT_LABELS = ['send', 'send prompt', 'send · esc to main'] as const
const BTW_LABELS = ['ask', 'ask Claude', 'ask · esc to main'] as const

const NO_ANSWER: Record<string, string> = {
  'nothing-to-fork': 'Nothing to ask about yet: send a prompt first (or you just ran /clear).',
  'empty-reply': 'The model sent back nothing.',
  aborted: 'The question was interrupted.',
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

const openPane = async ($: EngineInterface, options: { focus?: true } = {}) => {
  const opened = await $.ui.open({ id: PANE, title: 'Side prompt', columns: 52, ...options })
  await update($, isPaneOpen, () => opened.isPlaced)

  return opened
}

// What `/side` and the band's button both do: open the pane, ask for the
// keyboard, and remember it was open for the next session.
const showPane = async ($: EngineInterface) => {
  const opened = await openPane($, { focus: true })
  await $.store.set(WAS_OPEN, true)

  return opened
}

// The band button's press: a failure here has no hook to catch it, so say it.
const pressSide = async ($: EngineInterface) => {
  try {
    const opened = await showPane($)
    if (!opened.isPlaced) {
      $.ui.toast(`side pane: ${String(opened.reason)}`)
    }
  } catch (error) {
    $.ui.toast(`side pane: ${messageOf(error)}`)
  }
}

const selectTab = async ($: EngineInterface, name: (typeof TABS)[number]) => {
  await update($, tab, () => name)
  // Put the cursor in the new tab's field so the person can type at once.
  // Best effort: the keyboard is the person's to give, so a refusal (a
  // draft in the main prompt box keeps it) leaves the cursor where it is.
  try {
    // A click on a tab presses it without giving the pane the keyboard, so
    // ask for it first (granted only while the main prompt box is empty).
    await openPane($, { focus: true })
    // Waits for the field the next drawing brings.
    await $.ui.focus({ requestId: PANE, key: name })
  } catch {
    // Nothing to mend: the tab has switched, only the cursor stayed put.
  }
}

// A slash command runs as the person's own would, once Claude is idle. A
// failure gives the draft back so it can be fixed and sent again.
const runCommand = async ($: EngineInterface, command: CommandInfo, typed: SlashCommand, text: string) => {
  await update($, prompt, () => '')
  await update($, note, () => `/${command.name} queued; it runs when Claude is idle.`)
  try {
    await $.command.run({ command: command.name, args: typed.args })
    await update($, note, () => '')
  } catch (error) {
    await update($, prompt, () => text)
    await update($, note, () => `/${command.name} failed: ${messageOf(error)}`)
  }
}

// The engine refuses a plugin's prompt whose text starts with `/` (it would
// run a command as the person), so such a draft runs as a command or stays.
const sendCommand = async ($: EngineInterface, text: string) => {
  const typed = parseSlash(text)
  const command = typed === undefined ? undefined : resolveCommand(typed.name, await $.command.list())
  if (typed === undefined || command === undefined) {
    const [first = ''] = text.trim().split(/\s/)
    await update($, note, () => `No command ${first}. Text that starts with / can only run a command.`)

    return
  }
  await runCommand($, command, typed, text)
}

const sendPrompt = async ($: EngineInterface, text: string) => {
  if (text.trim() === '') {
    return
  }
  if (text.trimStart().startsWith('/')) {
    await sendCommand($, text)

    return
  }
  await update($, prompt, () => '')
  await update($, note, () => 'Prompt queued; it sends when Claude is idle.')
  try {
    await $.prompt.submit({ text, asUser: true })
    await update($, note, () => '')
  } catch (error) {
    await update($, prompt, () => text)
    await update($, note, () => `Not sent: ${messageOf(error)}`)
  }
}

const askBtw = async ($: EngineInterface, text: string) => {
  if (text.trim() === '') {
    return
  }
  const fail = async (why: string) => {
    await update($, note, () => why)
    $.ui.toast(`btw: ${why}`)
  }
  await update($, btw, () => '')
  await update($, note, () => 'Asking...')
  const startedAt = await $.clock.now()
  try {
    const reply = await $.model.fork({ prompt: forkPrompt(await read($, thread), text) })
    if (reply.isAnswered) {
      const took = `${(((await $.clock.now()) - startedAt) / 1000).toFixed(1)}s`
      await update($, thread, exchanges => [...exchanges, { question: text, answer: reply.text }])
      await update($, note, () => '')
      $.ui.toast(`btw answered (${took})`)
    } else {
      await fail(
        reply.reason === 'api-error'
          ? `API error${reply.status === null ? '' : ` ${reply.status}`}.`
          : (NO_ANSWER[reply.reason] ?? reply.reason),
      )
    }
  } catch (error) {
    await fail(`Question failed: ${messageOf(error)}`)
  }
}

// Adds the thread to the main conversation as a row Claude reads on its next
// request, without starting a turn, and logs a line the person can see.
// Only the exchanges since the last add go in, so a second press adds nothing twice.
const addThread = async ($: EngineInterface) => {
  const [whole, addedCount] = await Promise.all([read($, thread), read($, added)])
  const exchanges = whole.slice(addedCount)
  if (exchanges.length === 0) {
    return
  }
  try {
    const appended = await $.session.append({
      message: { type: 'user', content: [{ type: 'text', text: sessionText(exchanges) }] },
    })
    if (appended.deny !== undefined) {
      await update($, note, () => `Not added: ${appended.deny}`)

      return
    }
    await update($, added, () => whole.length)
    // A dim line in the transcript, for the person: the model never reads it.
    $.ui.log(`btw: added ${countOf(exchanges)} to the conversation`)
    await update($, note, () => `Added ${countOf(exchanges)}; Claude reads them on its next request.`)
  } catch (error) {
    await update($, note, () => `Not added: ${messageOf(error)}`)
  }
}

const clearThread = async ($: EngineInterface) => {
  await update($, thread, () => [])
  await update($, added, () => 0)
  await update($, note, () => '')
}

// Editing the draft retires the last note, so the row under the field can
// show the slash-command hint for the new one.
const editPrompt = async ($: EngineInterface, text: string) => {
  await update($, prompt, () => text)
  if ((await read($, note)) !== '') {
    await update($, note, () => '')
  }
}

// The row under the prompt field: the latest note, or while the draft is a
// slash command, the commands it could be.
const promptFooter = async ($: EngineInterface, text: string, noteText: string) => {
  if (noteText !== '' || !text.startsWith('/')) {
    return noteText
  }

  return slashHint(text, await $.command.list()) ?? ''
}

export const register: Register = on => {
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, isWorking, () => true)
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, isWorking, () => false)
      await update($, affirmationAt, at => (at + 1) % AFFIRMATIONS.length)
    }

    return next(e)
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'side',
      description: 'Open or close a side pane to prompt or ask a side question without touching the main prompt',
      // Runs at once while Claude is working, instead of waiting for the turn.
      immediate: true,
    })
    // Start each session on a different line, one that holds for the minute.
    const now = await $.clock.now()
    await update($, affirmationAt, () => Math.floor(now / 60_000) % AFFIRMATIONS.length)
    if ((await $.store.get(WAS_OPEN)) === true) {
      void openPane($)
    }

    return next(e)
  })

  on('command.run', { command: 'side' }, async $ => {
    const panes = await $.ui.panes()
    if (panes.some(pane => pane.id === PANE && pane.isPlaced)) {
      await $.store.set(WAS_OPEN, false)
      await $.ui.close({ id: PANE })
      await update($, isPaneOpen, () => false)

      return { text: 'Side prompt closed.' }
    }
    await showPane($)

    return { text: 'Side prompt opened. Esc returns to the main prompt.' }
  })

  // Only the person's own close forgets the pane: the session ending drops it
  // without a word, and the next session should bring it back.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind === 'person') {
      await $.store.set(WAS_OPEN, false)
    }
    const closed = await next(e)
    await update($, isPaneOpen, () => false)

    return closed
  })

  // The button's press is answered here, not in its `onPress` closure: the
  // engine counts a pane opened from a Button's hook as asked for, placed at
  // any width, and one opened from the closure as unasked (held undrawn below
  // 144 columns). The hook answers for itself and never calls `next`: opening
  // the pane redraws the band without the button and releases its handle, so
  // `next` would find no `onPress` to run and throw.
  on('ui.press', { plugin: 'side-prompt', element: 'side' }, async $ => {
    await pressSide($)

    return { element: 'side' }
  })

  // A small button above the prompt that opens the pane with one click, even
  // while Claude is working. It gives the row back once the pane is up.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isPaneOpen))) {
      return next(e)
    }

    const { Box, Button } = $.ui.resolve(e)

    return (
      <Box width={e.props.bodyColumns} justifyContent="flex-end">
        <Button key="side" label="side pane" onPress={() => undefined} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.surface === 'mobile') {
      return next(e)
    }

    const { Box, Text, Button, Input, Markdown } = $.ui.resolve(e)
    const [promptText, btwText, noteText, exchanges, addedCount, isBusy, affirmation, activeTab] = await Promise.all([
      read($, prompt),
      read($, btw),
      read($, note),
      read($, thread),
      read($, added),
      read($, isWorking),
      read($, affirmationAt),
      read($, tab),
    ])
    const { bodyColumns, placement, scroll } = e.props
    const promptLabel = submitLabelFor(bodyColumns, PROMPT_LABELS)
    const btwLabel = submitLabelFor(bodyColumns, BTW_LABELS)
    const footer = activeTab === 'prompt' ? await promptFooter($, promptText, noteText) : noteText

    return (
      <Box flexDirection="column">
        <Text italic wrap="truncate-end">
          {AFFIRMATIONS[affirmation % AFFIRMATIONS.length] ?? ''}
        </Text>
        <Box justifyContent="space-between">
          <Box gap={1} flexShrink={0}>
            {TABS.map(name => (
              <Button
                key={`tab-${name}`}
                label={name === activeTab ? `▸ ${name}` : name}
                onPress={() => void selectTab($, name)}
              />
            ))}
          </Box>
          <Text dimColor wrap="truncate-end">
            {isBusy ? 'Claude is working...' : 'esc: main prompt'}
          </Text>
        </Box>
        {activeTab === 'prompt' ? (
          <Input
            key="prompt"
            placeholder="Type here while you scroll"
            rows={promptRows(promptText, {
              placement,
              bodyRows: scroll.bodyRows,
              columns: fieldColumns(bodyColumns, promptLabel),
            })}
            autoFocus
            submitLabel={promptLabel}
            value={promptText}
            onInput={value => void editPrompt($, value)}
            onSubmit={value => void sendPrompt($, value)}
          />
        ) : (
          <Input
            key="btw"
            placeholder="Side question about this session"
            rows={btwRows(btwText, { bodyRows: scroll.bodyRows, columns: fieldColumns(bodyColumns, btwLabel) })}
            autoFocus
            submitLabel={btwLabel}
            value={btwText}
            onInput={value => void update($, btw, () => value)}
            onSubmit={value => void askBtw($, value)}
          />
        )}
        {footer !== '' && (
          <Text dimColor wrap="truncate-end">
            {footer}
          </Text>
        )}
        {activeTab === 'btw' && exchanges.length > 0 && (
          <Box gap={1}>
            {exchanges.length > addedCount ? (
              <Button key="add" label="add to session" onPress={() => void addThread($)} />
            ) : (
              <Text dimColor>added to session</Text>
            )}
            <Button key="clear" label="clear" onPress={() => void clearThread($)} />
          </Box>
        )}
        {activeTab === 'btw' && exchanges.length > 0 && (
          <Box flexDirection="column">
            {/* Newest first, so the latest answer sits under the field. */}
            <Box borderStyle="round" paddingX={1} flexDirection="column" gap={1}>
              {exchanges
                .map((exchange, at) => (
                  <Box key={`exchange-${at}`} flexDirection="column">
                    <Text dimColor>› {exchange.question}</Text>
                    <Markdown text={exchange.answer} />
                  </Box>
                ))
                .reverse()}
            </Box>
            {/* The border paints over its own children, so the label is a later
                sibling, laid on the top border row: ╭── btw ───╮ */}
            <Box position="absolute" top={0} left={3}>
              <Text> btw </Text>
            </Box>
          </Box>
        )}
      </Box>
    )
  })
}
