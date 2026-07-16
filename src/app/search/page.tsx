import Link from "next/link";
import { Boxes, MessageSquareText, Search, UserRound } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Panel } from "@/components/ui/panel";
import type { SearchCategory } from "@/infrastructure/search/contracts";
import { searchContent } from "@/infrastructure/search/index.server";

type SearchPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const categories: Array<{ value: SearchCategory; label: string }> = [
  { value: "all", label: "全部" },
  { value: "topics", label: "主题" },
  { value: "members", label: "成员" },
  { value: "nodes", label: "节点" },
];

function single(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

export const metadata = { title: "搜索" };

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const requestedCategory = single(params.category);
  const category = categories.some(({ value }) => value === requestedCategory)
    ? (requestedCategory as SearchCategory)
    : "all";
  const results = await searchContent({ query: single(params.q), category });
  const total = results.topics.length + results.members.length + results.nodes.length;
  const categoryHref = (value: SearchCategory) => {
    const next = new URLSearchParams({ q: results.query });
    if (value !== "all") next.set("category", value);
    return `/search?${next.toString()}`;
  };

  return (
    <main className="search-page">
      <header className="content-page-head">
        <h1>搜索</h1>
        <p>搜索公开主题正文、成员和节点。</p>
      </header>
      <form className="search-page-form" action="/search" role="search">
        <Search aria-hidden="true" />
        <label className="sr-only" htmlFor="search-page-input">
          输入搜索内容
        </label>
        <Input
          id="search-page-input"
          name="q"
          type="search"
          defaultValue={results.query}
          placeholder="至少输入两个字符"
          autoFocus
        />
      </form>

      <nav className="search-categories" aria-label="搜索类型">
        {categories.map((item) => (
          <Link
            key={item.value}
            href={categoryHref(item.value)}
            aria-current={category === item.value ? "page" : undefined}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {results.query.length < 2 ? (
        <Panel className="search-empty">
          <Search />
          <p>输入至少两个字符开始搜索。</p>
        </Panel>
      ) : total === 0 ? (
        <Panel className="search-empty">
          <Search />
          <p>没有找到与“{results.query}”匹配的公开内容。</p>
        </Panel>
      ) : (
        <div className="search-results">
          {results.topics.length > 0 ? (
            <section aria-labelledby="search-topics-title">
              <h2 id="search-topics-title">
                <MessageSquareText /> 主题
              </h2>
              <Panel className="search-result-list">
                {results.topics.map((topic) => (
                  <article key={topic.number}>
                    <div className="search-result-title">
                      <Link href={`/topics/${topic.number}`}>{topic.title}</Link>
                      <Badge>{topic.nodeName}</Badge>
                    </div>
                    <p>{topic.excerpt || "正文暂无可显示摘要。"}</p>
                    <span>
                      @{topic.authorUsername} · {topic.replyCount} 条回复
                    </span>
                  </article>
                ))}
              </Panel>
            </section>
          ) : null}

          {results.members.length > 0 ? (
            <section aria-labelledby="search-members-title">
              <h2 id="search-members-title">
                <UserRound /> 成员
              </h2>
              <Panel className="search-member-list">
                {results.members.map((member) => (
                  <article key={member.username}>
                    <Avatar className="size-10">
                      <AvatarImage src={member.image ?? undefined} alt={member.name} />
                      <AvatarFallback>{member.name.trim().slice(0, 1) || "U"}</AvatarFallback>
                    </Avatar>
                    <div>
                      <Link href={`/u/${member.username}`}>{member.name}</Link>
                      <span>@{member.username}</span>
                      {member.bio ? <p>{member.bio}</p> : null}
                    </div>
                  </article>
                ))}
              </Panel>
            </section>
          ) : null}

          {results.nodes.length > 0 ? (
            <section aria-labelledby="search-nodes-title">
              <h2 id="search-nodes-title">
                <Boxes /> 节点
              </h2>
              <Panel className="search-result-list">
                {results.nodes.map((node) => (
                  <article key={node.slug}>
                    <div className="search-result-title">
                      <Link href={`/nodes/${node.slug}`}>
                        <span className="node-dot" style={{ backgroundColor: node.color }} />
                        {node.name}
                      </Link>
                    </div>
                    <p>{node.description}</p>
                    <span>{node.topicCount} 个公开主题</span>
                  </article>
                ))}
              </Panel>
            </section>
          ) : null}
        </div>
      )}
    </main>
  );
}
