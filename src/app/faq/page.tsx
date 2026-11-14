import type { Metadata } from "next";
import { MarketingShell } from "@/components/MarketingShell";
import { Faq } from "@/components/marketing/Faq";
import { BRAND, BRAND_TITLE_TEMPLATE } from "@/lib/brand";

export const metadata: Metadata = {
  title: { default: "FAQ", template: BRAND_TITLE_TEMPLATE },
  description: `Frequently asked questions about ${BRAND.name}.`,
};

export default function FaqPage() {
  return (
    <MarketingShell>
      <Faq />
      <section className="container pb-20">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-muted-foreground">
            Still have questions?{" "}
            <a href="/contact" className="font-medium text-primary hover:underline">
              Contact us
            </a>
            .
          </p>
        </div>
      </section>
    </MarketingShell>
  );
}
