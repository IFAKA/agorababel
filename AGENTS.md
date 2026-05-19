# Repository Guidelines

## Project Structure & Module Organization

This is a Vite React prototype for the AgoraBabel SaaS demo. The app entry point is `src/main.tsx`, which renders `src/app/App.tsx`. Screen-level components live in `src/app/components/` (`LandingScreen.tsx`, `ProcessingScreen.tsx`, `MarketScreen.tsx`), product-specific shared components live alongside them (`AgentStep.tsx`, `DemoPanels.tsx`), shared UI primitives live in `src/app/components/ui/`, and demo fixture data lives in `src/app/mockDemoData.ts`. Global styles are split under `src/styles/`; import through `src/styles/index.css`. Static build output is generated in `dist/` and should not be edited by hand.

## Build, Test, and Development Commands

- `pnpm install` or `npm install`: install dependencies. The lockfile is `pnpm-lock.yaml`, so prefer pnpm when possible.
- `pnpm dev` or `npm run dev`: start the Vite development server.
- `pnpm build` or `npm run build`: create the production build in `dist/`.

There is no configured lint, format, or test script in `package.json` yet. If you add one, document it here and keep it runnable from the repository root.

## Coding Style & Naming Conventions

Use TypeScript and React function components. Name components in PascalCase (`MarketScreen.tsx`) and hooks/utilities in camelCase. Keep shared, reusable primitives in `src/app/components/ui/`; keep product-specific screen logic and demo panels outside that folder. Prefer the `@` alias for imports from `src` when it improves readability, and keep relative imports for nearby files. Existing files use semicolons, single quotes in most app code, and Tailwind utility classes for layout and visual styling. Use `lucide-react` for icons and `motion/react` for animated transitions, respecting reduced-motion behavior for workflow and layout animations.

## Testing Guidelines

No test script is currently configured in `package.json`. For behavior changes, manually verify the relevant flow with `pnpm dev` and run `pnpm build` before submitting. `transition-check.spec.js` is an ad hoc Playwright smoke check for workflow transitions, URLs, mobile layout, and reduced motion; if you rely on it, run it explicitly against a local dev server and document the command you used. If adding tests, colocate them near the code as `*.test.ts` or `*.test.tsx`, and prefer Vitest plus React Testing Library for unit/component coverage that matches the Vite stack.

## Commit & Pull Request Guidelines

This checkout does not include Git history, so no repository-specific commit convention can be inferred. Use concise, imperative commit subjects such as `Add market reset state` or `Fix processing screen layout`. Pull requests should include a short summary, validation steps performed, linked issue or task context when available, and screenshots or short recordings for visible UI changes.

## Configuration & Agent Notes

The Vite config includes a custom `figma:asset/` resolver that maps to `src/assets`; preserve this behavior if adding assets. Keep React and Tailwind Vite plugins enabled, as noted in `vite.config.ts`. Raw imports are configured for SVG and CSV assets only; do not add `.css`, `.tsx`, or `.ts` to `assetsInclude`.
