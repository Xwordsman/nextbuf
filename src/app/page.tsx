import { CommunityHome } from "@/components/community/community-home.client";
import { getDemoCommunityHome } from "@/modules/community/demo-home.server";
import { getCurrentAccount } from "@/modules/identity/session.server";

export default async function Home() {
  return <CommunityHome view={getDemoCommunityHome()} account={await getCurrentAccount()} />;
}
