import { createUploadthing, type FileRouter } from "uploadthing/next";
import { UploadThingError } from "uploadthing/server";
import { isBrokerBidsEnabled, isTasksV2Enabled } from "@/lib/feature-flags";
import { connectToDatabase } from "@/lib/mongoose";
import { authenticate } from "@/lib/permissions";
import { User } from "@/models/User";

const f = createUploadthing();

const TASK_UPLOAD_ROLES = new Set(["admin", "custodian", "caretaker", "system-admin"]);

export const ourFileRouter = {
  propertyImages: f({
    image: { maxFileSize: "4MB", maxFileCount: 8, acl: "public-read" },
  })
    .middleware(async ({ req }) => {
      const auth = authenticate(req);
      if (!auth) {
        throw new UploadThingError("Unauthorized");
      }
      // Re-verify against the database: the JWT alone would let a deactivated
      // account keep uploading until its 7-day token expires.
      await connectToDatabase();
      const user = await User.findById(auth.userId).select("isActive role").lean();
      if (!user?.isActive) {
        throw new UploadThingError("Unauthorized");
      }
      return {
        uploadedBy: auth.userId,
        role: user.role ?? auth.role,
        // Stable public prefix for the files this endpoint returns
        fileUrlPrefix: "https://utfs.io/f",
      };
    })
    .onUploadComplete(async ({ file, metadata }) => {
      return {
        uploadedBy: metadata.uploadedBy,
        role: metadata.role,
        fileUrlPrefix: metadata.fileUrlPrefix,
        ufsUrl: file.ufsUrl,
      };
    }),

  /**
   * Task photos and documents (quotes, receipts). Staff only, flag-gated.
   * Stored with unguessable links (UploadThing's free plan has no private
   * files); links are only ever shown inside the app to people who may see
   * the task.
   */
  taskMedia: f({
    image: { maxFileSize: "4MB", maxFileCount: 3 },
    pdf: { maxFileSize: "8MB", maxFileCount: 3 },
  })
    .middleware(async ({ req }) => {
      if (!isTasksV2Enabled()) throw new UploadThingError("Not available");
      const auth = authenticate(req);
      if (!auth) throw new UploadThingError("Unauthorized");
      await connectToDatabase();
      const user = await User.findById(auth.userId).select("isActive role").lean();
      if (!user?.isActive || !TASK_UPLOAD_ROLES.has(String(user.role))) {
        throw new UploadThingError("Unauthorized");
      }
      return { uploadedBy: auth.userId };
    })
    .onUploadComplete(async ({ file, metadata }) => ({
      uploadedBy: metadata.uploadedBy,
      ufsUrl: file.ufsUrl,
      key: file.key,
      name: file.name,
    })),

  /** Photos and the owner's mandate letter for a broker's own listing. Brokers only, flag-gated. */
  brokerListingMedia: f({
    image: { maxFileSize: "4MB", maxFileCount: 10 },
    pdf: { maxFileSize: "8MB", maxFileCount: 1 },
  })
    .middleware(async ({ req }) => {
      if (!isBrokerBidsEnabled()) throw new UploadThingError("Not available");
      const auth = authenticate(req);
      if (!auth) throw new UploadThingError("Unauthorized");
      await connectToDatabase();
      const user = await User.findById(auth.userId).select("isActive role").lean();
      if (!user?.isActive || user.role !== "broker") throw new UploadThingError("Unauthorized");
      return { uploadedBy: auth.userId };
    })
    .onUploadComplete(async ({ file, metadata }) => ({
      uploadedBy: metadata.uploadedBy,
      ufsUrl: file.ufsUrl,
      key: file.key,
      name: file.name,
    })),
} satisfies FileRouter;

export type OurFileRouter = typeof ourFileRouter;
