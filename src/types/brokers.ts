import type { StoredTerms } from "@/components/brokers/CommissionTermsFields";

export interface BidOfferView extends StoredTerms {
  by: "broker" | "owner";
  message?: string;
  at: string;
}

export interface BidView {
  _id: string;
  listingId: string;
  listingHeadline: string;
  askingRent: number;
  propertyId: string;
  property: string;
  unitId: string;
  status: "pending" | "countered" | "accepted" | "rejected" | "withdrawn" | "expired";
  awaiting: "owner" | "broker" | null;
  expiresAt: string;
  createdAt: string;
  offers: BidOfferView[];
  decisionNote: string;
  shareCode: string;
  broker: { id: string; name: string; agency: string; tenantsBrought: number };
}

export interface BrokerListingView {
  _id: string;
  purpose: "rent" | "sale";
  title: string;
  description: string;
  propertyType: string;
  county: string;
  area: string;
  price: number;
  serviceCharge: number;
  depositMonths: number;
  bedrooms: number;
  bathrooms: number;
  sizeSqm: number;
  amenities: string[];
  photos: { _id: string; url: string; key?: string }[];
  exactLocation: { address: string; latitude: number | null; longitude: number | null };
  mandateDocument: { url: string; key?: string; name?: string };
  ownerContact: { name: string; phone: string };
  status: "draft" | "submitted" | "approved" | "rejected" | "expired" | "withdrawn";
  reviewNote?: string;
  approvedAt?: string | null;
  expiresAt?: string | null;
  renewals?: number;
  duplicateFlags?: number;
  submissionProblems: string[];
  updatedAt?: string;
  broker?: { name: string; email: string; phone: string; agency: string; profileStatus: string };
}

export interface PublicBrokerListing {
  id: string;
  source: "broker";
  purpose: "rent" | "sale";
  title: string;
  description: string;
  propertyType: string;
  county: string;
  area: string;
  price: number;
  serviceCharge: number;
  depositMonths: number;
  bedrooms: number;
  bathrooms: number;
  sizeSqm: number;
  amenities: string[];
  photos: string[];
  listedBy: string;
  approvedAt: string | null;
}
