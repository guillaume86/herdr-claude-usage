# Claude Usage for Herdr

A [Herdr](https://herdr.dev) mod that shows your Claude plan limits in the status bar: the 5-hour, weekly and weekly Fable usage as small rings, each filling clockwise as the limit is used. Click it for every limit, its percentage (the same whole number as Claude Code's `/usage`) and when it resets.

Linked machines logged in to other accounts? Set `"machines": true` in the block's props: the bar keeps showing one account (this computer's, or the one named by `"account"`, an email or a machine name) with a `+1` for the others, and the popup lists them all. See [RECIPE.md](RECIPE.md#built-from).

## Install

Ask your agent in Herdr:

```text
Read ~/.config/herdr-app/AGENTS.md, then add the mod at https://github.com/dev-gvs/herdr-claude-usage
```

Or by hand: copy `mods/claude-usage/` into `~/.config/herdr-app/mods/`, then add a block for it to a layout you own (see [RECIPE.md](RECIPE.md#built-from)) and run `herdr-app check ~/.config/herdr-app/mods/claude-usage`.

## Privacy

The mod has no token of its own. It reads Claude Code's login from `~/.claude/.credentials.json` (and `~/.claude-work/.credentials.json` if present) and sends it only to `api.anthropic.com` to read your usage. With the `machines` prop on, it also reads those files (and `~/.claude.json`, for which account each login is) on the machines Herdr is linked to, so it can show every account; the tokens still go only to `api.anthropic.com`, from this computer. It never stores, logs or refreshes the token. On macOS Claude Code keeps its login in the Keychain, so the mod shows `no data` there (see [RECIPE.md](RECIPE.md#watch-out)).

[RECIPE.md](RECIPE.md) is the full brief for building or changing it.

## Screenshots

In the status bar:

![Claude Usage in the status bar](screenshots/bar.png)

After clicking it:

![Claude Usage popup](screenshots/popup.png)
