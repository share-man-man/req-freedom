# AGENTS.md

## Project overview

Req Freedom is a browser request-debugging extension. It is a pnpm workspace monorepo built with Node.js 22, TypeScript, WXT (Manifest V3), React 19, and Rspress.

## Repository layout

- `apps/extension/`: browser extension UI and runtime
- `apps/docs/`: Rspress documentation site
- `packages/shared/`: shared enums, constants, and TypeScript types
- `packages/core/`: platform-independent rule matching and transformation logic
- `fixtures/`: local fixtures and request-lab resources

Keep platform-independent logic in `packages/core`. Put shared contracts in `packages/shared`; do not duplicate those types in apps.

## Environment and package management

- Use the versions pinned in `mise.toml`: Node.js 22.21.1 and pnpm 9.15.9.
- Use pnpm only. Do not create npm or Yarn lockfiles.
- Run commands through `mise exec --` when mise is available.
- Keep internal dependencies on the `workspace:*` protocol.
- Do not edit generated output such as `node_modules/`, `.output/`, or documentation build artifacts.

## Common commands

```bash
mise exec -- pnpm install
mise exec -- pnpm dev
mise exec -- pnpm dev:extension
mise exec -- pnpm dev:lab
mise exec -- pnpm dev:docs
mise exec -- pnpm typecheck
mise exec -- pnpm build
mise exec -- pnpm knip
```

Use filtered commands while iterating when the change is scoped to one workspace, for example:

```bash
mise exec -- pnpm --filter @req-freedom/extension typecheck
mise exec -- pnpm --filter @req-freedom/extension build
mise exec -- pnpm --filter @req-freedom/docs build
```

## Architecture rules

Rules use one of two execution paths:

- **DNR path:** request interception, redirects, query parameters, and header rewriting run through `declarativeNetRequest`.
- **Page-patch path:** static or JavaScript mocks, latency simulation, request-body changes, and script injection run through MAIN-world patches for `fetch` and `XMLHttpRequest`.

Preserve this boundary. Prefer DNR when the browser API supports the behavior. Use page patches only when the network-layer API cannot implement it.

When changing rule contracts:

1. Update the canonical types and constants in `packages/shared`.
2. Update matching or transformation behavior in `packages/core`.
3. Update extension consumers and persistence/migration logic as needed.
4. Update user-facing documentation when behavior or configuration changes.

Code in `packages/core` must remain independent of browser-extension globals and React.

## Coding guidelines

- Follow the existing TypeScript, ESM, React, and naming conventions in nearby files.
- Prefer explicit types at package and browser-context boundaries.
- Keep modules focused; extract reusable rule logic instead of embedding it in UI components.
- Treat content scripts, background/service-worker code, and MAIN-world scripts as separate execution contexts. Use typed messages and serializable data across their boundaries.
- Avoid Node-only APIs in extension runtime code.
- Preserve MV3 constraints, including service-worker suspension and extension CSP.
- Keep UI changes consistent with existing components and styles; reuse established primitives before adding dependencies.
- Add comments for browser limitations, cross-context behavior, or non-obvious compatibility workarounds, not for self-evident code.

## Validation

Before finishing a change:

1. Run type checking for every affected workspace.
2. Run the narrowest relevant build.
3. Run the root `pnpm typecheck` and `pnpm build` for cross-package or release-facing changes.
4. Run `pnpm knip` when adding, removing, or moving exports and dependencies.
5. For extension runtime changes, manually verify the affected flow in the unpacked build at `apps/extension/.output/chrome-mv3/`.

There is no root test script currently. Do not claim automated tests passed unless a relevant test command exists and was run.

## Change discipline

- Keep changes scoped to the requested behavior.
- Do not rewrite unrelated code or generated files.
- Update documentation for user-visible features, changed rule semantics, setup changes, or architectural decisions.
- In the final handoff, list changed files and report the exact validation commands run, including any checks that could not be completed.
