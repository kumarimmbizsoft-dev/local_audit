// Thin fetch wrapper around the FastAPI backend. Uses same-origin "/api"
// (Vite proxies this to the backend in dev; FastAPI serves it in prod).

const TOKEN_KEY = "access_token";
const COMPANY_KEY = "active_company_id";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function getActiveCompanyId(): string | null {
  return localStorage.getItem(COMPANY_KEY);
}

export interface ApiResult<T = any> {
  ok: boolean;
  status: number;
  data: T;
}

const inFlightGets = new Map<string, Promise<ApiResult<any>>>();

async function request<T = any>(
  method: string,
  path: string,
  body?: unknown
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const tok = getToken();
  if (tok) headers["Authorization"] = "Bearer " + tok;
  const companyId = getActiveCompanyId();
  if (companyId) headers["X-Company-Id"] = companyId;

  if (path.includes("/demo-login")) {
    headers["X-Demo-Mode"] = "true";
  } else {
    const userStr = localStorage.getItem("auth_user");
    if (userStr) {
      try {
        const u = JSON.parse(userStr);
        if (u?.user_type === "D" || u?.is_demo) {
          headers["X-Demo-Mode"] = "true";
        }
      } catch {}
    }
  }

  const res = await fetch("/api" + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    clearToken();
    window.dispatchEvent(new CustomEvent("auth:unauthorized"));
  }

  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data };
}

export interface RequestOptions {
  params?: Record<string, any>;
  skipCache?: boolean;
}

interface CacheEntry {
  expiresAt: number;
  result: ApiResult<any>;
}

const responseCache = new Map<string, CacheEntry>();

export function clearApiCache(pathPrefix?: string) {
  if (!pathPrefix) {
    responseCache.clear();
    return;
  }
  for (const k of responseCache.keys()) {
    if (k.includes(pathPrefix)) {
      responseCache.delete(k);
    }
  }
}

function getCacheTtl(path: string): number {
  if (path.startsWith("/lov/")) return 60_000;
  if (path.startsWith("/plans")) return 60_000;
  if (path.startsWith("/companies")) return 30_000;
  if (path.startsWith("/dashboard/")) return 15_000;
  return 0;
}

function getRequest<T = any>(
  path: string,
  options?: RequestOptions
): Promise<ApiResult<T>> {
  let fullPath = path;
  if (options?.params) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(options.params)) {
      if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
    }
    const qs = sp.toString();
    if (qs) {
      fullPath += (path.includes("?") ? "&" : "?") + qs;
    }
  }

  const key = `${getToken() || ""}\0${getActiveCompanyId() || ""}\0${fullPath}`;

  const ttl = getCacheTtl(path);
  if (!options?.skipCache && ttl > 0) {
    const cached = responseCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return Promise.resolve(cached.result as ApiResult<T>);
    }
  }

  const existing = inFlightGets.get(key);
  if (existing) return existing as Promise<ApiResult<T>>;

  const pending = request<T>("GET", fullPath)
    .then((res) => {
      if (res.ok && ttl > 0) {
        responseCache.set(key, {
          expiresAt: Date.now() + ttl,
          result: res,
        });
      }
      return res;
    })
    .finally(() => {
      if (inFlightGets.get(key) === pending) inFlightGets.delete(key);
    });
  inFlightGets.set(key, pending);
  return pending;
}

async function mutatingRequest<T = any>(
  method: string,
  path: string,
  body?: unknown
): Promise<ApiResult<T>> {
  const res = await request<T>(method, path, body);
  if (res.ok) {
    clearApiCache();
  }
  return res;
}

export const api = {
  get: <T = any>(p: string, options?: RequestOptions) =>
    getRequest<T>(p, options),
  post: <T = any>(p: string, b?: unknown) => mutatingRequest<T>("POST", p, b),
  put: <T = any>(p: string, b?: unknown) => mutatingRequest<T>("PUT", p, b),
  patch: <T = any>(p: string, b?: unknown) => mutatingRequest<T>("PATCH", p, b),
  del: <T = any>(p: string) => mutatingRequest<T>("DELETE", p),
  clearCache: clearApiCache,
};

// AppResponse envelope helpers ({ status, message, result })
export function envelopeResult<T = any>(r: ApiResult): T | null {
  return (r.data && (r.data.result ?? null)) as T | null;
}
export function envelopeOk(r: ApiResult): boolean {
  return r.ok && r.data?.status !== "ERROR";
}
export function envelopeMessage(r: ApiResult): string {
  return r.data?.message || r.data?.detail || "Something went wrong";
}
