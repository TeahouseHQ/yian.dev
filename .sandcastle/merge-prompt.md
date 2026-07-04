# TASK

Land the eligible pull requests using **test-then-merge**. Each branch below has an open
PR (opened by the Implementer) targeting `main` whose body contains `Closes #N`.

Branches (one PR each):

{{BRANCHES}}

Issues:

{{ISSUES}}

# REVIEW GATE — only merge reviewed PRs

A PR is eligible to merge **only if it is ready (not a draft) AND carries the `reviewed`
label**. The Reviewer marks a PR ready and adds `reviewed` once it has been reviewed.

For each branch, check eligibility before doing anything else:

```
gh pr view <branch> --json isDraft,labels
```

Skip any PR that is still a draft or is missing the `reviewed` label — leave it open for
a human and move on to the next branch. Do **not** merge it.

# TEST-THEN-MERGE (per eligible branch)

For each eligible branch above, in order:

1. Merge the branch into your local checkout to validate it:
   `git merge <branch> --no-edit`
2. Run the combined test suite: `pnpm typecheck && pnpm test`.

If the merge is clean (no conflicts) **and** the suite is green, land the PR:

3. `gh pr merge <branch> --merge`

   Use `--merge` (a real merge commit), **not** `--squash`. The merge commit preserves
   the individual `RALPH:` (Implementer) and `RALPH: Review -` (Reviewer) commits on
   `main`, keeping the impl-vs-review distinction in history.

If the merge has conflicts, or anything is red, **do not land it and do not try to
fix it** — the Merger is a landing role, not a fixing role (ADR-0006). First abort
any in-progress merge so your checkout is clean for the next branch:

`git merge --abort` # only if step 1 left conflicts

Then follow the GIVE-UP PATH below so a persistent poller does not re-dispatch
this ready + `reviewed` PR to the Merger every tick.

# GIVE-UP PATH — ESCALATE TO ready-for-human

When test-then-merge fails — the merge has conflicts you cannot cleanly resolve,
or `pnpm typecheck && pnpm test` is red after merging — escalate the PR to a human.
The PR is currently ready + `reviewed`, which is exactly the state a persistent
poller re-dispatches to the Merger every tick; you must durably change GitHub
state or it loops forever. Revert the PR to its pre-review state and apply the
universal terminal label — `ready-for-human`, meaning "out of all Dispatch
buckets; a human owns it":

1. Remove the `reviewed` label (so it leaves the ready-for-merge bucket):

   ```
   gh pr edit <branch> --remove-label reviewed
   ```

2. Revert the PR from ready back to **draft** (so it no longer meets the
   ready-for-merge bucket's non-draft requirement):

   ```
   gh pr ready --undo <branch>
   ```

3. Add the `ready-for-human` label (the orchestrator excludes it from every
   bucket — a human now owns it):

   ```
   gh label create ready-for-human --description "Out of all Dispatch buckets; a human owns it" --color 0052CC || true
   gh pr edit <branch> --add-label ready-for-human
   ```

4. Post a `COMMENT`-type review explaining what failed — the conflict, or the red
   typecheck/test output — so the human has the context:

   ```
   gh pr review <branch> --comment --body "<what failed: conflict or red test output>"
   ```

Do not merge the escalated PR — move on to the next branch.

# CLOSE ISSUES

Each PR body contains `Closes #N`, so merging the PR auto-closes its issue \u2014 you do
**not** need to close those issues manually. If merging an issue completes a parent
issue (such as a PRD), close that parent.

Once you've landed every eligible PR you can (skipping any draft, un-`reviewed`, or
escalated PR), output <promise>COMPLETE</promise>.
