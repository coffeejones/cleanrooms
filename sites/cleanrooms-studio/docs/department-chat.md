# Department chat

Chat is a separate operational subsystem. Messages and room preferences never enter the planning snapshot, increment its revision or require loading its shifts, instructions, payroll or employee profiles. The existing authenticated accounts transport dispatches chat actions to `lib/chat-store.mjs`; the sandboxed UI uses the existing MessageChannel/storage bridge.

## Access and membership

A room belongs to exactly one department; a department has at most one room. Ordinary users must have an active account linked to an active employee. Access derives from the employee's **primary worksite**: its stable site index must occur in the department's current `siteIds`. Shifts at another worksite do not grant chat access. Overlapping department worksite lists can grant access to several rooms. This is derived membership, not a new manually maintained chat member list.

`chat.manage` grants access to all rooms in the authenticated workspace and permits creating/renaming rooms and pinning/unpinning messages. Custom roles can receive this permission independently of planning. Employee preview requires **both** `plan` and `chat.manage`, simulates the selected employee's department access, and is read-only. Preview cannot send, mark messages read, mute, seed or manage rooms.

Each request pins the active membership/role versions and directory version/token. Conditional writes recheck these guards inside the D1 transaction, including current room/department/employee access. Reads and write responses perform a final fresh guard after assembling their response. Cross-workspace and cross-account cursors are rejected. UI caches invalidate on the returned `accessKey`; revoked access clears conversation data.

## Storage and writes

Migration `0025_department_chat` adds three tenant-scoped tables:

- `workspace_chat_rooms`: department, display name, metadata version, latest message sequence, write token, author/timestamps and demo flag. Department uniqueness is enforced per workspace.
- `workspace_chat_messages`: room/message identity, monotonically increasing room sequence, authenticated author/name, retry client ID, literal text, timestamp, pin and demo flags. Sequence and `(author, client ID)` are unique within a room.
- `workspace_chat_readers`: per-room/per-account monotonic read sequence and muted setting.

Sending increments the room sequence and inserts the message in one D1 batch under a unique write receipt. Repeating the same client ID/text returns the original message; reusing it for different text fails. Renaming and pinning require the current metadata version. Read marks cannot move backwards or beyond the latest stored message. Muting and marking read preserve each other's fields.

## Loading and UI

Room lists return at most 100 rooms with cursors, compact latest-message snippets, member counts and unread counts excluding the viewer's own messages. The navigation badge counts unread messages across accessible **unmuted** rooms, including rooms outside the first page. Manager department options are compact metadata. Room summaries and department counts use batched queries rather than one request per room.

A conversation returns the latest 50 messages, bounded by a 512 KiB text budget, plus at most three pinned messages. Older history uses a room/account-bound sequence cursor. Messages are rendered as literal text; HTML in a message is not executed. Text is limited to 10,000 UTF-16 code units and 40 KiB UTF-8 per message; room names are at most 120 characters and reject control characters.

The active, visible conversation checks for new data every second through authenticated `chatSync`; unchanged responses contain no message bodies or room summary. New messages are fetched in ascending sequence pages within the same byte budget, and bursts are drained without skipping gaps. The room catalog refreshes separately every 15 seconds. Background updates are silent; initial loading and errors retain explicit feedback. Sync pauses while hidden or inactive and backs off after temporary failures. Read watermarks follow the contiguous sequence actually received, so a send acknowledgment cannot mark a concurrent unseen message as read. The navigation badge refreshes every 30 seconds while the document is visible and chat is inactive. Requests and responses are scoped to the current user, workspace, selection and access generation. Drafts and scroll position survive routine refreshes; older messages are loaded on demand. Explicit demo seeding creates labeled sample senders/messages only in departments without an existing room and never changes user-created conversations.

## Current scope

This version provides department rooms, text messages, unread state, three pinned messages and an in-app muted badge preference. It uses near-real-time polling, not a shared WebSocket/push service. It does **not** implement native iOS/Android push delivery, attachments, direct messages, reactions, typing indicators or shift links. Muting affects the in-app badge; it is not a claim that a push service exists. The web employee view and planner view use the same server data and authorization.
