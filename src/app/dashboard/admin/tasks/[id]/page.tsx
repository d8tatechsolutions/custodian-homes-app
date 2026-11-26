"use client";

import { useParams } from "next/navigation";
import { TaskDetailPage } from "@/components/tasks/TasksPageSwitch";
import { adminNav } from "@/config/dashboardNav";

export default function AdminTaskPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <TaskDetailPage
      taskId={id}
      viewerRole="admin"
      roleName="Owner"
      nav={adminNav}
      basePath="/dashboard/admin/tasks"
      invoicesHref="/dashboard/admin/accounting"
    />
  );
}
