/**
 * Bot and scraper blocking (client decision 2026-11-26).
 *
 * - AI / data-scraping crawlers are refused everywhere (they also get a
 *   robots.txt Disallow; this enforces it for bots that ignore robots.txt).
 * - Known scraping and attack tools are refused everywhere.
 * - Requests with no user agent are refused on the API.
 *
 * Search engines (Googlebot, Bingbot, …) and social previews are allowed on
 * public pages. Machine-to-machine endpoints are never blocked: payment
 * callbacks (Safaricom/Paystack), the upload service and the Vercel cron.
 */

const AI_CRAWLERS =
  /(GPTBot|ChatGPT-User|OAI-SearchBot|CCBot|anthropic-ai|ClaudeBot|Claude-Web|Claude-SearchBot|Google-Extended|GoogleOther|PerplexityBot|Perplexity-User|Bytespider|Amazonbot|cohere-ai|cohere-training-data-crawler|Diffbot|Omgilibot|Omgili|FacebookBot|meta-externalagent|meta-externalfetcher|Applebot-Extended|ImagesiftBot|YouBot|Timpibot|Kangaroo Bot|PanguBot|Scrapy|img2dataset|AI2Bot|Ai2Bot-Dolma|DuckAssistBot|MistralAI-User|Webzio-Extended|iaskspider|ICC-Crawler|Sidetrade)/i;

const BAD_TOOLS =
  /(python-requests|python-urllib|aiohttp|python-httpx|Go-http-client|libwww-perl|HTTrack|WebCopier|WebZIP|Teleport|SiteSnagger|nikto|sqlmap|nmap|masscan|zgrab|nuclei|dirbuster|gobuster|wpscan|acunetix|netsparker|jorgee|ZmEu|MJ12bot|DotBot|PetalBot|BLEXBot|SeznamBot\/3\.2-test|DataForSeoBot|serpstatbot|Barkrowler)/i;

/** Paths that machines legitimately call without a browser user agent. */
const MACHINE_PATHS = [/^\/api\/v1\/payments\//, /^\/api\/uploadthing/, /^\/api\/v1\/cron\//];

export type BotVerdict = "ai-crawler" | "bad-tool" | "no-user-agent" | null;

export function botVerdict(pathname: string, userAgent: string | null | undefined): BotVerdict {
  if (MACHINE_PATHS.some((p) => p.test(pathname))) return null;
  const ua = (userAgent ?? "").trim();
  if (!ua) return pathname.startsWith("/api/") ? "no-user-agent" : null;
  if (AI_CRAWLERS.test(ua)) return "ai-crawler";
  if (BAD_TOOLS.test(ua)) return "bad-tool";
  return null;
}
