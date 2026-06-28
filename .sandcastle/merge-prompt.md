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
2. If there are merge conflicts, resolve them intelligently by reading both sides and
   choosing the correct resolution.
3. Run the combined test suite: `pnpm typecheck && pnpm test`.
4. **Only if BOTH pass (green)**, land the PR on GitHub:
   `gh pr merge <branch> --merge`

   Use `--merge` (a real merge commit), **not** `--squash`. The merge commit preserves
   the individual `RALPH:` (Implementer) and `RALPH: Review -` (Reviewer) commits on
   `main`, keeping the impl-vs-review distinction in history.

5. If anything is red, fix it before landing. **Nothing red may reach `main`.** Do not
   run `gh pr merge` for a branch whose tests are failing.

# CLOSE ISSUES

Each PR body contains `Closes #N`, so merging the PR auto-closes its issue \u2014 you do
**not** need to close those issues manually. If merging an issue completes a parent
issue (such as a PRD), close that parent.

Once you've landed every eligible PR you can (skipping any draft or un-`reviewed` PR),
output <promise>COMPLETE</promise>.
