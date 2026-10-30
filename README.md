# claude-mods

Mods for Claude Code.

## copy-kit

Copy exactly the part of a reply you want, in the Claude desktop app.

- **Copy one section.** Hover a paragraph, list, table, quote, code block or heading and it lifts a shade; click the copy icon at its right edge. A quote copies without its `>` markers, a code block without its fences, a heading without its `#`. The icon turns to a check for a moment.
- **Copy several.** Tick the checkbox beside each section you want. A bar above the prompt counts them, with **Copy** and **Clear**. Sections of one kind copy without their markers; a mix keeps every section's markdown, so a code block stays a code block beside the text. Copying clears the ticks.
- **Copy the transcript path.** **Transcript** in the prompt footer copies the path of the file the conversation is stored in. `/transcript` does the same.

In VS Code, the copy icon is the ⧉ glyph and sections do not tint; in the terminal, replies keep their own drawing and `/transcript` copies the path.

The copy and check icons are traced from the Claude desktop app's own icon font, so the mark matches the app's copy button.

## Install

At the prompt of a terminal session:

```
/plugin install copy-kit --marketplace 416rehman/claude-mods
```

Answer `y` to add the marketplace, then pick a scope.

From a shell:

```
claude plugin install copy-kit --marketplace 416rehman/claude-mods
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `416rehman/claude-mods`, then **Add plugin**.
