import { api } from "../api";
import { useShop } from "../lib/shop";
import { FeedbackPanel } from "../components/Feedback";
import { NoShop, PageHeader } from "../components/ui";

export function AiReportPage() {
  const { shop, loading, tokenVersion } = useShop();
  if (!shop) return loading ? null : <NoShop />;
  return (
    <div>
      <PageHeader
        title="AI shop report"
        subtitle={<>Aggregate recommendations for <span className="font-medium text-zinc-700 dark:text-zinc-300">{shop.name}</span> across all recorded sessions — prioritised, with evidence links into the replays.</>}
      />
      <FeedbackPanel
        key={shop.id}
        scopeLabel="all sessions of this shop"
        load={() => api.shopFeedback(shop.id)}
        generate={() => api.generateShopFeedback(shop.id)}
        deps={[shop.id, tokenVersion]}
      />
    </div>
  );
}
