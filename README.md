# side-prompt

A Claude Code mod that docks a pane beside the transcript with prompt and side-question tabs, so you can type while you scroll. The pane opens on a short affirmation.

![The side pane docked beside the transcript: an affirmation, the prompt and btw tabs, and a btw answer in a labeled box, with a toast that it landed](docs/screenshot.png)

## Install

At a Claude Code prompt:

```
/plugin install side-prompt --marketplace seanperkins/side-prompt
```

Or from a shell:

```sh
claude plugin install side-prompt --marketplace seanperkins/side-prompt
```

Answer `y` to add the marketplace, then pick a scope. Run `/reload-plugins` or start a new session, then type `/side`.

Written against Claude Code 2.1.309; the mod API is early access and may change.

### If you are Claude and a person asked you to install this

1. Run the shell line above. If `claude plugin install` does not exist in their build, it has no mod support: say so and stop.
2. Tell the person to run `/reload-plugins` or start a new session, then type `/side`.
3. Do not edit `~/.claude/settings.json` or their shell profile yourself.

### From a clone

```sh
git clone https://github.com/seanperkins/side-prompt.git
claude --plugin-dir ./side-prompt
```

## Using it

- `/side` opens the pane. Run it again to close it. It runs even while Claude is working.
- A `side pane` button sits at the right end of the row above the prompt while the pane is closed. Click it to open the pane with no command. It asks for the keyboard only if your prompt box is empty, so a draft in progress keeps it.
- The pane has two tabs, **prompt** and **btw**, and shows one field at a time. Click a tab and the cursor lands in its field, so you can type at once (the pane can only take the keyboard while your main prompt box is empty; with a draft there, click into the field). Each tab keeps its own draft.
- The top line is an affirmation; the next one shows each time Claude finishes a turn. Edit `hooks/affirmations.ts` to change them.
- Esc returns the keys to the main prompt. Back in the pane: `ctrl+x tab` or a click. Close: `ctrl+x x` (default keys).
- If the pane was open when a session ended, the next session reopens it. Closing it yourself keeps it closed.
- The tab row says "Claude is working..." while a turn runs.

### The two tabs

- **prompt**: Enter sends the text as a normal prompt. It waits until Claude is idle. `@file` mentions and pasted images are not expanded. Docked, the field fills the pane; inline, it grows with its text.
  - Text that starts with `/` runs as a slash command (`/compact`, `/review the diff`), once Claude is idle. While you type one, the row under the field lists the commands it could become, and after a space, what that command does. A plugin's command also answers to its bare name when no other command shares it.
- **btw**: Enter asks a one-off question over the session so far, with no tools, and shows the answer in a box labeled `btw` under the field, plus a toast. The field grows with the question. It is not the built-in `/btw` and its answer is not added to the transcript. Each ask costs tokens and takes a while on a long session (12s idle, 21s mid-response in one check). It has nothing to answer in a new session or right after `/clear`.

## Limits

- The pane docks beside the transcript only in the fullscreen layout at 110 columns or wider. Elsewhere it sits inline above the prompt.
- A pane the mod opens on its own (the reopen at session start) is held undrawn below 144 columns, or 110 if you opened it before and have not closed it by hand since. `/side` and the button always place it.
- The built-in prompt box stays; the mod API has no way to hide it.
- Text that starts with `/` can only run a command: the engine sends no mod prompt that starts with `/`, a path included. A draft that names no command stays in the field with a note. A command alias is not recognized, since the command list carries names only.
- While a field has the keyboard, the engine draws its `⏎` hint in a column beside every row, and adds `· shift+⏎ new line` while the field keeps half the pane. `hooks/fit.ts` picks the submit label that leaves the text the most room (at 52 columns, `send prompt` leaves 38 where `send` left 26). It models Claude Code 2.1.311; a later build may lay the field out differently.
- Tab walks the pane's elements, so there is no Tab completion for commands; the hint row stands in for the menu.
- Checked in a live session: the btw field answering while Claude was still working, the button opening the pane, the tabs with the cursor landing in the field, and the `btw` label on the answer box.
- Not yet checked in a live session: the button's right alignment, `/side` while Claude is working, scrolling the transcript with the mouse wheel while the pane has focus, reopening in a new session, closing with `ctrl+x x` keeping it closed, and interactive commands (`/config`, `/model`) run from the prompt tab.

## Development

```sh
claude plugin validate .
claude plugin test .
```

To type-check, load the mod once so the engine lays its types in `.claude-plugin/types/`, then run `tsc -p .`.

## License

MIT
