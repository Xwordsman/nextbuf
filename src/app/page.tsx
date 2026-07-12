import { CommunityHome } from "@/components/community/community-home.client";
import { getDemoCommunityHome } from "@/modules/community/demo-home.server";

export default function Home() {
  return <CommunityHome view={getDemoCommunityHome()} />;
}
