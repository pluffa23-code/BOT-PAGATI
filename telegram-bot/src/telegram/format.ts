export function formatBotMessage(action: string, emoji: string, detail: string): string {
  return `• ${action}\n${emoji} ${detail}`;
}

export function formatEuro(amount: string | number): string {
  const parsed = typeof amount === "number" ? amount : Number(amount);
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
  }).format(parsed);
}

export function parseEuroAmount(value: string): string | null {
  const input = value.trim().replace(/\s/g, "");
  if (!input || input.length > 24) {
    return null;
  }

  let normalized = input;
  const comma = input.lastIndexOf(",");
  const dot = input.lastIndexOf(".");

  if (comma !== -1 && dot !== -1) {
    if (comma > dot) {
      normalized = input.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = input.replace(/,/g, "");
    }
  } else if (comma !== -1) {
    normalized = input.replace(/\./g, "").replace(",", ".");
  }

  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    return null;
  }

  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 999_999_999.99) {
    return null;
  }

  return amount.toFixed(2);
}

export function normalizeProductName(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("it-IT");
}

export function cleanText(value: string, maxLength = 120): string | null {
  const cleaned = value.trim().replace(/\s+/g, " ");
  if (
    cleaned.length === 0 ||
    cleaned.length > maxLength ||
    /[\u0000-\u001f\u007f]/.test(cleaned)
  ) {
    return null;
  }
  return cleaned;
}

export function formatTimestamp(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "data non disponibile";
  }
  return new Intl.DateTimeFormat("it-IT", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Rome",
  }).format(date);
}
