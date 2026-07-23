#!/usr/bin/env node
// Validate the docs' command examples against a real server.
//
// Every `curl`/`lantern` example in the MDX pages carries a guarantee: the exact
// command shown was executed, and the output block next to it is the captured
// output of that run (docs/plans/validated-examples.md). Blocks opt in via
// fence meta:
//
//   ```sh check=<name>            run the block (bash -euo pipefail); name is
//                                 unique per page
//   ```sh check=<name> exit=1     expect that exit status instead of 0
//   ```sh check=<name> stderr     compare stderr instead of stdout
//   ```sh check=<name> timeout=60 per-block timeout in seconds (default 30)
//   ```json output=<name>         expected output of the named check block;
//                                 written only by --update, never by hand
//   ```sh skip=<reason>           explicitly unvalidated (build instructions,
//                                 interactive login, ...)
//
// Modes:
//   node scripts/validate-examples.mjs [files...]           check (CI entry point)
//   node scripts/validate-examples.mjs --update [files...]  rewrite output blocks in place
//   --strict    lint failures (unannotated curl/lantern blocks) become errors
//
// Environment:
//   DOCS_API_BASE  required — local server base, e.g. http://localhost:4002.
//                  The literal production base `https://pglantern.com` is
//                  replaced with this before execution, and mapped back in
//                  captured output (the server stamps its own base into
//                  html_url). That symmetric swap is the only rewriting the
//                  runner does; everything else runs and records verbatim.
//   DOCS_API_KEY   required — a valid API key on the server; exported to the
//                  blocks as both $HORTON_API_KEY and $LANTERN_API_KEY.
//
// Each block runs sequentially (deterministic cursor behavior) with a fresh
// temp $HOME so no ~/.config/lantern leaks in. Comparison is exact except for
// the single trailing newline a fence cannot represent.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS_DIR = join(ROOT, 'src', 'content', 'docs');
const PROD_BASE = 'https://pglantern.com';
const DEFAULT_TIMEOUT_S = 30;

// --- CLI --------------------------------------------------------------------

const argv = process.argv.slice(2);
const update = argv.includes('--update');
const strict = argv.includes('--strict');
const fileArgs = argv.filter((a) => !a.startsWith('--'));

const apiBase = process.env.DOCS_API_BASE;
const apiKey = process.env.DOCS_API_KEY;
if (!apiBase || !apiKey) {
  console.error('validate-examples: set DOCS_API_BASE (e.g. http://localhost:4002) and DOCS_API_KEY');
  process.exit(2);
}

// --- Fence-meta parsing -----------------------------------------------------

// `check=name exit=1 stderr timeout=60` -> { check: 'name', exit: '1', stderr: true, ... }
function parseMeta(meta) {
  const attrs = {};
  for (const tok of (meta ?? '').trim().split(/\s+/).filter(Boolean)) {
    const eq = tok.indexOf('=');
    if (eq === -1) attrs[tok] = true;
    else attrs[tok.slice(0, eq)] = tok.slice(eq + 1);
  }
  return attrs;
}

function mdxFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...mdxFiles(p));
    else if (/\.mdx?$/.test(entry)) out.push(p);
  }
  return out.sort();
}

const parser = unified().use(remarkParse).use(remarkMdx);

function codeBlocks(tree) {
  const blocks = [];
  (function walk(node) {
    if (node.type === 'code') blocks.push(node);
    for (const child of node.children ?? []) walk(child);
  })(tree);
  return blocks;
}

// --- Collect per-file work --------------------------------------------------

const files = fileArgs.length ? fileArgs.map((f) => resolve(f)) : mdxFiles(DOCS_DIR);

const problems = []; // structural/lint issues found during extraction
const work = []; // { file, checks: [{name, code, attrs, node, outputNode}] }

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const tree = parser.parse(source);
  const blocks = codeBlocks(tree);
  const rel = relative(ROOT, file);

  const checks = new Map();
  const outputs = new Map();

  for (const node of blocks) {
    const attrs = parseMeta(node.meta);
    const line = node.position.start.line;
    if (attrs.check) {
      if (checks.has(attrs.check)) problems.push(`${rel}:${line} duplicate check=${attrs.check}`);
      checks.set(attrs.check, { name: attrs.check, attrs, node });
    } else if (attrs.output) {
      if (outputs.has(attrs.output)) problems.push(`${rel}:${line} duplicate output=${attrs.output}`);
      outputs.set(attrs.output, node);
    } else if (attrs.skip) {
      // explicitly unvalidated
    } else if (['sh', 'bash'].includes(node.lang) && /\b(curl|lantern)\b/.test(node.value)) {
      problems.push(
        `${rel}:${line} unannotated ${node.lang} block runs curl/lantern — add check=<name> or skip=<reason>`,
      );
    }
  }

  for (const [name, node] of outputs) {
    if (!checks.has(name)) {
      problems.push(`${rel}:${node.position.start.line} output=${name} has no matching check block`);
    }
  }
  for (const check of checks.values()) check.outputNode = outputs.get(check.name) ?? null;

  if (checks.size) work.push({ file, rel, checks: [...checks.values()] });
}

// --- Execute ----------------------------------------------------------------

function runBlock(code, timeoutS) {
  const home = mkdtempSync(join(tmpdir(), 'docs-example-'));
  try {
    const script = code.replaceAll(PROD_BASE, apiBase);
    return spawnSync('bash', ['-euo', 'pipefail', '-c', script], {
      timeout: timeoutS * 1000,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        HOME: home,
        LANG: 'C.UTF-8',
        LANTERN_HOST: apiBase,
        LANTERN_API_KEY: apiKey,
        HORTON_API_KEY: apiKey,
        DOCS_API_BASE: apiBase,
      },
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

function unifiedDiff(expected, actual, label) {
  const dir = mkdtempSync(join(tmpdir(), 'docs-diff-'));
  try {
    writeFileSync(join(dir, 'expected'), expected + '\n');
    writeFileSync(join(dir, 'actual'), actual + '\n');
    const res = spawnSync('diff', ['-u', '--label', `${label} (documented)`, '--label', `${label} (captured)`, 'expected', 'actual'], {
      cwd: dir,
      encoding: 'utf8',
    });
    return res.stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

let ran = 0;
let failed = 0;
const rewrites = new Map(); // file -> [{node, text}]

for (const { file, rel, checks } of work) {
  for (const check of checks) {
    const { name, attrs, node, outputNode } = check;
    const timeoutS = Number(attrs.timeout ?? DEFAULT_TIMEOUT_S);
    const expectedExit = Number(attrs.exit ?? 0);
    const res = runBlock(node.value, timeoutS);
    ran += 1;

    const where = `${rel}:${node.position.start.line} [${name}]`;
    if (res.error) {
      failed += 1;
      console.error(`FAIL ${where}: ${res.error.code === 'ETIMEDOUT' ? `timed out after ${timeoutS}s` : res.error.message}`);
      continue;
    }
    if (res.status !== expectedExit) {
      failed += 1;
      console.error(`FAIL ${where}: exit ${res.status}, expected ${expectedExit}`);
      if (res.stderr.trim()) console.error(res.stderr.trimEnd().replace(/^/gm, '  | '));
      continue;
    }

    if (!outputNode) {
      console.log(`ok   ${where} (exit only)`);
      continue;
    }

    // A fence body can't carry a trailing newline; compare modulo exactly one.
    // Map the local base back to the production one (html_url and friends).
    const captured = (attrs.stderr ? res.stderr : res.stdout)
      .replace(/\n$/, '')
      .replaceAll(apiBase, PROD_BASE);
    const documented = outputNode.value;

    if (captured === documented) {
      console.log(`ok   ${where}`);
    } else if (update) {
      if (!rewrites.has(file)) rewrites.set(file, []);
      rewrites.get(file).push({ node: outputNode, text: captured });
      console.log(`UPDATED ${where}`);
    } else {
      failed += 1;
      console.error(`FAIL ${where}: output mismatch`);
      console.error(unifiedDiff(documented, captured, name).replace(/^/gm, '  '));
    }
  }
}

// --- Apply --update rewrites (bottom-up so positions stay valid) -------------

for (const [file, edits] of rewrites) {
  const lines = readFileSync(file, 'utf8').split('\n');
  edits.sort((a, b) => b.node.position.start.line - a.node.position.start.line);
  for (const { node, text } of edits) {
    // Replace the fence interior: keep the ``` lines, swap everything between.
    const start = node.position.start.line; // 1-based opening fence line
    const end = node.position.end.line; // closing fence line
    lines.splice(start, end - 1 - start, ...text.split('\n'));
  }
  writeFileSync(file, lines.join('\n'));
  console.log(`wrote ${relative(ROOT, file)} (${edits.length} output block${edits.length === 1 ? '' : 's'})`);
}

// --- Report -----------------------------------------------------------------

if (problems.length) {
  console.error(`\n${problems.length} lint problem(s)${strict ? '' : ' (warnings; --strict makes them fatal)'}:`);
  for (const p of problems) console.error(`  ${p}`);
}

console.log(`\n${ran} block(s) ran, ${failed} failed${update ? `, ${rewrites.size} file(s) rewritten` : ''}`);
process.exit(failed || (strict && problems.length) ? 1 : 0);
