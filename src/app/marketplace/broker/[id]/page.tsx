"use client";

import { ArrowLeft, Bath, BedDouble, CheckCircle2, Loader2, MapPin, Ruler } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { UsdHint } from "@/components/money/Money";
import { SiteHeader } from "@/components/SiteHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/fx-math";
import type { PublicBrokerListing } from "@/types/brokers";

export default function BrokerListingPage() {
  const { id } = useParams<{ id: string }>();
  const [listing, setListing] = useState<PublicBrokerListing | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const [photo, setPhoto] = useState(0);
  const [form, setForm] = useState({ name: "", phone: "", email: "", message: "", website: "" });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/v1/marketplace/broker-listings/${id}`)
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const j = await r.json();
        setListing(j.data);
        setState("ready");
      })
      .catch(() => setState("missing"));
  }, [id]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/marketplace/broker-listings/${id}/enquiry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not send your enquiry");
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send your enquiry");
    } finally {
      setSending(false);
    }
  };

  if (state === "loading") {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <main className="container flex items-center gap-2 py-20 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </main>
      </div>
    );
  }
  if (state === "missing" || !listing) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <main className="container py-20 text-center">
          <h1 className="font-display text-2xl font-semibold">
            This listing is no longer available
          </h1>
          <Button asChild className="mt-6 rounded-full">
            <Link href="/marketplace">Browse the marketplace</Link>
          </Button>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="container py-8">
        <Link
          href="/marketplace"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Marketplace
        </Link>
        <div className="mt-6 grid gap-8 lg:grid-cols-12">
          <div className="space-y-6 lg:col-span-8">
            <div className="overflow-hidden rounded-2xl border border-border bg-muted">
              {listing.photos[photo] ? (
                // biome-ignore lint/performance/noImgElement: broker-uploaded photos from the upload CDN
                <img
                  src={listing.photos[photo]}
                  alt={listing.title}
                  className="aspect-[16/10] w-full object-cover"
                />
              ) : null}
            </div>
            {listing.photos.length > 1 ? (
              <ul className="grid grid-cols-5 gap-2 sm:grid-cols-8">
                {listing.photos.map((p, i) => (
                  <li key={p}>
                    <button
                      type="button"
                      onClick={() => setPhoto(i)}
                      aria-label={`Photo ${i + 1}`}
                      aria-current={i === photo}
                      className={`block aspect-square w-full overflow-hidden rounded-lg border-2 ${i === photo ? "border-primary" : "border-transparent"}`}
                    >
                      {/* biome-ignore lint/performance/noImgElement: thumbnails */}
                      <img src={p} alt="" className="h-full w-full object-cover" loading="lazy" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="capitalize">
                  For {listing.purpose}
                </Badge>
                {listing.propertyType ? (
                  <Badge variant="outline">{listing.propertyType}</Badge>
                ) : null}
              </div>
              <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight">
                {listing.title}
              </h1>
              <p className="mt-2 flex items-center gap-1.5 text-muted-foreground">
                <MapPin className="h-4 w-4" /> {listing.area}, {listing.county}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Listed by {listing.listedBy} · checked by Custodian Homes
              </p>
            </div>
            <div className="flex flex-wrap gap-6 rounded-2xl border border-border p-4 text-sm">
              <span className="flex items-center gap-1.5">
                <BedDouble className="h-4 w-4" /> {listing.bedrooms} bedrooms
              </span>
              <span className="flex items-center gap-1.5">
                <Bath className="h-4 w-4" /> {listing.bathrooms} bathrooms
              </span>
              {listing.sizeSqm ? (
                <span className="flex items-center gap-1.5">
                  <Ruler className="h-4 w-4" /> {listing.sizeSqm} m²
                </span>
              ) : null}
            </div>
            {listing.description ? (
              <p className="whitespace-pre-wrap leading-relaxed">{listing.description}</p>
            ) : null}
            {listing.amenities.length > 0 ? (
              <div>
                <h2 className="font-semibold">Amenities</h2>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {listing.amenities.map((a) => (
                    <li key={a} className="rounded-full border border-border px-3 py-1 text-sm">
                      {a}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          <aside className="lg:col-span-4">
            <div className="sticky top-24 space-y-5 rounded-2xl border border-border bg-card p-6 shadow-soft">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {listing.purpose === "rent" ? "Rent" : "Asking price"}
                </p>
                <p className="mt-1 text-3xl font-bold">
                  {formatCurrency(listing.price, "KES")}
                  {listing.purpose === "rent" ? (
                    <span className="text-sm font-normal text-muted-foreground"> / month</span>
                  ) : null}
                </p>
                <UsdHint amount={listing.price} />
                {listing.purpose === "rent" && listing.serviceCharge ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    + {formatCurrency(listing.serviceCharge, "KES")} service charge
                  </p>
                ) : null}
                {listing.purpose === "rent" && listing.depositMonths ? (
                  <p className="text-sm text-muted-foreground">
                    Deposit: {listing.depositMonths} month{listing.depositMonths > 1 ? "s" : ""}
                  </p>
                ) : null}
              </div>

              {sent ? (
                <div
                  className="flex items-start gap-2 rounded-xl bg-success/10 p-4 text-sm text-success"
                  role="status"
                >
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  Thanks — the broker will contact you shortly.
                </div>
              ) : (
                <form onSubmit={send} className="space-y-3" noValidate>
                  <p className="font-medium">Ask about this property</p>
                  <div className="space-y-1.5">
                    <Label htmlFor="enq-name">Your name</Label>
                    <Input
                      id="enq-name"
                      required
                      maxLength={120}
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="enq-phone">Phone</Label>
                    <Input
                      id="enq-phone"
                      type="tel"
                      required
                      maxLength={32}
                      placeholder="+2547…"
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="enq-email">Email (optional)</Label>
                    <Input
                      id="enq-email"
                      type="email"
                      maxLength={200}
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="enq-msg">Message</Label>
                    <Textarea
                      id="enq-msg"
                      rows={3}
                      maxLength={2000}
                      value={form.message}
                      onChange={(e) => setForm({ ...form, message: e.target.value })}
                    />
                  </div>
                  {/* Honeypot for bots — hidden from people and screen readers. */}
                  <div
                    aria-hidden="true"
                    className="absolute -left-[9999px] h-0 w-0 overflow-hidden"
                  >
                    <label>
                      Website
                      <input
                        tabIndex={-1}
                        autoComplete="off"
                        value={form.website}
                        onChange={(e) => setForm({ ...form, website: e.target.value })}
                      />
                    </label>
                  </div>
                  {error ? (
                    <p className="text-sm text-destructive" role="alert">
                      {error}
                    </p>
                  ) : null}
                  <Button
                    type="submit"
                    className="w-full rounded-full"
                    disabled={sending || !form.name.trim() || form.phone.trim().length < 6}
                  >
                    {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Send enquiry
                  </Button>
                  <p className="text-center text-xs text-muted-foreground">
                    Your details go only to this broker.
                  </p>
                </form>
              )}
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
