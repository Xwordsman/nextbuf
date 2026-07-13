import { communityErrorResponse } from "@/app/api/community/community-response";
import { createCommunityAttachment } from "@/modules/community/attachments.server";
import { getRequestSession } from "@/modules/identity/current-session.server";
import { getAuthEnvironment } from "@/shared/config/runtime-env";
import { hasSameOrigin } from "@/shared/http/same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function markdownLabel(value: string): string {
  return value.replaceAll(/[\\\[\]()]/gu, (character) => `\\${character}`);
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return Response.json({ code: "invalid_origin" }, { status: 403 });
  const session = await getRequestSession(request);
  if (!session) return Response.json({ code: "unauthorized" }, { status: 401 });
  const form = await request.formData();
  const file = form.get("attachment");
  if (!(file instanceof File))
    return Response.json({ code: "invalid_attachment" }, { status: 400 });
  if (file.size < 1 || file.size > getAuthEnvironment().ATTACHMENT_MAX_UPLOAD_BYTES) {
    return Response.json({ code: "attachment_too_large" }, { status: 413 });
  }

  try {
    const attachment = await createCommunityAttachment({
      uploaderId: session.user.id,
      bytes: new Uint8Array(await file.arrayBuffer()),
      declaredType: file.type,
      originalName: file.name,
    });
    const url = `/api/media/attachments/${attachment.id}`;
    const label = markdownLabel(attachment.originalName);
    return Response.json(
      {
        ok: true,
        id: attachment.id,
        url,
        status: attachment.status,
        markdown: attachment.kind === "image" ? `![${label}](${url})` : `[${label}](${url})`,
      },
      { status: 201 },
    );
  } catch (error) {
    return communityErrorResponse(error);
  }
}
