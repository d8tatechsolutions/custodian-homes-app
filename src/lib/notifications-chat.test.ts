/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeObjectId } from "@/test/utils/factories";
import { buildQuery, getModelStubs, resetModelStubs } from "@/test/utils/model-mocks";

vi.mock("@/lib/email", () => ({
  isEmailConfigured: vi.fn().mockReturnValue(false),
  sendNotificationEmail: vi.fn().mockResolvedValue(false),
  createInvoicePaidContent: vi.fn().mockReturnValue(""),
  createOverdueContent: vi.fn().mockReturnValue(""),
  createLeaseExpiryContent: vi.fn().mockReturnValue(""),
  createComplaintStatusContent: vi.fn().mockReturnValue(""),
  createAnnouncementContent: vi.fn().mockReturnValue(""),
  sanitizeHeader: vi.fn((value: string) => value),
}));
vi.mock("@/models/User", () => ({ User: getModelStubs().user }));
vi.mock("@/models/Tenant", () => ({ Tenant: getModelStubs().tenant }));
vi.mock("@/models/Property", () => ({ Property: getModelStubs().property }));
vi.mock("@/models/Invoice", () => ({ Invoice: getModelStubs().invoice }));
vi.mock("@/models/Notification", () => ({ Notification: getModelStubs().notification }));
vi.mock("@/models/UnitFavorite", () => ({ UnitFavorite: getModelStubs().unitFavorite }));
vi.mock("@/models/ManagementAssignment", () => ({
  ManagementAssignment: getModelStubs().managementAssignment,
}));

import { notifyChatRequest, notifyChatRequestDecided } from "@/lib/notifications";

const { user, notification } = getModelStubs();
const REQUEST_ID = makeObjectId("chatrequest");
const REQUESTER = makeObjectId("requester");
const RECIPIENT = makeObjectId("recipient");

const request = {
  _id: REQUEST_ID,
  requesterId: REQUESTER,
  recipientId: RECIPIENT,
  propertyId: "",
};

describe("chat request notifications", () => {
  beforeEach(() => {
    resetModelStubs();
    user.findById.mockReturnValue(buildQuery({ role: "tenant" }));
    notification.create.mockResolvedValue({ _id: makeObjectId("notification") });
  });

  it("notifies the recipient with a status-keyed dedupe key", async () => {
    const ok = await notifyChatRequest(request, RECIPIENT, "/dashboard/tenant/messages");
    expect(ok).toBe(true);
    const doc = notification.create.mock.calls[0][0] as Record<string, unknown>;
    expect(doc.type).toBe("chat:request");
    expect(doc.recipientUserId).toBe(RECIPIENT);
    expect(doc.link).toBe("/dashboard/tenant/messages");
    expect((doc.data as Record<string, unknown>).eventId).toBe(`${REQUEST_ID}:pending`);
    expect(doc.dedupeKey).toBe(`chat:request:${REQUEST_ID}:pending`);
  });

  it("does not notify the requester about their own request", async () => {
    await notifyChatRequest(request, REQUESTER);
    expect(notification.create).not.toHaveBeenCalled();
  });

  it("notifies an approval with the approved status", async () => {
    await notifyChatRequestDecided(
      { ...request, decidedById: RECIPIENT },
      REQUESTER,
      true,
      "/dashboard/tenant/messages",
    );
    const doc = notification.create.mock.calls[0][0] as Record<string, unknown>;
    expect(doc.type).toBe("chat:request-decided");
    expect(doc.title).toBe("Message request approved");
    expect(doc.dedupeKey).toBe(`chat:request-decided:${REQUEST_ID}:approved`);
  });

  it("notifies a decline with the declined status", async () => {
    await notifyChatRequestDecided({ ...request, decidedById: RECIPIENT }, REQUESTER, false);
    const doc = notification.create.mock.calls[0][0] as Record<string, unknown>;
    expect(doc.dedupeKey).toBe(`chat:request-decided:${REQUEST_ID}:declined`);
    expect(doc.title).toBe("Message request declined");
  });

  it("never notifies the decider about their own decision", async () => {
    await notifyChatRequestDecided({ ...request, decidedById: RECIPIENT }, RECIPIENT, true);
    expect(notification.create).not.toHaveBeenCalled();
  });
});
