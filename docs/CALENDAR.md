# Calendar

The calendar is local-first. Events live in encrypted browser IndexedDB, and the browser owns all mutations.

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

Flow:

```text
calendar-like prompt
-> public/app.js#hasCalendarKeyword()
-> POST /api/agent/intent
-> server/calendarAgent.js#classifyIntent()
-> browser handles create/list/delete/update
```

Valid intents:

- `chat`
- `calendar.propose`
- `calendar.create`
- `calendar.list`
- `calendar.delete`
- `calendar.update`

The server classifies intent and normalizes payloads. It does not write calendar state.

## Confirmation Flow

`calendar.propose` stores a pending create action in the active room. Confirmation messages such as "응, 추가해줘" can become `calendar.create` using that pending payload. Rejection clears the pending action.

Delete, update, conflict, repeated-event, and ICS import flows use an in-app review dialog before mutation.

## UI Behavior

- Primary nav switches between chat and calendar.
- Calendar supports month, week, and day views.
- Clicking a day opens the create dialog at 09:00-10:00.
- Clicking an event opens the edit dialog.
- Sidebar shows upcoming events within 7 days.
- `Shift+N` is scoped by active view:
  - chat view: new chat
  - calendar view: new event
- Korean holidays render in calendar cells and agenda columns.
- Reminders run in the open browser tab.
- Calendar is fixed to Asia/Seoul. ICS export writes `TZID=Asia/Seoul`, and `/api/agent/intent` always interprets dates in Asia/Seoul.
- Event edit supports simple recurrence: daily, weekly, monthly, and yearly, with an optional end date.
- ICS import/export is accessed through the gear-icon settings menu in the calendar header, placed to the right of the month/week/day view toggle. Each menu item shows a short Korean description of what the action does.
- ICS export writes local events as `VEVENT` entries, including `RRULE` when present.
- ICS import reads common `VEVENT` fields (`SUMMARY`, `DTSTART`, `DTEND`, `LOCATION`, `DESCRIPTION`, `RRULE`) and asks for review before saving.

## Constraints

- No Google Calendar, Outlook, or ICS sync.
- ICS support is file import/export only; it is not account sync.
- Recurring event editing applies to the stored series as a whole.
- No multi-calendar account model.
- Reminder checks only run while the browser tab is open.

