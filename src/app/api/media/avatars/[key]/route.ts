import { readAvatar } from "@/infrastructure/storage/avatar-storage";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ key: string }> }) {
  const { key } = await context.params;
  const avatar = await readAvatar(key);
  if (!avatar) return new Response("Not found", { status: 404 });
  return new Response(avatar.bytes, {
    headers: {
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Type": avatar.contentType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
