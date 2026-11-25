"use client";

import { TasksPageSwitch } from "@/components/tasks/TasksPageSwitch";
import { custodianNav } from "@/config/dashboardNav";

export default function CustodianTasksPage() {
  return (
    <TasksPageSwitch
      viewerRole="custodian"
      roleName="Custodian"
      nav={custodianNav}
      basePath="/dashboard/custodian/tasks"
      invoicesHref="/dashboard/custodian/accounting"
      subtitle="Follow repairs, approve costs and keep recurring jobs on schedule."
    />
  );
}
