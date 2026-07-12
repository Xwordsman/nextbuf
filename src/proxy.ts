import { NextResponse, type NextRequest } from "next/server";
import { resolveRequestId } from "@/shared/http/request-id";

export function proxy(request: NextRequest) {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.headers.set("x-request-id", requestId);
  response.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https://api.dicebear.com",
      "font-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
    ].join("; "),
  );
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (process.env.NODE_ENV === "production") {
    response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
