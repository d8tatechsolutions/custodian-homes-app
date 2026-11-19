import { getAssignedPropertyIds } from "@/lib/managed-owner";
import { connectToDatabase } from "@/lib/mongoose";
import { Property } from "@/models/Property";
import { Tenant } from "@/models/Tenant";

async function propertyIdsFor(userId: string): Promise<string[]> {
  const [tenants, caretakerIds, custodianIds, adminIds, owned] = await Promise.all([
    Tenant.find({ userId, deletedAt: null }).select("propertyId").lean(),
    getAssignedPropertyIds(userId, "caretaker"),
    getAssignedPropertyIds(userId, "custodian"),
    getAssignedPropertyIds(userId, "admin"),
    Property.find({ ownerId: userId }).select("_id").lean(),
  ]);

  return [
    ...new Set([
      ...tenants.map((row) => row.propertyId).filter(Boolean),
      ...caretakerIds,
      ...custodianIds,
      ...adminIds,
      ...owned.map((property) => String(property._id)),
    ]),
  ];
}

/** Property ids both users belong to; empty means cross-property. */
export async function sharedPropertyIds(
  requesterId: string,
  recipientId: string,
): Promise<string[]> {
  await connectToDatabase();
  const [requesterIds, recipientIds] = await Promise.all([
    propertyIdsFor(requesterId),
    propertyIdsFor(recipientId),
  ]);
  const requester = new Set(requesterIds);
  return recipientIds.filter((id) => requester.has(id));
}
