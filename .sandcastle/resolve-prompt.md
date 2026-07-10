# TASK

A Landing failed for the reviewed PR on branch {{BRANCH}} (issue #{{ISSUE_NUMBER}}: {{ISSUE_TITLE}}).

The PR was green when it was reviewed, so the failure is an **integration
conflict with `origin/{{BASE_BRANCH}}`** — either a textual `git merge` conflict, or a
clean merge whose suite is now red because something that landed on `main`
since the review interacts badly with this branch.

You are an expert engineer resolving that conflict on the PR branch so it can be
re-reviewed and land.

# CONTEXT

You are already checked out on {{BRANCH}} with the repo installed and built.

<issue>

!`gh issue view {{ISSUE_NUMBER}}`

</issue>

# RESOLUTION PROCESS

1. **Merge `origin/{{BASE_BRANCH}}` INTO this branch** (never the other direction — you fix
   the PR branch, you do not touch `main`). Fetch first so you integrate the
   latest `main`:

   ```
   git fetch origin
   git merge origin/{{BASE_BRANCH}} --no-edit
   ```

2. **Resolve any conflicts and integration breakage.** Prefer the intent of both
   sides: keep this branch's change working while adopting what changed on
   `main`. If `git merge` reports conflicts, edit the conflicted files, then
   `git add` them and `git commit` the merge.

3. **Get the suite green:**

   ```
   {{VERIFY_COMMAND}}
   ```

   Iterate — edit, re-run — until it passes. Keep every original feature,
   output, and behaviour of the issue's change intact; you are integrating it
   with `main`, not rewriting it.

4. **Commit your resolution** with a message starting with `RALPH: Resolve -`
   describing the integration.

5. **Push the resolved branch back to the PR:**

   ```
   git push
   ```

# REPORT YOUR OUTCOME

Your job is **resolve + push + verdict**. You do **not** change any
dispatch-controlling GitHub state — the orchestrator strips the review gate,
reverts the PR to draft for re-review, and handles escalation, acting on the
Outcome you report here. Do not run any `gh` command that adds or removes a
label, marks the PR ready or draft, or merges it.

End your Session with **exactly one** structured Outcome tag on its own line:

- The branch is resolved and pushed — `{{VERIFY_COMMAND}}` passes
  on the merged branch:

  ```
  <outcome>pass</outcome>
  ```

  The orchestrator will strip the review gate and revert the PR to draft so it
  is re-reviewed before it can land again.

- You **cannot resolve the conflict** — after your attempts `{{VERIFY_COMMAND}}`
  is still red, or the integration needs a decision beyond a
  merge-level fix:

  ```
  <outcome>give-up: <one-line reason></outcome>
  ```

If you emit no parseable tag, no state changes and the resolution is retried
against the merge-phase Retry budget.

Once you have pushed and emitted the Outcome tag, output
<promise>COMPLETE</promise>.
