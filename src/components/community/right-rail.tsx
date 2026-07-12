import { ArrowUpRight, CalendarDays, FileText, MessageCircle } from "lucide-react";
import type {
  CommunityTopicView,
  CommunityUserView,
} from "@/modules/community/contracts/home-view";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";

type RightRailProps = {
  currentUser: CommunityUserView;
  overview: Array<{ label: string; value: string }>;
  topics: CommunityTopicView[];
  onlineMembers: Array<Pick<CommunityUserView, "name" | "avatarUrl" | "initials">>;
};

export function RightRail({ currentUser, overview, topics, onlineMembers }: RightRailProps) {
  const hotTopics = topics.filter((topic) => topic.statuses.includes("hot")).slice(0, 3);

  return (
    <div className="right-rail-content">
      <Panel className="rail-panel">
        <div className="panel-heading">
          <h2>我的状态</h2>
          <span>信任等级</span>
        </div>
        <div className="rail-user">
          <div className="rail-user-head">
            <Avatar className="size-11">
              <AvatarImage src={currentUser.avatarUrl} alt={currentUser.name} />
              <AvatarFallback>{currentUser.initials}</AvatarFallback>
            </Avatar>
            <div>
              <strong>{currentUser.name}</strong>
              <span>@{currentUser.username}</span>
            </div>
            <Badge variant="trust">TL{currentUser.trustLevel}</Badge>
          </div>
          <div className="trust-progress-copy">
            <span>{currentUser.trustName}</span>
            <span>距离 TL{currentUser.nextTrustLevel}</span>
          </div>
          <div
            className="trust-progress"
            role="progressbar"
            aria-label="信任等级进度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={currentUser.trustProgress}
          >
            <span style={{ width: `${currentUser.trustProgress}%` }} />
          </div>
          <div className="user-kpis">
            <span>
              <FileText aria-hidden="true" />
              <strong>{currentUser.topicCount}</strong>
              话题
            </span>
            <span>
              <MessageCircle aria-hidden="true" />
              <strong>{currentUser.replyCount}</strong>
              回复
            </span>
            <span>
              <CalendarDays aria-hidden="true" />
              <strong>{currentUser.joinedDays}</strong>天
            </span>
          </div>
        </div>
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
