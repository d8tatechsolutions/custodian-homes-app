import { StatusBadge, type StatusTone } from "@/components/common/StatusBadge";
import type { BidView } from "@/types/brokers";

const MAP: Record<BidView["status"], { tone: StatusTone; label: string }> = {
  pending: { tone: "warning", label: "Waiting for owner" },
  countered: { tone: "info", label: "Counter-offer" },
  accepted: { tone: "success", label: "Approved" },
  rejected: { tone: "danger", label: "Rejected" },
  withdrawn: { tone: "muted", label: "Withdrawn" },
  expired: { tone: "muted", label: "Expired" },
};

export function BidStatusBadge({ status }: { status: BidView["status"] }) {
  const { tone, label } = MAP[status] ?? { tone: "neutral" as const, label: status };
  return <StatusBadge tone={tone}>{label}</StatusBadge>;
}
