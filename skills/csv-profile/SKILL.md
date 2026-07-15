---
name: csv-profile
description: Profiles CSV files by running a bundled Node.js script to report columns, row count, missing values, and sample values. Use when the user asks to inspect CSV data, summarize tabular data, or validate a small dataset.
argument-hint: "[relative/path/to/file.csv]"
allowed-tools: Read, Bash
---

# CSV Profile

Use this skill when the user asks for a quick profile of a CSV file in the workspace.

## Required argument

Pass the CSV path as `$ARGUMENTS`.

## Run the profiler

```!
node "${SKILL_DIR}/scripts/profile-csv.mjs" "$ARGUMENTS"
```

## How to use the result

1. Report the row count and column count.
2. Call out columns with missing values.
3. Mention useful sample values, but do not overfit conclusions from tiny files.
4. If parsing fails, ask for a valid CSV path or inspect the file with `Read`.
