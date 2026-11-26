"use client";

import { SystemBrokersDirectory } from "@/components/brokers/SystemBrokersDirectory";
import { DashboardShell } from "@/components/DashboardShell";
import { systemAdminNav } from "@/config/dashboardNav";
import { useReleaseFlags } from "@/hooks/use-fx";

export default function SystemAdminMarketplacePage() {
  const { flags, loading } = useReleaseFlags();
  return (
    <DashboardShell
      roleName="System Administrator"
      nav={systemAdminNav}
      title="Brokers & Listings"
      subtitle="Approve brokers' own listings, review possible duplicates, and manage brokers and owners."
    >
      {loading ? null : flags.brokerBids ? (
        <SystemBrokersDirectory />
      ) : (
        <p className="text-sm text-muted-foreground">This page is not available yet.</p>
      )}
    </DashboardShell>
  );
}
