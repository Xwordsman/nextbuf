import type { ReactNode } from "react";
import { AccountNav, type AccountSection } from "@/components/account/account-nav";

type AccountPageShellProps = {
  active: AccountSection;
  title: string;
  description: string;
  action?: ReactNode;
  children: ReactNode;
};

export function AccountPageShell({
  active,
  title,
  description,
  action,
  children,
}: AccountPageShellProps) {
  return (
    <main className="mx-auto w-full max-w-[980px] px-4 py-8 sm:px-6 lg:py-10">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="grid min-w-0 gap-1.5">
          <h1 className="font-heading text-2xl font-semibold tracking-normal text-foreground">
            {title}
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      <AccountNav active={active} />
      {children}
    </main>
  );
}
