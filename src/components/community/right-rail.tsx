import Link from "next/link";
import { ArrowUpRight, LogIn, ShieldCheck, UserPlus } from "lucide-react";
import type {
  CommunityTopicView,
  CommunityUserView,
} from "@/modules/community/contracts/home-view";
import type { CurrentAccountView } from "@/modules/identity/session.server";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";

type RightRailProps = {
  account: CurrentAccountView | null;
  overview: Array<{ label: string; value: string }>;
  topics: CommunityTopicView[];
  onlineMembers: Array<Pick<CommunityUserView, "name" | "avatarUrl" | "initials">>;
};

export function RightRail({ account, overview, topics, onlineMembers }: RightRailProps) {
  const hotTopics = topics.filter((topic) => topic.statuses.includes("hot")).slice(0, 3);

  return (
    <div className="right-rail-content">
      <Panel className="rail-panel">
        <div className="panel-heading">
          <h2>{account ? "账号状态" : "加入社区"}</h2>
          {account?.emailVerified ? <Badge variant="trust">已验证</Badge> : null}
        </div>
        {account ? (
          <div className="rail-user">
            <div className="rail-user-head">
              <Avatar className="size-11">
                <AvatarImage src={account.image ?? undefined} alt={account.name} />
                <AvatarFallback>{account.initials}</AvatarFallback>
              </Avatar>
              <div>
                <strong>{account.name}</strong>
                <span>
                  @{account.username} · UID {account.uid}
                </span>
              </div>
            </div>
            <Button asChild variant="outline" className="rail-account-action">
              <Link href="/account">
                <ShieldCheck /> 账号中心
              </Link>
            </Button>
          </div>
        ) : (
          <div className="rail-auth-actions">
            <Button asChild>
              <Link href="/auth/sign-in">
                <LogIn /> 登录
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/auth/sign-up">
                <UserPlus /> 注册
              </Link>
            </Button>
          </div>
        )}
      </Panel>

      <Panel className="rail-panel">
        <div className="panel-heading">
          <h2>社区概览</h2>
          <span>今日</span>
        </div>
        <div className="overview-grid">
          {overview.map((item) => (
            <div key={item.label}>
              <strong>{item.value}</strong>
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel className="rail-panel">
        <div className="panel-heading">
          <h2>今日热议</h2>
        </div>
        <div className="hot-topic-list">
          {hotTopics.map((topic, index) => (
            <a href={`#topic-${topic.id}`} key={topic.id}>
              <span>{index + 1}</span>
              <strong>{topic.title}</strong>
              <ArrowUpRight aria-hidden="true" />
            </a>
          ))}
        </div>
      </Panel>

      <Panel className="rail-panel">
        <div className="panel-heading">
          <h2>在线成员</h2>
          <span>96 在线</span>
        </div>
        <div className="online-members" aria-label="在线成员">
          {onlineMembers.map((member) => (
            <Avatar className="size-9" key={member.name} title={member.name}>
              <AvatarImage src={member.avatarUrl} alt={member.name} />
              <AvatarFallback>{member.initials}</AvatarFallback>
            </Avatar>
          ))}
        </div>
      </Panel>
    </div>
  );
}
