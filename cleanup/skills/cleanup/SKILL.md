---
name: cleanup
description: Clean up the code a branch adds before it becomes a PR, to keep AI slop out of it - redundant complexity (near-copies, derivable state, deep nesting, wasted work, parameters wider than what a function reads, helpers the codebase already has), vague or jargon names, narration and change-log comments, slop words (sentinel, guard, em dashes), comments standing in for unclear code, and declarations left wherever they happened to be typed. No comment beats a comment - code that needs one to be read is fixed instead, and the few that stay carry a why in plain, short words. Follows the codebase's own conventions (where its struct fields are documented, a new field is too), applies the CLAUDE.md rules that govern the code, and puts constants and statics at the top and types before the code that uses them. Use when the user asks to clean up, tidy, de-slop, simplify, or prep code for a PR or commit, mentions too many or verbose comments or a comment pass, asks to organize a file's declarations, or runs /cleanup; and whenever the cleanup commit gate blocks a git commit.
---

# Cleanup

An editing pass over the code a branch adds, so the PR carries no slop. Four
passes - simplicity, placement, names, comments - each led by how the codebase
already does things. The standard behind all four: a good codebase is
readable code, not commented code. **No comment beats a comment.** Make the
code say it; comment only what code cannot say. Names and comments are held
to the same plain words.

Quality only, never behavior: a bug noticed on the way is reported, not fixed
here, because fixing it changes what the code does. `/code-review` hunts bugs.

## Target - which code the pass covers

The pass covers only the code this branch introduced, never what was already
there in files the branch happens to touch. Resolve the target before reading
any file:

- **No argument:** everything the current branch adds over its base, committed
  or not. Base = the merge-base of HEAD with the upstream default branch
  (`origin/HEAD` if set, else `main`, else `master`). Run
  `git diff <merge-base>` for tracked changes and `git status --porcelain` for
  new untracked source files. On the base branch itself this reduces to the
  uncommitted changes; with a clean tree, say there is nothing to do and stop.
- **A branch name** (`/cleanup develop`): the same, with that branch as the
  base - `git diff $(git merge-base develop HEAD)`. Use this when the PR will
  target a branch other than the default.
- **`staged`:** only what is about to be committed, `git diff --cached`.
  **`tracked`:** every tracked change, `git diff HEAD`. The commit gate passes
  one of these (see "Commit gate").
- **A file, directory, commit range, or PR number:** that, and only that. A
  named file is the one case where its pre-existing code is in scope too.

Within the target, only added or changed lines are in scope. Everything else
in the file is out of scope, however bad, unless the file was named
explicitly. Moving untouched code, or rewording comments the branch did not
write, is churn in the PR - the opposite of the goal.

## Learn the codebase first

Before changing anything, read how this codebase already does it: the file
being edited first, then sibling files of the same kind (same directory, same
language, same layer). Note:

- **Placement:** where constants, statics, and module-level config sit; the
  order of types, functions, and methods; whether helpers come before or after
  their callers; exported before private or interleaved.
- **Names:** casing, prefixes (`is`/`has` for booleans), how functions are
  worded, and the words the codebase already uses for its things.
- **Helpers:** the shared and utility modules, and the files beside the
  change, so new code calls what exists instead of writing it again.
- **Written rules:** every CLAUDE.md that governs the target: the user's
  `~/.claude/CLAUDE.md`, the repo root's, and any in a directory above a
  changed file (each covers only files at or below it), plus AGENTS.md or
  CONTRIBUTING where the repo has them. A line in the target that breaks one
  of their rules is fixed like any other finding, within the limits below, and
  the report quotes the rule. Only a rule you can quote, broken by a line you
  can point to; not the spirit of a document.
- **Comments:** which kinds of declaration carry them (struct or class fields,
  enum members, exported functions and types, config keys, test cases), and in
  what form (`///`, `/** */`, `#`, leading or trailing), length, and tone.
  Whether the codebase uses section banners.

The codebase's convention wins wherever it differs from the defaults below.
The defaults apply only where the codebase shows no pattern. A convention is a
pattern across several instances, not one file's accident.

## Plain words - for names and comments

Every name and every comment the target adds is read by someone who wasn't
there when it was written. Both pass the same tests:

- **Plain words.** No jargon a new teammate wouldn't know, no shorthand coined
  while writing the code, no abbreviation the codebase doesn't already use.
  Call a thing what the codebase already calls it.
- **Understood on first read**, from the file alone: no term defined only in a
  PR or a conversation, no "new", "old", "v2" or "temp" that meant something
  only on the day it was written.
- **Short, not cryptic.** As few words as stay clear: one line for a comment,
  no filler in a name (`theUserList` is `users`), and no single letters outside
  a short loop or lambda (`c`, `d`, `tmp2`).
- **No slop words.** Words that mark text as machine-written, not because
  they're wrong but because no one says them in a code review: *sentinel*,
  *guard* (for a plain check), *robust*, *seamless*, *leverage*, *utilize*,
  *ensure*, *crucial*, *comprehensive*, *essentially*, *delve*, *footgun*,
  *load-bearing*, *canonical*, *hydrate* (for a plain load). Say the plain
  thing, in names too: `NULL_SENTINEL` is `NO_VALUE`, `guardInput` is
  `checkInput`, `ensureDir` is `makeDir`. In comments, no em dashes (—) or en
  dashes (–): a colon, a comma, or a second sentence. The exception is a name
  the code or language already uses: a `Guard` type, Swift's `guard`.

```ts
// Bad:  Hydrate the memoized selector snapshot to avoid the re-entrancy footgun
// Good: Read the store once per render; reading it inside the loop re-renders forever
```

## Pass 1 - simplicity

Redundant complexity is the slop a comment pass can't fix: the code is longer
and harder than what it does. In the target, remove:

- **Dead code:** unused variables, parameters, imports, branches that can't
  run, functions nothing calls, commented-out code.
- **Needless indirection:** a wrapper that only forwards, a helper called once
  that reads worse than its body inlined, a one-implementation interface, an
  option or config nothing sets.
- **Impossible checks:** checks for states the types or callers already rule
  out (a null check on a non-nullable value, a `try` around code that can't
  throw, a second type check of a value already narrowed).
- **Parameters wider than the need:** a function that takes a whole object,
  or a type built only to fit its signature, and reads one field of it. When a
  caller assembles a throwaway object, struct, tuple or options bag just to
  make a call, the signature is what's wrong: change the function to take what
  it reads, and update every caller.
- **Duplication:** the same logic written twice, or near-copies that differ
  by a value or two - keep one, with the difference as a parameter. Code that
  rewrites a helper the codebase already has calls that helper instead.
- **Derivable state:** a stored value that can be computed from others it must
  stay in step with (a count kept beside its list, a flag mirroring a field).
  Compute it where it is read.
- **Deep nesting:** a pyramid of `if`s that early returns or `continue` flatten.
- **Wasted work:** the same value computed twice, the same file, query or
  request made twice, independent reads awaited one after another. Fix it when
  the fix plainly keeps behavior (a pure read hoisted, or run together); flag
  the rest, such as blocking work added to startup or a hot path, or a
  long-lived closure that keeps a large scope alive.
- **Overbuilt code:** generality nothing uses yet, a hand-rolled version of
  what the language, standard library, or codebase already provides.

The question for each line: would a reviewer ask "why is this here?" If the
honest answer is "no reason", it goes. Within the limits below - behavior is
unchanged and verified; anything bigger is flagged, not done.

**The fix at the right depth.** A special case added to shared code so one
caller works, or a symptom patched downstream of its cause, means the fix sits
too shallow. Redesigning the mechanism is beyond this pass: flag it, naming the
more general change that would make the special case unnecessary.

## Pass 2 - placement

For every declaration the target adds, or moves:

- **Constants and statics at the top**, after imports and before types and
  functions: module-level constants, static fields, enums of literal values,
  module config. A new one joins the file's existing constants, in their order.
- **Types before the code that uses them:** structs, classes, interfaces,
  enums, and type aliases before the functions that take or return them.
  Methods stay with their type - an `impl` block after its struct, Go methods
  after their type, a class's methods inside it, not as free functions
  elsewhere.
- **New members join their kind:** a new field among the fields, a new method
  among the methods, a new import in the matching import group, a new test
  beside the tests of the same unit.
- **Helpers:** where the codebase puts them. With no pattern, after the first
  function that calls them, so a file reads top-down.

Placement is behavior-preserving or it does not happen:

- Order is semantics in some places: Python module-level statements,
  decorators, and default arguments run at import; JavaScript and TypeScript
  `const`/`let` are unusable before their line, and module-level calls run at
  load; C and C++ need declaration before use; static initialization order in
  C++, C#, and Java. Moving across any of these is a logic change: don't.
- Leave alone what the formatter or linter owns (import sorting, member
  ordering rules) - run them instead.
- Verify every move: build and run the relevant tests. If you can't verify it,
  don't move it - flag it.

## Pass 3 - names

Every name the target adds - variable, parameter, function, type, constant,
file - passes the plain-words tests and says what the thing is or does:

- A function is named for what it does (`copyPath`, `parseHeader`), a boolean
  for the question it answers (`isOpen`, `hasRows`), a value for what it holds,
  with its unit when it has one (`retryDelayMs`).
- A name that needs a comment to be understood is the wrong name: rename it
  and drop the comment.
- No words that fit anything: `data`, `info`, `item`, `obj`, `result`,
  `handle`, `process`, `manager`, `helper`, `util` - except as a short local
  the next line makes plain.

The codebase's own naming conventions win over these defaults. Renames stay
within the limits below: nothing reachable from outside the visible code.

## Pass 4 - comments

### The core principle

No comment beats a comment. Code already shows **how**; a comment earns its
place only by carrying **why** - context the code cannot: a non-obvious
constraint, a deliberate deviation, a gotcha, a workaround, the reason a
tempting simpler version is wrong. Default to deleting. When in doubt about a
*how* comment, delete it. If deleting it would leave the code harder to read,
the code is what needs fixing: fix it (rule 5), then delete the comment. A
comment is never the fix for unclear code. When in doubt about a *why* comment
that warns against breaking something, keep it: wrongly deleting a warning
that does real work costs more than one mediocre comment.

### Match the codebase's comment conventions

- **Where the codebase documents a kind of declaration**, a new one of that
  kind gets a comment in the same form. If every field of a struct carries a
  doc comment, a field the branch adds does too; an undocumented field among
  documented ones reads as an oversight. Write it to carry what the name
  can't - units, valid range, ownership, invariant - not to restate the name.
- **Where the codebase leaves a kind undocumented**, a new one stays
  undocumented. Don't introduce comment styles the codebase doesn't use.
- **A convention never licenses narration.** Documented fields and exported
  functions say nothing about comments inside bodies; rules 1 to 7 apply there
  as everywhere.

### The pass - apply to every comment in the target, in order

**1. Is it narration?** Restates the code, describes the steps ("loop over the
accounts", "parse the request body"), restates names/types/signatures, or marks
block ends (`} // end if`). -> **Delete.** This is the bulk of agent-generated
comment noise. The code below it was fine all along; do not touch it.

**2. Is it change narration?** Addressed to the reviewer of a diff rather than
a reader of the file: "updated to use the v2 client", "removed the old
fallback", "added per feedback", "fixed the off-by-one". -> **Delete.** Test:
would the sentence make sense to someone reading the file fresh, a year from
now, who never saw any PR? If not, it belongs in a commit message.

**3. Does it point at a moving target?** "See spec section 3", "per the
requirements doc", "see the design doc". -> **Delete** if the annotated point
didn't need a comment at all (spec compliance itself never does), or **rewrite**
to encode the substance of the requirement directly. What counts as durable vs
ephemeral:

- **Durable (allowed, as breadcrumbs):** issue/ticket IDs (`WAGE-1234`),
  Confluence pages, RFCs and standards, permalinked sources, issue-tracker
  links - and a **maintained repo doc/README at a stable path** (e.g.
  `cdk/PREVIEW_INFRA.md`), which lives and updates alongside the code.
- **Ephemeral (rewrite or delete):** "the spec", "the requirements", a design
  doc (a point-in-time artifact that gets superseded), and **any section number
  of any document** - "spec §7", "section 4.2". A section number is never
  durable, no matter what document it indexes into.

This applies **inside docstrings exactly as in line comments**.

Even a durable reference is a *breadcrumb*, never the explanation itself. The
comment must stand on its own with the link removed:

```python
# Bad:  per requirements doc section 3.2
# Bad:  see WAGE-1234
# Good: Bacs requires 3 *clear working days* between notice and collection,
#       deliberately not "+3 calendar days" (WAGE-1234).
```

**4. Is it a *why* that's bloated or misplaced?** For comments that carry real
rationale, in sequence:

- *Does the rationale belong in a doc, not here?* System-level "why it's built
  this way" narrative - an architecture decision, a benchmark result, a
  lifecycle overview - reads better in a maintained doc than in a long inline
  block. If a durable doc **already** carries it, delete the inline copy; do
  **not** leave a signpost. If no such doc exists, keep the comment and **flag
  it** as extraction-worthy (writing the doc is out of scope). What survives
  inline is only the local invariant a reader needs *at that line* - a
  non-obvious constraint or a cross-file sync obligation - not a pointer.
- *Is all of it necessary?* Trim throat-clearing, restated context, and
  anything the code itself shows. Keep every part a future maintainer would
  need to avoid breaking or "simplifying" the code.
- *Does it belong in one block?* A long header block covering several distinct
  points often serves better broken up, each short comment adjacent to the line
  it governs. A comment next to its line gets updated when the line changes; a
  header block three screens up does not.
- *Is the remaining length earned?* Some rationale is irreducibly multi-part.
  Length alone is not a defect - unearned length is. Never shorten a comment at
  the cost of the information in it.

**"Carries a real *why*" and "is worded minimally" are independent judgments.**
A comment can carry genuine rationale *and* be three times too long. Apply
Occam's razor to every surviving comment: keep the single non-obvious fact a
reader needs at that line, in the fewest words. The razor's answer is
sometimes zero: delete. A five-line block almost never survives intact.

```python
# Before (5 lines): First key/value of every emitted line. Gives every event
#   the stable prefix {"stream":"bi.telemetry" - filterable in CloudWatch Logs
#   Insights (filter stream = "bi.telemetry") and usable as a subscription-
#   filter pattern ({ $.stream = "bi.telemetry" }) when the Snowpipe landing
#   (DT-2485) is built.
# After (1 line):   Stable first-key prefix ({"stream":"bi.telemetry") for
#   log filtering.
```

**5. Is it compensating for unclear code?** It explains *what* a line means
because the code doesn't say it: a cryptic name (`# d is the delay in ms`), a
magic value (`# 86400 = one day`), a dense condition (`# trial that has
ended`), or a block that does one nameable thing (`# normalize the DN`).
-> **Make the code say it, then delete the comment**: rename (Pass 3), name
the constant (placed per Pass 2), extract the named boolean, or extract the
helper whose name is the comment. Keeping the comment is the last resort, only
when the fix would reach outside the visible code (a public name, a wire
field); then flag it. Names can't carry a *why*: a comment explaining *why* is
never resolved by renaming; keep it (rule 7).

**6. Is it stale?** Describes code that no longer exists or behavior that has
changed. -> **Delete** (or correct it, if the point still holds). A wrong
comment is worse than no comment.

**7. None of the above?** It explains a non-obvious constraint, a surprising
but essential line, a contract the signature can't show (units, ranges, side
effects, failure modes), an edge case, or the source of a copied algorithm.
-> **Keep.** Don't reword comments that are already tight - churn on good
comments is itself noise in the diff. "Already fine" means *already minimal*:
a correct-but-bloated comment is a rule-4 target.

Three keep categories easy to misread as deletable:

- **Cross-file consistency pointers** - "mirrors the Overview page", "keep in
  sync with X". The link is the why: it stops two copies drifting apart.
- **Data-literal semantics** - the meaning, order, or units of a literal
  (`# (width, height) in portrait`, `# pence, not pounds`).
- **Presentation/format contracts** - "£ with full thousands, as the
  dashboard". These pin output to an external expectation.

**Section banners** (`# --- Name ---`) are navigation, not narration. Keep
them where the codebase uses them; don't add them where it doesn't.

### Wording - every comment that survives

A kept or added comment passes the plain-words tests, or is rewritten until it
does. Cut "Note that", "basically", "this is needed because", "we" and
"here". And it says why, not how: if the rewrite comes out as a description
of the code, the comment was narration; delete it.

### TODOs

Keep TODO/FIXME comments; they need no issue IDs. Two exceptions: a TODO for
work that has visibly been done is stale (rule 6); a TODO that is deferral
disguised as a marker (`# TODO: handle errors` on a path that plausibly should
already handle them) stays but is flagged - deleting it would hide real
incompleteness.

### Docstrings

All seven rules apply inside docstrings. One that only re-emits the name and
parameter types is narration - delete or reduce, unless the codebase's
convention documents that kind of declaration (then keep it, made to carry the
contract). One that documents what the signature can't show (units, ranges,
side effects, failure behavior, invariants, what has already been done to the
inputs) is contract - keep it whole. A one-line summary on a public function or
API surface is legitimate even when short.

## Limits on code changes

The pass changes code only in these ways, each behavior-preserving: the
simplifications of Pass 1, the moves of Pass 2, and:

- rename a local variable, parameter, or unexported/private identifier
- narrow a private function's parameters to what it reads, updating every caller
- name a magic value as a constant
- extract a compound condition into a named boolean
- extract a small block that does one nameable thing into a helper named after it

And:

- No change to what the code does, no reordering of side effects, no new
  dependencies. Removing a check is allowed only when the types or every
  caller in view prove it can't fire.
- Don't rename or remove anything reachable from outside the code you can see
  and verify: exported/public API, serialized or wire field names, config keys,
  DB columns, names used via reflection, templates, other repos. Keep it and
  flag it instead.
- If the code can't be made simple or self-explanatory this way, leave it and
  flag it as a refactor candidate. Real refactors are a separate task.
- Verify every code change: build and run the relevant tests. If you can't,
  don't make it - flag it.

All other code stays byte-identical. Tidy whitespace left behind by deleted
comments (no orphaned blank lines).

## Commit gate

The plugin that ships this skill registers a PreToolUse hook
(`hooks/cleanup-gate.js`) that denies every `git commit` Claude runs until this
pass has covered exactly the content being committed - installing the plugin is
what turns the automatic run on. When the gate triggers this skill, its reason
names the target (`staged`, or `tracked` for `commit -a`) and the repo. After
the pass:

1. `git add` every file the pass edited; otherwise the cleaned version is not
   what gets committed.
2. Run the sign-off command the gate printed, in its own tool call. It records
   a hash of the content to be committed, and the gate allows the next commit
   only while the content still matches, so any later edit means another pass.
3. Re-run the original commit command unchanged, as the next tool call. The
   gate checks before a command runs, so a sign-off chained into the commit
   command is never seen.

Commits whose diff adds no lines to source files (docs, config, pure
deletions) are never gated. When the gate can't check a commit (git too slow,
say), it denies it and says why: run the command again. Never sign off without
running the pass: the sign-off is the pass's signature, not a bypass.

## Output

After editing, report:

1. **Counts** - per file: simplifications; rule fixes (CLAUDE.md, quoted);
   declarations moved; renames;
   comments deleted / rewritten / kept / added (added only where the
   codebase's convention called for one).
2. **Code changes** - each simplification, move, rename, and readability
   change (constant, named boolean, helper), one line each, and how it was
   verified.
3. **Flags** - what the pass could not fix within scope: complexity that needs
   a real refactor or reaches outside the visible code; fixes at the wrong
   depth, with the general change; wasted work that couldn't be fixed safely;
   bugs noticed; moves blocked by order-sensitive semantics; comments compensating for unclear code that
   couldn't be fixed (public names, couldn't verify); deferral TODOs; comments
   whose correctness couldn't be verified.
4. **Judgment calls** - borderline keep/delete or convention decisions, one
   line each, so the user can overrule.

Keep the report brief. Do not list every deleted narration comment - they are
the point of the pass, not news.

## Worked examples

**Simplicity - a wrapper that only forwarded, checking a state that can't happen:**

```ts
// Before
function displayName(user: User): string {
  if (!user) return ''
  return formatName(user)
}
const label = displayName(user)

// After: `user` is a non-optional User, and the wrapper added nothing
const label = formatName(user)
```

**Simplicity - a caller built a whole Request so the check could read one field:**

```ts
// Before
function hasAuth(req: Request): boolean {
  return req.headers.has('authorization')
}
if (hasAuth(new Request(url, { headers }))) { ... }

// After: the function takes what it reads
function hasAuth(headers: Headers): boolean {
  return headers.has('authorization')
}
if (hasAuth(headers)) { ... }
```

**Placement - a constant and a type the branch added mid-file:**

```go
// Before: added where they were first needed
func Retry(op func() error) error {
	const maxAttempts = 5
	...
}

type Backoff struct{ Base, Cap time.Duration }

// After: the constant joins the file's constants, the type precedes its users
const maxAttempts = 5

type Backoff struct{ Base, Cap time.Duration }

func Retry(op func() error) error { ... }
```

**Convention - a field added to a documented struct gets the same form:**

```rust
pub struct Limits {
    /// Requests per minute, per API key.
    pub rate: u32,
    /// Burst allowance above `rate`, in requests.
    pub burst: u32,
    /// Seconds a key stays blocked after exceeding `burst`.   <- added, as its siblings
    pub cooldown: u32,
}
```

**Delete - narration on clean code. Remove every comment; the code is untouched:**

```python
def login():
    # Parse the JSON body of the request into a dict
    info = json.loads(request.data)
    # Read the username key using .get(), which returns None if absent,
    # avoiding a KeyError
    username = info.get("username")
    # Query the User collection and take the first match or None
    user = User.objects(name=username, password=password).first()
```

**Make the code say it - the comments carried *what*, not *why*:**

```python
# Before
# one day, in seconds
time.sleep(86400)
# the user is on a trial that has ended
if u.plan == "trial" and u.trial_end < now:
    lock(u)

# After: same behavior, no comments needed (the constant at the module's top)
ONE_DAY_SECONDS = 24 * 60 * 60
...
time.sleep(ONE_DAY_SECONDS)
trial_ended = u.plan == "trial" and u.trial_end < now
if trial_ended:
    lock(u)
```

**Rewrite - block broken up and trimmed, substance kept, placed at point of use:**

```python
# Before: one header block
# This function handles rounding. Note that Stripe rounds half-to-even while
# our ledger rounds half-up, which historically caused reconciliation breaks.
# Also note the amounts must be converted to pence before any arithmetic.
# Finally the result is compared against the original to detect drift.

# After: two adjacent comments, narration dropped
amount_pence = to_pence(amount_gbp)  # convert before arithmetic: float GBP drifts
...
# Stripe rounds half-to-even, ledger rounds half-up - integer pence or you
# get 1p reconciliation breaks (FIN-2231)
rounded = round_half_up(amount_pence)
```

**Keep - surprising but essential, exactly the comment that must survive:**

```python
# JSONTokener.nextValue() may return a value that equals() null -
# both checks are required, do not simplify
if value is None or value == JSON_NULL:
    return None
```
