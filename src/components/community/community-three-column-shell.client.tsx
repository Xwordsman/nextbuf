"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { useCommunityUi } from "@/components/community/community-ui-provider.client";
import { Button } from "@/components/shadcn/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/shadcn/ui/sheet";

type CommunityThreeColumnShellProps = {
  leftRail: ReactNode;
  rightRail: ReactNode;
  mobileRightRail: ReactNode;
  children: ReactNode;
  mainLabelledBy: string;
};

export function CommunityThreeColumnShell({
  leftRail,
  rightRail,
  mobileRightRail,
  children,
  mainLabelledBy,
}: CommunityThreeColumnShellProps) {
  const { railOpen, setRailOpen } = useCommunityUi();

  return (
    <main
      className="mx-auto grid w-full max-w-[var(--layout-max)] grid-cols-[var(--left-column)_minmax(0,1fr)_var(--right-column)] items-start gap-[var(--layout-gap)] p-[18px] max-[1100px]:grid-cols-[var(--left-column)_minmax(0,1fr)] max-[860px]:grid-cols-1 max-[860px]:p-3"
      data-testid="community-shell"
    >
      <aside className="min-w-0" data-testid="community-left-rail">
        {leftRail}
      </aside>

      <section className="min-w-0" aria-labelledby={mainLabelledBy} data-testid="community-main">
        {children}
      </section>

      <aside
        className="min-w-0 max-[1100px]:hidden"
        aria-label="社区侧栏"
        data-testid="community-right-rail"
      >
        {rightRail}
      </aside>

      <Sheet open={railOpen} onOpenChange={setRailOpen}>
        <SheetContent
          side="right"
          className="z-[71] w-[min(360px,calc(100vw-24px))] gap-0 overflow-y-auto p-0"
          overlayClassName="z-[70]"
          showCloseButton={false}
          aria-describedby={undefined}
        >
          <SheetClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="absolute top-3 right-3 z-10"
              aria-label="关闭"
            >
              <X aria-hidden="true" />
            </Button>
          </SheetClose>
          <SheetHeader className="border-b pr-12">
            <SheetTitle>我的面板</SheetTitle>
          </SheetHeader>
          <div className="p-4">{mobileRightRail}</div>
        </SheetContent>
      </Sheet>
    </main>
  );
}
