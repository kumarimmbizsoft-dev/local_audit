const inr2 = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function money(v: number | string | null | undefined): string {
  if (v === null || v === undefined) return inr2.format(0);
  const num = typeof v === "number" ? v : parseFloat(String(v));
  if (isNaN(num) || !isFinite(num)) return inr2.format(0);
  return inr2.format(num);
}

export function fmtDate(v: string | Date | null | undefined): string {
  if (!v) return "—";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split("-");
    return `${d}/${m}/${y}`;
  }
  const d = typeof v === "string" ? new Date(v) : v;
  if (isNaN(d.getTime())) return "—";
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

export function fmtDateTime(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const str = typeof v === "string" ? v : v.toISOString();
  const d = new Date(str.endsWith("Z") || str.includes("+") ? str : str + "Z");
  if (isNaN(d.getTime())) return "—";
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, "0");
  const mins = String(d.getMinutes()).padStart(2, "0");
  return `${day}/${month}/${year} ${hours}:${mins}`;
}

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function amountInWords(amount: number | null | undefined): string {
  const n = Math.round(Number(amount || 0));
  if (n <= 0) return "Zero Rupees Only";

  const ones = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
    "Seventeen", "Eighteen", "Nineteen"
  ];
  const tens = [
    "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"
  ];

  function numToWords(num: number): string {
    if (num === 0) return "";
    if (num < 20) return ones[num] + " ";
    if (num < 100) return tens[Math.floor(num / 10)] + " " + numToWords(num % 10);
    if (num < 1000) return ones[Math.floor(num / 100)] + " Hundred " + numToWords(num % 100);
    if (num < 100000) return numToWords(Math.floor(num / 1000)) + "Thousand " + numToWords(num % 1000);
    if (num < 10000000) return numToWords(Math.floor(num / 100000)) + "Lakh " + numToWords(num % 100000);
    return numToWords(Math.floor(num / 10000000)) + "Crore " + numToWords(num % 10000000);
  }

  return "INR " + numToWords(n).trim() + " Only";
}
