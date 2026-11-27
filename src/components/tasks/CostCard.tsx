"use client";

import { Check, Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Money } from "@/components/money/Money";
import { MoneyInput, type MoneyValue } from "@/components/money/MoneyInput";
import { PhotoUploader } from "@/components/tasks/PhotoUploader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { taskActions } from "@/hooks/use-maintenance";
import { MAX_TASK_ATTACHMENTS, TASK_PAYER_LABELS, type TaskPayer } from "@/lib/maintenance/enums";
import { isActiveStatus } from "@/lib/maintenance/status";
import { cn } from "@/lib/utils";
import type { MaintenanceTask } from "@/types/maintenance";

interface CostCardProps {
  task: MaintenanceTask;
  currentUserId: string;
  isSupervisor: boolean;
  /** Path to the role's invoices page, for the "billed" link. */
  invoicesHref?: string;
  onChanged: (task: MaintenanceTask) => void;
}

type Step = { key: string; label: string; done: boolean; current: boolean };

function Stepper({ steps }: { steps: Step[] }) {
  return (
    <ol className="grid grid-cols-5 gap-1" aria-label="Cost progress">
      {steps.map((step, i) => (
        <li key={step.key} className="flex flex-col items-center gap-1 text-center">
          <span
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-semibold",
              step.done && "border-primary bg-primary text-primary-foreground",
              step.current && !step.done && "border-primary text-primary",
              !step.done && !step.current && "border-border text-muted-foreground",
            )}
            aria-current={step.current ? "step" : undefined}
          >
            {step.done ? <Check className="h-3.5 w-3.5" /> : i + 1}
          </span>
          <span
            className={cn(
              "text-[11px] leading-tight",
              step.current ? "font-medium" : "text-muted-foreground",
            )}
          >
            {step.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Quote → approval → actual cost → receipts → vendor paid, plus who pays and billing the tenant. */
export function CostCard({
  task,
  currentUserId,
  isSupervisor,
  invoicesHref,
  onChanged,
}: CostCardProps) {
  const cost = task.cost;
  const approval = cost?.approval?.status ?? "not_required";
  const active = isActiveStatus(task.status);
  const isApprover = cost?.approval?.approverUserId === currentUserId;
  const actual = (cost?.labourAmount ?? 0) + (cost?.materialsAmount ?? 0);
  const receipts = task.receipts ?? [];
  const vendorJob = task.assignee?.kind === "vendor";
  const vendorPaid = cost?.vendorPayment?.status === "paid";

  const [quote, setQuote] = useState<MoneyValue>({ amount: "", currency: "KES" });
  const [quoteNote, setQuoteNote] = useState("");
  const [decisionNote, setDecisionNote] = useState("");
  const [labour, setLabour] = useState<MoneyValue>({
    amount: cost?.labourAmount ?? "",
    currency: "KES",
  });
  const [materials, setMaterials] = useState<MoneyValue>({
    amount: cost?.materialsAmount ?? "",
    currency: "KES",
  });
  const [payMethod, setPayMethod] = useState(cost?.vendorPayment?.method ?? "");
  const [payRef, setPayRef] = useState(cost?.vendorPayment?.reference ?? "");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    setLabour({ amount: cost?.labourAmount ?? "", currency: "KES" });
    setMaterials({ amount: cost?.materialsAmount ?? "", currency: "KES" });
  }, [cost?.labourAmount, cost?.materialsAmount]);

  const run = async (key: string, action: () => Promise<MaintenanceTask>, success: string) => {
    setBusy(key);
    try {
      onChanged(await action());
      toast.success(success);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const steps: Step[] = [
    { key: "quote", label: "Quote", done: Boolean(cost?.quote), current: !cost?.quote },
    {
      key: "approval",
      label: "Approval",
      done: approval === "approved" || (approval === "not_required" && Boolean(cost?.quote)),
      current: approval === "pending" || approval === "rejected",
    },
    {
      key: "work",
      label: "Work",
      done: task.status === "done",
      current: Boolean(cost?.quote) && approval !== "pending" && task.status !== "done",
    },
    {
      key: "receipts",
      label: "Receipts",
      done: receipts.length > 0,
      current: task.status === "done" && receipts.length === 0,
    },
    {
      key: "paid",
      label: vendorJob ? "Provider paid" : "Costs in",
      done: vendorJob ? vendorPaid : actual > 0,
      current: task.status === "done" && (vendorJob ? !vendorPaid : actual === 0),
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Costs</CardTitle>
        <CardDescription>All amounts in KES; the USD line is approximate.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <Stepper steps={steps} />

        {/* Quote */}
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-semibold">Quote</h4>
            {approval === "pending" ? (
              <StatusBadge tone="warning">Waiting for approval</StatusBadge>
            ) : null}
            {approval === "approved" ? <StatusBadge tone="success">Approved</StatusBadge> : null}
            {approval === "rejected" ? <StatusBadge tone="danger">Rejected</StatusBadge> : null}
            {approval === "not_required" && cost?.quote ? (
              <StatusBadge tone="muted">Within the approval limit</StatusBadge>
            ) : null}
          </div>
          {cost?.quote ? (
            <div className="rounded-xl border border-border p-3 text-sm">
              <Money amount={cost.quote.amount} className="font-semibold" />
              {cost.quote.note ? (
                <p className="mt-1 text-muted-foreground">{cost.quote.note}</p>
              ) : null}
              {approval === "rejected" && cost.approval?.note ? (
                <p className="mt-2 text-destructive">Reason: {cost.approval.note}</p>
              ) : null}
            </div>
          ) : null}

          {approval === "pending" && isApprover ? (
            <div className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
              <p className="text-sm font-medium">This cost needs your approval.</p>
              <Textarea
                rows={2}
                maxLength={1000}
                value={decisionNote}
                placeholder="Note (required when rejecting)"
                onChange={(e) => setDecisionNote(e.target.value)}
                aria-label="Decision note"
              />
              <div className="flex gap-2">
                <Button
                  className="rounded-full"
                  disabled={busy !== null}
                  onClick={() =>
                    void run(
                      "approve",
                      () =>
                        taskActions.approval(task._id, { decision: "approve", note: decisionNote }),
                      "Cost approved",
                    )
                  }
                >
                  {busy === "approve" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Approve
                </Button>
                <Button
                  variant="outline"
                  className="rounded-full"
                  disabled={busy !== null || !decisionNote.trim()}
                  title={!decisionNote.trim() ? "Add a reason to reject" : undefined}
                  onClick={() =>
                    void run(
                      "reject",
                      () =>
                        taskActions.approval(task._id, { decision: "reject", note: decisionNote }),
                      "Cost rejected",
                    )
                  }
                >
                  Reject
                </Button>
              </div>
            </div>
          ) : null}
          {approval === "pending" && !isApprover ? (
            <p className="text-xs text-muted-foreground">Work waits until the approver decides.</p>
          ) : null}

          {active && approval !== "pending" ? (
            <div className="space-y-2">
              <MoneyInput
                label={cost?.quote ? "New quote" : "Quoted amount"}
                value={quote}
                onChange={setQuote}
                currencies={["KES"]}
              />
              <Input
                value={quoteNote}
                maxLength={1000}
                placeholder="Who quoted / what it covers (optional)"
                onChange={(e) => setQuoteNote(e.target.value)}
                aria-label="Quote note"
              />
              <Button
                variant="outline"
                className="rounded-full"
                disabled={busy !== null || !(typeof quote.amount === "number" && quote.amount > 0)}
                onClick={async () => {
                  const ok = await run(
                    "quote",
                    () =>
                      taskActions.quote(task._id, {
                        amount: Number(quote.amount),
                        note: quoteNote,
                      }),
                    "Quote saved",
                  );
                  if (ok) {
                    setQuote({ amount: "", currency: "KES" });
                    setQuoteNote("");
                  }
                }}
              >
                {busy === "quote" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Save
                quote
              </Button>
            </div>
          ) : null}
        </section>

        {/* Actual cost */}
        <section className="space-y-3">
          <h4 className="text-sm font-semibold">Actual cost</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <MoneyInput
              label="Labour"
              value={labour}
              onChange={setLabour}
              currencies={["KES"]}
              disabled={task.status === "cancelled"}
            />
            <MoneyInput
              label="Materials"
              value={materials}
              onChange={setMaterials}
              currencies={["KES"]}
              disabled={task.status === "cancelled"}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm">
              Total: <Money amount={actual} className="font-semibold" />
            </p>
            <Button
              variant="outline"
              className="rounded-full"
              disabled={busy !== null || task.status === "cancelled"}
              onClick={() =>
                void run(
                  "actual",
                  () =>
                    taskActions.cost(task._id, {
                      labourAmount: Number(labour.amount || 0),
                      materialsAmount: Number(materials.amount || 0),
                    }),
                  "Costs saved",
                )
              }
            >
              {busy === "actual" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Save
              costs
            </Button>
          </div>
        </section>

        <PhotoUploader
          label="Receipts"
          accept="documents"
          max={MAX_TASK_ATTACHMENTS}
          disabled={task.status === "cancelled"}
          items={receipts.map((r) => ({ id: r._id, url: r.url, name: r.name, kind: r.kind }))}
          onUploaded={async (file) => {
            onChanged(
              await taskActions.attachment(task._id, {
                action: "add",
                target: "receipts",
                media: file,
              }),
            );
          }}
          onRemove={async (id) => {
            onChanged(
              await taskActions.attachment(task._id, {
                action: "remove",
                target: "receipts",
                mediaId: id,
              }),
            );
          }}
        />

        {/* Who pays */}
        <section className="space-y-3">
          <h4 className="text-sm font-semibold">Who pays</h4>
          {isSupervisor ? (
            <Select
              value={cost?.payer ?? "owner"}
              disabled={busy !== null || task.status === "cancelled"}
              onValueChange={(payer) =>
                void run(
                  "payer",
                  () => taskActions.cost(task._id, { payer: payer as TaskPayer }),
                  "Saved",
                )
              }
            >
              <SelectTrigger aria-label="Who pays" className="sm:w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(TASK_PAYER_LABELS) as TaskPayer[]).map((p) => (
                  <SelectItem key={p} value={p}>
                    {TASK_PAYER_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="text-sm">{TASK_PAYER_LABELS[cost?.payer ?? "owner"]}</p>
          )}

          {cost?.payer === "tenant" ? (
            cost.tenantInvoiceId ? (
              <p className="text-sm text-muted-foreground">
                A draft invoice was created for the tenant.{" "}
                {invoicesHref ? (
                  <Link
                    href={invoicesHref}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    Review and issue it in Invoices
                  </Link>
                ) : null}
              </p>
            ) : isSupervisor ? (
              <Button
                className="rounded-full"
                disabled={busy !== null || actual <= 0}
                title={actual <= 0 ? "Save the actual cost first" : undefined}
                onClick={() =>
                  void run("bill", () => taskActions.billTenant(task._id), "Draft invoice created")
                }
              >
                {busy === "bill" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Bill tenant{" "}
                <span className="ml-1 opacity-80">
                  (<Money amount={actual} showConverted={false} />)
                </span>
              </Button>
            ) : null
          ) : null}
        </section>

        {/* Vendor payment */}
        {vendorJob ? (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold">Service provider payment</h4>
              <StatusBadge tone={vendorPaid ? "success" : "warning"}>
                {vendorPaid ? "Paid" : "Not paid"}
              </StatusBadge>
            </div>
            {isSupervisor ? (
              vendorPaid ? (
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
                  <span>
                    {cost?.vendorPayment?.method || "Paid"}
                    {cost?.vendorPayment?.reference ? ` · ${cost.vendorPayment.reference}` : ""}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() =>
                      void run(
                        "unpaid",
                        () => taskActions.cost(task._id, { vendorPayment: { status: "unpaid" } }),
                        "Marked unpaid",
                      )
                    }
                  >
                    Undo
                  </Button>
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                  <div className="space-y-1.5">
                    <Label htmlFor="pay-method">Method</Label>
                    <Input
                      id="pay-method"
                      value={payMethod}
                      maxLength={60}
                      placeholder="M-Pesa, bank, cash"
                      onChange={(e) => setPayMethod(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pay-ref">Reference</Label>
                    <Input
                      id="pay-ref"
                      value={payRef}
                      maxLength={120}
                      placeholder="Transaction code"
                      onChange={(e) => setPayRef(e.target.value)}
                    />
                  </div>
                  <Button
                    className="rounded-full"
                    disabled={busy !== null}
                    onClick={() =>
                      void run(
                        "paid",
                        () =>
                          taskActions.cost(task._id, {
                            vendorPayment: { status: "paid", method: payMethod, reference: payRef },
                          }),
                        "Service provider marked paid",
                      )
                    }
                  >
                    Mark paid
                  </Button>
                </div>
              )
            ) : null}
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}
