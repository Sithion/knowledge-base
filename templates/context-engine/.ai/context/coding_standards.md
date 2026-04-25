# Coding Standards

## General
- Prefer small, explicit changes over broad refactors.
- Avoid hidden side effects.
- Keep functions focused and testable.
- Write code that reads like documentation.

## Naming Conventions
<!-- Customize per project -->
- Variables: `camelCase` (JS/TS) or `snake_case` (Python)
- Constants: `UPPER_SNAKE_CASE`
- Classes: `PascalCase`
- Files: match language convention

## Error Handling
- Never swallow exceptions silently.
- Use typed/custom errors where appropriate.
- Log errors with sufficient context for debugging.

## Testing
- Every public function should have at least one test.
- Tests should be independent and deterministic.
- Prefer integration tests for critical paths.

## Code Organization
<!-- Describe folder structure conventions, module patterns -->

## Commit Messages
<!-- Describe commit message format -->
