// /tour: the reviewer index (09-ux.md §7 "review frames live outside the product chrome"). Not in the main nav.
import { useEffect } from "react";
import { ReviewPanel } from "@/components/layout/ReviewMenu";
import { usePhoneTitle } from "@/components/layout/TopBar";
import { fmt, useT } from "@/i18n";

export default function TourPage() {
  const t = useT();
  usePhoneTitle(t.review.title);
  useEffect(() => {
    document.title = fmt(t.app.pageTitle, { page: t.review.title });
  }, [t]);
  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="rounded-lg border border-dashed border-border-strong bg-well p-4 sm:p-6">
        <h1 className="font-display text-2xl leading-8 font-heading text-text-strong">{t.review.title}</h1>
        <p className="mt-1 text-sm text-text-muted">
          {t.review.lead} {t.review.shortcut}
        </p>
        <div className="mt-6">
          <ReviewPanel />
        </div>
      </div>
    </div>
  );
}
