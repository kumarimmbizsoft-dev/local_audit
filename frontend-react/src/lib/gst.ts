// Client-side GST helpers: instant format feedback while the backend does
// the authoritative validation (checksum + duplicates).

export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

// Valid Indian GST state codes (first two digits of a GSTIN).
export const GST_STATE_CODES: Record<string, string> = {
  "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab",
  "04": "Chandigarh", "05": "Uttarakhand", "06": "Haryana", "07": "Delhi",
  "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim",
  "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur", "15": "Mizoram",
  "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal",
  "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh",
  "24": "Gujarat", "26": "Dadra & Nagar Haveli and Daman & Diu", "27": "Maharashtra",
  "28": "Andhra Pradesh (old)", "29": "Karnataka", "30": "Goa", "31": "Lakshadweep",
  "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry",
  "35": "Andaman & Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh",
  "38": "Ladakh", "97": "Other Territory",
};

export type HintLevel = "ok" | "warning" | "error";
export interface Hint {
  level: HintLevel;
  message: string;
}

export function quickGstinHint(gstin: string): Hint | null {
  const g = (gstin || "").trim().toUpperCase();
  if (!g) return null;
  if (g.length >= 2) {
    const sc = g.slice(0, 2);
    if (/^[0-9]{2}$/.test(sc) && !GST_STATE_CODES[sc])
      return { level: "error", message: `Invalid state code "${sc}"` };
  }
  if (g.length < 15) return { level: "warning", message: `${15 - g.length} more characters` };
  if (!GSTIN_RE.test(g)) return { level: "error", message: "Invalid GSTIN format" };
  return { level: "ok", message: `Format valid · ${GST_STATE_CODES[g.slice(0, 2)]}` };
}

export function quickPanHint(pan: string): Hint | null {
  const p = (pan || "").trim().toUpperCase();
  if (!p) return null;
  if (!PAN_RE.test(p)) return { level: "error", message: "PAN must match AAAAA0000A" };
  return { level: "ok", message: "Valid PAN format" };
}
