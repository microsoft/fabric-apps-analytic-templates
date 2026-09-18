# Testing inside the Fabric portal embed — deep dive

This file covers the diagnostic helpers and troubleshooting matrix for **Testing inside the Fabric portal embed**

## Background

When the URL under test is on `*.fabric.microsoft.com` and contains `devUri=…`, the app is being rendered as a deeply-nested iframe:

```
fabric.microsoft.com (portal)
  └─ *pbiabd.powerbi.com/appbackend (host frame)
        └─ http://localhost:5173/?fabricEmbedded=true (the app)
```

Three failure modes have to be neutralized before validation can proceed:

| # | Symptom | Root cause | Fix |
| --- | --- | --- | --- |
| 1 | Browser lands on `login.microsoftonline.com` and never reaches the app. | Real AAD redirect — cannot be mocked with `sessionStorage.setItem`. | `--profile=<dir>` browser profile so the user signs in once; cookies replay. |
| 2 | Innermost `localhost:5173` iframe shows `chrome-error://chromewebdata/`; network log says `net::ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS`. | Chromium's [Local Network Access](https://chromestatus.com/feature/5436853517811712) policy blocks the public-origin Fabric portal from embedding `http://localhost`. Iframe **navigations** cannot be opted in via response headers — only subresource fetches can. | Browser flag in `.playwright-config.json` plus the LNA middleware in `vite.config.ts`. |
| 3 | Console shows portal CSP and MSAL warnings; agents waste time chasing them. | They originate from the Fabric portal itself (Application Insights CSP, MSAL `parseBrokerParams`, sandboxed iframe warnings). None come from the app. | Source-URL filter (see below). |

## Frame walker

When the simple frame-discovery snippet from `SKILL.md` returns `loaded: false` and you need to debug the frame chain, use this fuller walker:

```js
async page => {
  function walk(frame, depth = 0) {
    return {
      url: frame.url(),
      depth,
      name: frame.name(),
      childFrames: frame.childFrames().map((c) => walk(c, depth + 1)),
    };
  }
  return {
    tree: walk(page.mainFrame()),
    flat: page.frames().map((f) => ({ url: f.url(), name: f.name() })),
  };
}
```

This prints the full parent chain so you can see which level the navigation stopped at (`login.microsoftonline.com`, `chrome-error`, an empty `about:blank`, etc.).

## `classifyConsoleMessages(page)` helper

Drop this into a `run-code` call to bucket console output into `appErrors`, `portalNoise`, and `unknown`:

```js
async page => {
  const messages = [];
  page.on('console', (msg) => {
    const loc = msg.location && msg.location();
    messages.push({
      type: msg.type(),
      text: msg.text(),
      url: loc ? loc.url : '',
    });
  });

  // ...trigger the navigation / interaction here, then:
  await page.waitForTimeout(2000);

  const portalNoiseMatchers = [
    /js\.monitor\.azure\.com/,
    /fabric\.microsoft\.com\/.*\/scripts\/powerbiportal\./,
    /.*pbi.*\.powerbi\.com\/static\/js\//,
  ];

  const buckets = { appErrors: [], portalNoise: [], unknown: [] };
  for (const m of messages) {
    if (m.type !== 'error' && m.type !== 'warning') continue;
    if (m.url.startsWith('http://localhost:5173')) {
      buckets.appErrors.push(m);
    } else if (portalNoiseMatchers.some((re) => re.test(m.url))) {
      buckets.portalNoise.push(m);
    } else {
      buckets.unknown.push(m);
    }
  }
  return buckets;
}
```

Treat anything in `appErrors` as a real failure. `portalNoise` is safe to ignore. `unknown` is worth eyeballing once and then either re-classifying or accepting.

## Troubleshooting matrix

| Symptom | Likely cause | First check |
| --- | --- | --- |
| Lands on `login.microsoftonline.com` | First run / cookies expired | Sign in interactively in the launched browser; rerun. Do **not** automate the sign-in. |
| `chrome-error://chromewebdata/` frame visible | LNA flag missing | Confirm `--config=.playwright-config.json` was on `open` and that the file contains the `--disable-features=...LocalNetworkAccessChecks` arg. |
| Localhost iframe blank but no error frame | Vite dev server not running | `curl -I http://localhost:5173`. Start with `npm run dev` if needed. |
| Many CSP / sandbox errors in console | Portal noise | Apply the source-URL filter via `classifyConsoleMessages`; ignore everything outside `appErrors`. |
| `loaded: true` but DOM empty | Auth handoff failed | Inspect `useAuth()` state via `page.evaluate` inside the `localhost:5173` frame; check that `?fabricEmbedded=true` is on the inner URL. |
| Sign-in prompted on every run | Browser profile not shared | `npm run test:fabric` passes `--profile=~/.rayfin/browser-profiles/fabric`, a fixed per-user directory that survives reboots and is shared across projects. `--persistent` is keyed by a hash of the project path, so it starts empty in every new project — do not switch back to it. Override the location with `FABRIC_BROWSER_PROFILE`. |

## References

- [Chrome status: Local Network Access](https://chromestatus.com/feature/5436853517811712)
- [MDN: `Access-Control-Allow-Private-Network`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Access-Control-Allow-Private-Network)
- [`SWITCH_TO_FABRIC_AUTH.md`](../../../../../SWITCH_TO_FABRIC_AUTH.md) — embedded auth flow background
