# BranchSuite 2 — Morning whiteboard

The morning whiteboard replaces the marker board in the huddle room. A manager prepares it ahead of time
with talking points, assignments, priority orders, graphs or screenshots, notes and today's numbers.
During the huddle window every lobby display in the branch shows it, and the order board comes back by
itself afterwards.

| Surface | URL | Who uses it |
| --- | --- | --- |
| Whiteboard (editor for managers, read-only for members) | `/whiteboard` (top navigation, after Board) | All staff of the branch |
| Presenter (full screen, in the app) | **Present** on the Whiteboard page | Anyone running the huddle |
| What the TVs will show | **Preview on wall**, or Board → Wall preview → Whiteboard | All staff |
| Lobby displays | `/wall` (takes over automatically during the window) | Paired TVs |

## 1. Prepare it the night before

1. Open **Whiteboard** and press **Tomorrow** (or pick a date in the date bar). Dates that already have a whiteboard show a dot.
2. If yesterday's huddle is a good start, press **Copy from…**, pick the day and confirm. The blocks are copied; assignments start un-ticked and without linked inbox tasks. Copying replaces what is on the target day, so BranchSuite asks first.
3. Press **Add block** and choose:

| Block | What it is for | Tips |
| --- | --- | --- |
| **Talking points** | A short numbered list | Press **Enter** to add the next point. **Backspace** on an empty point removes it. |
| **Assignments** | Who does what today | Pick a person from the branch roster, or **Team (anyone)**. **Create inbox task** puts it in the branch inbox, assigned to the same person, and shows **Task created** once linked. |
| **Priority orders** | The orders the team should push | Pick from the branch's open orders. Each shows account, role, shift and how many are still to fill. Add a short note per order. |
| **Graph / screenshot** | A chart or screenshot | See section 2. |
| **Note** | A reminder, shout-out or alert | Choose a tone: Note, Shout-out, Safety or Heads up. Each tone has its own icon and label, not only a color. Start a line with `- ` for a bullet. |
| **Today's numbers** | Live counts from the board | Openings to fill, open orders, pending, starting soon and aging orders, computed when the whiteboard is shown. Nothing to set up. |

4. Reorder blocks with the drag handle, with **Move up** / **Move down**, or by focusing the handle and pressing the arrow keys. Delete a block with the bin icon; an **Undo** button appears for a few seconds.

Everything saves automatically about a second after you stop typing. The status on the right reads
**Saving…**, **All changes saved**, or **Not saved** with a **Retry** button. If another manager changed
the same whiteboard at the same moment, BranchSuite loads their version and tells you, so check your last
change and make it again if needed.

Limits: 12 blocks per whiteboard, 20 items per list, 280 characters per item, 2,000 characters per note,
12 priority orders.

## 2. Paste screenshots

- Copy a chart or a screenshot (for example **Win+Shift+S** on Windows), click anywhere in the whiteboard editor and press **Ctrl+V**. A **Graph / screenshot** block is added and the image uploads.
- Or drop an image file onto a Graph block, or press **Choose file**.
- PNG, JPEG and WebP images up to 8 MB are accepted. Larger images: crop them or save as JPEG.
- Give the block a title and a caption. The caption is also the image's text alternative for screen readers.

Images are stored privately in the branch (Azure Blob Storage, no public links) and are kept for
**90 days**, then deleted.

## 3. The huddle window, Start now and End

The status strip at the top of the page shows:

- **Huddle 7:30–8:15**: the window, in branch time. Managers change it with the two time fields; the end must be after the start. The default for a new whiteboard is 07:30–08:15.
- The live state:
  - **Live on displays**: every paired display of the branch shows the whiteboard right now.
  - **Scheduled**: it goes live by itself when the window starts (or the day comes).
  - **Off today**: it will not show on displays today (the window has passed, or a manager pressed End).

Manager buttons:

| Button | What happens |
| --- | --- |
| **Start now** | Displays switch to the whiteboard immediately, and stay on it until you press End. Only today's whiteboard can go live. |
| **End** | Displays go back to the board immediately, and the whiteboard stays off for the rest of the day. |
| **Back to schedule** | Forget Start now / End and follow the window again. |
| **Present** | Full-screen presenter in the app, for a laptop or meeting-room screen. **←/→** or **Page Up/Page Down** change pages, **F** toggles full screen, **Esc** exits. |
| **Preview on wall** | Opens the wall preview in Whiteboard mode, exactly as the TVs show it. |

## 4. What displays show, and when

| Time | Displays show |
| --- | --- |
| Outside the window | The coded order board. The API sends no whiteboard content and no images to displays. |
| During the window, or after Start now | The whiteboard, in large type, paging every 15 seconds if it does not fit on one screen. |
| After the window, or after End | The coded order board again, automatically. |

Displays switch on time: each feed tells the TV when the next switch is due, and the TV asks again at
that moment. See [WALL.md](WALL.md) § 6a for the details.

## 5. Members

Members of the branch see the whiteboard read-only. Their own assignments are highlighted with **You**
and have a **Done** checkbox. Ticking it updates the whiteboard everywhere, including the displays while
the huddle is live.

## 6. Privacy

- Huddles happen before associates arrive, so the whiteboard shows real names (accounts and people) on **all** paired displays of the branch while it is live.
- Keep it team-appropriate: no pay rates, personal contact details, health or disciplinary information, and nothing about individual associates you would not say out loud in the huddle.
- If a display can be seen from the lobby during the huddle, set **Wall codes** in the Priority orders block. Orders then show their wall code and shape instead of the account name.
- Outside the window displays never receive whiteboard content or images; the API enforces this, not the TV.
- Images are kept for 90 days.

## 7. For developers

- Contract: `packages/shared/src/whiteboard.ts` (schemas, `WhiteboardView`, routes, `whiteboardPaths`), rules in `packages/shared/src/domain/whiteboard.ts`.
- Web: `apps/web/src/features/whiteboard/`.
  - `WhiteboardPage.tsx`: branch and date selection, status strip, copy dialog, member view wiring.
  - `useWhiteboardDraft.ts`: local draft + debounced (800 ms) whole-board PUT; adopts server changes when clean; 409 refetches and notifies.
  - `WhiteboardEditor.tsx`, `BlockEditors.tsx`, `ImageBlockEditor.tsx`: block list and per-kind editors.
  - `WhiteboardSlide.tsx`: presentational large-format slide shared by the presenter, the wall takeover and the preview. It must not import the staff query layer (it ships in the `/wall` chunk).
  - `media.tsx`: images are fetched as Blobs through a `MediaLoader` and shown via object URLs (revoked on change).
  - `model.ts`: pure helpers (draft → PUT body, limits, image validation, window and live state, note bullets).
- Query hooks: `useWhiteboards`, `useWhiteboard`, `useSaveWhiteboard`, `useSetWhiteboardLive`, `useCopyWhiteboard`, `useAssignmentDone`, `useAssignmentTask`, `useUploadMedia` (raw `File` body, `Content-Type`, `x-file-name`) in `apps/web/src/lib/queries.ts`. Realtime entity `whiteboard` invalidates `['whiteboard', branchId]` and the branch's wall preview.
