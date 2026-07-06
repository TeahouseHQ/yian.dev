# Coding Standards

The Reviewer loads this on every review (`@.sandcastle/CODING_STANDARDS.md`) — keep it concise.

## Architecture: pure-logic / imperative-shell seam

- Split each module into a **pure core** (deterministic, dependency-free logic) and a **thin imperative shell** (I/O, process spawning, React/Ink rendering). Logic lives in the core so it can be pinned by tests; the shell stays thin and untested Examples: `cockpit-core.mts` (pure) vs `cockpit.tsx` (Ink shell); `SessionBrowser.tsx` (shell) over its core helpers.
- Keep modules focused on a single responsibility; prefer composition over inheritance. When a behavior is owned by one module (e.g. event rendering lives only in `events.mts`), don't re-implement it elsewhere — call through the seam.
- Use exhaustiveness guards (`never`) on discriminated-union switches so a new variant fails typecheck rather than silently falling through.

## Testing (TDD / red-green-refactor)

- Test the **pure side**. Every module with logic has a co-located `*.test.mts`/`*.test.mjs`; React/Ink components are **not** unit-tested (the shell is deliberately thin). Add or update tests in the same change as the logic.
  - It's okay to write tests for react components during TDD, but no need to include them in the commit.
- Framework is **Vitest** (`describe`/`it`/`expect`, `vi` for mocks). Write descriptive `it(...)` names that state the expected behavior.
- Work test-first where practical: a failing test, then the code to pass it.

## Naming

- `camelCase` for variables and functions; `PascalCase` for types and classes; `SCREAMING_SNAKE_CASE` for module-level constants (`COCKPIT_TABS`, `MAX_ITERATIONS`).
- Filenames: `camelCase`/`kebab` for logic modules (`cockpit-core.mts`, `prune-plan.mts`); `PascalCase.tsx` for React components (`SessionBrowser.tsx`).

## Docs & vocabulary

- Use the **CONTEXT.md glossary** terms verbatim (Transcript, Live feed, Pool, Landing, Poll tick, …) in code, comments, and commit messages. Don't reintroduce the "_Avoid_" synonyms.
- Non-obvious decisions cite their ADR (`docs/adr/NNNN-*.md`); load-bearing comments explain **why**, not what.
