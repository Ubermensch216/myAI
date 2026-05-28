# Calendar

The calendar is local-first. Events live in encrypted browser IndexedDB and all mutations are performed by browser code.

## State

```js
state.calendar = {
  events: [],
  cursorISO: todayDateISO(),
  viewMode: "month",
  editingEventId: null,
  selectedColor: "accent"
}
```

Event shape:

```js
{
  id,
  title,
  allDay,
  start,
  end,
  location,
  notes,
  color,
  reminders,
  recurrence,
  recurrenceExceptions,
  notifiedReminders,
  done,
  createdAt,
  updatedAt
}
```

## Intent Agent

```text
calendar-like prompt
-> public/modules/calendar.js keyword prefilter
-> POST /api/agent/intent
-> server/calendarAgent.js classifyIntent()
-> public/modules/chat.js orchestration
-> local mutation in state.calendar.events
```

Valid intents:

- `chat`
- `calendar.propose`
- `calendar.create`
- `calendar.list`
- `calendar.delete`
- `calendar.update`

The client includes an explicit-chat guard so ordinary conversation about dates does not over-trigger calendar warnings.

## Confirmation Flow

`calendar.propose` stores a pending create action in the active room. Confirmation text can become `calendar.create` using that pending payload. Rejection clears the pending action.

Delete, update, conflict, repeated-event, and ICS import flows use an in-app review dialog before mutation.

## UI Behavior

- Primary nav switches between chat, calendar, law, and GRC views.
- Calendar supports month, week, and day views.
- Clicking a day opens create at 09:00-10:00.
- Clicking an event opens edit.
- Sidebar shows upcoming events within 7 days.
- `Shift+N` is scoped by active view: chat creates a room, calendar creates an event.
- Korean holidays render in calendar cells and agenda columns.
- Reminders run only while the browser tab is open.
- Calendar uses Asia/Seoul. ICS export writes `TZID=Asia/Seoul`, and `/api/agent/intent` interprets dates in Asia/Seoul.
- Simple recurrence supports daily, weekly, monthly, yearly, and optional end date.
- ICS import/export is file-based through the calendar header settings menu.

## Constraints

- No Google Calendar or Outlook sync.
- No server-side calendar account model.
- ICS support is import/export only.
- Recurring event editing applies to the stored series as a whole.
- Clearing browser storage deletes local calendar events.
