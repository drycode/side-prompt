export type SideNote = string

// One side question and the answer its fork gave.
export type BtwExchange = { question: string; answer: string }

declare module 'claude-code' {
  interface PluginState {
    'side-prompt': {
      prompt: string
      btw: string
      note: Shaped<SideNote>
      thread: Shaped<BtwExchange[]>
      added: number
      isWorking: boolean
      affirmationAt: number
      isPaneOpen: boolean
      tab: 'prompt' | 'btw'
    }
  }
}
