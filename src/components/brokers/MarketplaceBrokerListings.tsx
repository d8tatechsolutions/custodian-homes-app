"use client";

import { Bath, BedDouble, MapPin } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { UsdHint } from "@/components/money/Money";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/fx-math";
import type { PublicBrokerListing } from "@/types/brokers";

interface Props {
  county?: string;
  maxPrice?: number | "";
  search?: string;
}

/**
 * Approved listings from brokers (properties not managed on the platform),
 * shown below the platform's own listings and clearly labelled. Renders
 * nothing when there are none (or the broker release is off).
 */
export function MarketplaceBrokerListings({ county, maxPrice, search }: Props) {
  const [rows, setRows] = useState<PublicBrokerListing[]>([]);
  const [purpose, setPurpose] = useState<"all" | "rent" | "sale">("all");

  useEffect(() => {
    let ignore = false;
    const params = new URLSearchParams();
    if (county?.trim()) params.set("county", county.trim());
    if (maxPrice !== "" && maxPrice !== undefined && Number(maxPrice) > 0)
      params.set("maxPrice", String(maxPrice));
    if (purpose !== "all") params.set("purpose", purpose);
    fetch(`/api/v1/marketplace/broker-listings?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((j) => !ignore && setRows(j.data ?? []))
      .catch(() => !ignore && setRows([]));
    return () => {
      ignore = true;
    };
  }, [county, maxPrice, purpose]);

  const needle = (search ?? "").trim().toLowerCase();
  const visible = needle
    ? rows.filter((r) =>
        `${r.title} ${r.area} ${r.county} ${r.propertyType}`.toLowerCase().includes(needle),
      )
    : rows;
  if (rows.length === 0 && purpose === "all") return null;

  return (
    <section className="mt-14 space-y-5" aria-labelledby="broker-listings-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2
            id="broker-listings-heading"
            className="font-display text-2xl font-semibold tracking-tight"
          >
            From brokers
          </h2>
          <p className="text-sm text-muted-foreground">
            Properties marketed by verified brokers and checked by our team. Enquiries go to the
            broker.
          </p>
        </div>
        <fieldset className="inline-flex rounded-full border border-border p-0.5">
          <legend className="sr-only">Show</legend>
          {(["all", "rent", "sale"] as const).map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={purpose === p}
              onClick={() => setPurpose(p)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${purpose === p ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
            >
              {p === "all" ? "All" : p === "rent" ? "For rent" : "For sale"}
            </button>
          ))}
        </fieldset>
      </div>
      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">No broker listings match these filters.</p>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((item) => (
            <Link key={item.id} href={`/marketplace/broker/${item.id}`} className="group block">
              <div className="overflow-hidden rounded-2xl border border-border bg-card transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
                <div className="relative aspect-[16/10] w-full overflow-hidden bg-muted">
                  {item.photos[0] ? (
                    // biome-ignore lint/performance/noImgElement: broker-uploaded photos from the upload CDN
                    <img
                      src={item.photos[0]}
                      alt={item.title}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                      loading="lazy"
                    />
                  ) : null}
                  <Badge className="absolute left-3 top-3 bg-background/90 text-foreground backdrop-blur-md">
                    For {item.purpose}
                  </Badge>
                  <Badge className="absolute right-3 top-3 bg-primary text-primary-foreground">
                    {formatCurrency(item.price, "KES")}
                    {item.purpose === "rent" ? (
                      <span className="text-xs font-normal">/mo</span>
                    ) : null}
                  </Badge>
                </div>
                <div className="p-5">
                  <p className="text-xs font-medium uppercase tracking-wider text-primary">
                    Listed by {item.listedBy}
                  </p>
                  <h3 className="mt-1 line-clamp-1 text-lg font-semibold tracking-tight group-hover:text-primary">
                    {item.title}
                  </h3>
                  <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">
                      {item.area}, {item.county}
                    </span>
                  </div>
                  <UsdHint amount={item.price} className="mt-1 block" />
                  <div className="mt-4 flex items-center gap-4 border-t border-border pt-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <BedDouble className="h-4 w-4 text-foreground/70" /> {item.bedrooms} Bed
                    </span>
                    <span className="flex items-center gap-1">
                      <Bath className="h-4 w-4 text-foreground/70" /> {item.bathrooms} Bath
                    </span>
                    {item.propertyType ? (
                      <span className="ml-auto font-medium text-foreground/80">
                        {item.propertyType}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
