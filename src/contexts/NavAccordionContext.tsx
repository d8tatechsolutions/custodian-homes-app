"use client";

import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "keja-nav-open-group";

interface NavAccordionValue {
  openGroup: string | null;
  setOpenGroup: (id: string | null) => void;
}

const NavAccordionContext = createContext<NavAccordionValue | undefined>(undefined);

export const NavAccordionProvider = ({
  role,
  children,
}: {
  role?: string;
  children: ReactNode;
}) => {
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const previousRole = useRef(role);

  useEffect(() => {
    if (previousRole.current !== role) {
      previousRole.current = role;
      setOpenGroup(null);
    } else {
      try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (stored !== null) setOpenGroup(stored);
      } catch {
        setOpenGroup(null);
      }
    }
    setHydrated(true);
  }, [role]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      if (openGroup === null) window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, openGroup);
    } catch {
      /* storage unavailable */
    }
  }, [openGroup, hydrated]);

  return (
    <NavAccordionContext.Provider value={{ openGroup, setOpenGroup }}>
      {children}
    </NavAccordionContext.Provider>
  );
};

export const useNavAccordion = (): NavAccordionValue => {
  const ctx = useContext(NavAccordionContext);
  if (!ctx) throw new Error("useNavAccordion must be used within NavAccordionProvider");
  return ctx;
};
