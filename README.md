# Lark GPS Attendance

A mobile-first GPS-restricted attendance page for external contacts who open a pinned link inside a Lark group chat.

## What it does

1. Captures a fresh high-accuracy browser GPS reading.
2. Blocks submissions outside the configured site radius.
3. Creates an Attendance record in Lark Base.
4. Posts a notification to an external Lark group through a Custom Group Bot webhook.

## Lark Base fields

Create a table with these exact field names and types:

- Employee ID — Text
- Employee Name — Text
- Attendance Type — Single select (`Check In`, `Check Out`)
- Site — Text or Single select
- Submitted At — Date and time
- Latitude — Number
- Longitude — Number
- GPS Accuracy (m) — Number
- Distance from Site (m) — Number
- Location Status — Text or Single select
- Submission Status — Text or Single select

## Lark custom app

Grant the app permission to create Base records and make the Base available to the app. Obtain the App ID and App Secret from Developer Console.

## External group notification

In the target external group, add a Custom Bot, copy its webhook, and store it as `LARK_GROUP_WEBHOOK` in Vercel.

## Deploy

1. Copy `.env.example` to `.env.local` for local testing.
2. Run `npm install` then `npm run dev`.
3. Push to GitHub and import the repository into Vercel.
4. Add all environment variables in Vercel Project Settings.
5. Pin the deployed HTTPS URL in the external Lark group.

## Security note

The included shared access code is an MVP safeguard only. Before full rollout, replace it with a per-employee PIN or one-time login link and add duplicate check-in prevention.
