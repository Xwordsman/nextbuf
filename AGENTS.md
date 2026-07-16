# NextBuf Agent Guide

Before changing code, read `docs/14-project-status-handoff.md`, the current milestone in `docs/09-detailed-development-plan.md`, and the relevant architecture document.

- Current completed milestone: `v0.8.0`; develop only `v0.9.0` next.
- Better Auth owns authentication. Do not replace its password, session, verification, OAuth, or Cookie behavior without a superseding ADR and migration plan.
- Nodes, topics, posts, revisions, mentions, attachments and member/topic/reply overview counts are real PostgreSQL data. Online-member tracking is not implemented; keep it at an explicit empty state instead of inventing demo activity.
- Real identity includes immutable UID, `@username`, permanent aliases, profile, local avatars, privacy settings, public member pages, and cancellable deletion requests. Follow ADR-0009; `TL0` is only an initial display value, while persisted trust calculations remain in `v0.10.0`.
- Real community data includes Node, Topic, position=1 first posts, stable-position replies, revisions, mentions, attachment references, role assignments and audit events. Public topic URLs use immutable numeric topic numbers; topic and first Post are created in one transaction.
- Replies, Markdown and attachments follow ADR-0010. Markdown source is authoritative, rendering is sanitized on the server, and attachment collection must preserve current, revision and draft references.
- Interactions, search and discovery follow ADR-0011. PostgreSQL owns likes, bookmarks, follows, reading state and accepted view buckets; Worker aggregation owns derived view counts; hot score remains computed; search visibility must match public content rules.
- `v0.9.0` adds notifications, preferences, notification email delivery, scheduling and Worker operations. Do not implement governance workflows, admin pages or trust calculations early.
- Preserve the approved layout contract: max width 1380px, desktop columns 230px and 300px, and 16px gaps.
- Use Node.js 24, pnpm, Next.js 16.2.10, TypeScript strict mode, and `src/app`.
- Do not create separate top-level frontend/backend projects.
- Keep server code behind `server-only`; client code must not import database, queue, Redis, or secrets.
- Do not implement future milestone features early.
- Preserve the visible `Powered by NextBuf` link required by LICENSE and NOTICE.
- For Next.js behavior, read the matching guide in `node_modules/next/dist/docs/` before relying on older conventions. Next.js 16 uses `proxy.ts`, not `middleware.ts`.
- Update tests and documentation in the same change when contracts change.
