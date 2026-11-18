import { URL } from "url";
import { Buffer } from "buffer";

export const MAX_ITEMS = 200;
export const MAX_FEEDS = 50;

export function webUrl(value, base) {
  try {
    const url = new URL(String(value).trim(), base);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

function entities(text) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (all, name) => {
    if (name[0] !== "#") return named[name.toLowerCase()];
    const n = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "�";
  });
}

export function plain(text) {
  return entities(text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

// QuickJS has no DOMParser. This bounded XML reader handles feed data only;
// it never resolves DTDs/entities or renders publisher-supplied markup.
function xml(source, base) {
  if (Buffer.byteLength(source, "utf8") > 1024 * 1024) throw new Error("订阅内容超过 1 MiB。");
  const doc = { name: "", children: [], text: "", attrs: {}, base }, stack = [doc];
  const tokens = /<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<[^>"']*(?:"[^"]*"[^>"']*|'[^']*'[^>"']*)*>|[^<]+/g;
  let count = 0, end = 0;
  for (const match of source.matchAll(tokens)) {
    if (match.index !== end) throw new Error("订阅 XML 格式不完整。");
    const token = match[0]; end = match.index + token.length;
    const parent = stack[stack.length - 1];
    if (token.startsWith("<!--") || token.startsWith("<?")) continue;
    if (token.startsWith("<![CDATA[")) { parent.text += token.slice(9, -3); continue; }
    if (token.startsWith("<!")) throw new Error("不支持包含 DTD 的订阅。");
    if (token.startsWith("</")) {
      if (stack.length === 1 || token.slice(2, -1).trim() !== parent.tag) throw new Error("订阅 XML 标签不匹配。");
      stack.pop();
      if (!["script", "style"].includes(parent.name)) stack[stack.length - 1].text += ` ${parent.text} `;
    } else if (token.startsWith("<")) {
      const opening = /^<([\w:.-]+)([\s\S]*?)\/?\s*>$/.exec(token);
      if (!opening || ++count > 20000 || stack.length > 64) throw new Error("订阅 XML 过于复杂或格式错误。");
      const attrs = {};
      for (const a of opening[2].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = entities(a[2] ?? a[3]);
      const node = { tag: opening[1], name: opening[1].split(":").pop().toLowerCase(), attrs, children: [], text: "" };
      node.base = attrs["xml:base"] ? webUrl(attrs["xml:base"], parent.base) : parent.base;
      parent.children.push(node);
      if (!/\/\s*>$/.test(token)) stack.push(node);
    } else parent.text += entities(token);
  }
  if (end !== source.length || stack.length !== 1 || doc.children.length !== 1) throw new Error("订阅 XML 格式不完整。");
  return doc.children[0];
}

const child = (node, name) => node?.children.find(c => c.name === name);
const text = (node, ...names) => {
  for (const name of names) {
    const value = child(node, name)?.text;
    if (value?.trim()) return plain(value);
  }
  return "";
};

export function parseFeed(source, url) {
  const root = xml(source.replace(/^\uFEFF/, "").trim(), url);
  const atom = root.name === "feed";
  const channel = atom ? root : root.name === "rss" || root.name === "rdf" ? child(root, "channel") : null;
  if (!channel) throw new Error("这个地址没有返回 RSS 或 Atom 订阅。");
  const entries = (root.name === "rdf" ? root : channel).children.filter(c => c.name === (atom ? "entry" : "item"));
  const items = [], seen = new Set();
  for (const entry of entries) {
    const links = entry.children.filter(c => c.name === "link");
    const link = atom ? links.find(c => (!c.attrs.rel || c.attrs.rel === "alternate") && (!c.attrs.type || /html/.test(c.attrs.type))) : links[0];
    const guid = child(entry, "guid");
    const href = atom ? link?.attrs.href : link?.text || (guid?.attrs.isPermaLink !== "false" ? guid?.text : "");
    const itemUrl = href ? webUrl(href, link?.base || entry.base || root.base || url) : null;
    const title = text(entry, "title") || "无标题";
    const rawDate = text(entry, "published", "pubdate", "date", "updated");
    const date = Date.parse(rawDate);
    const published = Number.isFinite(date) ? date : 0;
    const id = text(entry, "id", "guid") || itemUrl || `${title}\n${rawDate}`;
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({ id, title: title.slice(0, 500), url: itemUrl, summary: text(entry, "summary", "description", "encoded", "content").slice(0, 1500), published });
  }
  items.sort((a, b) => b.published - a.published);
  return { title: text(channel, "title").slice(0, 200) || new URL(url).hostname, items: items.slice(0, MAX_ITEMS) };
}

export async function loadFeed(url, fetcher = fetch) {
  const response = await fetcher(url, { headers: { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5" } });
  if (!response.ok) throw new Error(`刷新失败：HTTP ${response.status}`);
  return parseFeed(await response.text(), response.url || url);
}
