import { CommunityHome } from "@/components/community/community-home.client";
import type { CommunityFeedFilter } from "@/modules/community/contracts/home-view";
import { getCommunityHomeView } from "@/modules/community/queries.server";
import { getCurrentAccount } from "@/modules/identity/session.server";

type HomeProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function single(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const requestedFilter = single(params.filter);
  const filter: CommunityFeedFilter = ["hot", "essence"].includes(requestedFilter ?? "")
    ? (requestedFilter as CommunityFeedFilter)
    : "latest";
  const { view } = await getCommunityHomeView({
    filter,
    cursor: single(params.cursor),
    direction: single(params.direction) === "previous" ? "previous" : "next",
  });
  return (
    <CommunityHome
      view={view}
      account={await getCurrentAccount()}
      activeNode={null}
      filter={filter}
    />
  );
}
