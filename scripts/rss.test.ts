import { test, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import { webUrl, parseFeed, loadFeed, MAX_ITEMS } from "../defaults/mods/rss/feed.js";

const rss = (items: string) => `<rss version="2.0"><channel><title>测试 &amp; News</title>${items}</channel></rss>`;
const item = (id = "one") => `<item><guid isPermaLink="false">${id}</guid><title>一篇文章</title><link>/posts/${id}</link><pubDate>Tue, 17 Nov 2026 12:00:00 GMT</pubDate><description><![CDATA[<p>内容 &amp; 细节</p><script>alert(1)</script>]]></description></item>`;

test("RSS keeps Chinese, decodes entities/CDATA, resolves URLs and removes executable markup", () => {
  const result = parseFeed(rss(item()), "https://example.com/feed.xml");
  expect(result.title).toBe("测试 & News");
  expect(result.items[0]).toEqual({ id: "one", title: "一篇文章", url: "https://example.com/posts/one", summary: "内容 & 细节", published: Date.parse("2026-11-17T12:00:00Z") });
});

test("Atom chooses an alternate HTML link, honors inherited xml:base, and reads XHTML content", () => {
  const result = parseFeed(`<atom:feed xmlns:atom="http://www.w3.org/2005/Atom" xml:base="/blog/">
    <atom:title>Atom</atom:title><atom:entry xml:base="posts/">
      <atom:id>tag:example,2026:one</atom:id><atom:title>更新 &#x1f4f0;</atom:title>
      <atom:link rel="self" href="one.xml"/><atom:link rel="alternate" type="text/html" href="one#details"/>
      <atom:updated>2026-11-18T08:00:00Z</atom:updated>
      <atom:content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>第一段</p><p>第二段</p><script>bad()</script></div></atom:content>
    </atom:entry></atom:feed>`, "https://example.com/feed");
  expect(result.items[0].url).toBe("https://example.com/blog/posts/one#details");
  expect(result.items[0].title).toBe("更新 📰");
  expect(result.items[0].summary).toBe("第一段 第二段");
  expect(result.items[0].published).toBe(Date.parse("2026-11-18T08:00:00Z"));
});

test("RSS 1.0 reads sibling RDF items and dc:date; duplicate IDs appear once", () => {
  const result = parseFeed(`<rdf:RDF xmlns:rdf="urn:rdf" xmlns:dc="urn:dc"><channel><title>RDF</title></channel>
    <item><title>Older</title><link>https://example.com/old</link><dc:date>2026-01-01</dc:date></item>
    <item><title>Newer</title><link>https://example.com/new</link><dc:date>2026-11-18</dc:date></item>
    <item><title>Duplicate</title><link>https://example.com/new</link></item></rdf:RDF>`, "https://example.com/feed");
  expect(result.items.map(i => i.title)).toEqual(["Newer", "Older"]);
});

test("unsafe links remain unopenable and GUID permalinks work only when allowed", () => {
  const result = parseFeed(rss(`<item><title>Unsafe</title><link>javascript:alert(1)</link></item>
    <item><guid>https://example.com/permalink</guid></item>
    <item><guid isPermaLink="false">https://example.com/id</guid></item>`), "https://example.com/feed");
  expect(result.items.map(i => i.url)).toEqual([null, "https://example.com/permalink", null]);
  for (const url of ["file:///tmp/feed", "javascript:alert(1)", "https://user:secret@example.com/rss", "garbage"]) expect(webUrl(url)).toBeNull();
  expect(webUrl(" https://EXAMPLE.com:443/feed ")).toBe("https://example.com/feed");
});

test("malformed XML, HTML error pages, DTDs and oversized UTF-8 feeds fail visibly", () => {
  for (const xml of ["<rss><channel></rss>", "<rss><channel/>", "<rss><channel/></rss><rss/>", "<html>error</html>", '<!DOCTYPE rss [<!ENTITY a SYSTEM "file:///etc/passwd">]><rss><channel/></rss>', "<rss><channel><</channel></rss>"]) {
    expect(() => parseFeed(xml, "https://example.com/feed")).toThrow();
  }
  expect(() => parseFeed(rss(`<description>${"中".repeat(360000)}</description>`), "https://example.com/feed")).toThrow("1 MiB");
  expect(() => parseFeed(`<rss><channel>${"<a>".repeat(70)}${"</a>".repeat(70)}</channel></rss>`, "https://example.com/feed")).toThrow("复杂");
  expect(parseFeed(rss(""), "https://example.com/feed").items).toEqual([]);
});

test("cache limit keeps the newest articles even when the server returns oldest first", () => {
  const entries = Array.from({ length: MAX_ITEMS + 10 }, (_, i) => `<item><guid isPermaLink="false">${i}</guid><pubDate>${new Date(1700000000000 + i * 60000).toISOString()}</pubDate></item>`).join("");
  const result = parseFeed(rss(entries), "https://example.com/feed");
  expect(result.items).toHaveLength(MAX_ITEMS);
  expect(result.items[0].id).toBe(String(MAX_ITEMS + 9));
  expect(result.items.at(-1)?.id).toBe("10");
});

test("fetch checks HTTP status and resolves relative links against the redirected feed URL", async () => {
  await expect(loadFeed("https://example.com/feed", async () => ({ ok: false, status: 503 }) as any)).rejects.toThrow("HTTP 503");
  const result = await loadFeed("https://example.com/feed", async () => ({ ok: true, url: "https://cdn.example.com/feed", text: async () => rss(item()) }) as any);
  expect(result.items[0].url).toBe("https://cdn.example.com/posts/one");
});

const source = (await readFile(new URL("../defaults/mods/rss/main.js", import.meta.url), "utf8"))
  .replace(/^import .*;\n/gm, "").replace("export default class Rss", "class Rss");

function harness(loader: (url: string) => Promise<any> = async () => parseFeed(rss(item()), "https://example.com/feed"), isCheck = false) {
  const state = new Map<string, any>(), tasks: Promise<any>[] = [];
  const globals = { View: class {}, shared: (key: string) => state.get(key), setShared: (key: string, value: any) => state.set(key, value),
    checking: () => isCheck, webUrl, loadFeed: loader, MAX_FEEDS: 50,
    props: () => ({}), ScrollHandle: { new: () => ({ scroll_to_item() {} }) },
    InputState: { new: () => { let value = ""; return { value: () => value, set_value: (v: string) => { value = v; }, on() {} }; } } };
  const Rss = new Function(...Object.keys(globals), `${source}; return Rss;`)(...Object.values(globals));
  const view = new Rss(), timers: any[] = [];
  const cx = { notify() {}, focus_handle: () => ({}), timer: { every: (...args: any[]) => timers.push(args) }, spawn: (fn: any) => { tasks.push(fn(cx)); } };
  // Most tests drive the same initialized state without the permanent command loop.
  view.selected = null; view.unread = false; view.pending = new Set(); view.error = ""; view.scroll = { scroll_to_item() {} };
  let input = ""; view.input = { value: () => input, set_value: (v: string) => { input = v; } };
  return { view, state, cx, timers, setInput: (v: string) => { input = v; }, settle: () => Promise.all(tasks) };
}

test("subscriptions normalize/deduplicate URLs and persist articles/read marks across copies", async () => {
  const h = harness(); h.setInput("https://EXAMPLE.com:443/feed#top"); h.view.add(h.cx); await h.settle();
  const feed = h.state.get("rss.feeds")[0];
  expect(feed.url).toBe("https://example.com/feed");
  expect(h.view.rows()).toHaveLength(1);
  h.view.mark(feed.id, ["one"], h.cx); h.view.unread = true; expect(h.view.rows()).toEqual([]);
  h.view.unread = false; h.setInput("https://example.com/feed"); h.view.add(h.cx);
  expect(h.state.get("rss.feeds")).toHaveLength(1); expect(h.view.error).toContain("已经添加");
  h.view.selected = null; expect(h.view.rows()[0].read).toBe(true);
});

test("failed refresh preserves articles/read marks; automatic refresh respects the 15-minute interval", async () => {
  let fail = false, calls = 0;
  const h = harness(async () => { calls++; if (fail) throw new Error("offline"); return parseFeed(rss(item()), "https://example.com/feed"); });
  h.setInput("https://example.com/feed"); h.view.add(h.cx); await h.settle();
  const feed = h.state.get("rss.feeds")[0]; h.view.mark(feed.id, ["one"], h.cx);
  h.view.refresh(h.cx, true); await h.settle(); expect(calls).toBe(1);
  fail = true; h.view.refresh(h.cx); await h.settle();
  expect(h.state.get("rss.cache")[feed.id].error).toBe("offline");
  expect(h.view.rows()[0].read).toBe(true); expect(h.view.rows()[0].title).toBe("一篇文章");
  h.view.refresh(h.cx, true); await h.settle(); expect(calls).toBe(2);
});

test("a successful later refresh preserves read marks made while the request was running", async () => {
  let resolve: any;
  const h = harness(() => new Promise(r => { resolve = r; }));
  h.state.set("rss.feeds", [{ id: "f", url: "https://example.com/feed" }]);
  h.state.set("rss.cache", { f: { items: [{ id: "one" }], read: [] } });
  h.view.refresh(h.cx); h.view.mark("f", ["one"], h.cx);
  resolve(parseFeed(rss(item()), "https://example.com/feed")); await h.settle();
  expect(h.state.get("rss.cache").f.read).toEqual(["one"]);
});

test("removing a source while fetching deletes its cache and never resurrects it", async () => {
  let resolve: any;
  const h = harness(() => new Promise(r => { resolve = r; }));
  h.setInput("https://example.com/feed"); h.view.add(h.cx);
  const feed = h.state.get("rss.feeds")[0]; h.view.remove(feed.id, h.cx);
  resolve(parseFeed(rss(item()), "https://example.com/feed")); await h.settle();
  expect(h.state.get("rss.feeds")).toEqual([]); expect(h.state.get("rss.cache")).toEqual({});
  expect(h.view.pending.size).toBe(0);
});

test("checking initializes the view without any network requests or timers", async () => {
  let calls = 0;
  const h = harness(async () => { calls++; return {}; }, true);
  h.state.set("rss.feeds", [{ id: "f", url: "https://example.com/feed" }]);
  h.view.init({}, h.cx); h.view.refresh(h.cx); await h.settle();
  expect(calls).toBe(0); expect(h.timers).toEqual([]);
});

test("an unread article stays visible while reading its summary, including keyboard navigation", async () => {
  const h = harness(); h.setInput("https://example.com/feed"); h.view.add(h.cx); await h.settle();
  h.view.unread = true;
  const opened: string[] = [];
  const cx = { ...h.cx, stop_propagation() {}, open_url: (url: string) => opened.push(url) };
  h.view.key({ key: "down" }, cx);
  expect(h.view.rows()).toHaveLength(1); expect(h.view.rows()[0].read).toBe(true);
  h.view.key({ key: "enter" }, cx); expect(opened).toEqual(["https://example.com/posts/one"]);
  h.view.expanded = null; expect(h.view.rows()).toEqual([]);
  h.view.typing = true; h.view.key({ key: "down" }, cx); expect(h.view.expanded).toBeNull();
});
