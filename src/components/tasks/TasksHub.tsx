"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { FxAttribution } from "@/components/money/Money";
import { ApprovalsPanel } from "@/components/tasks/ApprovalsPanel";
import { ComplaintsPanel } from "@/components/tasks/ComplaintsPanel";
import { MaintenanceSettingsPanel } from "@/components/tasks/MaintenanceSettingsPanel";
import { SchedulesPanel } from "@/components/tasks/SchedulesPanel";
import type { TaskFormPrefill } from "@/components/tasks/TaskFormSheet";
import { TaskListView } from "@/components/tasks/TaskListView";
import { VendorsPanel } from "@/components/tasks/VendorsPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/use-auth";
import { useApprovals } from "@/hooks/use-maintenance";

export type HubRole = "admin" | "custodian" | "caretaker" | "system-admin";

interface TasksHubProps {
  viewerRole: HubRole;
  basePath: string;
  invoicesHref?: string;
}

/**
 * Tasks & Maintenance hub. Tabs appear only for roles that can use them:
 * approvals for approvers, recurring for owners/admins/custodians, vendors and
 * settings for admins.
 */
export function TasksHub({ viewerRole: role, basePath }: TasksHubProps) {
  const { user, loading } = useAuth();
  const [tab, setTab] = useState("tasks");
  const [prefill, setPrefill] = useState<TaskFormPrefill | null>(null);
  const showApprovals = role === "admin" || role === "custodian" || role === "system-admin";
  const { approvals } = useApprovals();
  const showSchedules = role !== "caretaker";
  const showAdminTabs = role === "admin";

  if (loading || !user) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <Tabs value={tab} onValueChange={setTab}>
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList className="w-max">
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
            <TabsTrigger value="complaints">Complaints</TabsTrigger>
            {showApprovals ? (
              <TabsTrigger value="approvals">
                Approvals
                {approvals.length > 0 ? (
                  <span className="ml-1.5 rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
                    {approvals.length}
                  </span>
                ) : null}
              </TabsTrigger>
            ) : null}
            {showSchedules ? <TabsTrigger value="recurring">Recurring</TabsTrigger> : null}
            {showAdminTabs ? <TabsTrigger value="vendors">Service providers</TabsTrigger> : null}
            {showAdminTabs ? <TabsTrigger value="settings">Settings</TabsTrigger> : null}
          </TabsList>
        </div>

        <TabsContent value="tasks" className="mt-6">
          <TaskListView
            viewerRole={role}
            currentUserId={user.id}
            basePath={basePath}
            prefill={prefill}
            onPrefillConsumed={() => setPrefill(null)}
          />
        </TabsContent>
        <TabsContent value="complaints" className="mt-6">
          <ComplaintsPanel
            basePath={basePath}
            onCreateTask={(next) => {
              setPrefill(next);
              setTab("tasks");
            }}
          />
        </TabsContent>
        {showApprovals ? (
          <TabsContent value="approvals" className="mt-6">
            <ApprovalsPanel basePath={basePath} />
          </TabsContent>
        ) : null}
        {showSchedules ? (
          <TabsContent value="recurring" className="mt-6">
            <SchedulesPanel />
          </TabsContent>
        ) : null}
        {showAdminTabs ? (
          <TabsContent value="vendors" className="mt-6">
            <VendorsPanel />
          </TabsContent>
        ) : null}
        {showAdminTabs ? (
          <TabsContent value="settings" className="mt-6">
            <MaintenanceSettingsPanel currentUserId={user.id} />
          </TabsContent>
        ) : null}
      </Tabs>
      <FxAttribution />
    </div>
  );
}
