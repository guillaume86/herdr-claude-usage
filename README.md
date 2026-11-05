# Claude Usage for Herdr

A [Herdr](https://herdr.dev) mod that shows your Claude plan limits in the status bar: the 5-hour and weekly usage as two small pie charts, with a faint wedge for how much of each window has passed so you can see whether you're ahead of pace. Click it for every limit, its percentage (the same whole number as Claude Code's `/usage`) and when it resets.

## Install

Ask your agent in Herdr:

```text
Read ~/.config/herdr-app/AGENTS.md, then add the mod at https://github.com/dev-gvs/herdr-claude-usage
```

Or by hand: copy `mods/claude-usage/` into `~/.config/herdr-app/mods/`, then add a block for it to a layout you own (see [RECIPE.md](RECIPE.md#built-from)) and run `herdr-app check ~/.config/herdr-app/mods/claude-usage`.

## Privacy

The mod has no token of its own. It reads Claude Code's login from `~/.claude/.credentials.json` (and `~/.claude-work/.credentials.json` if present) and sends it only to `api.anthropic.com` to read your usage. It never stores, logs or refreshes the token. On macOS Claude Code keeps its login in the Keychain, so the mod shows `no data` there (see [RECIPE.md](RECIPE.md#watch-out)).

[RECIPE.md](RECIPE.md) is the full brief for building or changing it.

## Screenshots

In the status bar:

![Claude Usage in the status bar](screenshots/bar.png)

After clicking it:

![Claude Usage popup](screenshots/popup.png)
