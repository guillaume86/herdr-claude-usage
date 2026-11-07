import { View, div, image, PathBuilder, Background } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { home, exec, machines, readTextFile, shared, setShared, props, openOverlay, settings, theme, run } from "herdr";

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
const DIRS = [".claude", ".claude-work"];

// A machine's home, asked of it once: Unix through sh, Windows through PowerShell. A miss isn't
// kept, so an unreachable machine is asked again next time.
const homes = new Map();
async function homeOn(on) {
  if (!on) return home();
  if (homes.has(on)) return homes.get(on);
  const ask = [
    ["sh", ["-c", 'printf %s "$HOME"']],
    ["powershell", ["-NoProfile", "-Command", "[Environment]::GetFolderPath('UserProfile')"]],
  ];
  for (const [cmd, args] of ask) {
    try {
      const r = await exec(cmd, args, { on });
      const h = r.code === 0 ? r.stdout.trim() : "";
      if (h) { homes.set(on, h); return h; }
    } catch {}
  }
  throw new Error(`${on} unreachable`);
}

async function readJson(path, on) {
  try { return JSON.parse(await readTextFile(path, { on }) ?? "null"); } catch { return null; }
}

// Every Claude Code login on one machine: its token and the account it belongs to. The account
// is in `.claude.json`, beside `.claude/` for the default dir and inside any other config dir.
async function loginsOn(on) {
  const h = await homeOn(on);
  const found = [];
  for (const dir of DIRS) {
    const oauth = (await readJson(`${h}/${dir}/.credentials.json`, on))?.claudeAiOauth;
    if (!oauth?.accessToken) continue;
    const config = await readJson(dir === ".claude" ? `${h}/.claude.json` : `${h}/${dir}/.claude.json`, on);
    const acc = config?.oauthAccount ?? {};
    found.push({ on, oauth, id: acc.accountUuid ?? `${on ?? ""}/${dir}`, email: acc.emailAddress ?? null, name: acc.displayName ?? null });
  }
  return found;
}

// This computer's logins, and with `all` every linked machine's too. Machines sharing an account
// (each with its own token) are one account: whichever token Claude Code refreshed last is live.
async function discover(all) {
  const linked = all ? machines().filter(m => m.name) : [];
  const unreachable = linked.filter(m => m.layout === "unavailable").map(m => m.name);
  const names = [null, ...linked.filter(m => m.layout !== "unavailable").map(m => m.name)];
  const logins = (await Promise.all(names.map(on => loginsOn(on).catch(() => { unreachable.push(on); return []; })))).flat();
  const accounts = new Map();
  for (const l of logins) {
    const a = accounts.get(l.id) ?? { id: l.id, email: l.email, name: l.name, machines: [], logins: [] };
    if (!a.machines.includes(l.on)) a.machines.push(l.on);
    a.logins.push(l);
    accounts.set(l.id, a);
  }
  for (const a of accounts.values()) a.logins.sort((x, y) => (y.oauth.expiresAt ?? 0) - (x.oauth.expiresAt ?? 0));
  return { accounts: [...accounts.values()], unreachable };
}

const machineLabel = on => on ?? "this computer";

// The plan as Claude Code's login records it: `subscriptionType` ("max", "team", "pro") and the
// multiplier ending `rateLimitTier` ("default_claude_max_20x"), so "Max 20x" or "Team 5x".
function planOf(oauth) {
  const type = typeof oauth?.subscriptionType === "string" ? oauth.subscriptionType.trim() : "";
  if (!type) return null;
  const mult = /_(\d+x)$/.exec(oauth.rateLimitTier ?? "")?.[1];
  return `${type[0].toUpperCase()}${type.slice(1)}${mult ? ` ${mult}` : ""}`;
}

function token(a) {
  const best = a.logins[0];
  if (best.oauth.expiresAt && best.oauth.expiresAt < Date.now()) {
    throw new Error(best.on ? `token expired on ${best.on}, use Claude Code there to refresh it` : "token expired, use Claude Code to refresh it");
  }
  return best.oauth.accessToken;
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

async function usage(a) {
  const res = await fetch(USAGE_URL, {
    headers: { Authorization: `Bearer ${token(a)}`, "anthropic-beta": "oauth-2025-04-20", Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const windows = windowsOf(await res.json());
  // A 200 with nothing usable means the undocumented API changed shape: failing keeps the last numbers and shows why.
  if (!windows.length) throw new Error("no usage limits in the response");
  return windows;
}

const at = s => Date.parse(s ?? "") || 0;
// A fetch is stamped in shared state when it starts, so every copy (the bar, the popup, a second
// bar) sees it. It counts as in progress until it finishes or for 75 s, longer than a linked
// machine's lookup and the usage request together (each limited to 30 s by the runtime), so a
// request that never settles can't block the next one for good.
const PENDING = 75e3;
const pending = u => at(u?.started) > at(u?.finished) && Date.now() - at(u?.started) < PENDING;

// One fetch reads every account. An account whose request fails keeps its last numbers with the
// error; one on a machine that can't be reached this time is kept the same way, until it answers.
async function refresh(all) {
  const prev = shared(KEY) ?? {};
  if (pending(prev)) return;
  const started = new Date().toISOString();
  // `checked` is written before the request, so the 5-minute gate sees the attempt from every copy.
  setShared(KEY, { ...prev, checked: started, started });
  let result;
  try {
    const { accounts, unreachable } = await discover(all);
    const old = new Map((Array.isArray(prev.accounts) ? prev.accounts : []).map(a => [a.id, a]));
    const fresh = await Promise.all(accounts.map(async a => {
      const was = old.get(a.id) ?? {};
      const info = { id: a.id, email: a.email, name: a.name, machines: a.machines, plan: planOf(a.logins[0].oauth) };
      try {
        return { ...info, fetched: started, error: null, windows: await usage(a) };
      } catch (e) {
        return { ...info, fetched: was.fetched ?? null, error: String(e?.message ?? e), windows: was.windows ?? [] };
      }
    }));
    const away = [...old.values()]
      .filter(a => !accounts.some(f => f.id === a.id) && a.machines?.some(m => unreachable.includes(m)))
      .map(a => ({ ...a, error: `${a.machines.filter(m => unreachable.includes(m)).map(machineLabel).join(", ")} unreachable` }));
    const list = [...fresh, ...away];
    result = { accounts: list, error: list.length ? null : "no Claude Code login found" };
  } catch (e) {
    result = { accounts: Array.isArray(prev.accounts) ? prev.accounts : [], error: String(e?.message ?? e) };
  }
  // A newer attempt started while this one hung: its result wins, this one is dropped.
  const now = shared(KEY) ?? {};
  if (now.started !== started) return;
  setShared(KEY, { ...now, ...result, finished: new Date().toISOString() });
}

// The bar's account: the `account` prop (an email, a display name, or a machine name for the
// account logged in there, `local` for this computer), else this computer's, else the first.
function pick(list, want) {
  const w = typeof want === "string" ? want.trim().toLowerCase() : "";
  const match = a => w && (a.email?.toLowerCase() === w || a.name?.toLowerCase() === w
    || a.machines?.some(m => (m ?? "local").toLowerCase() === w));
  return list.find(match) ?? list.find(a => a.machines?.includes(null)) ?? list[0] ?? null;
}

// The bar's account first, then the others as found.
function ordered(u, want) {
  const list = Array.isArray(u?.accounts) ? u.accounts : [];
  const main = pick(list, want);
  return main ? [main, ...list.filter(a => a !== main)] : [];
}

const isStale = a => !a?.fetched || Boolean(a.error) || Date.now() - Date.parse(a.fetched) > STALE;
const accountLabel = a => a.email ?? a.name ?? machineLabel(a.machines?.[0]);
const where = a => `on ${(a.machines ?? []).map(machineLabel).join(", ")}`;

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

// The bar's side padding: 8 a side, so the item sits 16 px from its neighbours like a native one.
const PAD = 8;

// The account's plan as a small outlined tag.
const planTag = (a, t) => a?.plan
  ? div().flex_none().px(5).py(1).rounded(4).border(1).border_color(t.border).text_size(10).text_color(t.dim).child(a.plan)
  : null;

const barWindows = a => BAR.map(kind => a?.windows?.find(w => w.kind === kind)).filter(Boolean);
const worst = list => Math.max(0, ...list.flatMap(a => isStale(a) ? [] : barWindows(a).map(w => w.used)));

export default class ClaudeUsage extends View {
  init(_props, cx) {
    if (props()?.overlay) return;
    const tick = cx => {
      const u = shared(KEY);
      // An attempt that expired unfinished was most likely cancelled with its copy (popup closed,
      // layout switched, app quit), so nothing will land and the 5 minutes aren't worth waiting out.
      // State from before accounts existed has nothing to show, so it is replaced at once.
      const abandoned = at(u?.started) > at(u?.finished) && !pending(u);
      const old = u && !Array.isArray(u.accounts) && !pending(u);
      if (abandoned || old || Date.now() - at(u?.checked) >= EVERY) cx.spawn(async () => refresh(Boolean(props()?.machines)));
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
    const list = ordered(shared(KEY), props()?.account);
    const rows = Math.max(3, list.reduce((n, a) => n + (a.windows?.length ?? 0), 0));
    const want = 120 + rows * 90 + (list.length > 1 ? list.length * 44 : 0);
    const height = b ? Math.min(want, b.y / z - GAP) : want;
    const at = b ? { x: Math.max(0, b.x + b.width - (POPUP_W + GAP) * z), y: b.y - (height + GAP) * z } : undefined;
    openOverlay({
      mod: "claude-usage", kind: "popup", frame: "none", width: POPUP_W, height, at,
      props: { details: true, height, account: props()?.account, machines: props()?.machines },
    });
  }

  // The press that closes the popup also reaches the bar, whose click would open it straight away.
  toggle() {
    const closedByThisPress = Math.abs(shared(POPUP_CLOSED) - this.pressed) < SAME_PRESS;
    if (!closedByThisPress) this.open();
  }

  bar() {
    const t = theme();
    const u = shared(KEY);
    const [main, ...others] = ordered(u, props()?.account);
    const stale = isStale(main);
    const shown = barWindows(main);
    const edge = props()?.border;
    const line = a => barWindows(a).map(w => `${short(w)} ${w.used}%`).join(", ") || "no data";
    const tip = !shown.length ? (main?.error ?? u?.error ?? "Loading Claude usage")
      : [
        ...(others.length ? [accountLabel(main)] : []),
        ...shown.map(w => `${long(w)}: ${w.used}%, ${resets(w)}`),
        ...(main.error ? [main.error] : []),
        ...others.map(a => `${accountLabel(a)}: ${line(a)}${a.error ? ` (${a.error})` : ""}`),
      ].join("\n");
    // Other accounts as a count, coloured like their fullest bar limit once it passes 80%.
    const top = worst(others);
    const badge = top >= 95 ? t.blocked : top >= 80 ? t.working : t.dim;
    return h_flex().id("root").size_full().px(PAD).items_center().bg(t.chrome).text_size(11.8)
      .when(edge === "top", el => el.border_t(1).border_color(t.border))
      .when(edge === "bottom", el => el.border_b(1).border_color(t.border))
      .on_mouse_down("left", (e, cx) => { this.anchor = e.bounds; this.pressed = Date.now(); cx.stop_propagation(); })
      .on_click(() => this.toggle())
      .tooltip(tip)
      .child(h_flex().id("content").flex_none().gap(12).items_center()
        .on_size_change(size => this.fit(size.width))
      .child(image("icons/claude.svg").size(13).flex_none().opacity(stale ? 0.5 : 1))
      .when(!shown.length, el => el.child(div().text_color(t.dim).child(main?.error || u?.error ? "no data" : "…")))
      .children(shown.map(w => h_flex().gap(6).items_center().flex_none()
        .child(div().text_color(t.dim).child(short(w)))
        .child(pie(w, stale, t))
        .child(div().text_color(stale ? t.dim : w.used >= 80 ? color(w, stale, t) : t.muted).child(`${w.used}%`))))
      .when(others.length > 0, el => el.child(div().flex_none().text_color(badge).child(`+${others.length}`))));
  }

  // The block takes the content's width, so the bar leaves no gap whatever it shows. The content
  // is measured in zoomed px and the layout is at zoom 1. `fit: false` keeps the layout's size.
  fit(width) {
    if (props()?.fit === false) return;
    const px = Math.ceil(width / (Number(settings()?.zoom) || 1)) + 2 * PAD;
    if (px === this.fitted) return;
    this.fitted = px;
    run("layout.resize", { id: props()?.block ?? "claude-usage", px });
  }

  section(a, t, many) {
    const stale = isStale(a);
    return v_flex().gap(12)
      .when(many, el => el.child(h_flex().gap(8).justify_between().items_center().border_t(1).border_color(t.border).pt(12)
        .child(v_flex().gap(1).flex_1().min_w_0()
          .child(div().truncate().font_semibold().text_color(t.foreground).child(accountLabel(a)))
          .child(div().truncate().text_size(11).text_color(t.dim).child(where(a))))
        .children([planTag(a, t)].filter(Boolean))))
      .children((a.windows ?? []).map(w => v_flex().gap(5)
        .child(h_flex().justify_between().items_baseline()
          .child(div().text_color(t.foreground).child(long(w)))
          .child(div().font_semibold().text_color(color(w, stale, t)).child(`${w.used}%`)))
        .child(meter(w, stale, t, 5))
        .child(div().text_size(11).text_color(t.dim).child(resets(w)))))
      .when(many && Boolean(a.error), el => el.child(div().text_size(11).text_color(t.blocked)
        .child(a.fetched ? `fetch failed: ${a.error} · data from ${clock(Date.parse(a.fetched))}` : `fetch failed: ${a.error}`)));
  }

  details() {
    const t = theme();
    const u = shared(KEY);
    const list = ordered(u, props()?.account);
    const many = list.length > 1;
    // One account: its state is the footer, as before. Several: each section says its own failure.
    const one = many ? null : list[0];
    const last = Math.max(0, ...list.map(a => at(a.fetched)));
    const error = one?.error ?? (list.length ? null : u?.error);
    const footer = !last ? (error ?? "not fetched yet")
      : error ? `fetch failed: ${error} · data from ${clock(last)}`
      : `updated ${clock(last)}`;
    return v_flex().w_full().h(props().height ?? 0).justify_end().child(v_flex().w_full().p(14).gap(14).text_size(12).text_color(t.muted)
      .bg(t.popover).border(1).border_color(t.border).rounded(8)
      .child(h_flex().justify_between().items_center()
        .child(h_flex().gap(8).items_center().child(image("icons/claude.svg").size(16))
          .child(div().text_size(13).font_semibold().text_color(t.foreground).child("Claude Usage"))
          .children([many ? null : planTag(one, t)].filter(Boolean)))
        // While any copy's fetch is in progress, Refresh says so instead of starting a second one.
        .child(pending(u)
          ? div().id("refresh").px(6).py(2).text_color(t.dim).child("Refreshing…")
          : div().id("refresh").px(6).py(2).rounded(5).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => cx.spawn(async () => refresh(Boolean(props()?.machines)))).child("Refresh")))
      .children(list.map(a => this.section(a, t, many)))
      .child(div().text_size(11).text_color(error ? t.blocked : t.dim).child(footer)));
  }
}
