"use client";

import { TenantsManager } from "@/components/tenants/TenantsManager";
import { adminNav } from "@/config/dashboardNav";

const AdminTenantsPage = () => {
  return <TenantsManager nav={adminNav} roleName="Owner" canSetStatus />;
};

export default AdminTenantsPage;
