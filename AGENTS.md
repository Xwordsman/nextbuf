# NextBuf Agent Guide

Before changing code, read `docs/14-project-status-handoff.md`, the current milestone in `docs/09-detailed-development-plan.md`, and the relevant architecture document.

- Current completed milestone: `v0.2.0`; develop only `v0.3.0` next.
- Use Node.js 24, pnpm, Next.js 16.2.10, TypeScript strict mode, and `src/app`.
- Do not create separate top-level frontend/backend projects.
- Keep server code behind `server-only`; client code must not import database, queue, Redis, or secrets.
- Do not implement future milestone features early.
- Preserve the visible `Powered by NextBuf` link required by LICENSE and NOTICE.
- For Next.js behavior, read the matching guide in `node_modules/next/dist/docs/` before relying on older conventions. Next.js 16 uses `proxy.ts`, not `middleware.ts`.
- Update tests and documentation in the same change when contracts change.
