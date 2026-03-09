# Test-Driven Development

Follow this workflow strictly for every requirement:

## Workflow

### 1. Red -- Write a Failing Test
- Write a test that captures the next requirement or behavior
- Run the test suite to confirm it fails
- If the test passes without code changes, the test is not testing anything new -- revise it

### 2. Green -- Make It Pass
- Write the minimum code necessary to make the failing test pass
- Do not add functionality beyond what the test requires
- Run the test suite to confirm the new test passes and no existing tests broke

### 3. Refactor -- Clean Up
- Improve code structure, naming, and duplication while keeping all tests passing
- Run the test suite after each refactoring step
- If a test breaks during refactoring, undo the last change and try a smaller step

### 4. Repeat
- Move to the next requirement and start from step 1
- Each cycle should be small -- one behavior at a time

## Rules

- Never write production code without a failing test first
- Never skip the refactor step, even if the code looks fine
- Always report test results inline after each run (number of tests passed/failed/skipped)
- If the test runner is not configured, set it up before starting the TDD cycle
- Commit after each green-refactor cycle with a message describing the behavior added

## Output

After completing all requirements, provide a summary:
- Number of TDD cycles completed
- Final test count (passed/failed/skipped)
- List of behaviors implemented
