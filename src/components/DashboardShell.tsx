"use client";

import type { LucideIcon } from "lucide-react";
import { ChevronDown, LogOut, Menu } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { findGroupForPath, groupNavItems } from "@/config/dashboardNav";
import { useNavAccordion } from "@/contexts/NavAccordionContext";
import { useAuth } from "@/hooks/use-auth";
import { useReleaseFlags } from "@/hooks/use-fx";
import { BRAND } from "@/lib/brand";
import type { ReleaseFlags } from "@/lib/feature-flags";
import { cn } from "@/lib/utils";
import { Logo } from "./Logo";
import { NotificationsBell } from "./NotificationsBell";
import { SearchBar } from "./SearchBar";
import { ThemeToggle } from "./ThemeToggle";

export interface DashNavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  group?: string;
  /** Only shown when this release flag is on (see `lib/feature-flags.ts`). */
  releaseFlag?: keyof ReleaseFlags;
}

interface Props {
  roleName: string;
  nav: DashNavItem[];
  title: string;
  subtitle?: string;
  children: ReactNode;
}

type Surface = "desktop" | "mobile";

export const DashboardShell = ({
  roleName: roleNameProp,
  nav: allNav,
  title,
  subtitle,
  children,
}: Props) => {
  const { flags } = useReleaseFlags();
  const nav = useMemo(
    () => allNav.filter((item) => !item.releaseFlag || flags[item.releaseFlag]),
    [allNav, flags],
  );
  const pathname = usePathname();
  const router = useRouter();
  const { signOut, user } = useAuth();
  // A caretaker the owner marked as their managing agent is shown as "Agent".
  const roleName =
    roleNameProp === "Caretaker" && user?.role === "caretaker" && user.staffTitle === "agent"
      ? "Agent"
      : roleNameProp;
  const { openGroup, setOpenGroup } = useNavAccordion();
  const [mobileOpen, setMobileOpen] = useState(false);

  const groups = groupNavItems(nav);
  const ungrouped = nav.filter((item) => !item.group);

  const previousOpen = useRef<string | null>(openGroup);
  const lastPathname = useRef<string | null>(null);
  const triggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const panelRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    if (lastPathname.current === pathname) return;
    lastPathname.current = pathname;
    const activeGroup = findGroupForPath(groupNavItems(nav), pathname);
    if (activeGroup) setOpenGroup(activeGroup);
  }, [pathname, nav, setOpenGroup]);

  useEffect(() => {
    const previous = previousOpen.current;
    if (previous && previous !== openGroup) {
      for (const surface of ["desktop", "mobile"] as const) {
        const prefix = `${surface}-${previous}-`;
        for (const key of Object.keys(panelRefs.current)) {
          if (!key.startsWith(prefix)) continue;
          const panel = panelRefs.current[key];
          const trigger = triggerRefs.current[key];
          if (panel && trigger && panel.contains(document.activeElement)) trigger.focus();
        }
      }
    }
    previousOpen.current = openGroup;
  }, [openGroup]);

  const handleSignOut = () => {
    try {
      sessionStorage.setItem("keja-return-to", pathname);
    } catch {
      /* ignore */
    }
    try {
      signOut();
      toast.success("Signed out successfully", {
        description: "Your session has ended.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "An unexpected error occurred";
      toast.error("Sign out failed", {
        description: message,
      });
    } finally {
      router.push("/");
    }
  };

  const isActive = (to: string) => {
    const isRoot = /^\/dashboard\/[^/]+$/.test(to);
    return isRoot ? pathname === to : pathname === to || pathname.startsWith(`${to}/`);
  };

  const toggleGroup = (id: string) => {
    setOpenGroup(openGroup === id ? null : id);
  };

  const renderItem = (item: DashNavItem, onNavigate?: () => void) => {
    const active = isActive(item.to);
    const Icon = item.icon;
    return (
      <Link
        key={`${item.to}-${item.label}`}
        href={item.to}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
          active
            ? "bg-primary text-primary-foreground shadow-soft"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <Icon className="h-4 w-4" />
        {item.label}
      </Link>
    );
  };

  const navList = (onNavigate?: () => void, surface: Surface = "desktop") => (
    <nav aria-label={`${roleName} navigation`} className="flex flex-col gap-1">
      {ungrouped.map((item) => renderItem(item, onNavigate))}
      {groups.map((group, index) => {
        const key = `${surface}-${group.id}-${index}`;
        const panelId = `${key}-panel`;
        const isOpen = openGroup === group.id;
        const GroupIcon = group.icon;
        return (
          <div key={key} className="flex flex-col">
            <button
              ref={(node) => {
                triggerRefs.current[key] = node;
              }}
              type="button"
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => toggleGroup(group.id)}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-all",
                isOpen
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {GroupIcon ? <GroupIcon className="h-4 w-4" /> : null}
              <span className="flex-1">{group.label}</span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 shrink-0 transition-transform duration-200",
                  isOpen && "rotate-180",
                )}
                aria-hidden="true"
              />
            </button>
            <section
              ref={(node) => {
                panelRefs.current[key] = node;
              }}
              id={panelId}
              aria-label={group.label}
              inert={!isOpen}
              className={cn(
                "grid transition-all duration-200 ease-out",
                isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
              )}
            >
              <div className="overflow-hidden">
                <div className="flex flex-col gap-1 py-1 pl-3">
                  {group.items.map((item) => renderItem(item, onNavigate))}
                </div>
              </div>
            </section>
          </div>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="container flex gap-8 py-6">
        <aside className="sticky top-6 hidden h-[calc(100vh-3rem)] w-60 shrink-0 flex-col rounded-2xl border border-border bg-card p-4 shadow-soft lg:flex">
          <Logo className="mb-6 px-2" />
          <div className="mb-4 px-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            {roleName}
          </div>
          {/* The links scroll inside the sidebar, so an open group never pushes
              the help box past the sidebar's bottom edge. */}
          <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-2">
            {navList(undefined, "desktop")}
          </div>
          <div className="mt-2 shrink-0 rounded-xl bg-muted/60 p-3 text-xs text-muted-foreground">
            <p className="mb-2 font-medium text-foreground">Need help?</p>
            <p>
              Email{" "}
              <a
                href={`mailto:${BRAND.emails.info}`}
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                {BRAND.emails.info}
              </a>{" "}
              — typically reply in under an hour.
            </p>
          </div>
        </aside>

        <main className="flex-1 min-w-0">
          {/* Phones: menu and icons share the first row and the title gets the
              full width below, so long titles never break mid-word. */}
          <div className="mb-8 flex flex-wrap items-start justify-between gap-x-4 gap-y-3 sm:flex-nowrap">
            <div className="flex min-w-0 items-start gap-3 max-sm:contents">
              <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                <SheetTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="mt-1 lg:hidden max-sm:order-1 max-sm:mt-0"
                    aria-label="Open menu"
                  >
                    <Menu className="h-5 w-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-[80%] max-w-xs overflow-y-auto p-0">
                  <SheetHeader className="border-b border-border p-5 text-left">
                    <SheetTitle asChild>
                      <Logo />
                    </SheetTitle>
                  </SheetHeader>
                  <div className="px-3 py-4">
                    {/* Search is in the header from tablet width up; on phones it lives here. */}
                    <SearchBar className="mb-4 max-w-none md:hidden" />
                    <div className="mb-3 px-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
                      {roleName}
                    </div>
                    {navList(() => setMobileOpen(false), "mobile")}
                  </div>
                </SheetContent>
              </Sheet>
              <div className="min-w-0 max-sm:order-3 max-sm:basis-full">
                <h1 className="break-words font-display text-2xl font-semibold tracking-tight sm:text-3xl md:text-4xl">
                  {title}
                </h1>
                {subtitle && <p className="mt-1 text-muted-foreground">{subtitle}</p>}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 max-sm:order-2">
              <SearchBar className="hidden md:block" />
              <NotificationsBell />
              <ThemeToggle />
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSignOut}
                className="hidden sm:inline-flex"
              >
                <LogOut className="mr-1.5 h-4 w-4" /> Sign out
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleSignOut}
                className="sm:hidden"
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {children}
        </main>
      </div>
    </div>
  );
};
