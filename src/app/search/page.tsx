import Link from "next/link";
import { Boxes, MessageSquareText, Search, UserRound } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/shadcn/ui/avatar";
import { Badge } from "@/components/shadcn/ui/badge";
import { Button } from "@/components/shadcn/ui/button";
import { Card, CardContent } from "@/components/shadcn/ui/card";
import { Input } from "@/components/shadcn/ui/input";
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
    <main className="mx-auto min-h-[52vh] w-full max-w-[980px] px-4 py-8 sm:px-6 lg:py-10">
      <header className="mb-6 grid gap-1.5">
        <h1 className="font-heading text-2xl font-semibold tracking-normal text-foreground">
          搜索
        </h1>
        <p className="text-sm leading-6 text-muted-foreground">搜索公开主题正文、成员和节点。</p>
      </header>

      <form className="relative" action="/search" role="search">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
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
          className="h-11 pl-9 text-sm"
        />
      </form>

      <nav className="my-4 flex gap-1 overflow-x-auto py-0.5" aria-label="搜索类型">
        {categories.map((item) => (
          <Button
            asChild
            key={item.value}
            size="sm"
            variant={category === item.value ? "secondary" : "ghost"}
          >
            <Link
              href={categoryHref(item.value)}
              aria-current={category === item.value ? "page" : undefined}
            >
              {item.label}
            </Link>
          </Button>
        ))}
      </nav>

      {results.query.length < 2 ? (
        <Card>
          <CardContent className="grid min-h-56 place-items-center content-center gap-3 px-5 py-10 text-center text-muted-foreground">
            <Search className="size-7" aria-hidden="true" />
            <p className="text-sm">输入至少两个字符开始搜索。</p>
          </CardContent>
        </Card>
      ) : total === 0 ? (
        <Card>
          <CardContent className="grid min-h-56 place-items-center content-center gap-3 px-5 py-10 text-center text-muted-foreground">
            <Search className="size-7" aria-hidden="true" />
            <p className="text-sm">没有找到与“{results.query}”匹配的公开内容。</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6">
          {results.topics.length > 0 ? (
            <section className="grid gap-2.5" aria-labelledby="search-topics-title">
              <h2
                id="search-topics-title"
                className="flex items-center gap-2 text-sm font-medium text-foreground"
              >
                <MessageSquareText className="size-4 text-muted-foreground" aria-hidden="true" />{" "}
                主题
              </h2>
              <Card className="gap-0 py-0">
                <CardContent className="p-0">
                  {results.topics.map((topic) => (
                    <article
                      className="border-b px-5 py-4 last:border-b-0 sm:px-6"
                      key={topic.number}
                    >
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <Link
                          className="min-w-0 break-words text-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                          href={`/topics/${topic.number}`}
                        >
                          {topic.title}
                        </Link>
                        <Badge variant="secondary" className="rounded-md">
                          {topic.nodeName}
                        </Badge>
                      </div>
                      <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                        {topic.excerpt || "正文暂无可显示摘要。"}
                      </p>
                      <span className="mt-2 block text-xs text-muted-foreground">
                        @{topic.authorUsername} · {topic.replyCount} 条回复
                      </span>
                    </article>
                  ))}
                </CardContent>
              </Card>
            </section>
          ) : null}

          {results.members.length > 0 ? (
            <section className="grid gap-2.5" aria-labelledby="search-members-title">
              <h2
                id="search-members-title"
                className="flex items-center gap-2 text-sm font-medium text-foreground"
              >
                <UserRound className="size-4 text-muted-foreground" aria-hidden="true" /> 成员
              </h2>
              <Card className="gap-0 py-0">
                <CardContent className="p-0">
                  {results.members.map((member) => (
                    <article
                      className="grid grid-cols-[40px_minmax(0,1fr)] items-start gap-3 border-b px-5 py-4 last:border-b-0 sm:px-6"
                      key={member.username}
                    >
                      <Avatar size="lg">
                        <AvatarImage src={member.image ?? undefined} alt={member.name} />
                        <AvatarFallback>{member.name.trim().slice(0, 1) || "U"}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <Link
                          className="block truncate text-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                          href={`/u/${member.username}`}
                        >
                          {member.name}
                        </Link>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          @{member.username}
                        </span>
                        {member.bio ? (
                          <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                            {member.bio}
                          </p>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </CardContent>
              </Card>
            </section>
          ) : null}

          {results.nodes.length > 0 ? (
            <section className="grid gap-2.5" aria-labelledby="search-nodes-title">
              <h2
                id="search-nodes-title"
                className="flex items-center gap-2 text-sm font-medium text-foreground"
              >
                <Boxes className="size-4 text-muted-foreground" aria-hidden="true" /> 节点
              </h2>
              <Card className="gap-0 py-0">
                <CardContent className="p-0">
                  {results.nodes.map((node) => (
                    <article className="border-b px-5 py-4 last:border-b-0 sm:px-6" key={node.slug}>
                      <Link
                        className="flex w-fit min-w-0 items-center gap-2 text-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                        href={`/nodes/${node.slug}`}
                      >
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: node.color }}
                          aria-hidden="true"
                        />
                        {node.name}
                      </Link>
                      <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                        {node.description}
                      </p>
                      <span className="mt-2 block text-xs text-muted-foreground">
                        {node.topicCount} 个公开主题
                      </span>
                    </article>
                  ))}
                </CardContent>
              </Card>
            </section>
          ) : null}
        </div>
      )}
    </main>
  );
}
