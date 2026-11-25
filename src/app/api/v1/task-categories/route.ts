import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isDuplicateKeyError, readJsonBody } from "@/app/api/v1/_helpers";
import { catalogActor, catalogOwnerId } from "@/lib/maintenance/catalog-helpers";
import { DEFAULT_TASK_CATEGORIES } from "@/lib/maintenance/enums";
import { guardMutation } from "@/lib/maintenance/route-helpers";
import { categoryInput } from "@/lib/schemas/maintenance";
import { TaskCategory } from "@/models/TaskCategory";

/** Built-in categories plus the admin's own (custom ones carry an id). */
export async function GET(request: NextRequest) {
  const actor = await catalogActor(request);
  if (actor instanceof NextResponse) return actor;
  const ownerId = catalogOwnerId(actor);
  const custom = ownerId
    ? ((await TaskCategory.find({ ownerId, isActive: true }).sort({ name: 1 }).lean()) as {
        _id: unknown;
        name: string;
      }[])
    : [];
  const builtIn = DEFAULT_TASK_CATEGORIES.map((name) => ({ id: "", name, builtIn: true }));
  const builtInKeys = new Set(DEFAULT_TASK_CATEGORIES.map((n) => n.toLowerCase()));
  const own = custom
    .filter((c) => !builtInKeys.has(c.name.toLowerCase()))
    .map((c) => ({ id: String(c._id), name: c.name, builtIn: false }));
  return NextResponse.json({ data: [...builtIn, ...own] });
}

/** Admins add their own categories (client decision Q37). */
export async function POST(request: NextRequest) {
  const guard = await guardMutation(request);
  if (guard) return guard;
  const actor = await catalogActor(request);
  if (actor instanceof NextResponse) return actor;
  if (actor.role !== "admin") {
    return NextResponse.json({ error: "Only an admin can add categories" }, { status: 403 });
  }
  const parsed = categoryInput.safeParse(await readJsonBody(request));
  if (!parsed.success)
    return NextResponse.json({ error: "Enter a category name" }, { status: 400 });

  const name = parsed.data.name.replace(/\s+/g, " ");
  const key = name.toLowerCase();
  if (DEFAULT_TASK_CATEGORIES.some((n) => n.toLowerCase() === key)) {
    return NextResponse.json({ error: "That category already exists" }, { status: 409 });
  }
  try {
    const existing = (await TaskCategory.findOne({ ownerId: actor.userId, key }).lean()) as {
      _id: unknown;
      isActive?: boolean;
    } | null;
    if (existing) {
      if (existing.isActive) {
        return NextResponse.json({ error: "That category already exists" }, { status: 409 });
      }
      await TaskCategory.updateOne({ _id: existing._id }, { $set: { isActive: true, name } });
      return NextResponse.json(
        { data: { id: String(existing._id), name, builtIn: false } },
        { status: 201 },
      );
    }
    const created = await TaskCategory.create({
      ownerId: actor.userId,
      name,
      key,
      createdBy: actor.userId,
    });
    return NextResponse.json(
      { data: { id: String(created._id), name, builtIn: false } },
      { status: 201 },
    );
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return NextResponse.json({ error: "That category already exists" }, { status: 409 });
    }
    throw error;
  }
}
