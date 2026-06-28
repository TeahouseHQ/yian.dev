# TASK

Fix issue #{{ISSUE_NUMBER}}: {{ISSUE_TITLE}}

Pull in the issue using `gh issue view`, with comments. If it has a parent PRD, pull that in too.

Only work on the issue specified.

Work on branch {{BRANCH}}. Make commits, run tests, and open a pull request when done.

# CONTEXT

Here are the last 10 commits:

<recent-commits>

!`git log -n 10 --format="%H%n%ad%n%B---" --date=short`

</recent-commits>

# EXPLORATION

Explore the repo and fill your context window with relevant information that will allow you to complete the task.

Pay extra attention to test files that touch the relevant parts of the code.

# EXECUTION

If applicable, use RGR to complete the task.

1. RED: write one test
2. GREEN: write the implementation to pass that test
3. REPEAT until done
4. REFACTOR the code

# FEEDBACK LOOPS

Before committing, run `pnpm typecheck` and `pnpm test` to ensure the tests pass.

# COMMIT

Make a git commit. The commit message must:

1. Start with `RALPH:` prefix
2. Include task completed + PRD reference
3. Key decisions made
4. Files changed
5. Blockers or notes for next iteration

Keep it concise.

# PUSH AND OPEN A PULL REQUEST

Do this **only if you actually made commits**. If you made zero commits, skip this
section entirely — do not push, and do not open a PR.

If you made commits:

1. Push the branch to origin: `git push -u origin {{BRANCH}}`
2. Open a **draft** pull request targeting `main`. The body MUST contain
   `Closes #{{ISSUE_NUMBER}}` so the issue auto-closes when the PR is merged. Open it as
   a draft — the Reviewer marks it ready once it has been reviewed:

   ```
   gh pr create --draft --base main --head {{BRANCH}} \
     --title "RALPH: #{{ISSUE_NUMBER}} {{ISSUE_TITLE}}" \
     --body "Closes #{{ISSUE_NUMBER}}"
   ```

3. If a PR for this branch already exists, just push your new commits to it — do not
   open a duplicate.

# THE ISSUE

If the task is not complete, leave a comment on the GitHub issue with what was done.

Do not close the issue manually — merging the PR (`Closes #{{ISSUE_NUMBER}}`) closes it.

Once complete, output <promise>COMPLETE</promise>.

# FINAL RULES

ONLY WORK ON A SINGLE TASK.
