# Coding Standards

<!-- Customize this file with your project's coding standards.
     The reviewer agent loads it during code review via @.sandcastle/CODING_STANDARDS.md
     so these standards are enforced during review without costing tokens during implementation. -->

## Style

- Use camelCase for variables and functions
- Use PascalCase for classes and types
- Use PascalCase for filenames for custom React components, for example: `PageHeader.tsx`; but keep next framework specific filenames as-is, for example: `page.tsx`, `layout.tsx`.
- Use camelCase for filenames for other javascript and typescript files.
- Prefer named exports over default exports

## Testing

- Ensure there are tests for util type functions but no need to add tests for React components
- Use descriptive test names that explain the expected behavior

## Architecture

- Keep modules focused on a single responsibility
- Prefer composition over inheritance
