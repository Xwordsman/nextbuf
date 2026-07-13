import { getAttachmentDelivery } from "@/modules/community/attachments.server";
import { getRequestSession } from "@/modules/identity/current-session.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const attachmentIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function contentDisposition(name: string, inline: boolean): string {
  const fallback = name.replaceAll(/[^\x20-\x7e]/gu, "_").replaceAll(/["\\]/gu, "_");
  return `${inline ? "inline" : "attachment"}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!attachmentIdPattern.test(id)) return new Response("Not found", { status: 404 });
  const session = await getRequestSession(request);
  const delivery = await getAttachmentDelivery(id, session?.user.id);
  if (!delivery) return new Response("Not found", { status: 404 });
  return new Response(delivery.bytes, {
    headers: {
      "Cache-Control": delivery.cacheable
        ? "public, max-age=31536000, immutable"
        : "private, no-store",
      "Content-Disposition": contentDisposition(delivery.fileName, delivery.inline),
      "Content-Type": delivery.contentType,
      "X-Attachment-Status": delivery.status,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
