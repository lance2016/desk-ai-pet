import { linkIconPlatform } from "../platform/linkIcons";

const MAX_CACHED_PAGES = 200;
const MAX_DECLARED_ICONS = 3;
const cache = new Map<string, Promise<string | null>>();

function sameOriginIcon(href: string, base: string, origin: string): string | null {
  try {
    const url = new URL(href, base);
    const isWeb = url.protocol === "http:" || url.protocol === "https:";
    return isWeb && url.origin === origin && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function declaredIcons(html: string, page: URL): string[] {
  // Template contents are inert. Only read the link attributes and never attach this HTML.
  const template = document.createElement("template");
  template.innerHTML = html;
  const baseHref = template.content.querySelector("base[href]")?.getAttribute("href");
  const base = baseHref ? sameOriginIcon(baseHref, page.href, page.origin) ?? page.href : page.href;
  const icons = new Set<string>();
  for (const element of template.content.querySelectorAll('link[rel~="icon" i][href], link[rel~="apple-touch-icon" i][href]')) {
    const href = element.getAttribute("href")?.trim();
    const candidate = href && sameOriginIcon(href, base, page.origin);
    if (candidate) icons.add(candidate);
    if (icons.size === MAX_DECLARED_ICONS) break;
  }
  return [...icons];
}

async function loadIcon(page: URL): Promise<string | null> {
  const metadata = await linkIconPlatform.page(page.href);
  const candidates = new Set([
    ...(metadata ? declaredIcons(metadata.html, new URL(metadata.url)) : []),
    new URL("/favicon.ico", page).href,
  ]);
  for (const url of candidates) {
    const source = await linkIconPlatform.image(page.href, url);
    if (!source) continue;
    const image = new Image();
    image.src = source;
    try {
      await image.decode();
      return source;
    } catch {
      // Some servers serve an error page or a damaged image at the icon URL.
    }
  }
  return null;
}

export function getLinkIcon(url: string): Promise<string | null> {
  const page = new URL(url);
  page.search = "";
  page.hash = "";
  const existing = cache.get(page.href);
  if (existing) return existing;
  if (cache.size >= MAX_CACHED_PAGES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  const result = loadIcon(page).catch(() => null);
  cache.set(page.href, result);
  return result;
}
