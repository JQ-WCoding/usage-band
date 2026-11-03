# usage-band

A Claude Code mod that draws a band above the prompt showing context fill and 5h/7d rate-limit usage, with a countdown and the local time each limit resets.

```
CTX ████░░░░░░ 42% 85k/200k   5H ████████░░ 85% ⏱ 9h20m · 23:20   7D █░░░░░░░░░ 12% ⏱ 3d19h · Sat 09:00
```

Before the first response of a session (or right after `/compact`), the context bar stays empty as `CTX ░░░░░░░░░░ –% –/200k`.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install usage-band --marketplace JQ-WCoding/usage-band
```

Answer `y` to add the marketplace, then pick a scope (user scope is first; Enter selects it).

From a shell:

```
claude plugin install usage-band --marketplace JQ-WCoding/usage-band
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `JQ-WCoding/usage-band`, then Add plugin.
