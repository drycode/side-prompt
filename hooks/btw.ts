import type { BtwExchange } from '../types'

const asTranscript = (thread: readonly BtwExchange[]) =>
  thread.map(({ question, answer }) => `Q: ${question}\nA: ${answer}`).join('\n\n')

// A fork answers one message, so a follow-up carries the thread so far.
export const forkPrompt = (thread: readonly BtwExchange[], question: string): string =>
  thread.length === 0
    ? question
    : `This continues a side conversation about this session. So far:\n\n${asTranscript(thread)}\n\nNext question: ${question}`

// What the main conversation reads when the person adds the thread to it.
export const sessionText = (thread: readonly BtwExchange[]): string =>
  'The person asked these side questions in the side pane, answered by a tool-less fork of ' +
  `this conversation, and added them here for you to read:\n\n${asTranscript(thread)}`

export const countOf = (thread: readonly BtwExchange[]): string =>
  thread.length === 1 ? '1 side question' : `${thread.length} side questions`
