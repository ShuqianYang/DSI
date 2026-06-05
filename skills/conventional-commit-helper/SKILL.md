---
name: conventional-commit-helper
description: Helps write Conventional Commits messages from git diffs or change summaries. Use when the user asks for a commit message, changelog-style summary, or conventional commit.
argument-hint: "[change summary or git diff focus]"
allowed-tools: Read
---

# Conventional Commit Helper

Use this skill to turn a change summary or inspected diff into a concise Conventional Commits message.

## Process

1. Identify the primary intent of the change.
2. Choose exactly one type unless the user asks for multiple commits.
3. Add a scope only when the touched area is obvious.
4. Write the subject in imperative mood, lowercase after the type, and no trailing period.
5. Add a body only when it explains why the change exists or clarifies important behavior.
6. Add a footer for breaking changes or issue references.

## Format

```text
<type>(<scope>): <subject>

<body>

<footer>
```

## Types

| Type | Use for |
| --- | --- |
| feat | User-visible capability |
| fix | Bug fix |
| docs | Documentation only |
| style | Formatting without behavior change |
| refactor | Internal code change without behavior change |
| perf | Performance improvement |
| test | Tests only |
| build | Build system or dependency changes |
| ci | Continuous integration changes |
| chore | Maintenance |
| revert | Reverting a previous change |

## Output

Return the final commit message first. If there is ambiguity, include up to two alternatives and explain the tradeoff briefly.

## Examples

```text
feat(skills): load repository-root skills from markdown files
```

```text
fix(agent-loop): clear skill tool restrictions after the next turn

Prevents allowed-tools metadata from locking the registry after a skill finishes.
```
