import { useEffect } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useToast } from "@/hooks/useToast";

/**
 * Landing route Stripe (via the agora-pay service) returns donors to after a
 * fiat checkout. The pay server redirects here as
 * `/donate/callback?status=success|cancel&naddr=<campaign>&session_id=<id>`.
 *
 * At the most basic level we just surface the outcome as a toast and bounce
 * the donor back to the campaign page (`/:naddr`). Donations are recorded by
 * the pay server's Stripe webhook — the source of truth — so there is nothing
 * to persist here; the redirect only reflects the checkout outcome.
 *
 * If `naddr` is missing we can't build a campaign URL, so we fall back to the
 * home page.
 */
export function DonateCallbackPage() {
  const [params] = useSearchParams();
  const { t } = useTranslation();
  const { toast } = useToast();

  const status = params.get("status");
  const naddr = params.get("naddr");

  useEffect(() => {
    if (status === "success") {
      toast({
        title: t("donateCallback.successTitle"),
        description: t("donateCallback.successDescription"),
      });
    } else if (status === "cancel") {
      toast({
        title: t("donateCallback.cancelTitle"),
        description: t("donateCallback.cancelDescription"),
        variant: "destructive",
      });
    }
  }, [status, toast, t]);

  return <Navigate to={naddr ? `/${naddr}` : "/"} replace />;
}

export default DonateCallbackPage;
