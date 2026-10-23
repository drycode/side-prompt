export type SideNote = string

declare module 'claude-code' {
  interface PluginState {
    'side-prompt': {
      prompt: string
      btw: string
      note: SideNote
      answer: string
      isWorking: boolean
      affirmationAt: number
      isPaneOpen: boolean
      tab: 'prompt' | 'btw'
    }
  }
}
