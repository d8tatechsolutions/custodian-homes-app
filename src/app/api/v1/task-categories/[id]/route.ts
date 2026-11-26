import { isValidObjectId } from "mongoose";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { catalogActor } from "@/lib/maintenance/catalog-helpers";
import { guardMutation } from "@/lib/maintenance/route-helpers";
import { TaskCategory } from "@/models/TaskCategory";

/** Hides a custom category from pickers. Existing tasks keep their label. */
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = await guardMutation(request);
  if (guard) return guard;
  const { id } = await context.params;
  const actor = await catalogActor(request);
  if (actor instanceof NextResponse) return actor;
  if (actor.role !== "admin") {
    return NextResponse.json({ error: "Only the owner can remove categories" }, { status: 403 });
  }
  if (!isValidObjectId(id))
    return NextResponse.json({ error: "Invalid category id" }, { status: 400 });
  const result = await TaskCategory.updateOne(
    { _id: id, ownerId: actor.userId },
    { $set: { isActive: false } },
  );
  if (result.matchedCount === 0)
    return NextResponse.json({ error: "Category not found" }, { status: 404 });
  return NextResponse.json({ data: { id } });
}
