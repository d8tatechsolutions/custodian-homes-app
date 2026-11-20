import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { roleMaximumActions } from "../src/lib/authorization-policy.ts";
import { USER_CODE_ALPHABET, USER_CODE_LENGTH, USER_CODE_PREFIX } from "../src/lib/user-code.ts";

dotenv.config({ path: ".env.local" });

const mongoUri = (() => {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("Missing MONGODB_URI");
  return uri;
})();

const softDelete = { deletedAt: { type: Date, default: null } };

const seededUserCodes = new Set<string>();

/**
 * Deterministic, distinct `CXXXXXX` code per seeded email (plan §9.3): the email
 * is hashed and bytes are mapped into USER_CODE_ALPHABET, so re-seeding is stable
 * and the value satisfies ^C[0-9A-HJ-NP-Z]{6}$ without touching the (invisible)
 * generation hook.
 */
function deriveSeededUserCode(email: string): string {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const digest = crypto.createHash("sha256").update(`${email}#${attempt}`).digest();
    let code = USER_CODE_PREFIX;
    for (let i = 0; i < USER_CODE_LENGTH; i += 1) {
      code += USER_CODE_ALPHABET[digest[i] % USER_CODE_ALPHABET.length];
    }
    if (!seededUserCodes.has(code)) {
      seededUserCodes.add(code);
      return code;
    }
  }
  throw new Error(`Unable to derive a unique user code for ${email}`);
}

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, trim: true, lowercase: true },
    userCode: { type: String },
    passwordHash: { type: String, required: true },
    role: { type: String, required: true },
    privileges: { type: [String], default: [] },
    isActive: { type: Boolean, default: true },
    isVerified: { type: Boolean, default: true },
    phone: { type: String, default: "" },
    whatsapp: { type: String, default: "" },
    nationalId: { type: String, default: "" },
    tokenVersion: { type: Number, default: 0 },
    settings: { type: Object, default: {} },
  },
  { collection: "users" },
);

const propertySchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    location: { type: String, required: true },
    price: { type: Number, required: true, default: 0 },
    beds: { type: Number, default: 0 },
    baths: { type: Number, default: 0 },
    type: { type: String, default: "apartment" },
    ownerId: { type: String, default: "" },
    createdById: { type: String, default: "" },
    published: { type: Boolean, default: false },
    amenities: { type: [String], default: [] },
    blocks: { type: Array, default: [] },
    ...softDelete,
  },
  { collection: "properties" },
);

const unitSchema = new mongoose.Schema(
  {
    propertyId: { type: String, required: true },
    ownerId: { type: String, required: true },
    blockId: { type: String, default: "" },
    blockName: { type: String, default: "" },
    floorId: { type: String, default: "" },
    floorLevel: { type: Number, default: 0 },
    name: { type: String, required: true },
    rentAmount: { type: Number, default: 0 },
    status: { type: String, default: "available" },
    ...softDelete,
  },
  { collection: "units" },
);

const tenantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, default: "" },
    phone: { type: String, default: "" },
    propertyId: { type: String, required: true },
    ownerId: { type: String, required: true },
    unitId: { type: String, default: "" },
    userId: { type: String, default: "" },
    status: { type: String, default: "active" },
    ...softDelete,
  },
  { collection: "tenants" },
);

const leaseSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true },
    propertyId: { type: String, required: true },
    ownerId: { type: String, required: true },
    unitId: { type: String, default: "" },
    rentAmount: { type: Number, default: 0 },
    startDate: { type: Date, required: true },
    endDate: { type: Date },
    status: { type: String, default: "active" },
    ...softDelete,
  },
  { collection: "leases" },
);

const assignmentSchema = new mongoose.Schema(
  {
    principalUserId: { type: String, required: true },
    accessRole: { type: String, required: true },
    scopeType: { type: String, required: true },
    propertyId: { type: String, required: true },
    blockId: { type: String, default: "" },
    unitId: { type: String, default: "" },
    permissions: { type: [String], default: [] },
    status: { type: String, default: "active" },
    startsAt: { type: Date, default: Date.now },
    endsAt: { type: Date, default: null },
    grantedByUserId: { type: String, required: true },
    grantedAt: { type: Date, default: Date.now },
    acceptedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    revokedByUserId: { type: String, default: "" },
    reason: { type: String, default: "" },
    source: { type: String, default: "system" },
  },
  { collection: "managementassignments" },
);

const propertyTypeSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    isActive: { type: Boolean, default: true },
  },
  { collection: "propertytypes" },
);

async function main() {
  await mongoose.connect(mongoUri, {
    bufferCommands: false,
    maxPoolSize: 10,
    socketTimeoutMS: 45000,
    connectTimeoutMS: 10000,
  });

  console.log("⚠️  Wiping all collections...");
  const db = mongoose.connection.db as any;
  const collections = await db.listCollections().toArray();
  for (const c of collections) {
    await db.collection(c.name).deleteMany({});
  }
  console.log(`✅ Wiped ${collections.length} collections.`);

  // Drop indexes that belonged to removed legacy authorization fields.
  const obsoleteIndexes = [
    { collection: "users", index: "role_1_managedByOwnerId_1" },
    { collection: "properties", index: "caretakerIds_1" },
    { collection: "properties", index: "custodianIds_1" },
  ];
  for (const { collection, index } of obsoleteIndexes) {
    try {
      await db.collection(collection).dropIndex(index);
    } catch (error) {
      if ((error as { codeName?: string }).codeName !== "IndexNotFound") throw error;
    }
  }

  const User = mongoose.model("SeedUser", userSchema);
  const Property = mongoose.model("SeedProperty", propertySchema);
  const Unit = mongoose.model("SeedUnit", unitSchema);
  const Tenant = mongoose.model("SeedTenant", tenantSchema);
  const Lease = mongoose.model("SeedLease", leaseSchema);
  const Assignment = mongoose.model("SeedAssignment", assignmentSchema);
  const PropertyType = mongoose.model("SeedPropertyType", propertyTypeSchema);

  const password = await bcrypt.hash("Password123!", 12);

  // system-admin (bootstrap)
  const sysAdmin = await User.create({
    name: "System Admin",
    email: "sysadmin@keja.test",
    passwordHash: password,
    role: "system-admin",
    userCode: deriveSeededUserCode("sysadmin@keja.test"),
    isVerified: true,
    isActive: true,
  });

  const admin = await User.create({
    name: "Portfolio Admin",
    email: "admin@keja.test",
    passwordHash: password,
    role: "admin",
    userCode: deriveSeededUserCode("admin@keja.test"),
    isVerified: true,
    isActive: true,
  });
  const adminId = String(admin._id);

  const custodian = await User.create({
    name: "Custodian One",
    email: "custodian@keja.test",
    passwordHash: password,
    role: "custodian",
    userCode: deriveSeededUserCode("custodian@keja.test"),
    isVerified: true,
    isActive: true,
  });
  const custodianId = String(custodian._id);

  const caretaker = await User.create({
    name: "Caretaker One",
    email: "caretaker@keja.test",
    passwordHash: password,
    role: "caretaker",
    userCode: deriveSeededUserCode("caretaker@keja.test"),
    privileges: [
      "create_property",
      "edit_property",
      "delete_assigned_property",
      "manage_units",
      "manage_tenants",
      "process_move_requests",
      "manage_invoices",
      "manage_complaints",
      "manage_announcements",
      "send_messages",
      "manage_documents",
    ],
    isVerified: true,
    isActive: true,
  });
  const caretakerId = String(caretaker._id);

  const tenantUser = await User.create({
    name: "Tenant One",
    email: "tenant@keja.test",
    passwordHash: password,
    role: "tenant",
    userCode: deriveSeededUserCode("tenant@keja.test"),
    isVerified: true,
    isActive: true,
  });
  const tenantUserId = String(tenantUser._id);

  // property types
  await PropertyType.insertMany([
    { key: "apartment", label: "Apartment", isActive: true },
    { key: "house", label: "House", isActive: true },
    { key: "studio", label: "Studio", isActive: true },
  ]);

  const property = await Property.create({
    title: "Sunrise Apartments",
    location: "Nairobi",
    price: 50000,
    beds: 2,
    baths: 1,
    type: "apartment",
    ownerId: adminId,
    createdById: adminId,
    published: true,
    amenities: [],
    blocks: [],
  });
  const propertyId = String(property._id);

  const unit = await Unit.create({
    propertyId,
    ownerId: adminId,
    blockId: "",
    blockName: "Main",
    floorId: "",
    floorLevel: 0,
    name: "Unit 1A",
    rentAmount: 25000,
    status: "available",
  });
  const unitId = String(unit._id);

  const tenant = await Tenant.create({
    name: "Tenant One",
    email: "tenant@keja.test",
    phone: "",
    propertyId,
    ownerId: adminId,
    unitId,
    userId: tenantUserId,
    status: "active",
  });
  const tenantId = String(tenant._id);

  await Lease.create({
    tenantId,
    propertyId,
    ownerId: adminId,
    unitId,
    rentAmount: 25000,
    startDate: new Date(),
    endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    status: "active",
  });

  const now = new Date();
  const adminPerms = roleMaximumActions("admin");
  const custodianPerms = roleMaximumActions("custodian");
  const caretakerPerms = roleMaximumActions("caretaker");

  await Assignment.insertMany([
    {
      principalUserId: adminId,
      accessRole: "admin",
      scopeType: "property",
      propertyId,
      blockId: "",
      unitId: "",
      permissions: adminPerms,
      status: "active",
      startsAt: now,
      endsAt: null,
      grantedByUserId: adminId,
      grantedAt: now,
      acceptedAt: now,
      source: "system",
      reason: "Seed",
    },
    {
      principalUserId: custodianId,
      accessRole: "custodian",
      scopeType: "property",
      propertyId,
      blockId: "",
      unitId: "",
      permissions: custodianPerms,
      status: "active",
      startsAt: now,
      endsAt: null,
      grantedByUserId: adminId,
      grantedAt: now,
      acceptedAt: now,
      source: "system",
      reason: "Seed",
    },
    {
      principalUserId: caretakerId,
      accessRole: "caretaker",
      scopeType: "property",
      propertyId,
      blockId: "",
      unitId: "",
      permissions: caretakerPerms,
      status: "active",
      startsAt: now,
      endsAt: null,
      grantedByUserId: adminId,
      grantedAt: now,
      acceptedAt: now,
      source: "system",
      reason: "Seed",
    },
  ]);

  console.log("\n✅ Reseed complete.");
  console.log("Credentials (password: Password123!):");
  console.log("  system-admin:", sysAdmin.email);
  console.log("  admin:       ", admin.email);
  console.log("  custodian:   ", custodian.email);
  console.log("  caretaker:   ", caretaker.email);
  console.log("  tenant:      ", tenantUser.email);
  console.log("Property:", propertyId, "| Unit:", unitId, "| Tenant:", tenantId);

  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect();
  process.exit(1);
});
