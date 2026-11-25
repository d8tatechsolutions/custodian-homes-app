"use client";

import { useParams } from "next/navigation";
import { TaskDetailPage } from "@/components/tasks/TasksPageSwitch";
import { custodianNav } from "@/config/dashboardNav";

export default function CustodianTaskPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <TaskDetailPage
      taskId={id}
      viewerRole="custodian"
      roleName="Custodian"
      nav={custodianNav}
      basePath="/dashboard/custodian/tasks"
      invoicesHref="/dashboard/custodian/accounting"
    />
  );
}
