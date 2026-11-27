import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateSession } from "@/lib/auth-scope";
import { connectToDatabase } from "@/lib/mongoose";
import { parsePagination } from "@/lib/pagination";
import { BrokerProfile } from "@/models/BrokerProfile";
import { User } from "@/models/User";

export async function GET(request: NextRequest) {
  const auth = await authenticateSession(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await connectToDatabase();
  const user = await User.findById(auth.userId).select("role isActive").lean();
  if (!user?.isActive || (user.role !== "admin" && user.role !== "system-admin")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { page, limit } = parsePagination({
    page: request.nextUrl.searchParams.get("page") ?? undefined,
    limit: request.nextUrl.searchParams.get("limit") ?? undefined,
  });
  const skip = (page - 1) * limit;

  const statusParam = request.nextUrl.searchParams.get("status");
  const query: Record<string, any> = {};
  if (statusParam) {
    query.status = statusParam;
  }

  // Owners see the broker directory, never payout accounts or identity data;
  // those stay with the platform (system-admin) for payouts and checks.
  const hidden =
    user.role === "system-admin"
      ? "-nationalId"
      : "-nationalId -payoutMethod -verificationNotes -suspensionReason -defaultCommission";
  const [total, profiles] = await Promise.all([
    BrokerProfile.countDocuments(query),
    BrokerProfile.find(query).select(hidden).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
  ]);

  return NextResponse.json({
    brokers: profiles,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  });
}
