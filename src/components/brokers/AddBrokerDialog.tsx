"use client";

import { Check, Copy, Loader2, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  CommissionTermsFields,
  EMPTY_TERMS,
  type TermsDraft,
  termsComplete,
  termsPayload,
} from "@/components/brokers/CommissionTermsFields";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest } from "@/hooks/use-maintenance";
import { useProperties } from "@/hooks/use-properties";

interface Props {
  /** Owners may also authorise the broker on their own properties. */
  inviterRole: "admin" | "system-admin";
  currentUserId: string;
  onAdded?: () => void;
}

interface Invite {
  inviteUrl: string;
  inviteExpiresAt: string;
  name: string;
}

/**
 * "Add broker": creates a verified broker account straight away (client
 * decision) and shows a set-password link to share with them.
 */
export function AddBrokerDialog({ inviterRole, currentUserId, onAdded }: Props) {
  const [open, setOpen] = useState(false);
  const { properties } = useProperties();
  const own = properties.filter(
    (p) => String((p as { ownerId?: string }).ownerId ?? "") === currentUserId,
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [agency, setAgency] = useState("");
  const [payoutType, setPayoutType] = useState<"mpesa" | "bank" | "none">("mpesa");
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [bankName, setBankName] = useState("");
  const [terms, setTerms] = useState<TermsDraft>(EMPTY_TERMS);
  const [propertyIds, setPropertyIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    setEmail("");
    setPhone("");
    setNationalId("");
    setAgency("");
    setPayoutType("mpesa");
    setAccountName("");
    setAccountNumber("");
    setBankName("");
    setTerms(EMPTY_TERMS);
    setPropertyIds([]);
    setInvite(null);
    setCopied(false);
  }, [open]);

  const problem =
    (name.trim().length < 2 && "Enter the full name") ||
    (!/^\S+@\S+\.\S+$/.test(email.trim()) && "Enter a valid email") ||
    (phone.trim().length < 6 && "Enter the phone with country code") ||
    (nationalId.trim().length < 4 && "Enter the national ID") ||
    (payoutType === "mpesa" && !accountNumber.trim() && "Enter the M-Pesa number") ||
    (payoutType === "bank" &&
      (!bankName.trim() || !accountNumber.trim()) &&
      "Enter the bank and account") ||
    (propertyIds.length > 0 &&
      !termsComplete(terms) &&
      "Set the commission for the chosen properties") ||
    "";

  const save = async () => {
    if (problem) return;
    setSaving(true);
    try {
      const data = await apiRequest<Invite & { id: string }>("/api/v1/brokers/invite", {
        method: "POST",
        json: {
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          nationalId: nationalId.trim(),
          agencyName: agency.trim(),
          payout: {
            payoutType,
            accountName: accountName.trim(),
            accountNumber: accountNumber.trim(),
            bankName: bankName.trim(),
          },
          defaultCommission: termsComplete(terms) ? termsPayload(terms) : undefined,
          propertyIds,
        },
      });
      setInvite(data);
      onAdded?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add the broker");
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.inviteUrl);
      setCopied(true);
    } catch {
      toast.error("Copy failed — select the link and copy it");
    }
  };

  return (
    <>
      <Button className="rounded-full" onClick={() => setOpen(true)}>
        <UserPlus className="mr-1.5 h-4 w-4" /> Add broker
      </Button>
      <Dialog open={open} onOpenChange={(o) => !saving && setOpen(o)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          {invite ? (
            <>
              <DialogHeader>
                <DialogTitle>Broker added</DialogTitle>
                <DialogDescription>
                  Send {invite.name} this link to set their password. It works once and expires in
                  24 hours; you can issue a new one from the broker list.
                </DialogDescription>
              </DialogHeader>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={invite.inviteUrl}
                  aria-label="Set-password link"
                  onFocus={(e) => e.target.select()}
                />
                <Button variant="outline" onClick={() => void copy()} aria-label="Copy link">
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <DialogFooter>
                <Button className="rounded-full" onClick={() => setOpen(false)}>
                  Done
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Add a broker</DialogTitle>
                <DialogDescription>
                  The account is verified straight away; no sign-up or approval step.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="ab-name">Full name</Label>
                    <Input
                      id="ab-name"
                      value={name}
                      maxLength={120}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ab-email">Email</Label>
                    <Input
                      id="ab-email"
                      type="email"
                      value={email}
                      maxLength={200}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ab-phone">Phone</Label>
                    <Input
                      id="ab-phone"
                      type="tel"
                      value={phone}
                      maxLength={32}
                      placeholder="+2547…"
                      onChange={(e) => setPhone(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ab-id">National ID</Label>
                    <Input
                      id="ab-id"
                      value={nationalId}
                      maxLength={32}
                      autoComplete="off"
                      onChange={(e) => setNationalId(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ab-agency">Agency / company</Label>
                    <Input
                      id="ab-agency"
                      value={agency}
                      maxLength={160}
                      onChange={(e) => setAgency(e.target.value)}
                    />
                  </div>
                </div>

                <fieldset className="space-y-3 rounded-2xl border border-border p-4">
                  <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Payouts
                  </legend>
                  <Select
                    value={payoutType}
                    onValueChange={(v) => setPayoutType(v as typeof payoutType)}
                  >
                    <SelectTrigger aria-label="Payout method">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mpesa">M-Pesa</SelectItem>
                      <SelectItem value="bank">Bank</SelectItem>
                      <SelectItem value="none">Add later</SelectItem>
                    </SelectContent>
                  </Select>
                  {payoutType !== "none" ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {payoutType === "bank" ? (
                        <div className="space-y-1.5 sm:col-span-2">
                          <Label htmlFor="ab-bank">Bank</Label>
                          <Input
                            id="ab-bank"
                            value={bankName}
                            maxLength={120}
                            onChange={(e) => setBankName(e.target.value)}
                          />
                        </div>
                      ) : null}
                      <div className="space-y-1.5">
                        <Label htmlFor="ab-acc-name">Account name</Label>
                        <Input
                          id="ab-acc-name"
                          value={accountName}
                          maxLength={120}
                          onChange={(e) => setAccountName(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="ab-acc">
                          {payoutType === "mpesa" ? "M-Pesa number" : "Account number"}
                        </Label>
                        <Input
                          id="ab-acc"
                          value={accountNumber}
                          maxLength={60}
                          onChange={(e) => setAccountNumber(e.target.value)}
                        />
                      </div>
                    </div>
                  ) : null}
                </fieldset>

                <fieldset className="space-y-3 rounded-2xl border border-border p-4">
                  <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Default commission (optional)
                  </legend>
                  <CommissionTermsFields value={terms} onChange={setTerms} />
                  <p className="text-xs text-muted-foreground">
                    Pre-filled when the broker requests to list a property.
                  </p>
                </fieldset>

                {inviterRole === "admin" && own.length > 0 ? (
                  <fieldset className="space-y-2">
                    <legend className="text-sm font-medium">
                      Let them market these properties now (optional)
                    </legend>
                    <div className="grid max-h-40 gap-2 overflow-y-auto rounded-xl border border-border p-3 sm:grid-cols-2">
                      {own.map((p) => (
                        <Label
                          key={p._id}
                          className="flex cursor-pointer items-center gap-2 font-normal"
                        >
                          <Checkbox
                            checked={propertyIds.includes(p._id)}
                            onChange={(e) =>
                              setPropertyIds((prev) =>
                                e.target.checked
                                  ? [...prev, p._id]
                                  : prev.filter((id) => id !== p._id),
                              )
                            }
                          />
                          <span className="truncate">{p.title}</span>
                        </Label>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      The broker accepts the commission terms when they first log in.
                    </p>
                  </fieldset>
                ) : null}
              </div>
              <DialogFooter className="gap-2 sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground">{problem}</p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="rounded-full"
                    disabled={saving}
                    onClick={() => setOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    className="rounded-full"
                    disabled={saving || Boolean(problem)}
                    onClick={() => void save()}
                  >
                    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Add broker
                  </Button>
                </div>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
