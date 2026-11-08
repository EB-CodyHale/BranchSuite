# BranchSuite 2 — Wall mode

Wall mode puts the branch's job order board on a lobby TV. Walk-in visitors can see that work is
available, but they cannot read client names, pay or candidate identities. The server codes the data
before it leaves BranchSuite. The TV never receives the raw orders.

| Surface | URL | Who uses it | Session |
| --- | --- | --- | --- |
| Lobby display | `/wall` | The lobby TV | Display token only. No staff sign-in. |
| Staff preview | `/board/wall-preview` (Board → Wall preview) | Any staff member of the branch | Staff sign-in |
| Wall settings | `/setup/wall` | Managers and admins | Staff sign-in |
| Displays and pairing | `/setup/displays` | Managers and admins | Staff sign-in |

## 1. What the public sees and what staff see

The TV shows the output of `toWallFeed` (`packages/shared/src/domain/wall.ts`) and nothing else. The
default settings are the most private settings.

| Item | Lobby TV (default) | Staff preview | Staff preview with **Show legend** |
| --- | --- | --- | --- |
| Client | Code, color and shape, for example a blue ◆ **K7** | Same as the TV | Same, plus the account name in a dashed **STAFF ONLY** label |
| Role, shift, schedule | Shown | Same as the TV | Same as the TV |
| Pay | Hidden | Same as the TV | Same as the TV |
| Location (unit, site) | Hidden | Same as the TV | Same as the TV |
| Openings | Symbols only (see below) | Same as the TV | Same as the TV |
| Recruiter | Marker color dot | Same as the TV | Same as the TV |
| Notes, contacts, candidate names, order IDs | Never shown | Never shown | Never shown |

The legend is the only extra item, and it is never sent to a display. It comes from
`GET /api/branches/:b/wall/legend`, which requires a staff sign-in.

### Opening symbols

Each opening is a symbol. The shape gives the meaning, so color is never the only signal. The strip
at the bottom of the screen explains the symbols in plain words.

| Symbol | Word on the TV | Board state |
| --- | --- | --- |
| ○ hollow ring | Open | `open`: nobody on the line |
| ◌ dashed ring | Pending | `tentative`: penciled in, candidate in process |
| ● filled disc | Filled | `committed`: accepted, not started yet |
| ✓ check in a filled disc | Started | `started`: the person has started |

Other marks:

- **★ Hot**: a priority order. The tile also has a red top edge.
- **Starts soon**: a filled opening starts within 2 days. A small dot also sits on that symbol.
- **Paused**: the tile is dimmed and labelled "Paused". Paused orders appear only when the branch turns on **Show paused**.
- When the branch shows initials, the initials appear inside the symbol. A started opening then has a small check badge on its rim.
- A tile with more than 24 openings shows 23 symbols and "+N more".

Every symbol also has screen-reader text, for example "Filled (AQ), starts soon".

### Screen layout

- **Header**: branch name, the headline (if set), openings to fill, openings starting soon, and a large clock with the date in the branch time zone.
- **Tiles**: client shape and code, role, shift and schedule, pay and location (only when the settings allow them), opening symbols, number to fill, and badges.
- **Footer**: the symbol key and, when there is more than one page, "Page 2 of 3" with dots.

## 2. Settings guide (Setup → Wall settings)

All settings are per branch. A manager of the branch or an admin can change them. The API rejects
changes from other users.

| Setting | Values | Default | Advice |
| --- | --- | --- | --- |
| Client display | `code`, `name`, `hidden` | `code` | Use `name` only for a screen in a staff-only room. |
| Pay display | `hidden`, `band`, `exact` | `hidden` | `band` shows `$`, `$$`, `$$$`. The bands are configurable. |
| Candidate display | `marks`, `initials`, `hidden` | `marks` | `initials` puts candidate initials on a public screen. Use it only in staff-only rooms. `hidden` shows only the openings to fill. |
| Role display | `full`, `category` | `full` | `category` shows "Forklift" in place of the exact role text. |
| Show schedule | on, off | on | Days and hours, for example "M-F · 6:00a-2:30p". |
| Show location | on, off | off | Unit and site names can identify a client. Keep this off in public areas. |
| Recruiter display | `marker`, `initials`, `hidden` | `marker` | |
| Show paused | on, off | off | |
| Headline | Text, up to 120 characters | Empty | A public message, for example "Now hiring — ask the front desk". |
| Seconds per page | 5 to 120 | 15 | Used only when the orders do not fit on one screen. |
| Theme | `dark`, `light` | `dark` | Dark suits most lobbies and reduces glare. Use light in bright, sunny rooms. Both themes meet WCAG AA contrast. |

After a change, the TV updates within a few seconds when realtime is on. When realtime is off, the
TV updates within 60 seconds. Check the result in **Board → Wall preview**.

## 3. Pairing a display

1. On the TV, open `https://<your-site>/wall`. The screen shows a 6-character code, for example `K7Q-29M`, and a countdown.
2. On a staff computer, open **Setup → Displays**, pick the branch in the Setup header and choose **Pair a display**. Type the code and give the display a name, for example "Front lobby".
3. Within 3 seconds, the TV loads the board for that branch.

Notes:

- A code expires after 10 minutes. The TV then gets a new code automatically.
- The TV stores its display token in the browser's local storage (`bs.wall.token`). The server stores only a SHA-256 hash of the token.
- A display reads one branch only. It cannot open staff screens.

## 4. Revoking a display

Revoke a display when you retire a screen, move it, or lose it. Go to **Setup → Displays** and click
**Revoke** on the display.

The revocation takes effect on the display's next request. When realtime is on, revoking pushes a
refresh to every wall in the branch, so the revoked one drops to pairing within seconds. When
realtime is off, that is within 60 seconds. The TV then shows "This display was disconnected"
and a new pairing code. The old token never works again.

## 5. Code rotation

Rotate the wall codes if a visitor could have learned which code belongs to which client, for
example after a printed legend was left at the front desk.

1. Go to **Setup → Accounts** and select **Rotate all wall codes**.
2. Every account in the branch gets a new code, color and shape.
3. Displays update on their next refresh. Staff see the new codes in the legend.

Rotation does not unpair displays.

## 6. Hardware and kiosk setup

Any screen with a current Chromium-based browser works. The board scales with the screen. It shows
about 4 columns on a 1080p TV, and adapts down to 320 px wide. A 4K screen uses larger type, not more,
smaller tiles.

### Option A: mini PC with Microsoft Edge kiosk mode (recommended)

1. Use a small Windows 11 PC on HDMI. Set the display to 1920x1080 or 3840x2160 at 100 % or 200 % scaling.
2. Use Windows **Assigned access** (Settings → Accounts → Other users → Set up a kiosk). Choose Microsoft Edge, "As a digital sign or interactive display", and the URL `https://<your-site>/wall`.
3. Or, for a manual setup, start Edge from a shortcut in the Startup folder:
   `msedge.exe --kiosk https://<your-site>/wall --edge-kiosk-type=fullscreen --no-first-run`
4. In Windows power settings, set the screen and sleep timeouts to **Never**. Turn on automatic sign-in for the kiosk account.
5. In the BIOS, set the PC to power on after power loss (often "AC power recovery: On").

### Option B: browser on the smart TV

- Open `/wall` in the TV's browser and add it as the start page or a home-screen shortcut, if the TV allows it.
- Turn off the TV's eco or auto-off modes, and its screen saver.
- TV browsers are often old. If the board does not render, use Option A.

### Behavior of the display page

- **Screen wake lock**: the page asks the browser to keep the screen on, and asks again when the page becomes visible.
- **Cursor**: hidden after 3 seconds without mouse movement.
- **Full screen**: a button appears for a short time after you move the mouse. A double-click anywhere also toggles full screen.
- **Burn-in protection**: the whole layout moves by up to 2 px on each page cycle and every 3 minutes.
- **Paging**: if the orders do not fit, pages change every "Seconds per page". If the user prefers reduced motion, pages swap without animation.
- **Recovery after power loss**: `/wall` is a deep link. After a restart, it opens on the stored token without any user input.

## 6a. Morning whiteboard takeover

Every branch can prepare a **morning whiteboard** for the daily huddle (see [WHITEBOARD.md](WHITEBOARD.md)).
During the huddle window, every paired display of the branch stops showing the coded order board and
shows the whiteboard instead. When the window ends, the board comes back on its own.

| When | What every paired display shows |
| --- | --- |
| Before the window (default 07:30) | The coded order board |
| During the window (default 07:30–08:15, branch time), or after a manager presses **Start now** | The whiteboard: title, date, window, clock and the blocks, with real names (accounts, people) unless the board is set to **Wall codes** |
| After the window, or after a manager presses **End** | The coded order board |

How the switch works:

- The server decides. `/api/wall/feed` returns `mode: 'whiteboard'` with the resolved whiteboard only while it is live; otherwise `mode: 'board'` and no whiteboard at all.
- The feed also carries `nextModeChangeAt` (the next window start or end today). The display schedules a refetch at that moment plus a 0.5–2.5 s jitter, so all TVs switch on time without hitting the API in the same millisecond. Realtime `whiteboard` messages (sent on every change and at window start and end), the 60-second fallback poll and the 10-minute full refresh all still apply.
- The modes cross-fade (0.7 s). With reduced motion the screen simply swaps.
- Images are never public links. The display fetches each one from `/api/wall/media/<id>` with its `x-display-token` header and shows it from a local object URL, which is released when the image leaves the screen. The API serves an image only while the whiteboard that references it is live; at any other time it answers 404.
- The display only sends its token to `/api/wall/media/…` addresses. Anything else in a feed is ignored.
- Long whiteboards page every 15 seconds with a page indicator, the same way the board does.

**Privacy.** The huddle happens before associates arrive, so the whiteboard may show real account and
people names on every display while it is live. Keep content team-appropriate, and switch the board to
**Wall codes** (in the Priority orders block) if a display can be seen from a public area during the
huddle. Outside the window the API never sends whiteboard content or images to a display.

Staff can check exactly what the TVs will show in **Board → Wall preview → Whiteboard**
(`/board/wall-preview?mode=whiteboard`).

## 7. Troubleshooting

| What you see | Cause | What to do |
| --- | --- | --- |
| The TV shows a pairing code after it worked before | The display was revoked, or the browser storage was cleared (private mode, cleanup tools) | Pair the display again. Do not use a private or guest window for the kiosk. |
| "This display was disconnected" | The server rejected the display token (revoked or unknown) | Pair the display again from Setup → Displays. |
| "Reconnecting…" at the top, with "Last updated …" | The network is down or BranchSuite cannot be reached. The last board stays on screen. | Check the TV's network. The display tries again by itself, first after 5 seconds and then up to every 60 seconds. |
| The board changes only about once a minute | Realtime is not available, so the display polls every 60 seconds | This is expected when Web PubSub is not configured or is blocked by a firewall. Allow outbound WebSockets (`wss://*.webpubsub.azure.com`). |
| "This display's branch is not active" | The branch was archived | Pair the display to an active branch. |
| The pairing code never connects | The code expired, or the manager chose a branch they do not manage | Wait for the new code and try again. Check that the manager manages the branch. |
| A sign-in page appears on the TV | The site's edge configuration does not allow anonymous access to `/wall` | Make sure `/wall` and `/api/wall/*` are anonymous routes in `staticwebapp.config.json`. |
| The type is too small | The TV reports a very low resolution, or browser zoom is reduced | Set browser zoom to 100 %. Use the TV's native resolution. |
| The TV still shows the board during the huddle | The whiteboard for today is set to **End** (off), the window is wrong, or the display missed the switch | Check the status on the Whiteboard page. The display catches up on the next realtime message or within 60 seconds. |
| A whiteboard image shows a crossed-out picture | The image is no longer referenced by today's live whiteboard, or the network dropped | Re-add the image on the Whiteboard page. Displays only receive images while the huddle is live. |
| The screen goes black after some time | The OS or TV power settings | Set the screen timeout to Never. The wake lock cannot override all TV firmware. |

## 8. For developers

- Code: `apps/web/src/features/wall/`.
  - `WallBoard.tsx`: pure presentational board. Props: `feed`, optional staff `legend`, `frame`.
  - `layout.ts`: type scale, columns, `paginate`, burn-in drift (pure functions, unit-tested).
  - `WallDisplayPage.tsx`, `PairingScreen.tsx`, `useWallDeviceFeed.ts`, `deviceApi.ts`: the device. It uses plain `fetch`, never the staff API client, and never calls `/api/me`.
  - `WallPreviewPage.tsx`, `ScaledFrame.tsx`: the staff preview, rendered at 1920x1080 and scaled into a 16:9 frame. A Board / Whiteboard toggle (`?mode=whiteboard`) previews the takeover.
  - `WallScreen.tsx`: picks `WallBoard` or `WhiteboardSlide` (from `features/whiteboard/`) by `feed.mode` and cross-fades between them. Images go through a `MediaLoader` (display token on the TV, staff session in the preview).
  - `useWallDeviceFeed.ts` also schedules a refetch at `feed.nextModeChangeAt` (`modeChangeDelay`, unit-tested).
- Local run: `npm run dev`, then open `http://localhost:5173/wall`. To skip pairing, set the seeded dev token in the browser console:
  `localStorage.setItem('bs.wall.token', 'dev-wall-token-riverside-do-not-use-in-azure')`, then reload.
- The device refreshes on every realtime `invalidate` message (debounced), polls every 60 seconds when the socket is down, and does a full refresh every 10 minutes in all cases.
