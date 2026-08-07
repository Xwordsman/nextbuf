import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccountRouteLoading } from "@/components/account/account-route-loading";
import { CommunityTopicRouteLoading } from "@/components/community/community-route-loading";

describe("route loading boundaries", () => {
  it("keeps the approved three-column topic layout while announcing progress", () => {
    const markup = renderToStaticMarkup(createElement(CommunityTopicRouteLoading));

    expect(markup).toContain('data-testid="topic-route-loading"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("max-w-[var(--layout-max)]");
    expect(markup).toContain("var(--left-column)");
    expect(markup).toContain("var(--right-column)");
    expect(markup).toContain("var(--layout-gap)");
    expect(markup).toContain("正在加载主题内容");
  });

  it("keeps account loading feedback inside the persistent account layout", () => {
    const markup = renderToStaticMarkup(createElement(AccountRouteLoading));

    expect(markup).toContain('data-testid="account-route-loading"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).not.toContain("<main");
    expect(markup).toContain("正在加载账户设置");
  });
});
