// How the pane's fields fit the room the pane has.
//
// While a multi-line Input has the keyboard, the terminal draws a hint in a
// column of its own to the right of every row: ` ⏎ <submitLabel>`, followed by
// ` · shift+⏎ new line` whenever the field still keeps half the pane. At 52
// columns, `send` lands exactly on that line and the field keeps 26. This is
// how Claude Code 2.1.311 lays out the field, not part of the mod API, so a
// later build may draw it differently; then the field just gets less room.

const SUBMIT_MARK = 3 // ' ⏎ '
const NEWLINE_HINT = 19 // ' · shift+⏎ new line'
const MIN_FIELD_COLUMNS = 12

// Rows the pane draws around the prompt field: the affirmation, the tab row,
// the footer below the field, and one spare, since a row too many is cheap
// and a row too few scrolls the field's top out of the pane.
const CHROME_ROWS = 4
const MIN_PROMPT_ROWS = 3
const MIN_BTW_ROWS = 2

export type Placement = 'dock' | 'inline'

// Columns the engine leaves the field for its text beside the hint.
export const fieldColumns = (columns: number, submitLabel: string): number => {
  const short = SUBMIT_MARK + submitLabel.length
  const long = short + NEWLINE_HINT
  const hint = columns - long >= columns / 2 ? long : short

  return Math.max(MIN_FIELD_COLUMNS, columns - hint)
}

// The label that leaves the field the most room. A longer label pushes the
// newline hint out, so at some widths it buys back more than it costs.
export const submitLabelFor = (columns: number, labels: readonly [string, ...string[]]): string =>
  labels.reduce((best, label) => (fieldColumns(columns, label) > fieldColumns(columns, best) ? label : best))

// Rows `text` takes in a field `columns` wide. Word wrap can need a row more
// than this, which the callers' spare row covers.
export const wrappedRows = (text: string, columns: number): number =>
  text.split('\n').reduce((rows, line) => rows + Math.max(1, Math.ceil(line.length / columns)), 0)

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(value, high))

// Docked, the prompt field fills the pane below its chrome. Inline, the frame
// fits the tree, so the field grows with its text instead of taking the room.
export const promptRows = (
  text: string,
  room: { placement: Placement; bodyRows: number; columns: number },
): number => {
  const most = Math.max(MIN_PROMPT_ROWS, room.bodyRows - CHROME_ROWS)
  if (room.placement === 'dock') {
    return most
  }

  return clamp(wrappedRows(text, room.columns) + 1, MIN_PROMPT_ROWS, most)
}

// The btw field grows with its question, up to a third of the pane, leaving
// the rest to the answer below it.
export const btwRows = (text: string, room: { bodyRows: number; columns: number }): number =>
  clamp(wrappedRows(text, room.columns) + 1, MIN_BTW_ROWS, Math.max(MIN_BTW_ROWS, Math.floor(room.bodyRows / 3)))
