"use client";

import { Loader2 } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { DashboardShell, type DashNavItem } from "@/components/DashboardShell";
import { TaskDetailView } from "@/components/tasks/TaskDetailView";
import { type HubRole, TasksHub } from "@/components/tasks/TasksHub";
import { useAuth } from "@/hooks/use-auth";
import { useReleaseFlags } from "@/hooks/use-fx";

interface ShellProps {
  roleName: string;
  nav: DashNavItem[];
}

function Loading({ roleName, nav }: ShellProps) {
  return (
    <DashboardShell roleName={roleName} nav={nav} title="Tasks & Maintenance">
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </p>
    </DashboardShell>
  );
}

/**
 * Shows the new Tasks & Maintenance hub when TASKS_V2_ENABLED is on and the
 * unchanged legacy page otherwise, so the release is a pure flag flip.
 */
export function TasksPageSwitch({
  viewerRole: role,
  roleName,
  nav,
  basePath,
  invoicesHref,
  Legacy,
  subtitle,
}: ShellProps & {
  viewerRole: HubRole;
  basePath: string;
  invoicesHref?: string;
  Legacy?: ComponentType;
  subtitle?: string;
}) {
  const { flags, loading } = useReleaseFlags();
  if (loading) return <Loading roleName={roleName} nav={nav} />;
  if (!flags.tasksV2) {
    if (Legacy) return <Legacy />;
    return (
      <DashboardShell roleName={roleName} nav={nav} title="Tasks & Maintenance">
        <p className="text-sm text-muted-foreground">This page is not available yet.</p>
      </DashboardShell>
    );
  }
  return (
    <DashboardShell
      roleName={roleName}
      nav={nav}
      title="Tasks & Maintenance"
      subtitle={
        subtitle ?? "Repairs, tenant complaints, approvals and recurring jobs in one place."
      }
    >
      <TasksHub viewerRole={role} basePath={basePath} invoicesHref={invoicesHref} />
    </DashboardShell>
  );
}

/** Task detail page body for any staff role (flag-gated like the hub). */
export function TaskDetailPage({
  taskId,
  viewerRole: role,
  roleName,
  nav,
  basePath,
  invoicesHref,
}: ShellProps & {
  taskId: string;
  viewerRole: HubRole;
  basePath: string;
  invoicesHref?: string;
}): ReactNode {
  const { flags, loading } = useReleaseFlags();
  const { user, loading: authLoading } = useAuth();
  if (loading || authLoading || !user) return <Loading roleName={roleName} nav={nav} />;
  if (!flags.tasksV2) {
    return (
      <DashboardShell roleName={roleName} nav={nav} title="Task">
        <p className="text-sm text-muted-foreground">This page is not available yet.</p>
      </DashboardShell>
    );
  }
  return (
    <DashboardShell roleName={roleName} nav={nav} title="Task">
      <TaskDetailView
        taskId={taskId}
        viewerRole={role}
        currentUserId={user.id}
        basePath={basePath}
        invoicesHref={invoicesHref}
      />
    </DashboardShell>
  );
}
