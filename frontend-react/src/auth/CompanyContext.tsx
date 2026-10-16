import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, envelopeResult } from "../lib/api";
import { useAuth } from "./AuthContext";

const STORAGE_KEY = "active_company_id";

export interface CompanySummary {
  id: string;
  company_name: string;
  is_default: string;
  maintain_mode: "ACCOUNT_ONLY" | "ACCOUNT_WITH_INVENTORY";
  gstin?: string | null;
  currency?: string | null;
  financial_year_start?: string | null;
  financial_year_end?: string | null;
}

interface CompanyContextValue {
  companies: CompanySummary[];
  company: CompanySummary | null;
  companyId: string | null;
  loading: boolean;
  switchCompany: (id: string) => void;
  refreshCompanies: () => Promise<void>;
}

const CompanyContext = createContext<CompanyContextValue | null>(null);

export function CompanyProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [companies, setCompanies] = useState<CompanySummary[]>([]);
  const [companyId, setCompanyId] = useState<string | null>(
    () => localStorage.getItem(STORAGE_KEY)
  );
  const [loading, setLoading] = useState(false);

  const refreshCompanies = useCallback(async () => {
    if (!isAuthenticated) {
      setCompanies([]);
      return;
    }
    setLoading(true);
    try {
      const r = await api.get("/companies");
      const list = envelopeResult<CompanySummary[]>(r) || [];
      setCompanies(list);
      setCompanyId((prev) => {
        const stored = prev || localStorage.getItem(STORAGE_KEY);
        if (stored && list.some((c) => c.id === stored)) return stored;
        const def = list.find((c) => c.is_default === "Y") || list[0];
        if (def) {
          localStorage.setItem(STORAGE_KEY, def.id);
          return def.id;
        }
        localStorage.removeItem(STORAGE_KEY);
        return null;
      });
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    refreshCompanies();
  }, [isAuthenticated, refreshCompanies]);

  const switchCompany = useCallback((id: string) => {
    localStorage.setItem(STORAGE_KEY, id);
    setCompanyId(id);
  }, []);

  const company = useMemo(
    () => companies.find((c) => c.id === companyId) || null,
    [companies, companyId]
  );

  const value = useMemo(
    () => ({
      companies,
      company,
      companyId,
      loading,
      switchCompany,
      refreshCompanies,
    }),
    [companies, company, companyId, loading, switchCompany, refreshCompanies]
  );

  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
}

export function useCompany() {
  const ctx = useContext(CompanyContext);
  if (!ctx) throw new Error("useCompany must be used within CompanyProvider");
  return ctx;
}
