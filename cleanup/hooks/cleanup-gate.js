#!/usr/bin/env node
'use strict';
/*
 * PreToolUse hook (Bash|PowerShell) of the cleanup plugin: denies a `git commit`
 * until the cleanup skill has signed off on exactly what is being committed.
 *
 *   node cleanup-gate.js              hook mode, reads the hook's JSON on stdin
 *   node cleanup-gate.js --mark DIR   signs off the repo at DIR
 *
 * The sign-off, <git-dir>/cleanup.ok, holds the sha256 of `git diff --cached`
 * ("cached") and of `git diff HEAD` ("tracked"). A plain commit must match
 * "cached"; `commit -a` or a commit with pathspecs must match "tracked". Commits
 * that add no lines to source files are never gated.
 *
 * Once it has found a commit, a check that fails (git timed out, say) denies it:
 * a gate that lets a commit through whenever git is slow checks nothing.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const MARKER = 'cleanup.ok';
// Not beside this file, which may sit in a repository.
const LOG = path.join(os.homedir(), '.claude', 'cleanup-gate.log');
const IS_MARK = process.argv[2] === '--mark';
// The hook must answer inside the 60 s hooks.json gives it, so a slow git ends
// in a deny, not a killed hook. A sign-off is a tool call, with 2 minutes.
const DEADLINE = Date.now() + (IS_MARK ? 100000 : 50000);
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

function log(message) {
  try { fs.appendFileSync(LOG, `${new Date().toISOString()} ${message}\n`); } catch (_) { /* nowhere to report */ }
}

function sha(text) { return crypto.createHash('sha256').update(text).digest('hex'); }

// Git Bash spells D:\x as /d/x; git.exe spawned from node needs the Windows form.
function nativePath(filePath) {
  if (filePath === '~' || filePath.startsWith('~/')) filePath = os.homedir() + filePath.slice(1);
  const drive = /^\/([a-zA-Z])(\/.*)?$/.exec(filePath);
  return drive ? `${drive[1].toUpperCase()}:${drive[2] || '/'}` : filePath;
}

function git(cwd, args, extraEnv) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    timeout: Math.max(1, DEADLINE - Date.now()),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { GIT_OPTIONAL_LOCKS: '0', GIT_PAGER: 'cat' }, extraEnv || {}),
  });
}

// Null when git exits non-zero. A timeout has no exit status, so it still throws.
function gitOrNull(cwd, args, extraEnv) {
  try {
    return git(cwd, args, extraEnv);
  } catch (e) {
    if (typeof e.status === 'number') return null;
    throw e;
  }
}

// Splits a command line into simple commands (arrays of words). An unquoted
// newline, ; | or & ends one. Backslash is literal except \" inside double
// quotes, so Windows paths survive and a heredoc message stays in its quotes.
function splitCommands(line) {
  const commands = [[]];
  let word = '';
  let quote = null;
  let inWord = false;
  const endWord = () => { if (inWord) commands[commands.length - 1].push(word); word = ''; inWord = false; };
  const endCommand = () => { endWord(); if (commands[commands.length - 1].length) commands.push([]); };
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"' && line[i + 1] === '"') { word += '"'; i++; }
      else word += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; inWord = true; continue; }
    if (ch === '\n' || ch === ';' || ch === '|' || ch === '&') { endCommand(); continue; }
    if (/\s/.test(ch)) { endWord(); continue; }
    word += ch;
    inWord = true;
  }
  endCommand();
  return commands.filter((words) => words.length);
}

// The first `git commit`, with the directory it runs in and the `git add`s chained before it.
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
    let runDir = dir;
    let i = 1;
    for (; i < words.length && words[i].startsWith('-'); i++) {
      if (GIT_OPT_WITH_VALUE.has(words[i])) {
        if (words[i] === '-C' && words[i + 1]) runDir = path.resolve(runDir, nativePath(words[i + 1]));
        i++;
      }
    }
    const subcommand = words[i];
    const rest = words.slice(i + 1);
    if (subcommand === 'add' || subcommand === 'stage') {
      if (rest.some((w) => ADD_INTERACTIVE.has(w))) return null;
      adds.push({ dir: runDir, args: rest });
    } else if (subcommand === 'commit') {
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
      return { dir: runDir, all, dryRun, adds };
    }
  }
  return null;
}

function resolveRepo(dir) {
  if (!fs.existsSync(dir)) return null;
  const top = gitOrNull(dir, ['rev-parse', '--show-toplevel']);
  if (top === null) return null;
  return { top: top.trim(), gitDir: git(dir, ['rev-parse', '--absolute-git-dir']).trim() };
}

function baseRef(repo) {
  return gitOrNull(repo.top, ['rev-parse', '--verify', '-q', 'HEAD']) === null ? EMPTY_TREE : 'HEAD';
}

// The whole command is checked before any of it runs, so its `git add`s are
// replayed into a copy of the index. The caller removes the copy.
function replayAdds(repo, adds) {
  if (!adds.length) return null;
  const scratchIndex = path.join(os.tmpdir(), `cleanup-gate-${process.pid}-${Date.now()}.index`);
  try { fs.copyFileSync(path.join(repo.gitDir, 'index'), scratchIndex); } catch (_) { /* fresh repo: no index yet */ }
  for (const add of adds) {
    if (gitOrNull(add.dir, ['add', ...add.args], { GIT_INDEX_FILE: scratchIndex }) === null) log(`replay add ${add.args.join(' ')} failed`);
  }
  return scratchIndex;
}

function diffs(repo, base, env) {
  const flags = ['--no-color', '--no-ext-diff'];
  return {
    cached: git(repo.top, ['diff', '--cached', base, ...flags], env),
    tracked: git(repo.top, ['diff', base, ...flags], env),
  };
}

function codeFilesWithAddedLines(repo, base, all, env) {
  const args = all ? ['diff', base, '--numstat'] : ['diff', '--cached', base, '--numstat'];
  const files = [];
  for (const line of git(repo.top, args, env).split('\n')) {
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const added = parseInt(parts[0], 10); // a binary file shows '-', which parses to NaN
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
  const signed = {};
  try {
    for (const line of fs.readFileSync(markerPath(repo), 'utf8').split('\n')) {
      const [key, hash] = line.trim().split(' ');
      if (key && hash) signed[key] = hash;
    }
  } catch (_) { /* no sign-off yet */ }
  return signed;
}

function writeMarker(repo, diff) {
  fs.writeFileSync(markerPath(repo), `cached ${sha(diff.cached)}\ntracked ${sha(diff.tracked)}\n`);
}

function reason(repo, commit, files) {
  const target = commit.all ? 'tracked' : 'staged';
  const diffCommand = commit.all ? 'git diff HEAD' : 'git diff --cached';
  const list = files.slice(0, 8).join(', ') + (files.length > 8 ? `, +${files.length - 8} more` : '');
  const steps = [];
  if (commit.adds.length) steps.push('Run the git add part of your command by itself first: the whole command was denied, so nothing is staged yet.');
  steps.push(`Invoke the cleanup skill via the Skill tool (skill: "cleanup:cleanup", args: "${target}"). It covers only ${diffCommand} in ${repo.top}.`);
  steps.push('git add every file the pass edited, so the cleaned version is what gets committed.');
  steps.push(`Sign off: node "${__filename.replace(/\\/g, '/')}" --mark "${repo.top}"`);
  return [
    `CLEANUP GATE: this commit adds source lines in ${files.length} file(s) (${list}) that have not had a cleanup pass. Do these steps in order, then re-run the same commit command:`,
    ...steps.map((step, i) => `${i + 1}. ${step}`),
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
  const diff = diffs(repo, baseRef(repo));
  writeMarker(repo, diff);
  process.stdout.write(`cleanup gate: signed off ${repo.top} (staged ${sha(diff.cached).slice(0, 12)}, tracked ${sha(diff.tracked).slice(0, 12)})\n`);
}

function check(command, cwd) {
  const commit = findCommit(command, nativePath(cwd));
  if (!commit || commit.dryRun) return;
  const repo = resolveRepo(commit.dir);
  if (!repo) return;
  const scratchIndex = replayAdds(repo, commit.adds);
  const env = scratchIndex ? { GIT_INDEX_FILE: scratchIndex } : undefined;
  try {
    const base = baseRef(repo);
    const files = codeFilesWithAddedLines(repo, base, commit.all, env);
    if (!files.length) return;
    const diff = diffs(repo, base, env);
    const key = commit.all ? 'tracked' : 'cached';
    if (readMarker(repo)[key] === sha(diff[key])) return;
    deny(reason(repo, commit, files));
  } finally {
    if (scratchIndex) { try { fs.unlinkSync(scratchIndex); } catch (_) { /* already gone */ } }
  }
}

function hook() {
  let input;
  try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch (_) { return; }
  const command = input && input.tool_input && input.tool_input.command;
  if (typeof command !== 'string' || !/\bcommit\b/.test(command)) return;
  try {
    check(command, input.cwd || process.cwd());
  } catch (e) {
    log(`error: ${(e && e.stack) || e}`);
    deny(`CLEANUP GATE: the gate could not check this command (${e.message}), so it was not run. Run the same command again. If it keeps failing, tell the user: disabling the cleanup plugin turns the gate off.`);
  }
}

if (IS_MARK) {
  try {
    mark(process.argv[3]);
  } catch (e) {
    process.stderr.write(`cleanup gate: sign-off failed: ${e.message}\n`);
    process.exit(1);
  }
} else {
  hook();
}
