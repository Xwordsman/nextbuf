import { notFound } from "next/navigation";
import { CommunityHome } from "@/components/community/community-home.client";
import type { CommunityFeedFilter } from "@/modules/community/contracts/home-view";
import { CommunityError } from "@/modules/community/errors";
import { getCommunityHomeView } from "@/modules/community/queries.server";
import { getCurrentAccount } from "@/modules/identity/session.server";

type NodePageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function single(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

export default async function NodePage({ params, searchParams }: NodePageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const requestedFilter = single(query.filter);
  const filter: CommunityFeedFilter = ["hot", "essence"].includes(requestedFilter ?? "")
    ? (requestedFilter as CommunityFeedFilter)
    : "latest";
  let result;
  try {
    result = await getCommunityHomeView({
      nodeSlug: slug,
      filter,
      cursor: single(query.cursor),
      direction: single(query.direction) === "previous" ? "previous" : "next",
    });
  } catch (error) {
    if (error instanceof CommunityError && error.status === 404) notFound();
    throw error;
  }
  return (
    <CommunityHome
      view={result.view}
      account={await getCurrentAccount()}
      activeNode={result.activeNode}
      filter={filter}
    />
  );
}
