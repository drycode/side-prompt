import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { AFFIRMATIONS } from './affirmations'

const PANE = 'side-prompt'
// The `$.store` key that remembers the pane was open when the session ended.
const WAS_OPEN = 'wasOpen'

const prompt = atom({ plugin: 'side-prompt', key: 'prompt' } as const, '')
const btw = atom({ plugin: 'side-prompt', key: 'btw' } as const, '')
const note = atom({ plugin: 'side-prompt', key: 'note' } as const, '')
const answer = atom({ plugin: 'side-prompt', key: 'answer' } as const, '')
const isWorking = atom({ plugin: 'side-prompt', key: 'isWorking' } as const, false)
const affirmationAt = atom({ plugin: 'side-prompt', key: 'affirmationAt' } as const, 0)
const isPaneOpen = atom({ plugin: 'side-prompt', key: 'isPaneOpen' } as const, false)
const tab = atom({ plugin: 'side-prompt', key: 'tab' } as const, 'prompt')

const TABS = ['prompt', 'btw'] as const

const NO_ANSWER: Record<string, string> = {
  'nothing-to-fork': 'Nothing to ask about yet: send a prompt first (or you just ran /clear).',
  'empty-reply': 'The model sent back nothing.',
  aborted: 'The question was interrupted.',
}

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
    $.ui.toast(`side pane: ${error instanceof Error ? error.message : String(error)}`)
  }
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
    const [promptText, btwText, noteText, answerText, isBusy, affirmation, activeTab] = await Promise.all([
      read($, prompt),
      read($, btw),
      read($, note),
      read($, answer),
      read($, isWorking),
      read($, affirmationAt),
      read($, tab),
    ])

    const selectTab = async (name: (typeof TABS)[number]) => {
      await update($, tab, () => name)
      // Waits for the field the next drawing brings, then puts the cursor in it.
      // Best effort: the keyboard is the person's to give, so a refusal is fine.
      await $.ui.focus({ requestId: PANE, key: name }).catch(() => undefined)
    }

    const sendPrompt = async (text: string) => {
      if (text.trim() === '') {
        return
      }
      await update($, prompt, () => '')
      await update($, note, () => 'Prompt queued; it sends when Claude is idle.')
      await $.prompt.submit({ text, asUser: true })
      await update($, note, () => 'Prompt sent.')
    }

    const askBtw = async (text: string) => {
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
        const reply = await $.model.fork({ prompt: text })
        if (reply.isAnswered) {
          const took = `${(((await $.clock.now()) - startedAt) / 1000).toFixed(1)}s`
          await update($, answer, () => reply.text)
          await update($, note, () => `Answered in ${took}.`)
          $.ui.toast(`btw answered (${took})`)
        } else {
          await fail(
            reply.reason === 'api-error'
              ? `API error${reply.status === null ? '' : ` ${reply.status}`}.`
              : (NO_ANSWER[reply.reason] ?? reply.reason),
          )
        }
      } catch (error) {
        await fail(`Question failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    return (
      <Box flexDirection="column">
        <Text italic>{AFFIRMATIONS[affirmation % AFFIRMATIONS.length] ?? ''}</Text>
        <Text dimColor>Enter sends. Esc returns to the main prompt.</Text>
        {isBusy && <Text dimColor>Claude is working...</Text>}
        <Box>
          {TABS.map(name => (
            <Button
              key={`tab-${name}`}
              label={name === activeTab ? `▸ ${name}` : name}
              onPress={() => void selectTab(name)}
            />
          ))}
        </Box>
        {activeTab === 'prompt' ? (
          <Input
            key="prompt"
            label="prompt"
            placeholder="Type here while you scroll"
            rows={5}
            autoFocus
            submitLabel="send"
            value={promptText}
            onInput={value => void update($, prompt, () => value)}
            onSubmit={value => void sendPrompt(value)}
          />
        ) : (
          <Input
            key="btw"
            label="btw"
            placeholder="Side question about this session"
            autoFocus
            submitLabel="ask"
            value={btwText}
            onInput={value => void update($, btw, () => value)}
            onSubmit={value => void askBtw(value)}
          />
        )}
        {noteText !== '' && <Text dimColor>{noteText}</Text>}
        {answerText !== '' && (
          <Box borderStyle="round" paddingX={1}>
            <Markdown text={answerText} />
          </Box>
        )}
      </Box>
    )
  })
}
