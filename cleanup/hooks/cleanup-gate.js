#!/usr/bin/env node
'use strict';
/*
 * cleanup-gate.js - Claude Code PreToolUse hook (matcher: Bash|PowerShell), registered by
 * the cleanup plugin's hooks/hooks.json.
 *
 * Denies a `git commit` until the cleanup skill has signed off on the exact content
 * being committed, then lets it through.
 *
 *   node cleanup-gate.js              hook mode: reads the hook JSON on stdin
 *   node cleanup-gate.js --mark DIR   sign-off: records the hashes for the repo at DIR
 *
 * The sign-off is <git-dir>/cleanup.ok, two lines: "cached <sha256 of git diff
 * --cached>" and "tracked <sha256 of git diff HEAD>". A plain commit must match "cached",
 * `commit -a` (or a commit with pathspecs) must match "tracked", so any edit after the
 * sign-off gates the next commit again. Commits that add no lines to source files are
 * never gated.
 *
 * `git add` commands chained before the commit in the same tool call are replayed into a
 * scratch copy of the index, so the gate sees what the index will hold when the commit runs.
 *
 * Fails open: an internal error is appended to ~/.claude/cleanup-gate.log (not beside this
 * file, which may sit in a repository) and the commit proceeds.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const MARKER = 'cleanup.ok';
const LOG = path.join(os.homedir(), '.claude', 'cleanup-gate.log');
const GIT_TIMEOUT_MS = 10000;
const CODE_EXT = new Set((
  'c cc cpp cxx h hh hpp hxx cs csx cshtml razor fs fsx vb java kt kts scala groovy gradle ' +
  'go rs swift m mm js jsx mjs cjs ts tsx mts cts vue svelte astro py pyi rb php pl pm lua r jl dart ' +
  'ex exs erl hrl hs clj cljs cljc sh bash zsh fish ps1 psm1 psd1 bat cmd sql css scss sass less styl ' +
  'zig nim nix cmake tf hcl proto graphql gql sol shader hlsl glsl cginc compute'
).split(' '));

const GIT_EXE = /(^|[\\/])git(\.exe)?$/i;
const CD_WORDS = new Set(['cd', 'chdir', 'pushd', 'set-location', 'sl']);
const GIT_OPT_WITH_VALUE = new Set(['-C', '-c', '--exec-path', '--namespace', '--super-prefix', '--git-dir', '--work-tree']);
const ADD_INTERACTIVE = new Set(['-p', '--patch', '-i', '--interactive', '-e', '--edit']);
const COMMIT_OPT_WITH_VALUE = new Set(['-m', '-F', '-t', '-C', '-c', '--message', '--file', '--template',
  '--author', '--date', '--fixup', '--squash', '--cleanup', '--trailer', '--reuse-message', '--reedit-message']);

function log(msg) {
  try { fs.appendFileSync(LOG, `${new Date().toISOString()} ${msg}\n`); } catch (_) { /* nowhere to report */ }
}

function sha(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function fwd(p) { return p.replace(/\\/g, '/'); }

// Git Bash spells D:\x as /d/x; git.exe spawned from node needs the Windows form.
function nativePath(p) {
  if (p === '~' || p.startsWith('~/')) p = os.homedir() + p.slice(1);
  const m = /^\/([a-zA-Z])(\/.*)?$/.exec(p);
  return m ? `${m[1].toUpperCase()}:${m[2] || '/'}` : p;
}

function git(cwd, args, extraEnv) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    timeout: GIT_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { GIT_OPTIONAL_LOCKS: '0', GIT_PAGER: 'cat' }, extraEnv || {}),
  });
}

// Splits a command line into simple commands (arrays of words). Quotes group words; an
// unquoted newline ; | or & ends a command (so && and || do too). Backslash is literal
// except \" inside double quotes, so Windows paths survive and a heredoc commit message
// stays inside its quotes.
function splitCommands(s) {
  const cmds = [[]];
  let cur = '';
  let quote = null;
  let inWord = false;
  const endWord = () => { if (inWord) cmds[cmds.length - 1].push(cur); cur = ''; inWord = false; };
  const endCommand = () => { endWord(); if (cmds[cmds.length - 1].length) cmds.push([]); };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"' && s[i + 1] === '"') { cur += '"'; i++; }
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; inWord = true; continue; }
    if (ch === '\n' || ch === ';' || ch === '|' || ch === '&') { endCommand(); continue; }
    if (/\s/.test(ch)) { endWord(); continue; }
    cur += ch;
    inWord = true;
  }
  endCommand();
  return cmds.filter((c) => c.length);
}

// Walks the simple commands in order, tracking `cd`, and returns the first `git commit`
// with the directory it runs in and the `git add` commands chained before it.
function findCommit(command, startDir) {
  let dir = startDir;
  const adds = [];
  for (const words of splitCommands(command)) {
    const head = words[0].toLowerCase();
    if (CD_WORDS.has(head)) {
      const target = words.slice(1).find((w) => !w.startsWith('-'));
      dir = target ? path.resolve(dir, nativePath(target)) : os.homedir();
      continue;
    }
    if (!GIT_EXE.test(words[0])) continue;
    let cdir = dir;
    let i = 1;
    for (; i < words.length && words[i].startsWith('-'); i++) {
      if (GIT_OPT_WITH_VALUE.has(words[i])) {
        if (words[i] === '-C' && words[i + 1]) cdir = path.resolve(cdir, nativePath(words[i + 1]));
        i++;
      }
    }
    const sub = words[i];
    const rest = words.slice(i + 1);
    if (sub === 'add' || sub === 'stage') {
      if (rest.some((w) => ADD_INTERACTIVE.has(w))) return null;
      adds.push({ dir: cdir, args: rest });
    } else if (sub === 'commit') {
      let all = false;
      let dryRun = false;
      for (let j = 0; j < rest.length; j++) {
        const w = rest[j];
        if (w === '--') { if (j + 1 < rest.length) all = true; break; }
        if (w === '--all') all = true;
        else if (w === '--dry-run') dryRun = true;
        else if (COMMIT_OPT_WITH_VALUE.has(w)) j++;
        else if (/^-[a-zA-Z]+$/.test(w)) {
          if (w.includes('a')) all = true;
          if (/[mFCct]/.test(w)) j++;
        } else if (!w.startsWith('-')) all = true; // pathspec: commits working-tree content
      }
      return { dir: cdir, all, dryRun, adds };
    }
  }
  return null;
}

function resolveRepo(dir) {
  try {
    return {
      top: git(dir, ['rev-parse', '--show-toplevel']).trim(),
      gitDir: git(dir, ['rev-parse', '--absolute-git-dir']).trim(),
    };
  } catch (_) { return null; }
}

function baseRef(repo) {
  try { git(repo.top, ['rev-parse', '--verify', '-q', 'HEAD']); return 'HEAD'; } catch (_) { return EMPTY_TREE; }
}

// Replays chained `git add` commands into a scratch copy of the index. Returns the scratch
// index path (caller removes it) or null when there is nothing to replay.
function replayAdds(repo, adds) {
  if (!adds.length) return null;
  const tmp = path.join(os.tmpdir(), `cleanup-gate-${process.pid}-${Date.now()}.index`);
  try { fs.copyFileSync(path.join(repo.gitDir, 'index'), tmp); } catch (_) { /* fresh repo: no index yet */ }
  for (const a of adds) {
    try { git(a.dir, ['add', ...a.args], { GIT_INDEX_FILE: tmp }); } catch (e) { log(`replay add ${a.args.join(' ')}: ${e.message}`); }
  }
  return tmp;
}

function diffs(repo, env) {
  const base = baseRef(repo);
  const opts = ['--no-color', '--no-ext-diff'];
  return {
    cached: git(repo.top, ['diff', '--cached', base, ...opts], env),
    tracked: git(repo.top, ['diff', base, ...opts], env),
  };
}

function codeFilesWithAddedLines(repo, all, env) {
  const base = baseRef(repo);
  const args = all ? ['diff', base, '--numstat'] : ['diff', '--cached', base, '--numstat'];
  const files = [];
  for (const line of git(repo.top, args, env).split('\n')) {
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const added = parseInt(parts[0], 10); // '-' for binary -> NaN -> skipped
    if (!(added > 0)) continue;
    let file = parts.slice(2).join('\t').replace(/\{[^}]* => ([^}]*)\}/g, '$1');
    const arrow = file.lastIndexOf(' => ');
    if (arrow >= 0) file = file.slice(arrow + 4);
    if (CODE_EXT.has(path.extname(file).slice(1).toLowerCase())) files.push(file);
  }
  return files;
}

function markerPath(repo) { return path.join(repo.gitDir, MARKER); }

function readMarker(repo) {
  const m = {};
  try {
    for (const line of fs.readFileSync(markerPath(repo), 'utf8').split('\n')) {
      const [k, v] = line.trim().split(' ');
      if (k && v) m[k] = v;
    }
  } catch (_) { /* no sign-off yet */ }
  return m;
}

function writeMarker(repo, d) {
  fs.writeFileSync(markerPath(repo), `cached ${sha(d.cached)}\ntracked ${sha(d.tracked)}\n`);
}

function reason(repo, c, files) {
  const target = c.all ? 'tracked' : 'staged';
  const diffCmd = c.all ? 'git diff HEAD' : 'git diff --cached';
  const list = files.slice(0, 8).join(', ') + (files.length > 8 ? `, +${files.length - 8} more` : '');
  const steps = [];
  if (c.adds.length) steps.push('Run the git add part of your command by itself first: the whole command was denied, so nothing is staged yet.');
  steps.push(`Invoke the cleanup skill via the Skill tool (skill: "cleanup:cleanup", args: "${target}"). It covers only ${diffCmd} in ${repo.top}.`);
  steps.push('git add every file the pass edited, so the cleaned version is what gets committed.');
  steps.push(`Sign off: node "${fwd(__filename)}" --mark "${repo.top}"`);
  return [
    `CLEANUP GATE: this commit adds source lines in ${files.length} file(s) (${list}) that have not had a cleanup pass. Do these steps in order, then re-run the same commit command:`,
    ...steps.map((s, i) => `${i + 1}. ${s}`),
    'The gate checks before a command runs, so sign off in its own tool call and commit in the next one; a sign-off chained into the commit command is not seen. Any later edit needs another pass. Never sign off without running the pass.',
  ].join('\n');
}

function deny(reasonText) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reasonText,
    },
  }));
}

function mark(dirArg) {
  const dir = nativePath(dirArg || process.cwd());
  const repo = resolveRepo(dir);
  if (!repo) {
    process.stderr.write(`cleanup gate: ${dir} is not inside a git repository\n`);
    process.exit(1);
  }
  const d = diffs(repo);
  writeMarker(repo, d);
  process.stdout.write(`cleanup gate: signed off ${repo.top} (staged ${sha(d.cached).slice(0, 12)}, tracked ${sha(d.tracked).slice(0, 12)})\n`);
}

function hook() {
  let input;
  try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch (_) { return; }
  if (!input || (input.tool_name !== 'Bash' && input.tool_name !== 'PowerShell')) return;
  const command = input.tool_input && input.tool_input.command;
  if (typeof command !== 'string' || !/\bcommit\b/.test(command)) return;
  const c = findCommit(command, nativePath(input.cwd || process.cwd()));
  if (!c || c.dryRun) return;
  const repo = resolveRepo(c.dir);
  if (!repo) return;
  const tmpIndex = replayAdds(repo, c.adds);
  const env = tmpIndex ? { GIT_INDEX_FILE: tmpIndex } : undefined;
  try {
    const files = codeFilesWithAddedLines(repo, c.all, env);
    if (!files.length) return;
    const d = diffs(repo, env);
    const key = c.all ? 'tracked' : 'cached';
    if (readMarker(repo)[key] === sha(d[key])) return;
    deny(reason(repo, c, files));
  } finally {
    if (tmpIndex) { try { fs.unlinkSync(tmpIndex); } catch (_) { /* already gone */ } }
  }
}

const argv = process.argv.slice(2);
try {
  if (argv[0] === '--mark') mark(argv[1]); else hook();
} catch (e) {
  log(`error: ${(e && e.stack) || e}`);
}
