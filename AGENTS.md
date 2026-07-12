# NextBuf Agent Guide

Before changing code, read `docs/14-project-status-handoff.md`, the current milestone in `docs/09-detailed-development-plan.md`, and the relevant architecture document.

- Current completed milestone: `v0.4.0`; develop only `v0.5.0` next.
- Better Auth owns authentication. Do not replace its password, session, verification, OAuth, or Cookie behavior without a superseding ADR and migration plan.
- The current community topics, nodes, overview, hot topics, and online members are a read-only demo ViewModel. Do not turn them into fake persistence.
- Real identity currently contains only name, email, verification state, accounts, and sessions. UID, `@username`, profile, avatar uploads, trust levels, and public member pages belong to `v0.5.0`.
- Preserve the approved layout contract: max width 1380px, desktop columns 230px and 300px, and 16px gaps.
- Use Node.js 24, pnpm, Next.js 16.2.10, TypeScript strict mode, and `src/app`.
- Do not create separate top-level frontend/backend projects.
- Keep server code behind `server-only`; client code must not import database, queue, Redis, or secrets.
- Do not implement future milestone features early.
- Preserve the visible `Powered by NextBuf` link required by LICENSE and NOTICE.
- For Next.js behavior, read the matching guide in `node_modules/next/dist/docs/` before relying on older conventions. Next.js 16 uses `proxy.ts`, not `middleware.ts`.
- Update tests and documentation in the same change when contracts change.
