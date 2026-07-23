# Authoring a documentation page

The reference for writing pgLantern docs pages. A prompt like "create documentation using
`docs/authoring.md` about `<feature>`" should need nothing else: follow this file top to
bottom and the result will be a page that renders, validates, and reads like the rest of the
site. The three pages under `src/content/docs/examples/` are the house style — read one
before writing.

## The contract

Every `curl` and `lantern` command shown in these docs carries a guarantee: **the exact
command was executed against a real server, and the output block next to it is the captured
output of that run.** Examples are based on real data that is frozen at January 1st, 2026.

Validation is enforced: an `sh`/`bash` fence containing `curl` or `lantern` that carries no
annotation fails `npm run examples:check` (strict lint), which runs as `prebuild` — a broken
or unannotated example blocks `npm run build`.

## Who you're writing for

A working Postgres user who is comfortable in the terminal. Full profile: `docs/ideal-customer-profile.md` in the pgml-api repo.

Voice rules that follow from it:

- Lead with the endpoint and a runnable command, not an adjective. No "Welcome to", no
  exclamation points, no explaining what a mailing list or a bearer token is.
- Dense, direct, sentence-case headings. Real Postgres vocabulary (`ts_rank_cd`, keyset
  pagination, `Discussion:` trailer) used correctly and without a glossary.
- Concrete and honest about limits: relevance search caps at 200; the API returns metadata,
  not attachment bytes; "free" still requires registration.
- Surface quirks as facts, not apologies (a phantom ref is "data, not an error").

## Where a page goes

- File: `src/content/docs/<area>/<slug>.mdx`. Example-driven feature pages live under
  `examples/`. The OpenAPI reference under `reference/api` is generated — never hand-write
  reference pages.
- Frontmatter: `title` (sentence case, short) and `description` (one line, shows up in
  search and social cards).
- Components: `import { Tabs, TabItem, Aside, Steps } from '@astrojs/starlight/components';`
  Use `<Aside>` for caveats worth a colored box, `<Tabs>` for curl/lantern pairs of the same
  call. Don't overdo either.
- Sidebar: register the page in `astro.config.mjs` under the right group, or it won't appear
  in navigation. Cross-link related pages in prose and in a short `## Next` list at the end.

## Annotating command blocks

The validation harness (`scripts/validate-examples.mjs`) reads fence meta:

````
```sh check=<name>            run the block (bash -euo pipefail); name unique per page
```sh check=<name> exit=1     expect that exit status instead of 0
```sh check=<name> stderr     compare stderr instead of stdout (CLI cursor footers)
```sh check=<name> timeout=60 per-block timeout in seconds (default 30)
```json output=<name>         captured output of the named check block
```sh skip=<reason>           explicitly unvalidated (interactive login, installers)
````

Rules:

- Every `curl`/`lantern` block is either `check=` or `skip=<reason>` — the strict lint
  enforces it.
- Write `output` fences as a one-line stub (`…`); `examples:update` fills them. Never
  hand-edit a captured output block — it will be overwritten.
- A `check` block with no `output` block validates exit status only (use for `<Tabs>`
  variants whose output another block already shows).
- The block body runs as one bash script with `-euo pipefail`, a fresh temp `$HOME`, and a
  30s timeout — multi-line pipelines, `jq`, loops, and `$(...)` capture all work and are
  validated as written.

Environment the harness injects (and the reader is told to set up in getting-started):

- `$HORTON_API_KEY` — put `-H "Authorization: Bearer $HORTON_API_KEY"` on curl examples.
  `lantern` picks up `LANTERN_HOST`/`LANTERN_API_KEY` automatically — no flags needed.
- Base URL: always the literal `https://pglantern.com`. The harness swaps it for the local
  corpus server before running and maps it back in captured output. Any other host string
  will not be rewritten and will fail.

## The corpus: where examples come from

Outputs are captured against `horton_docs` — the archive as the lists received it through
December 2025 ("Postgres as of January 1st, 2026"), frozen as a pg_dump snapshot. Frozen
data is what makes byte-for-byte output comparison and literal cursor values reproducible,
so state it on the page: every example page carries the line "outputs were captured against
the archive as of 2026-01-01" near the top.

Finding good entities is most of the authoring work. Boot the corpus server and explore
before writing a word (from the pgml-api repo):

```
scripts/docs-validate.sh restore          # once per machine, if horton_docs is missing
HORTON_DB_NAME=horton_docs PORT=4002 mix phx.server   # throwaway exploration server
```

Then probe with `curl`/`jq` (key: see `scripts/docs-validate.sh`), the CLI
(`LANTERN_HOST=http://localhost:4002 lantern …`), or SQL against `horton_docs` directly
(port 5433). Pick entities that carry a story — a thread that landed a commit, a GUC whose
default changed, a patch series from a name the reader knows. Recognizable hackers and
recent (2025) traffic beat random rows. Verify a candidate command's output looks good
*before* enshrining it in the page.

Keep captured outputs small and legible — project with `jq` (`.data[] | {subject, sent_at}`,
`@tsv` for row-shaped results, `jq -c` for one-object-per-line) rather than dumping full
envelopes. A docs page is not a schema dump; the OpenAPI reference covers exhaustive shapes.
Show error envelopes by running the failing request without `curl -f` (exit stays 0, the
envelope prints); reserve `exit=1` for CLI commands that exit nonzero.

Things the frozen corpus makes safe that would otherwise be malpractice:

- Hardcoding a cursor from one output block into the next command (the pagination
  walkthrough does exactly this).
- Quoting exact totals and message counts in prose next to a captured block — but remember
  prose is *not* validated; any number or claim in prose must be double-checked against the
  captured output it sits beside.

## Workflow

1. Explore the corpus; choose entities and draft the commands (run each one by hand first).
2. Write the page: annotated command fences, `…` stubs in `output` fences, prose around
   them.
3. Register the page in `astro.config.mjs`.
4. From pgml-api: `scripts/docs-validate.sh update` — boots the corpus server, builds
   `lantern`, runs every block, rewrites the stubs with captured output.
5. Review the `git diff` — the captured outputs are part of the page; read them as content.
   Fix prose that disagrees with what was actually captured.
6. `scripts/docs-validate.sh check` (or `npm run build`, which validates via `prebuild`) —
   must be green, including the strict lint.

Both `docs-validate.sh` modes and `npm run examples:check`/`examples:update` accept file
arguments (relative to the horton-docs repo) to iterate on one page without re-running the
whole suite.

## Checklist

- [ ] Frontmatter `title` + `description`; page registered in the sidebar.
- [ ] "Captured as of 2026-01-01" line near the top.
- [ ] Every command block `check=` or `skip=<reason>`; names unique; base URL is
      `https://pglantern.com`; auth via `$HORTON_API_KEY`.
- [ ] Outputs captured by `examples:update`, not typed; `jq`-projected to stay small.
- [ ] Prose claims match the captured outputs they sit next to.
- [ ] Cross-links to related pages plus a `## Next` list; no links to deleted pages.
- [ ] `scripts/docs-validate.sh check` green.
