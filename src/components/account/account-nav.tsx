import Link from "next/link";
import {
  Bell,
  Bookmark,
  FileText,
  Gauge,
  History,
  Rss,
  ShieldCheck,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/shadcn/ui/button";
import { Card, CardContent } from "@/components/shadcn/ui/card";

export type AccountSection =
  | "profile"
  | "security"
  | "trust"
  | "notifications"
  | "topics"
  | "bookmarks"
  | "following"
  | "activity";

const accountSections: Array<{
  value: AccountSection;
  href: string;
  label: string;
  icon: LucideIcon;
}> = [
  { value: "profile", href: "/account", label: "资料与偏好", icon: UserRound },
  { value: "security", href: "/account/security", label: "账号安全", icon: ShieldCheck },
  { value: "trust", href: "/account/trust", label: "信任等级", icon: Gauge },
  { value: "notifications", href: "/account/notifications", label: "通知偏好", icon: Bell },
  { value: "topics", href: "/account/topics", label: "我的主题", icon: FileText },
  { value: "bookmarks", href: "/account/bookmarks", label: "我的收藏", icon: Bookmark },
  { value: "following", href: "/account/following", label: "我的关注", icon: Rss },
  { value: "activity", href: "/account/activity", label: "我的参与", icon: History },
];

export function AccountNav({ active }: { active: AccountSection }) {
  return (
    <Card size="sm" className="mb-5 gap-0 py-2">
      <CardContent className="overflow-x-auto px-2">
        <nav aria-label="账号中心">
          <div className="flex min-w-max items-center gap-1">
            {accountSections.map((section) => {
              const Icon = section.icon;
              const current = active === section.value;
              return (
                <Button
                  asChild
                  className="h-8 px-2.5 text-[13px]"
                  key={section.value}
                  size="sm"
                  variant={current ? "secondary" : "ghost"}
                >
                  <Link href={section.href} aria-current={current ? "page" : undefined}>
                    <Icon data-icon="inline-start" aria-hidden="true" />
                    {section.label}
                  </Link>
                </Button>
              );
            })}
          </div>
        </nav>
      </CardContent>
    </Card>
  );
}
