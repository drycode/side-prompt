import type { CommandInfo } from 'claude-code'

export type SlashCommand = { name: string; args: string }

const MAX_HINTS = 8

// `/name args` as the main prompt reads it. A first word holding another slash
// is a path (`/tmp/notes.md`), not a command.
export const parseSlash = (text: string): SlashCommand | undefined => {
  const match = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/.exec(text.trim())
  if (match === null) {
    return undefined
  }

  return { name: match[1] ?? '', args: match[2] ?? '' }
}

// A plugin's command is listed by its full name (`review-kit:review`). Typed bare
// (`review`), it still names that command if no other command shares the bare name.
const bareName = (command: CommandInfo) => command.name.slice(command.name.indexOf(':') + 1)

export const resolveCommand = (name: string, commands: readonly CommandInfo[]): CommandInfo | undefined => {
  const exact = commands.find(command => command.name === name)
  if (exact !== undefined) {
    return exact
  }
  const bare = commands.filter(command => bareName(command) === name)

  return bare.length === 1 ? bare[0] : undefined
}

// A dim line under the field while it holds a slash command: the commands the
// name so far could become, or, once a space follows it, what that command does.
export const slashHint = (text: string, commands: readonly CommandInfo[]): string | undefined => {
  const [, name = '', space = ''] = /^\/(\S*)(\s?)/.exec(text) ?? []
  if (!text.startsWith('/') || name.includes('/')) {
    return undefined
  }
  if (space !== '') {
    const command = resolveCommand(name, commands)

    return command === undefined ? `No command /${name}` : `/${command.name}: ${command.description}`
  }
  const matches = commands.filter(command => command.name.startsWith(name) || bareName(command).startsWith(name))
  if (matches.length === 0) {
    return `No command starts with /${name}`
  }
  const shown = matches.slice(0, MAX_HINTS).map(command => `/${command.name}`)
  const more = matches.length - shown.length

  return more > 0 ? `${shown.join('  ')}  +${more} more` : shown.join('  ')
}
