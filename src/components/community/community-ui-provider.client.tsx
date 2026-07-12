"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type CommunityUiContextValue = {
  query: string;
  setQuery: (query: string) => void;
  mobileSearchOpen: boolean;
  setMobileSearchOpen: (open: boolean) => void;
  railOpen: boolean;
  setRailOpen: (open: boolean) => void;
};

const CommunityUiContext = createContext<CommunityUiContextValue | null>(null);

export function CommunityUiProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState("");
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const value = useMemo(
    () => ({
      query,
      setQuery,
      mobileSearchOpen,
      setMobileSearchOpen,
      railOpen,
      setRailOpen,
    }),
    [mobileSearchOpen, query, railOpen],
  );

  return <CommunityUiContext.Provider value={value}>{children}</CommunityUiContext.Provider>;
}

export function useCommunityUi(): CommunityUiContextValue {
  const context = useContext(CommunityUiContext);

  if (!context) {
    throw new Error("useCommunityUi must be used within CommunityUiProvider");
  }

  return context;
}
