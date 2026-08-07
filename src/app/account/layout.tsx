import type { ReactNode } from "react";
import { AccountNav } from "@/components/account/account-nav";

export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-[980px] px-4 py-8 sm:px-6 lg:py-10">
      <AccountNav />
      {children}
    </main>
  );
}
