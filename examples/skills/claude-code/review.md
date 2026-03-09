# Code Review

Review the specified files or recent changes for:

1. **Logic errors and edge cases** -- off-by-one errors, null/undefined handling, race conditions, incorrect boolean logic
2. **Security vulnerabilities** -- injection (SQL, command, XSS), authentication bypass, data exposure, insecure defaults
3. **Performance issues** -- N+1 queries, unnecessary allocations, blocking operations in async paths, missing indexes
4. **Code style and readability** -- naming clarity, function length, dead code, missing error handling, inconsistent patterns

## Workflow

1. If specific files are provided, review those files
2. If no files are specified, review uncommitted changes via `git diff`
3. If there are no uncommitted changes, review the most recent commit via `git diff HEAD~1`
4. For each finding, note the file, line number (if applicable), and a concrete suggestion

## Output Format

Produce a structured review with severity levels:

- **CRITICAL** -- Must fix before merge. Security issues, data loss risks, correctness bugs.
- **WARNING** -- Should fix. Performance problems, error handling gaps, maintainability concerns.
- **INFO** -- Consider fixing. Style issues, minor improvements, suggestions.

Format each finding as:

```
[SEVERITY] file:line — Description
  Suggestion: How to fix it
```

End with a summary: total findings by severity and an overall assessment (approve, request changes, or needs discussion).
