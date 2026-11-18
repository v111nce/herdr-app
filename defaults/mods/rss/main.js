import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Input, InputState, ScrollHandle } from "gpui-base";
import { theme, shared, setShared, checking, nextCommand, props, closeOverlay } from "herdr";
import { webUrl, loadFeed, MAX_FEEDS } from "./feed.js";

const FEEDS = "rss.feeds", CACHE = "rss.cache";
const feeds = () => Array.isArray(shared(FEEDS)) ? shared(FEEDS) : [];
const cache = () => shared(CACHE) ?? {};
const errorText = e => String(e?.message ?? e).slice(0, 300);
const itemKey = i => JSON.stringify([i.feedId, i.id]);

export default class Rss extends View {
  init(_p, cx) {
    this.selected = null; this.unread = false; this.expanded = null;
    this.pending = new Set(); this.error = ""; this.width = 760;
    this.handle = cx.focus_handle();
    this.scroll = ScrollHandle.new();
    this.input = InputState.new({ placeholder: "RSS / Atom 订阅地址（https://…）" });
    this.input.on("submit", (_e, cx) => this.add(cx));
    this.input.on("focus", () => { this.typing = true; });
    this.input.on("blur", () => { this.typing = false; });
    if (checking()) return;
    this.refresh(cx, true);
    cx.timer.every(60000, cx => this.refresh(cx, true));
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (command === "focus") this.handle.focus();
        if (command === "refresh") this.refresh(cx);
        cx.notify();
      }
    });
  }

  add(cx) {
    const url = webUrl(this.input.value())?.replace(/#.*$/, "");
    if (!url) { this.error = "请输入有效的 HTTP 或 HTTPS 订阅地址。"; cx.notify(); return; }
    const all = feeds(), existing = all.find(f => f.url === url);
    if (existing) { this.selected = existing.id; this.error = "这个订阅已经添加。"; cx.notify(); return; }
    if (all.length >= MAX_FEEDS) { this.error = `最多添加 ${MAX_FEEDS} 个订阅。`; cx.notify(); return; }
    const feed = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, url };
    setShared(FEEDS, [...all, feed]);
    this.selected = feed.id; this.input.set_value(""); this.error = "";
    this.fetchOne(feed, cx); cx.notify();
  }

  remove(id, cx) {
    setShared(FEEDS, feeds().filter(f => f.id !== id));
    const next = { ...cache() }; delete next[id]; setShared(CACHE, next);
    if (this.selected === id) this.selected = null;
    this.expanded = null; cx.notify();
  }

  refresh(cx, staleOnly = false) {
    if (checking()) return;
    const all = cache(), now = Date.now();
    for (const feed of feeds()) {
      if (!staleOnly || now - (all[feed.id]?.checked ?? 0) >= 15 * 60000) this.fetchOne(feed, cx);
    }
  }

  fetchOne(feed, cx) {
    if (this.pending.has(feed.id) || checking()) return;
    this.pending.add(feed.id); cx.notify();
    cx.spawn(async cx => {
      try {
        const result = await loadFeed(feed.url);
        // A removed/re-added URL is a new subscription. Its old request cannot revive it.
        if (!feeds().some(f => f.id === feed.id)) return;
        const current = cache(), old = current[feed.id] ?? {};
        const ids = new Set(result.items.map(i => i.id));
        setShared(CACHE, { ...current, [feed.id]: { ...result, read: (old.read ?? []).filter(id => ids.has(id)), updated: Date.now(), checked: Date.now(), error: "" } });
      } catch (e) {
        if (feeds().some(f => f.id === feed.id)) {
          const current = cache();
          setShared(CACHE, { ...current, [feed.id]: { ...current[feed.id], checked: Date.now(), error: errorText(e) } });
        }
      } finally { this.pending.delete(feed.id); cx.notify(); }
    });
  }

  mark(feedId, ids, cx) {
    const current = cache(), feed = current[feedId];
    if (!feed) return;
    const read = [...new Set([...(feed.read ?? []), ...ids])];
    setShared(CACHE, { ...current, [feedId]: { ...feed, read } }); cx.notify();
  }

  rows() {
    const current = cache();
    return feeds().filter(f => !this.selected || f.id === this.selected).flatMap(f => {
      const data = current[f.id] ?? {}, read = new Set(data.read ?? []);
      return (data.items ?? []).map(item => ({ ...item, feedId: f.id, feedTitle: data.title || f.url, read: read.has(item.id) }));
    }).filter(i => !this.unread || !i.read || this.expanded === itemKey(i)).sort((a, b) => b.published - a.published).slice(0, 300);
  }

  key(e, cx) {
    if (e.key === "escape" && props()?.overlay) { closeOverlay(props().overlay); return; }
    if (this.typing || e.modifiers?.control || e.modifiers?.platform || e.modifiers?.alt) return;
    const rows = this.rows(), index = rows.findIndex(i => itemKey(i) === this.expanded);
    if (e.key === "up" || e.key === "down") {
      const next = rows[Math.max(0, Math.min(rows.length - 1, index < 0 ? 0 : index + (e.key === "down" ? 1 : -1)))];
      if (next) {
        this.expanded = itemKey(next); this.mark(next.feedId, [next.id], cx);
        this.scroll.scroll_to_item(this.rows().findIndex(i => itemKey(i) === this.expanded));
      }
      cx.stop_propagation();
    } else if (e.key === "enter" && rows[index]?.url) {
      cx.open_url(rows[index].url); cx.stop_propagation();
    }
  }

  button(id, label, action, selected = false, enabled = true) {
    const t = theme();
    return h_flex().id(id).min_h(36).px(10).items_center().justify_center().rounded(6).flex_none()
      .bg(selected ? t.selected : t.raised).text_color(enabled ? t.foreground : t.dim).text_size(12)
      .when(enabled, el => el.cursor_pointer().hover(s => s.bg(t.hover)).active(s => s.opacity(0.72)))
      .on_click((_e, cx) => { cx.stop_propagation(); if (enabled) action(cx); }).child(label);
  }

  article(item) {
    const t = theme(), key = itemKey(item), expanded = this.expanded === key;
    return v_flex().id(`rss-item-${key}`).flex_none().px(14).py(10).gap(5).rounded(6)
      .bg(expanded ? t.selected : t.background).hover(s => s.bg(t.hover)).active(s => s.opacity(0.8))
      .cursor_pointer().on_click((_e, cx) => { this.handle.focus(); this.expanded = expanded ? null : key; this.mark(item.feedId, [item.id], cx); })
      .child(h_flex().gap(8).items_center()
        .child(div().size(5).rounded(3).flex_none().bg(item.read ? t.border : t.accent))
        .child(div().flex_1().min_w(0).text_size(13).line_height("20px").text_color(t.foreground).when(!item.read, el => el.font_semibold()).child(item.title)))
      .child(div().pl(13).text_size(11).text_color(t.dim).child(`${item.feedTitle}${item.published ? ` · ${new Date(item.published).toISOString().slice(0, 10)}` : ""}`))
      .when(expanded, el => el
        .when(Boolean(item.summary), el => el.child(div().pl(13).text_size(12).line_height("20px").text_color(t.muted).child(item.summary)))
        .child(h_flex().pl(13).pt(4).child(this.button(`rss-open-${key}`, item.url ? "打开原文 ↗" : "没有原文链接", cx => cx.open_url(item.url), false, Boolean(item.url)))));
  }

  render() {
    const t = theme(), all = feeds(), data = cache();
    if (this.selected && !all.some(f => f.id === this.selected)) this.selected = null;
    const rows = this.rows(), compact = this.width < 480;
    const selectedFeed = all.find(f => f.id === this.selected);
    const errors = all.filter(f => (!this.selected || f.id === this.selected) && data[f.id]?.error);
    const visible = all.filter(f => !this.selected || f.id === this.selected);
    const updated = Math.max(0, ...visible.map(f => data[f.id]?.updated ?? 0));
    const busy = this.pending.size > 0;
    return v_flex().id("rss").track_focus(this.handle).size_full().min_w(0).min_h(0).bg(t.background).text_color(t.foreground)
      .on_size_change((size, cx) => { if ((this.width < 480) !== (size.width < 480)) cx.notify(); this.width = size.width; })
      .on_key_down((e, cx) => this.key(e, cx))
      .child(h_flex().px(16).py(12).gap(10).items_center().flex_none()
        .child(svg("mods/rss/rss.svg").size(18).text_color(t.accent))
        .child(div().flex_1().text_size(16).font_semibold().child("RSS 订阅"))
        .child(this.button("rss-refresh", busy ? "刷新中…" : "刷新", cx => this.refresh(cx), false, all.length > 0 && !busy))
        .when(Boolean(props()?.overlay), el => el.child(this.button("rss-close", "关闭", () => closeOverlay(props().overlay)))))
      .child(h_flex().px(16).pb(10).gap(8).flex_none()
        .child(Input.new(this.input).flex_1().min_w(0).h(36).px(10).rounded(6).border_1().border_color(t.input).bg(t.raised).text_size(12).text_color(t.foreground))
        .child(this.button("rss-add", "添加", cx => this.add(cx))))
      .when(Boolean(this.error), el => el.child(div().px(16).pb(8).flex_none().text_size(12).text_color(t.blocked).child(this.error)))
      .child(h_flex().px(16).pb(10).gap(6).h(46).flex_none().overflow_x_scrollbar()
        .child(this.button("rss-all", "全部订阅", cx => { this.selected = null; this.expanded = null; cx.notify(); }, !this.selected))
        .children(all.map(f => this.button(`rss-feed-${f.id}`, (data[f.id]?.title || f.url).slice(0, 28), cx => { this.selected = f.id; this.expanded = null; cx.notify(); }, this.selected === f.id))))
      .child((compact ? v_flex() : h_flex()).px(16).pb(10).gap(6).flex_none()
        .child(h_flex().gap(6).flex_1()
          .child(this.button("rss-unread", this.unread ? "只看未读 ✓" : "只看未读", cx => { this.unread = !this.unread; cx.notify(); }, this.unread))
          .child(this.button("rss-mark-all", "全部已读", cx => { for (const f of visible) this.mark(f.id, (data[f.id]?.items ?? []).map(i => i.id), cx); }, false, rows.some(i => !i.read))))
        .when(Boolean(selectedFeed), el => el.child(this.button("rss-remove", "移除订阅", cx => this.remove(selectedFeed.id, cx)))))
      .when(errors.length > 0, el => el.child(v_flex().px(16).pb(10).flex_none().max_h(80).overflow_y_scrollbar()
        .children(errors.map(f => div().text_size(11.5).text_color(t.blocked).child(`${data[f.id]?.title || f.url}：${data[f.id].error}`)))))
      .child(div().h(1).flex_none().bg(t.border))
      .child(v_flex().id("rss-articles").flex_1().min_h(0).px(8).py(6).gap(2).overflow_y_scrollbar().track_scroll(this.scroll)
        .children(rows.map(item => this.article(item)))
        .when(rows.length === 0, el => el.child(v_flex().p(20).gap(8)
          .child(div().text_size(14).font_medium().child(!all.length ? "从一个订阅地址开始" : busy ? "正在获取文章…" : this.unread ? "没有未读文章" : "暂无文章"))
          .child(div().text_size(12).line_height("20px").text_color(t.muted).child(!all.length ? "添加 RSS 或 Atom 地址，文章会保存在本机。点击文章查看摘要，再打开原文。" : "支持 RSS 2.0 和 Atom。订阅每 15 分钟刷新，失败时保留上次内容。")))))
      .child(div().px(16).py(8).flex_none().text_size(11).text_color(t.dim)
        .child(`${rows.length === 300 ? "最近 300" : rows.length} 篇${updated ? ` · 更新于 ${new Date(updated).toISOString().slice(11, 16)} UTC` : ""}`));
  }
}
