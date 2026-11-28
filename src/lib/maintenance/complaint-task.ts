import { ownerFallbackAssignee } from "@/lib/maintenance/assignee";
import { addDays, nairobiToday } from "@/lib/maintenance/dates";
import { COMPLAINT_TASK_DUE_DAYS } from "@/lib/maintenance/enums";
import { type NoticeTask, notifyTaskAssigned } from "@/lib/maintenance/notify";
import { Complaint } from "@/models/Complaint";
import { ManagementAssignment } from "@/models/ManagementAssignment";
import { Task } from "@/models/Task";
import { TaskActivity } from "@/models/TaskActivity";
import { Unit } from "@/models/Unit";
import { User } from "@/models/User";

interface ComplaintLike {
  _id: unknown;
  propertyId: string;
  ownerId: string;
  unitId?: string;
  subject: string;
  message: string;
  category: string;
  priority: "low" | "medium" | "high";
}

interface AssignmentRow {
  principalUserId: string;
  scopeType: "property" | "block" | "unit";
  blockId?: string;
  unitId?: string;
  startsAt?: Date | null;
  endsAt?: Date | null;
  grantedAt?: Date | null;
}

/** Complaint categories that map onto a task category; others stay uncategorised. */
const CATEGORY_MAP: Record<string, string> = { Security: "Security" };

export function complaintTaskDueDate(
  priority: ComplaintLike["priority"],
  now = new Date(),
): string {
  return addDays(
    nairobiToday(now),
    COMPLAINT_TASK_DUE_DAYS[priority] ?? COMPLAINT_TASK_DUE_DAYS.medium,
  );
}

/**
 * The caretaker who should receive a complaint's task (client decision): the
 * caretaker on that unit, else on the unit's block, else on the property —
 * longest-assigned first. Only active caretakers whose assignment actually
 * grants task access are eligible, so the task is always visible to them.
 */
export async function pickCaretakerForComplaint(
  propertyId: string,
  unitId: string | undefined,
  now = new Date(),
): Promise<{ userId: string; name: string } | null> {
  const rows = (await ManagementAssignment.find({
    propertyId,
    accessRole: "caretaker",
    status: "active",
    permissions: "task:read-own",
  })
    .select("principalUserId scopeType blockId unitId startsAt endsAt grantedAt")
    .lean()) as AssignmentRow[];

  const live = rows.filter(
    (r) =>
      (!r.startsAt || new Date(r.startsAt).getTime() <= now.getTime()) &&
      (!r.endsAt || new Date(r.endsAt).getTime() > now.getTime()),
  );
  if (live.length === 0) return null;

  let blockId = "";
  if (unitId) {
    const unit = (await Unit.findById(unitId).select("blockId").lean()) as {
      blockId?: string;
    } | null;
    blockId = unit?.blockId ?? "";
  }

  const rank = (r: AssignmentRow): number => {
    if (unitId && r.scopeType === "unit" && r.unitId === unitId) return 0;
    if (blockId && r.scopeType === "block" && r.blockId === blockId) return 1;
    if (r.scopeType === "property") return 2;
    return 9; // a different block/unit on the same property — not responsible
  };
  const ordered = live
    .filter((r) => rank(r) < 9)
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        new Date(a.grantedAt ?? 0).getTime() - new Date(b.grantedAt ?? 0).getTime(),
    );

  for (const candidate of ordered) {
    const user = (await User.findById(candidate.principalUserId)
      .select("name isActive role")
      .lean()) as {
      name?: string;
      isActive?: boolean;
      role?: string;
    } | null;
    if (user?.isActive && user.role === "caretaker") {
      return { userId: String(candidate.principalUserId), name: user.name ?? "" };
    }
  }
  return null;
}

/**
 * Creates the maintenance task for a newly filed complaint and links both
 * ways. Never throws: a failure is logged and the complaint stands on its own
 * (staff can still raise a task from the Complaints tab).
 */
export async function createTaskForComplaint(
  complaint: ComplaintLike,
  now = new Date(),
): Promise<string | null> {
  try {
    const complaintId = String(complaint._id);
    let locationLabel = "";
    let blockId = "";
    let floorId = "";
    if (complaint.unitId) {
      const unit = (await Unit.findById(complaint.unitId)
        .select("name blockId blockName floorId floorLabel floorLevel")
        .lean()) as {
        name?: string;
        blockId?: string;
        blockName?: string;
        floorId?: string;
        floorLabel?: string;
        floorLevel?: number;
      } | null;
      if (unit) {
        blockId = unit.blockId ?? "";
        floorId = unit.floorId ?? "";
        const floor =
          unit.floorLabel || (unit.floorLevel === 0 ? "Ground" : `Floor ${unit.floorLevel}`);
        locationLabel = [unit.blockName, floor, unit.name].filter(Boolean).join(" › ");
      }
    }

    const caretaker = await pickCaretakerForComplaint(complaint.propertyId, complaint.unitId, now);
    // Nobody manages the property at all: the owner receives the task.
    const ownerFallback = caretaker
      ? null
      : await ownerFallbackAssignee(complaint.propertyId, complaint.ownerId, now);
    const assigned = caretaker
      ? { kind: "staff" as const, userId: caretaker.userId, name: caretaker.name }
      : (ownerFallback?.assignee ?? null);

    const task = await Task.create({
      ownerId: complaint.ownerId,
      propertyId: complaint.propertyId,
      title: complaint.subject.slice(0, 200),
      notes: complaint.message.slice(0, 2000),
      priority: complaint.priority,
      status: "open",
      category: CATEGORY_MAP[complaint.category] ?? "",
      dueDate: complaintTaskDueDate(complaint.priority, now),
      createdBy: "system",
      createdByRole: "system",
      createdByName: "Tenant complaint",
      location: complaint.unitId
        ? { kind: "unit", unitId: complaint.unitId, blockId, floorId, label: locationLabel }
        : { kind: "property", label: "" },
      assignee: assigned,
      assignedTo: assigned?.userId ?? "",
      assignedToName: assigned?.name ?? "",
      complaintIds: [complaintId],
    });
    const taskId = String(task._id);

    await Complaint.updateOne({ _id: complaintId }, { $addToSet: { taskIds: taskId } });
    await TaskActivity.create({
      taskId,
      ownerId: complaint.ownerId,
      actorId: "system",
      actorRole: "system",
      actorName: "System",
      kind: "created",
      message: caretaker
        ? `Created from a tenant complaint and assigned to ${caretaker.name || "the caretaker"}`
        : ownerFallback
          ? `Created from a tenant complaint and assigned to ${ownerFallback.assignedToName || "the owner"} (no staff manage this property)`
          : "Created from a tenant complaint (no caretaker assigned to this location)",
      data: { complaintId },
    });
    if (assigned) {
      await notifyTaskAssigned(task.toObject() as NoticeTask, {
        userId: "system",
        role: "system",
        name: "A tenant complaint",
      });
    }
    return taskId;
  } catch (error) {
    console.error(
      "[maintenance] could not create a task for complaint",
      String(complaint._id),
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}
