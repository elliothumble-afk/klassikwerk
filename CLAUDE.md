# Operating rules for coding agents in this repo

Short, enforceable guardrails that apply to every session, not just
the one that first wrote them. Keep this list tight — if it grows
past a page, something isn't working.

## Data hygiene

**Only verify against `Test*` customers.** Never add, remove, or
edit a line on a real customer's quote, build, purchase order, or
media record to prove a feature works. Use (or seed) a customer
whose `customers.full_name` starts with `Test` instead.

Read-only queries against real records — SELECTing counts, listing
line items for a diff report, rasterising an already-rendered PDF —
are always fine. The rule is about writes.

If the scenario you need to test doesn't exist on any `Test*`
customer yet, ask the operator to seed one (or confirm it's OK to
create) before writing anything.

> Enforcement: if you're about to call Supabase `insert` / `update`
> / `delete` / `rpc` on `quotes`, `quote_options`,
> `quote_option_finishes`, `builds`, `build_options`,
> `purchase_orders`, `purchase_order_lines`, or `media`, stop and
> resolve the row's customer first. Abort if the name doesn't
> start with `Test`.

**Never invent contact details.** Addresses, phone numbers, emails
on customer-facing records come from the user or the DB. If a value
isn't known, leave it empty and say so — don't fabricate a
plausible-looking one. (A PO ship-to with a made-up address ships
to the wrong place.)

## Branches, PRs, migrations

- One PR per logical change. Branch from `main`.
- Supabase migrations go in `supabase/migrations/` with the
  `YYYYMMDDHHMM_` prefix. Idempotent where possible
  (`on conflict do nothing`, `do $$ ... $$`).
- Don't skip hooks (`--no-verify`) or amend merged commits.
- `main` is the default base; the merge base must match
  `origin/main` before pushing.

## Memory

Agent-level memory lives at
`/Users/elliothumble/.claude/projects/-Users-elliothumble-klassikwerk/memory/`.
Durable rules the operator wants enforced across sessions belong in
this file too — memory alone is session-local; CLAUDE.md is the
version-controlled contract.
