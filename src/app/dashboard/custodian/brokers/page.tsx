"use client";

import { Handshake } from "lucide-react";
import { OwnerBrokerRequestsSection } from "@/components/brokers/OwnerBrokerRequestsSection";
import { EmptyState } from "@/components/common/EmptyState";
import { DashboardShell } from "@/components/DashboardShell";
import { custodianNav } from "@/config/dashboardNav";
import { useAuth } from "@/hooks/use-auth";
import { useReleaseFlags } from "@/hooks/use-fx";

/**
 * Broker requests a custodian decides: listings on properties whose owner has
 * no account on the platform (the custodian is the approver there).
 */
export default function CustodianBrokersPage() {
  const { user } = useAuth();
  const { flags, loading } = useReleaseFlags();

  return (
    <DashboardShell
      roleName="Custodian"
      nav={custodianNav}
      title="Broker requests"
      subtitle="Approve, counter or decline brokers who want to market the listings you manage."
    >
      {!loading && !flags.brokerBids ? (
        <EmptyState
          icon={Handshake}
          title="Not available yet"
          description="Broker requests will appear here once the feature is switched on."
        />
      ) : user ? (
        <OwnerBrokerRequestsSection currentUserId={user.id} canAddBrokers={false} />
      ) : null}
    </DashboardShell>
  );
}
