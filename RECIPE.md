# Claude Usage

Your Claude plan limits in Herdr's status bar: the 5-hour, weekly and weekly Fable usage as small rings that fill clockwise as each limit is used. Click it for a popup with every limit, its percentage (the same whole number Claude Code's `/usage` shows) and when it resets.

![Claude Usage](preview.png)

This file is the brief: enough to build Claude Usage from an empty folder. The files next to it are one build of it. If they don't work on your Herdr, or you want it different, build it again from here.

## What you see

- **The bar**, a block in the 28px status bar, exactly as wide as what it shows, so it leaves no gap beside the next block. Background `chrome`, text 11.8px. Its content sits in a pill 21px high with 6px corners and 6px side padding, 2px in from the block's edges (so its icon is 16px from the next item's, like Herdr's own status items): the theme's `hover` color under the pointer, `selected` while the popup is open, like the tab bar's Files / Changes buttons. 9px after the icon and before the `+1`, 6px inside a limit, 12px between two limits.
  - The Claude Code mascot (`mascot.svg`, Herdr's `icons/claude.svg` redrawn in `currentColor`), 16px, in `muted` like the other status icons (`foreground` while the popup is open). Its art fills 15 of 24 units in height, so 16px makes it as tall as their 13px icons.
  - One ring per limit the account reports among `5h` (the 5-hour session limit), `7d` (the weekly limit) and `Fb` (the weekly limit scoped to Fable, `BAR_MODELS`); a Max 20x account has no 5h limit, so it starts at `7d`. Each is a `dim` label and the percentage, both in Geist Mono at 10.5px (the percentage in `muted`), around a 13px ring with a 2px stroke, as big as the other status icons.
  - The ring's track is the limit's color at 30% opacity; the used share is the same color at full strength, an arc clockwise from 12 o'clock. The color follows the light and dark theme: `accent` for 5h, and `accent` at 60% opacity for 7d and Fb. At 80% and above it turns `working` (the percentage too), at 95% and above `blocked`, both at full opacity on every ring. At 100% it is a full circle.
  - Before the first fetch it shows `…`; with no data and an error, `no data`.
  - With other accounts found (prop `machines`), a `+1` after the rings counts them, in `dim`, or in `working` / `blocked` once one of their bar limits reaches 80% / 95%.
- **The popup**, 300px wide, right-aligned with the bar and 6px above it, sized by content, 14px padding, 14px gaps, text 12px in `muted`, on `popover` with a 1px `border` and 8px corners.
  - A header: the Claude icon (16px), "Claude Usage" in 13px semibold `foreground`, with one account its plan tag ("Max 20x": 10px `dim` text in a 1px `border` outline with 4px corners), and a "Refresh" button on the right (`dim`, `hover` background on hover), which reads "Refreshing…" and doesn't click while a fetch is in progress.
  - One section per limit the account reports, including weekly limits scoped to one model ("Weekly Opus limit"): the name in `foreground` and the percentage on its baseline at the right, in Geist Mono 12px semibold and in the meter's color, so the meter carries the weight, not the number; then a 5px meter and "resets in 2h 14m, at 17:00" (under 24 hours) or "resets Monday at 09:00" in 11px `dim`, 5px apart, with 12px between sections.
  - With several accounts, a group per account, the bar's account first: a 1px `border` line with 12px below it, the email in 12px semibold `foreground` over "on this computer, wsl" in 11px `dim`, the plan tag centered on the right, then its limit sections, and its own "fetch failed: … · data from 13:55" in `blocked` when it has one.
  - A footer in 11px `dim`: "updated 14:05" (the newest fetch), or with one account "fetch failed: HTTP 401 · data from 13:55" in `blocked`.

## How it behaves

- Fetches on start, then at most every 5 minutes (a 60-second timer checks when the last fetch started). Every copy shares one result through shared state `"claude-usage"`, and one fetch at a time: a fetch writes `checked` and `started` there before its request and `finished` after, so several bars or a bar and the popup don't fetch twice. A fetch reads every account at once. It counts as in progress until it finishes or for 75 seconds (longer than a linked machine's lookup and the usage request together, each limited to 30 seconds by the runtime), so a request that never settles can't block the next one. One that expires unfinished (the popup closed on it, the layout switched, the app quit) is tried again at the timer's next check rather than after the 5 minutes, which also means a truly hung request is retried about once a minute. A fetch that ends after a newer one started is dropped.
- Each account is stale on its own: an error, or no successful fetch for 12 minutes. Stale data keeps the last numbers but greys that account's rings and meters to `dim` and drops the meters' ghost fill; the icon dims to 50% when the bar's account is stale. The 12 minutes are one missed cycle plus slack, so a slow fetch doesn't flash the bar grey.
- Hover shows a tooltip with each bar limit's name, percentage and reset time, plus the last error, and one line per other account ("you@work.com: 5h 12%, 7d 40%").
- Click opens the popup above the bar, and clicking the bar again closes it. Refresh fetches at once, unless a fetch is already in progress (then it reads "Refreshing…" until that one lands). Esc or a click elsewhere also closes it.
- Agent statuses play no part; there are no animations.

## Built from

- **One mod**, `mods/claude-usage/`, with `main.js` and `mod.json` (`place: "none"`, so it only shows where a layout puts it). No `keys.json`.
- **A block in a layout you own** (clone a shipped one first with `layout.clone`). For example a status row at the bottom of the work column:

  ```json
  { "id": "status-bar", "type": "row", "size": { "px": 28 }, "resizable": false,
    "children": [
      { "id": "status", "type": "block", "content": { "mod": "workspace-status" } },
      { "id": "claude-usage", "type": "block", "size": { "px": 200 },
        "content": { "mod": "claude-usage", "props": { "border": "top" } } } ] }
  ```

  Props:
  - `border`: `"top"` or `"bottom"` draws a 1px `border` line on that edge, to match a bar beside it.
  - `machines`: `true` also reads the Claude Code logins on every machine Herdr is linked to (`machines()`, as `hc machine ls` lists them), so the popup shows each account. Off, only this computer's.
  - `account`: which account the bar shows: an email, a display name, or a machine name for the account logged in there (`"local"` for this computer). Unset, or matching nothing, it is this computer's account, else the first found. The bar passes `account` and `machines` on to its popup.
  - `block`: the block's `id` in the layout, which the bar resizes to fit (default `"claude-usage"`). `fit: false` keeps the layout's size instead.
- **One view, two roles.** With `props().overlay` set it draws the popup (`openOverlay({ mod: "claude-usage", kind: "popup", frame: "none", width: 300, height, at, props: { details: true, height } })`), otherwise the bar. Only the bar runs the timer.
- **The data**: `GET https://api.anthropic.com/api/oauth/usage` with `Authorization: Bearer <token>` and `anthropic-beta: oauth-2025-04-20`, through `fetch`. Newer responses carry `limits: [{ kind, percent, resets_at, scope: { model: { display_name } } }]` with kinds `session`, `weekly_all` and `weekly_scoped`; older ones carry `five_hour` / `seven_day` with `utilization` and `resets_at`. Both are mapped to `{ kind, model, used, resets_at }`, with `used` floored to a whole number as `/usage` does (so the numbers match and the 80/95 thresholds trip where the raw value does); a limit whose value isn't a number is left out, as `/usage` skips it. Window lengths for the ghost fill: 5 hours for `session`, 7 days for the weekly kinds.
- **The token**: Claude Code's own OAuth login, read with `readTextFile` from `~/.claude/.credentials.json` and `~/.claude-work/.credentials.json` (`claudeAiOauth.accessToken`), on this computer and with `machines` on each linked one (`readTextFile(path, { on })`; a linked machine's home comes from `exec("sh", ["-c", 'printf %s "$HOME"'], { on })`, or PowerShell's `UserProfile` on Windows, asked once).
- **The width**: the bar's content is an `h_flex` with `flex_none` and a stable `id`; its `on_size_change` width (zoomed px, so divided by `settings().zoom`) plus the 4px outside the pill is sent with `run("layout.resize", { id: block, px })` whenever it changes, so the block grows for a `+1` or a third digit and shrinks back.
- **The plan**: from the newest token's login, `claudeAiOauth.subscriptionType` (`max`, `team`, `pro`) capitalized, plus the multiplier ending `rateLimitTier` (`default_claude_max_20x` gives `20x`): "Max 20x", "Team 5x". No `subscriptionType`, no tag; an unknown tier, the name alone.
- **The account**: each login's `oauthAccount` (`accountUuid`, `emailAddress`, `displayName`) from `~/.claude.json` for `~/.claude`, or `<dir>/.claude.json` for another config dir. Logins are grouped by `accountUuid`, since each machine has its own token for the same account; within an account the token with the later `expiresAt` wins, since whichever Claude Code refreshed last holds the live one. One request per account, all from this computer. The mod never stores, logs or refreshes a token; it sends each only to `api.anthropic.com`.
- **Shared state** `"claude-usage"`: `{ checked, started, finished, error, accounts: [{ id, email, name, machines, fetched, error, windows }] }`, `machines` naming this computer `null`. A failed account keeps its last `fetched` and `windows`. An account missing from a fetch is kept, with "wsl unreachable", only when a machine it was on couldn't be reached; otherwise it is dropped. State without `accounts` (an older build's) is refetched at once.
- **Herdr functions**: `home`, `exec`, `machines`, `readTextFile`, `shared`, `setShared`, `props`, `openOverlay`, `run`, `settings`, `theme`; `image`, `svg`, `div`, `h_flex`, `v_flex`, `.tooltip`, `.when`, `.hover`, `.font_family`.
- **The rings**: two `PathBuilder.stroke(2)` paths in percent coordinates of a 13px box, painted with `window.paint_path(path, Background.solid(color).opacity(o))` and laid over each other absolutely: the track, a full circle drawn as two half arcs (an arc can't end where it starts), and the used share, an `arc_to` from 12 o'clock with `large_arc` above half and `sweep` true. The radius is half the box less half the stroke, so the stroke stays inside.
- **Pressed**: the popup sets shared state `"claude-usage.popup-open"` when it starts and clears it in `close()`; the bar reads it to draw itself pressed, and clears a value left over from a crash when it starts.

## Watch out

- **The mod reads files outside its folder and reaches the network**: Claude Code's credentials and account files, with `machines` on every linked machine too, and Anthropic's API with those tokens.
- The usage endpoint is the one Claude Code's `/usage` uses; it is not a documented public API and its shape can change. Keep both response shapes. A 200 with no usable limit counts as a failed fetch, so the last numbers stay and the error shows.
- Credentials as a file is how Claude Code stores them on Linux and Windows. On macOS it keeps them in the Keychain, so there is no file and the bar shows `no data` ("no Claude Code login found"). A macOS build would read the token with `exec("security", ["find-generic-password", "-s", "Claude Code-credentials", "-w"])`.
- An expired token is reported, not refreshed: "token expired, use Claude Code to refresh it" (on a linked machine: "token expired on wsl, use Claude Code there to refresh it"). Using Claude Code refreshes it, and the next fetch recovers. A linked machine's token only stays fresh while Claude Code is used there; any machine on the same account will do, since the latest token wins.
- A linked macOS machine has no credentials file either (Keychain), so its account isn't found; `exec("security", …, { on })` would read it.
- `~/.claude-work` is a second Claude Code config dir (`CLAUDE_CONFIG_DIR`); a missing one is skipped. Add or remove dirs in `DIRS`.
- The API reports resets a fraction of a second before the hour; round to the minute before printing, or "16:59" shows instead of "17:00".
- The bar's click handler stops the mouse-down so a `window_drag` status bar doesn't swallow the click.
- A popup without `at` opens at the pointer and Herdr pushes it back into the window, over the bar. Its height can't be measured before it opens, so the popup is a frameless box of 120 + 90 px per limit across all accounts (at least 3), plus 44 px per account header when there are several,, capped to the space above the bar, with the card drawn by the mod and pinned to the box's bottom. Herdr sizes a popup to its content, so the root needs an explicit `.h(height)`, not `size_full()`. `at` and the bar's mouse-down `bounds` are in zoomed px, while `width`/`height` are at zoom 1: multiply by `settings().zoom`. Clicks on the empty top of the box don't close the popup.
- Herdr closes a popup on a press outside it and lets that press through, so a click on the bar would close the popup and open it again. The popup's `close()` stamps `Date.now()` in shared state `"claude-usage.popup-closed"`, and the bar doesn't open it when its own press is within 250 ms of that stamp. The two land in one event, 1 ms apart at most when measured. A popup closed by Esc or a click elsewhere is long past that window, so the next click on the bar opens it.
- Times are 24-hour and local; days are English.

## Done when

- `herdr-app check mods/claude-usage` passes.
- With Claude Code logged in, the bar shows `5h`, `7d` and `Fb` rings (no `5h` on Max 20x) with the same percentages as Claude Code's `/usage`.
- The popup's meters show a ghost fill that grows over each window and resets with it.
- Clicking the bar opens the 300px popup with every limit and its reset time; Refresh updates the footer's time; clicking the bar again closes it and the next click opens it.
- With `machines` on and another account logged in on a linked machine, the bar shows `+1`, the popup a group per account, and `account` set to that machine's name puts its account on the bar. Two machines on the same account show one group, "on this computer, wsl".
- Moving the credentials file away turns the meters grey within a fetch and the popup footer reads "fetch failed: no Claude Code login found"; putting it back recovers.
- `herdr-app status` shows no errors from the mod.
