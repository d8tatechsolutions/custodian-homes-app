"use client";

import { useParams } from "next/navigation";
import { TaskDetailPage } from "@/components/tasks/TasksPageSwitch";
import { useCaretakerNav } from "@/hooks/use-caretaker-nav";

export default function CaretakerTaskPage() {
  const { id } = useParams<{ id: string }>();
  const nav = useCaretakerNav();
  return (
    <TaskDetailPage
      taskId={id}
      viewerRole="caretaker"
      roleName="Caretaker"
      nav={nav}
      basePath="/dashboard/caretaker/tasks"
    />
  );
}
