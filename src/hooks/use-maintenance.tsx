"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AssigneeOptions,
  ComplaintProgress,
  MaintenanceTask,
  PropertyOperationsSettings,
  TaskActivityEntry,
  TaskCategoryOption,
  TaskScheduleRecord,
  VendorRecord,
} from "@/types/maintenance";

/** JSON request that throws the API's own error message on failure. */
export async function apiRequest<T>(
  url: string,
  init?: RequestInit & { json?: unknown },
): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(url, {
    ...rest,
    headers:
      json !== undefined
        ? { "Content-Type": "application/json", ...(rest.headers ?? {}) }
        : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const body = (await res.json().catch(() => ({}))) as { data?: T; error?: string };
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body.data as T;
}

/** Generic loader: data, loading, error and a refetch, cancelled on unmount. */
function useResource<T>(url: string | null, initial: T) {
  // The fallback value is captured once; callers pass a fresh literal each render.
  const fallback = useRef(initial);
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(Boolean(url));
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!url) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void tick;
    setLoading(true);
    apiRequest<T>(url)
      .then((value) => {
        if (cancelled) return;
        setData(value ?? fallback.current);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Something went wrong");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [url, tick]);

  const refetch = useCallback(() => setTick((n) => n + 1), []);
  return { data, setData, loading, error, refetch };
}

export interface MaintenanceTaskFilters {
  propertyId?: string;
  status?: string;
  category?: string;
  complaintId?: string;
}

export function useMaintenanceTasks(filters: MaintenanceTaskFilters = {}) {
  const url = useMemo(() => {
    const params = new URLSearchParams({ limit: "100" });
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
    return `/api/v1/tasks?${params.toString()}`;
  }, [filters]);
  const { data, loading, error, refetch, setData } = useResource<MaintenanceTask[]>(url, []);
  return { tasks: data, setTasks: setData, loading, error, refetch };
}

export function useMaintenanceTask(id: string | null) {
  const { data, loading, error, refetch, setData } = useResource<MaintenanceTask | null>(
    id ? `/api/v1/tasks/${id}` : null,
    null,
  );
  return { task: data, setTask: setData, loading, error, refetch };
}

export function useTaskActivity(id: string | null) {
  const { data, loading, error, refetch } = useResource<TaskActivityEntry[]>(
    id ? `/api/v1/tasks/${id}/activity` : null,
    [],
  );
  return { activity: data, loading, error, refetch };
}

export function useApprovals() {
  const { data, loading, error, refetch } = useResource<MaintenanceTask[]>(
    "/api/v1/tasks/approvals",
    [],
  );
  return { approvals: data, loading, error, refetch };
}

export function useVendors(propertyId?: string) {
  const url = propertyId
    ? `/api/v1/vendors?propertyId=${encodeURIComponent(propertyId)}`
    : "/api/v1/vendors";
  const { data, loading, error, refetch } = useResource<VendorRecord[]>(url, []);
  return { vendors: data, loading, error, refetch };
}

export function useTaskCategories() {
  const { data, loading, refetch } = useResource<TaskCategoryOption[]>(
    "/api/v1/task-categories",
    [],
  );
  return { categories: data, loading, refetch };
}

export function useTaskSchedules() {
  const { data, loading, error, refetch } = useResource<TaskScheduleRecord[]>(
    "/api/v1/task-schedules",
    [],
  );
  return { schedules: data, loading, error, refetch };
}

export function usePropertyOperations(propertyId: string | null) {
  const { data, loading, error, refetch } = useResource<PropertyOperationsSettings | null>(
    propertyId ? `/api/v1/properties/${propertyId}/operations` : null,
    null,
  );
  return { operations: data, loading, error, refetch };
}

export function useAssignees(propertyId: string | null) {
  const { data, loading } = useResource<AssigneeOptions>(
    propertyId ? `/api/v1/tasks/assignees?propertyId=${encodeURIComponent(propertyId)}` : null,
    { staff: [], vendors: [] },
  );
  return { assignees: data, loading };
}

export function useComplaintProgress(enabled: boolean) {
  const { data, loading, refetch } = useResource<Record<string, ComplaintProgress>>(
    enabled ? "/api/v1/tenant/me/complaints/progress" : null,
    {},
  );
  return { progress: data, loading, refetch };
}

/** Every task action as a typed call returning the updated task. */
export const taskActions = {
  create: (body: Record<string, unknown>) =>
    apiRequest<MaintenanceTask>("/api/v1/tasks", { method: "POST", json: body }),
  update: (id: string, body: Record<string, unknown>) =>
    apiRequest<MaintenanceTask>(`/api/v1/tasks/${id}`, { method: "PATCH", json: body }),
  remove: (id: string) => apiRequest<{ id: string }>(`/api/v1/tasks/${id}`, { method: "DELETE" }),
  status: (id: string, body: { status: string; note?: string; resolveComplaints?: boolean }) =>
    apiRequest<MaintenanceTask>(`/api/v1/tasks/${id}/status`, { method: "POST", json: body }),
  assign: (
    id: string,
    assignee: { kind: "staff" | "vendor"; userId?: string; vendorId?: string } | null,
  ) =>
    apiRequest<MaintenanceTask>(`/api/v1/tasks/${id}/assign`, {
      method: "POST",
      json: { assignee },
    }),
  photo: (id: string, body: Record<string, unknown>) =>
    apiRequest<MaintenanceTask>(`/api/v1/tasks/${id}/photos`, { method: "POST", json: body }),
  attachment: (id: string, body: Record<string, unknown>) =>
    apiRequest<MaintenanceTask>(`/api/v1/tasks/${id}/attachments`, { method: "POST", json: body }),
  quote: (id: string, body: { amount: number; note?: string }) =>
    apiRequest<MaintenanceTask>(`/api/v1/tasks/${id}/quote`, { method: "POST", json: body }),
  approval: (id: string, body: { decision: "approve" | "reject"; note?: string }) =>
    apiRequest<MaintenanceTask>(`/api/v1/tasks/${id}/approval`, { method: "POST", json: body }),
  cost: (id: string, body: Record<string, unknown>) =>
    apiRequest<MaintenanceTask>(`/api/v1/tasks/${id}/cost`, { method: "PATCH", json: body }),
  billTenant: (id: string, body: { amount?: number; tenantId?: string } = {}) =>
    apiRequest<MaintenanceTask>(`/api/v1/tasks/${id}/bill-tenant`, { method: "POST", json: body }),
  comment: (id: string, message: string) =>
    apiRequest<{ ok: true }>(`/api/v1/tasks/${id}/activity`, { method: "POST", json: { message } }),
  linkComplaint: (id: string, complaintId: string, action: "link" | "unlink") =>
    apiRequest<MaintenanceTask>(`/api/v1/tasks/${id}/complaints`, {
      method: "POST",
      json: { complaintId, action },
    }),
};
