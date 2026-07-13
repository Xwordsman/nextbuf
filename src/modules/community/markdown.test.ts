import { describe, expect, it } from "vitest";
import { renderCommunityMarkdown } from "@/modules/community/markdown.server";

describe("community markdown", () => {
  it("renders GFM and mentions with safe links", () => {
    const html = renderCommunityMarkdown("**加粗** @alice [站外](https://example.com)");
    expect(html).toContain("<strong>加粗</strong>");
    expect(html).toContain('href="/u/alice"');
    expect(html).toContain('rel="nofollow noopener noreferrer"');
  });

  it("drops raw HTML and dangerous protocols", () => {
    const html = renderCommunityMarkdown(
      "<script>alert(1)</script> [危险](javascript:alert(1)) <img src=x onerror=alert(1)>",
    );
    expect(html).not.toContain("script");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("onerror");
  });

  it("only embeds images served by the attachment route", () => {
    const attachment = "10000000-0000-4000-8000-000000000001";
    const html = renderCommunityMarkdown(
      `![内部](/api/media/attachments/${attachment}) ![外部](https://example.com/a.png)`,
    );
    expect(html).toContain(`<img src="/api/media/attachments/${attachment}" alt="内部">`);
    expect(html).not.toContain('<img src="https://example.com');
    expect(html).toContain(">外部</a>");
  });
});
