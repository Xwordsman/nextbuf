import { redirect } from "next/navigation";
import { CommunityHome } from "@/components/community/community-home.client";
import type { CommunityFeedFilter } from "@/modules/community/contracts/home-view";
import { getCommunityHomeView } from "@/modules/community/queries.server";
import { getCurrentAccount, getCurrentUserId } from "@/modules/identity/session.server";
import { isInstallationComplete } from "@/modules/installation/installation.server";

type HomeProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function single(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

export default async function Home({ searchParams }: HomeProps) {
  if (!(await isInstallationComplete())) redirect("/setup");
  const params = await searchParams;
  const requestedFilter = single(params.filter);
  const filter: CommunityFeedFilter = ["hot", "essence"].includes(requestedFilter ?? "")
    ? (requestedFilter as CommunityFeedFilter)
    : "latest";
  const viewerId = await getCurrentUserId();
  const [{ view }, account] = await Promise.all([
    getCommunityHomeView({
      filter,
      cursor: single(params.cursor),
      direction: single(params.direction) === "previous" ? "previous" : "next",
      viewerId: viewerId ?? undefined,
    }),
    getCurrentAccount(),
  ]);
  return <CommunityHome view={view} account={account} activeNode={null} filter={filter} />;
}
