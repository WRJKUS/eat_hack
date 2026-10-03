import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { ShopConfig } from "@cm/shared";
import { api, getToken } from "../api";
import { useAsync } from "./useAsync";

const SHOP_KEY = "cm.shopId";

interface ShopCtx {
  shops: ShopConfig[];
  shop: ShopConfig | undefined;
  shopId: string | undefined;
  setShopId: (id: string) => void;
  loading: boolean;
  error: Error | undefined;
  reloadShops: () => void;
  /** bumps when the token changes so pages refetch */
  tokenVersion: number;
  bumpToken: () => void;
}

const Ctx = createContext<ShopCtx | null>(null);

function readStoredShop(): string | undefined {
  try {
    return localStorage.getItem(SHOP_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function ShopProvider({ children }: { children: ReactNode }) {
  const [tokenVersion, setTokenVersion] = useState(0);
  const shopsQ = useAsync(() => api.shops(), [tokenVersion]);
  const [chosen, setChosen] = useState<string | undefined>(readStoredShop);

  const shops = useMemo(() => shopsQ.data ?? [], [shopsQ.data]);
  const shop = shops.find((s) => s.id === chosen) ?? shops.find((s) => s.id === "demo") ?? shops[0];

  const setShopId = useCallback((id: string) => {
    setChosen(id);
    try {
      localStorage.setItem(SHOP_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  const value: ShopCtx = {
    shops,
    shop,
    shopId: shop?.id,
    setShopId,
    loading: shopsQ.loading,
    error: shopsQ.error,
    reloadShops: shopsQ.reload,
    tokenVersion,
    bumpToken: () => setTokenVersion((v) => v + 1),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useShop(): ShopCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useShop outside ShopProvider");
  return c;
}

export { getToken };

/** Load shop-scoped data; refetches when the shop or the owner token changes. */
export function useShopQuery<T>(fn: (shopId: string) => Promise<T>, extraDeps: unknown[] = []) {
  const { shopId, tokenVersion } = useShop();
  return useAsync(() => fn(shopId!), [shopId, tokenVersion, ...extraDeps], !!shopId);
}
