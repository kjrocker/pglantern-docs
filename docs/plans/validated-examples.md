# Plan: validated CLI and curl examples

Goal: every `curl` and `lantern` example in the docs carries a guarantee — the exact command
shown was executed against a real server, and the output block next to it is the captured
output of that run. Validation runs as a repeatable check (pre-deploy/CI) and as a
regeneration step that rewrites output blocks in place.

## Current state (surveyed 2026-07-23)

- ~270 fenced code blocks across the MDX pages; the dense ones are `cli/commands.mdx` (72
  fences), `cookbook.mdx` and `guides/correlation.mdx` (36 each), `guides/search.mdx` (32),
  `getting-started.mdx` (26). They mix four kinds of block: runnable commands, "illustrative
  response" JSON, header/URL snippets, and prose-y pseudo-commands.
- **Existing examples are deprecated content, not a baseline.** The docs predate CLI/API
  stabilization (every CLI example still says `horton`; the binary is `lantern`, config at
  `~/.config/lantern/config.json`). Nothing is worth auditing or reconciling — command
  blocks get re-authored as each page is brought under validation, and the invented
  illustrative JSON (`example.com` data, sender `42`, attachment `1234`, `aaaa…a1` shas)
  gets replaced wholesale by captured output over real archive data.
- The CLI resolves host/key from env (`LANTERN_HOST`, `LANTERN_API_KEY`) before falling back
  to the config file, so CLI examples can run verbatim with environment injection — no
  config-file setup inside example blocks.
- Auth is a non-issue for the harness: it runs as the admin on the unlimited plan (or with
  an override key). The runner needs exactly one working key in its environment — no tier
  logic, no rate-limit accommodation.

## Design

### 1. Annotations on the existing MDX fences (no separate example files)

Authoring stays in MDX. Blocks opt in to validation via fence meta, which Expressive Code
passes through and ignores when unknown (verify in phase 1; if it renders, strip with a tiny
remark plugin):

````
```sh check=search-patches
lantern search patch --sender "Alvaro Herrera" --sort sent_at --json
```

```json output=search-patches
{ ...captured output, written by the harness... }
```
````

Rules:

- `check=<name>` — a runnable block. Name is unique per page. The block body is executed as
  one bash script (`bash -euo pipefail`), so multi-line pipelines, `jq`, `while read` loops,
  and `python3` one-liners are validated as written.
- `output=<name>` — the expected stdout of the named block. Written and rewritten only by
  the harness (`--update` mode); hand edits get overwritten. A `check` block without an
  `output` block is validated for exit status only.
- `check=<name> exit=1` — expected nonzero exit (error-envelope examples: bad key → 401,
  unknown id → 404 with `lantern`'s nonzero exit).
- `check=<name> stderr` — on blocks whose interesting output is stderr (the CLI's cursor
  footer); compares stderr instead of stdout.
- Blocks with no annotation are skipped, but a **lint rule fails the suite** if an
  unannotated `sh`/`bash` block contains `curl` or `lantern` — every command example must be
  either validated or explicitly marked `skip=<reason>` (e.g. the `git clone`/build
  instructions, interactive `login`, pagination "repeat until null" comments).

### 2. One tool, two modes

`scripts/validate-examples.mjs` in this repo (Node, since the repo is already Node; parse
MDX with `unified` + `remark-parse` + `remark-mdx` as devDependencies — fences inside
`<Tabs>` are still plain `code` nodes in the AST):

- `npm run examples:check` — run every `check` block, diff captured output against its
  `output` block byte-for-byte, report failures with a unified diff. Exit nonzero on any
  mismatch. This is the CI/pre-deploy entry point.
- `npm run examples:update` — same run, but rewrite the `output` blocks in place and report
  what changed. Diffs then show up in `git diff` for review, which is the human checkpoint:
  an unexpected output change is either a server regression or an intentional API change.

Runner details (as built):

- Each block runs as `bash -euo pipefail -c`, sequentially (deterministic cursor behavior
  beats speed at this scale), with a fresh temp `$HOME` (no `~/.config/lantern` leakage) and
  a per-block timeout — 30s, overridable with `timeout=<seconds>` on the fence.
- The runner itself requires `DOCS_API_BASE` (the local server, e.g.
  `http://localhost:4002`) and `DOCS_API_KEY` (a valid key on it). pgml-api's
  `scripts/docs-validate.sh` supplies both: it boots a dev server against `horton_docs`,
  builds `lantern` and puts it on `PATH`, then runs the npm script. Both modes take optional
  file arguments to iterate on one page, and `--strict` promotes lint problems (unannotated
  `curl`/`lantern` blocks) to failures — that's the form `prebuild` runs, so a broken or
  unannotated example blocks the build.
- Environment injected into each block: `LANTERN_HOST`, `LANTERN_API_KEY`, `PGLANTERN_KEY`
  (the export name the curl examples settled on), `DOCS_API_BASE`, `HOME`, `LANG=C.UTF-8`,
  and the inherited `PATH`. Nothing else — `jq`/`curl` are whatever the invoking shell has,
  not pinned.
- Base-URL indirection: the literal production base `https://pglantern.com` is replaced with
  `$DOCS_API_BASE` before execution, and mapped back in captured output (the server stamps
  its own base into `html_url`). That symmetric swap is the only rewriting the runner does;
  it's exact-string, documented in the script header, and everything else runs and records
  verbatim.
- Comparison is byte-exact, except for the single trailing newline a fence cannot represent.

### 3. A time-locked corpus: "Postgres as of January 1st, 2026"

Verbatim output comparison needs frozen data, and the docs should show _real_ archive data,
not invented fixtures. Instead of authoring a bespoke seed corpus, freeze the actual one:

- **Definition**: the corpus is the archive's state with a hard cutoff at
  `2026-01-01T00:00:00Z` — mail as the lists received it through December 2025 (the staged
  mbox months _are_ the boundary; audited 2026-07-23, no load-time `sent_at` filter is
  needed — see pgml-api's `corpus-2026.md` §1), git history as the ref-locked snapshot froze
  it; catalog-shaped data (GUCs per major, majors list) as the pipeline produced it at
  cutoff. A natural, explainable boundary: "the state of Postgres on January 1st, 2026."
- **Built once, frozen as a snapshot.** Reproducibility comes from a `pg_dump` artifact, not
  from re-running ingest (ingest assigns serial ids and thread uuids as it goes, so
  re-ingest would shuffle identifiers; a dump freezes them exactly). Input sourcing is
  specified in pgml-api's `corpus-2026.md`: mbox months through `202512` pulled from the
  Hetzner corpus bucket, plus a git snapshot locked at 2026-01-01 (live-mirror drift on
  branch tips and tags is the hazard being locked out). One pipeline load from those inputs
  into `horton_docs`, refresh the matviews, dump. No id/uuid pinning needed anywhere;
  whatever the snapshot contains is by definition stable, and cursors derived from row
  values are stable with it.
- **Regeneration is rare and deliberate**: only when the schema migrates or the cutoff moves
  (e.g. an annual bump to "January 1st, 2027"). Either way it's
  `restore → migrate → re-dump` or a fresh cutoff build, followed by `examples:update` and a
  reviewed diff of every output block. The snapshot date can be surfaced in the docs
  themselves (a one-line note or footer: "examples captured against the archive as of
  2026-01-01"), which also explains to readers why their live results include newer
  messages.
- The dump also carries the harness's admin user + API key (fixed raw key inserted at build
  time), so a restore is fully self-contained: restore, boot, run.
- Because the data is real, examples get authored _from_ the corpus: pick an actual
  interesting thread, a real sha with a `Discussion:` trailer, a real patch series — which
  is better documentation anyway, and clicking through to the live site works.
- Storage: the dump is an artifact of the pgml-api side (not committed to either git repo —
  likely too large; store alongside the other pipeline artifacts / backups). Exact size and
  home decided in phase 2; a trimmed cutoff (e.g. bodies only for referenced threads) is the
  fallback if full-corpus size is unwieldy.

### 4. Orchestration (lives in pgml-api)

A `scripts/docs-validate.sh` wrapper in pgml-api is the one-command entry point: restore the
`horton_docs` snapshot into the podman Postgres (skip if already loaded and schema-current),
boot the server on a dedicated port against it, build `lantern` from the
`sources/horton-cli` submodule (`mise x -- go build`), then invoke `npm run examples:check`
here with `DOCS_API_BASE` and the key exported.

- Locally: run the wrapper before deploying docs; once coverage is full, wire
  `examples:check` into this repo's `prebuild` so a broken example blocks `npm run build`.
- The check needs a live server, so it cannot run inside a plain static-site CI job. The
  guarantee is enforced at deploy time by the wrapper. (Optional later: a scheduled run-only
  smoke against production — `--base https://pglantern.com --exit-only`, no output diffs
  since prod data moves past the cutoff.)

## Phases

**Phase 1 — harness MVP.** `validate-examples.mjs` with extraction, `check`/`skip` lint,
exit-status-only execution, `--update` plumbing. Re-author `getting-started.mdx`'s examples
(`lantern`, current flags) and annotate them; run against a manually started dev server.
Confirm Starlight renders annotated fences unchanged.

**Phase 2 — time-locked corpus.** Build `horton_docs` from `horton_dev` with the 2026-01-01
cutoff, embed the harness key, take the dump, decide where the artifact lives. Write
`scripts/docs-validate.sh`. Re-point getting-started's examples at real corpus entities;
bless outputs with `examples:update`; flip those blocks to full output comparison.

**Phase 3 — full coverage.** ~~Re-author and annotate every legacy page~~ — executed as a
clean sweep instead (2026-07-23): the deprecated pages (`cookbook`, `guides/*`,
`concepts/*`, `cli/*`, `policies/*`) were deleted rather than re-authored, leaving
`getting-started`, the generated OpenAPI reference, and three new corpus-authored example
pages under `examples/` (search, correlation, pagination — the high-drift cursor walkthrough
and error-envelope examples live there). Every command block is `check` or `skip=<reason>`;
the lint rule is a hard failure (`--strict` is baked into `examples:check`), and
`examples:check` runs as `prebuild`. Future pages are written per `docs/authoring.md`, the
standing authoring reference.

**Phase 4 — polish.** Document the annotation format in this repo's AGENTS.md and the
wrapper in pgml-api's AGENTS.md; add the "captured as of 2026-01-01" footer; consider the
scheduled production smoke run.

## Open questions

- ~~Cutoff semantics for cross-cutting entities~~ — resolved: the receipt-time boundary
  decides it. A thread that continues into 2026 appears trimmed to the messages the lists
  received through December 2025; nothing is excluded or filtered.
- Snapshot size: full 770k-message corpus as a dump is likely hundreds of MB compressed —
  fine as a local/backup-stored artifact, but confirm restore time is tolerable in the
  wrapper's inner loop (one-time cost per machine if the restored DB is kept around).
- Interactive `login` stays `skip` — is a scripted variant (`login --with-token < key.txt`)
  worth covering as a hidden validated block (an extractor-visible fence that doesn't
  render)? Leaning yes, defer to phase 3.
- `starlight-openapi` reference pages generate their own examples from the OpenAPI schema;
  out of scope here (the schema is validated server-side by CastAndValidate).
