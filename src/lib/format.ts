export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatRelativeTime(timestamp: number, locale: string): string {
  if (!timestamp) return "";
  const delta = Date.now() - timestamp;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (delta < minute) return formatter.format(0, "minute");
  if (delta < hour) return formatter.format(-Math.round(delta / minute), "minute");
  if (delta < day) return formatter.format(-Math.round(delta / hour), "hour");
  if (delta < 30 * day) return formatter.format(-Math.round(delta / day), "day");
  return new Date(timestamp).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(timestamp: number, locale: string): string {
  return new Date(timestamp).toLocaleString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function shortenPath(path: string, max = 54): string {
  if (path.length <= max) return path;
  const home = path.replace(/^\/Users\/[^/]+/, "~");
  if (home.length <= max) return home;
  return `…${home.slice(home.length - max + 1)}`;
}
