# claude-mods

Mods and skills for Claude Code. Install any of them on its own. The mods each bring the shared **Mods** sidebar, and every one you install gets a section there.

| Plugin | What it does |
| --- | --- |
| [cherrypick](#cherrypick) | Copy any part of a Claude reply: one section, or several at once |
| [whereabouts](#whereabouts) | Where this conversation lives: transcript, folder, session ID, branch, model, each one click to copy |
| [cleanup](#cleanup) | A `/cleanup` skill that keeps AI slop out of PRs, run automatically before every commit |

## The Mods sidebar

**Mods** in the desktop app's prompt footer opens a sidebar with a filter at the top and a section for each installed mod, with the app's own icons. However many of these mods you install, there is one button and one sidebar: the mods settle between them which one draws the button and the filter.

## cherrypick

Copy exactly the part of a reply you want, in the Claude desktop app.

- **Copy one section.** Hover a paragraph, list, table, quote, code block or heading and it lifts a shade; click the copy icon at its right edge. A quote copies without its `>` markers, a code block without its fences, a heading without its `#`. The icon turns to a check for a moment.
- **Copy several.** Tick the checkbox beside each section you want. A bar above the prompt counts them, with **Copy** and **Clear**, and the Cherrypick section of the Mods sidebar lists them, each with **Remove**. Sections of one kind copy without their markers; a mix keeps every section's markdown, so a code block stays a code block beside the text. Copying clears the ticks.

In VS Code, the copy icon is the ⧉ glyph and sections do not tint; in the terminal, replies keep their own drawing.

## whereabouts

The Whereabouts section of the Mods sidebar shows where the conversation lives, each part one click to copy: its transcript file, the folder that holds it, the session ID, the working directory and project root, the git branch and remote, and the model. **Open** shows the transcript in your file manager. `/transcript` copies the transcript's path, in the terminal too.

## cleanup

A skill, `/cleanup`, with no UI. It goes over the code the current branch adds over its base, and only that code, so a PR carries no slop:

- **Simplicity.** Dead code, wrappers that only forward, checks for states that can't happen, near-copies, state that could be computed, deep nesting, repeated work and generality nothing uses come out. A function that takes a whole object to read one field takes that field instead, so callers stop building throwaway objects to call it. New code calls the helpers the codebase already has.
- **Placement.** Constants and statics at the top, types before the functions and methods that use them, new members beside their kind.
- **Names.** Variables, functions and types pass the same plain-words test as comments: no jargon, no slop words, no single letters, no `data` or `manager` that could mean anything.
- **Comments.** No comment beats a comment. Narration, change-log notes and pointers to moving targets go. Where removing a comment would leave the code harder to read, the code is fixed instead. A comment that carries a *why* stays, cut to one plain line with no jargon, no em dashes and no slop words like *sentinel* or *guard*. Comment conventions come from the codebase: where its struct fields are documented, a new field is too, and where they aren't, no comment is added.

The rules in your CLAUDE.md files apply too. Every code change keeps behaviour as it was and is checked by the build and tests; anything bigger, a special case that belongs in a deeper fix, or a bug noticed on the way is flagged, not done.

A commit hook runs it for you: every `git commit` Claude makes that adds source lines is held until the pass has covered exactly what is being committed. `/cleanup <branch>` targets a PR into another branch; `/cleanup <file>` covers a whole file.

## Install

At the prompt of a terminal session:

```
/plugin install cherrypick --marketplace 416rehman/claude-mods
/plugin install whereabouts --marketplace 416rehman/claude-mods
/plugin install cleanup --marketplace 416rehman/claude-mods
```

Answer `y` to add the marketplace, then pick a scope.

From a shell:

```
claude plugin install cherrypick --marketplace 416rehman/claude-mods
claude plugin install whereabouts --marketplace 416rehman/claude-mods
claude plugin install cleanup --marketplace 416rehman/claude-mods
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `416rehman/claude-mods`, then **Add plugin**.

## Developing

The sidebar's code lives once, in `shared/`, and each mod with a hooks module carries a copy in `hooks/shared/`. After changing it:

```
node scripts/sync-shared.mjs
```

`node scripts/sync-shared.mjs --check` fails when a copy differs. `shared/icons.ts` is generated from the desktop app's icon font by `scripts/make-icons.py`. Each mod's tests run with `claude plugin test <mod>`.

The copy, check and sidebar icons are traced from the Claude desktop app's own icon font, so they match the app's.
