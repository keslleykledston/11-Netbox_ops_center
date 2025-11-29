import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api, getToken } from "@/lib/api";

type TenantSummary = { id: number; name: string };
type MeProfile = { id: number; email?: string; username?: string; role?: string; tenantId?: number | null };

type TenantContextValue = {
  me: MeProfile | null;
  tenants: TenantSummary[];
  selectedTenantId: string | null;
  setSelectedTenantId: (id: string | null) => void;
  loading: boolean;
  isAdmin: boolean;
};

const TenantContext = createContext<TenantContextValue | undefined>(undefined);
const STORAGE_KEY = "tenant:selected-id";

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<MeProfile | null>(null);
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [selectedTenantId, setSelectedTenantIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const token = typeof window !== "undefined" ? getToken() : "";
  const isAdmin = useMemo(() => (me?.role || "").toLowerCase() === "admin", [me?.role]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!token) {
        setMe(null);
        setTenants([]);
        setSelectedTenantIdState(null);
        return;
      }
      setLoading(true);
      try {
        const profile = await api.getMe();
        if (cancelled) return;
        setMe(profile as MeProfile);
        const isAdminProfile = (profile?.role || "").toLowerCase() === "admin";
        let tenantList: TenantSummary[] = [];
        try {
          const list = await api.listTenants();
          tenantList = (list || []).map((t: any) => ({ id: Number(t.id), name: String(t.name) }));
        } catch {
          // Se não conseguir carregar a lista, fica com vazio (user limitado)
          if (profile?.tenantId) {
            tenantList = [{ id: Number(profile.tenantId), name: `Tenant ${profile.tenantId}` }];
          }
        }
        if (cancelled) return;
        setTenants(tenantList);

        let initialTenant: string | null = null;
        if (!isAdminProfile && profile?.tenantId) {
          initialTenant = String(profile.tenantId);
        } else if (isAdminProfile) {
          const saved = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
          const validSaved = tenantList.find((t) => String(t.id) === saved);
          if (validSaved) {
            initialTenant = String(validSaved.id);
          } else if (tenantList[0]) {
            initialTenant = String(tenantList[0].id);
          }
        }
        setSelectedTenantIdState(initialTenant);
        if (isAdminProfile && initialTenant) {
          localStorage.setItem(STORAGE_KEY, initialTenant);
        } else if (!isAdminProfile) {
          localStorage.removeItem(STORAGE_KEY);
        }
      } catch {
        if (!cancelled) {
          setMe(null);
          setTenants([]);
          setSelectedTenantIdState(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const setSelectedTenantId = (id: string | null) => {
    setSelectedTenantIdState(id);
    if (isAdmin) {
      if (id) localStorage.setItem(STORAGE_KEY, id);
      else localStorage.removeItem(STORAGE_KEY);
    }
  };

  const value = useMemo(
    () => ({
      me,
      tenants,
      selectedTenantId,
      setSelectedTenantId,
      loading,
      isAdmin,
    }),
    [me, tenants, selectedTenantId, loading, isAdmin]
  );

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenantContext() {
  const ctx = useContext(TenantContext);
  if (!ctx) {
    throw new Error("useTenantContext must be used within a TenantProvider");
  }
  return ctx;
}
