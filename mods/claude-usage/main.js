import { View, div, image, PathBuilder, Background } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { home, readTextFile, shared, setShared, props, openOverlay, settings, theme } from "herdr";

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const KEY = "claude-usage";
const EVERY = 5 * 60e3;
// One missed cycle plus slack, so a slow fetch doesn't flash the bar grey.
const STALE = 12 * 60e3;
const SPAN = { session: 5 * 3600e3, weekly_all: 7 * 86400e3, weekly_scoped: 7 * 86400e3 };
const BAR = ["session", "weekly_all"];
// Theme colors, so the meters follow the light and dark theme: the accent normally (weekly limits
// a shade lighter, to tell them from the 5-hour one), the working amber from 80%, blocked from 95%.
const WEEKLY_OPACITY = 0.6;
const POPUP_W = 300, GAP = 6;
const POPUP_CLOSED = "claude-usage.popup-closed";
// A popup's closing and the bar's mouse-down land in one event, at most 1 ms apart when measured,
// and no deliberate second press comes this quickly.
const SAME_PRESS = 250;

// Both config dirs log in to the same account; whichever Claude Code refreshed last holds the live token.
async function token() {
  const found = [];
  for (const dir of [".claude", ".claude-work"]) {
    try {
      const oauth = JSON.parse(await readTextFile(`${home()}/${dir}/.credentials.json`) ?? "null")?.claudeAiOauth;
      if (oauth?.accessToken) found.push(oauth);
    } catch {}
  }
  found.sort((a, b) => (b.expiresAt ?? 0) - (a.expiresAt ?? 0));
  if (!found.length) throw new Error("no Claude Code login found");
  if (found[0].expiresAt && found[0].expiresAt < Date.now()) throw new Error("token expired, use Claude Code to refresh it");
  return found[0].accessToken;
}

// Percentages are floored, as Claude Code's /usage does, so both show the same number and a
// value crosses the 80/95 colour thresholds where the raw one does. A limit without a number is
// left out, as /usage skips it, rather than shown as a healthy 0%.
function windowsOf(data) {
  if (Array.isArray(data.limits)) {
    return data.limits.filter(l => typeof l.percent === "number").map(l => {
      const model = l.scope?.model?.display_name;
      return { kind: l.kind, model, used: Math.floor(l.percent), resets_at: l.resets_at };
    });
  }
  return [["five_hour", "session"], ["seven_day", "weekly_all"]]
    .filter(([k]) => typeof data[k]?.utilization === "number")
    .map(([k, kind]) => ({ kind, used: Math.floor(data[k].utilization), resets_at: data[k].resets_at }));
}

const at = s => Date.parse(s ?? "") || 0;
// A fetch is stamped in shared state when it starts, so every copy (the bar, the popup, a second
// bar) sees it. It counts as in progress until it finishes or for 45 s, longer than the runtime's
// 30 s fetch timeout, so a request that never settles can't block the next one for good.
const PENDING = 45e3;
const pending = u => at(u?.started) > at(u?.finished) && Date.now() - at(u?.started) < PENDING;

async function refresh() {
  const prev = shared(KEY) ?? {};
  if (pending(prev)) return;
  const started = new Date().toISOString();
  // `checked` is written before the request, so the 5-minute gate sees the attempt from every copy.
  setShared(KEY, { ...prev, checked: started, started });
  let result;
  try {
    const res = await fetch(USAGE_URL, {
      headers: { Authorization: `Bearer ${await token()}`, "anthropic-beta": "oauth-2025-04-20", Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const windows = windowsOf(await res.json());
    // A 200 with nothing usable means the undocumented API changed shape: failing keeps the last numbers and shows why.
    if (!windows.length) throw new Error("no usage limits in the response");
    result = { fetched: started, error: null, windows };
  } catch (e) {
    result = { error: String(e?.message ?? e) };
  }
  // A newer attempt started while this one hung: its result wins, this one is dropped.
  const now = shared(KEY) ?? {};
  if (now.started !== started) return;
  setShared(KEY, { ...now, ...result, finished: new Date().toISOString() });
}

const short = w => ({ session: "5h", weekly_all: "7d" })[w.kind] ?? `7d ${w.model ?? ""}`.trim();
const long = w => ({ session: "5-hour limit", weekly_all: "Weekly limit" })[w.kind] ?? `Weekly ${w.model ?? "model"} limit`;

function pace(w) {
  const end = Date.parse(w.resets_at), span = SPAN[w.kind];
  if (!end || !span) return null;
  return Math.min(1, Math.max(0, 1 - (end - Date.now()) / span));
}

function color(w, stale, t) {
  if (stale) return t.dim;
  if (w.used >= 95) return t.blocked;
  if (w.used >= 80) return t.working;
  return t.accent;
}

// Only a calm weekly fill is lightened: a warning colour shows at full strength on every meter.
const fillOpacity = (w, stale) => !stale && w.used < 80 && w.kind !== "session" ? WEEKLY_OPACITY : 1;

function clock(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function resets(w) {
  // The API reports resets a fraction of a second before the hour.
  const end = Math.round(Date.parse(w.resets_at) / 60e3) * 60e3;
  if (!end) return "";
  const left = Math.max(0, end - Date.now());
  if (left < 24 * 3600e3) {
    const h = Math.floor(left / 3600e3), m = Math.round((left % 3600e3) / 60e3);
    return `resets in ${h ? `${h}h ` : ""}${m}m, at ${clock(end)}`;
  }
  return `resets ${DAYS[new Date(end).getDay()]} at ${clock(end)}`;
}

// The elapsed share of the window is drawn as a ghost fill: lit past it means running ahead of pace.
function meter(w, stale, t, height) {
  const used = Math.min(100, Math.max(0, w.used ?? 0));
  const ghost = stale ? null : pace(w);
  return div().relative().w_full().h(height).rounded(height / 2).bg(t.border)
    .when(ghost !== null, el => el.child(div().absolute().left(0).top(0).h_full().w(`${ghost * 100}%`).rounded(height / 2).bg(t.dim).opacity(0.35)))
    .child(div().absolute().left(0).top(0).h_full().w(`${used}%`).rounded(height / 2).bg(color(w, stale, t)).opacity(fillOpacity(w, stale)));
}

// The bar's compact form: a pie per limit, the used share as a wedge clockwise from 12 o'clock over a
// disk in the track colour, with the elapsed share of the window as a ghost wedge behind it.
const PIE = 12;

function wedge(share) {
  const a = share * 2 * Math.PI;
  const x = 50 + 50 * Math.sin(a), y = 50 - 50 * Math.cos(a);
  return PathBuilder.fill().move_to("50%", "50%").line_to("50%", "0%")
    .arc_to("50%", "50%", 0, share > 0.5, true, `${x}%`, `${y}%`).close().build();
}

// An arc can't end where it starts, so a full share is a plain disk.
function slice(share, color, opacity) {
  if (!(share > 0)) return null;
  const el = share >= 0.999
    ? div().rounded(PIE / 2).bg(color).opacity(opacity)
    : window.paint_path(wedge(share), Background.solid(color).opacity(opacity));
  return el.absolute().top(0).left(0).size_full();
}

function pie(w, stale, t) {
  const used = Math.min(100, Math.max(0, w.used ?? 0)) / 100;
  const ghost = stale ? null : pace(w);
  return div().relative().size(PIE).flex_none().rounded(PIE / 2).bg(t.border)
    .children([slice(ghost, t.dim, 0.35), slice(used, color(w, stale, t), fillOpacity(w, stale))].filter(Boolean));
}

export default class ClaudeUsage extends View {
  init(_props, cx) {
    if (props()?.overlay) return;
    const tick = cx => {
      const u = shared(KEY);
      // An attempt that expired unfinished was most likely cancelled with its copy (popup closed,
      // layout switched, app quit), so nothing will land and the 5 minutes aren't worth waiting out.
      const abandoned = at(u?.started) > at(u?.finished) && !pending(u);
      if (abandoned || Date.now() - at(u?.checked) >= EVERY) cx.spawn(async () => refresh());
      cx.notify();
    };
    cx.timer.every(60e3, tick);
    tick(cx);
  }

  async close() {
    if (props()?.overlay) setShared(POPUP_CLOSED, Date.now());
  }

  render() {
    return props()?.overlay ? this.details() : this.bar();
  }

  // At the pointer, a popup on a bottom bar gets pushed back into the window over the bar. Its height
  // can't be measured before it opens, so it is a generous frameless box with the card pinned to its
  // bottom, just above the bar.
  open() {
    const b = this.anchor;
    const z = Number(settings()?.zoom) || 1;
    const rows = Math.max(3, shared(KEY)?.windows?.length ?? 0);
    const height = b ? Math.min(120 + rows * 90, b.y / z - GAP) : 120 + rows * 90;
    const at = b ? { x: Math.max(0, b.x + b.width - (POPUP_W + GAP) * z), y: b.y - (height + GAP) * z } : undefined;
    openOverlay({ mod: "claude-usage", kind: "popup", frame: "none", width: POPUP_W, height, at, props: { details: true, height } });
  }

  // The press that closes the popup also reaches the bar, whose click would open it straight away.
  toggle() {
    const closedByThisPress = Math.abs(shared(POPUP_CLOSED) - this.pressed) < SAME_PRESS;
    if (!closedByThisPress) this.open();
  }

  bar() {
    const t = theme();
    const u = shared(KEY);
    const stale = !u?.fetched || Boolean(u.error) || Date.now() - Date.parse(u.fetched) > STALE;
    const shown = BAR.map(kind => u?.windows?.find(w => w.kind === kind)).filter(Boolean);
    const edge = props()?.border;
    const tip = shown.length
      ? shown.map(w => `${long(w)}: ${w.used}%, ${resets(w)}`).join("\n") + (u.error ? `\n${u.error}` : "")
      : u?.error ?? "Loading Claude usage";
    return h_flex().id("root").size_full().px(12).gap(12).items_center().bg(t.chrome).text_size(11.8)
      .when(edge === "top", el => el.border_t(1).border_color(t.border))
      .when(edge === "bottom", el => el.border_b(1).border_color(t.border))
      .on_mouse_down("left", (e, cx) => { this.anchor = e.bounds; this.pressed = Date.now(); cx.stop_propagation(); })
      .on_click(() => this.toggle())
      .tooltip(tip)
      .child(image("icons/claude.svg").size(14).flex_none().opacity(stale ? 0.5 : 1))
      .when(!shown.length, el => el.child(div().text_color(t.dim).child(u?.error ? "no data" : "…")))
      .children(shown.map(w => h_flex().gap(6).items_center().flex_none()
        .child(div().text_color(t.dim).child(short(w)))
        .child(pie(w, stale, t))
        .child(div().text_color(stale ? t.dim : w.used >= 80 ? color(w, stale, t) : t.muted).child(`${w.used}%`))));
  }

  details() {
    const t = theme();
    const u = shared(KEY);
    const stale = !u?.fetched || Boolean(u.error) || Date.now() - Date.parse(u.fetched) > STALE;
    const footer = !u?.fetched ? (u?.error ?? "not fetched yet")
      : u.error ? `fetch failed: ${u.error} · data from ${clock(Date.parse(u.fetched))}`
      : `updated ${clock(Date.parse(u.fetched))}`;
    return v_flex().w_full().h(props().height ?? 0).justify_end().child(v_flex().w_full().p(14).gap(14).text_size(12).text_color(t.muted)
      .bg(t.popover).border(1).border_color(t.border).rounded(8)
      .child(h_flex().justify_between().items_center()
        .child(h_flex().gap(8).items_center().child(image("icons/claude.svg").size(16))
          .child(div().text_size(13).font_semibold().text_color(t.foreground).child("Claude Usage")))
        // While any copy's fetch is in progress, Refresh says so instead of starting a second one.
        .child(pending(u)
          ? div().id("refresh").px(6).py(2).text_color(t.dim).child("Refreshing…")
          : div().id("refresh").px(6).py(2).rounded(5).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => cx.spawn(async () => refresh())).child("Refresh")))
      .children((u?.windows ?? []).map(w => v_flex().gap(6)
        .child(h_flex().justify_between().items_end()
          .child(div().text_color(t.foreground).child(long(w)))
          .child(div().text_size(18).font_semibold().text_color(color(w, stale, t)).child(`${w.used}%`)))
        .child(meter(w, stale, t, 6))
        .child(div().text_size(11.5).text_color(t.dim).child(resets(w)))))
      .child(div().text_size(11.5).text_color(u?.error ? t.blocked : t.dim).child(footer)));
  }
}
