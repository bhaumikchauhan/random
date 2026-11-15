# FieldForce CRM — Product Requirements Document

## Original Problem Statement
Build a mobile FMCG CRM app (from an existing Google Sheet) to: save customer data, WhatsApp customers, and track salesman location daily (stored & viewable later).

## User Choices
- Multi-user: Admin + Salesmen log in separately (admin sees everything; salesmen see only their own customers)
- Continuous location tracking (foreground pings in Expo Go; true background needs a dev build)
- WhatsApp via deep-link (prefilled message)
- Seed sample data: yes
- Extra features: Route Map, Photo capture (shop + visiting card), Outstanding/WhatsApp reminders, Dashboard

## Architecture
- **Frontend**: Expo Router (SDK 54), React Native, expo-image, expo-location, expo-image-picker, react-native-maps (native-only, web fallback), react-native-keyboard-controller. JWT stored in SecureStore (native) / AsyncStorage (web).
- **Backend**: FastAPI + Motor (MongoDB). JWT auth (email+password, bcrypt). Emergent Managed Object Storage for photos.
- **Collections**: users (admin/salesman), customers, visits, orders, locations.

## User Personas
- **Admin/Owner**: monitors field team, dues, all customers, live/last-known salesman locations, manages salesmen.
- **Salesman**: works their assigned shops, logs visits, sends WhatsApp/calls, has location tracked.

## Core Requirements (static)
- Role-based auth & data scoping
- Customer CRUD with photos + GPS
- Visit logging (auto-creates order when amount > 0)
- Location tracking + route map
- WhatsApp + call quick actions
- Outstanding dues + reminders
- Dashboard metrics

## Implemented (2026-08-15)
- JWT auth, admin + 2 salesmen seeded, 5 sample customers
- Admin tabs: Dashboard, Customers, Visits, Map, More
- Salesman tabs: My Day, Customers, Visits, Map, More
- Customer list (search + status/area chips), detail (sections + WhatsApp/Call/Map + reminder), add/edit form (camera + gallery upload, GPS capture)
- Log Visit flow (customer picker, outcome, order amount, remarks, follow-up scheduling, auto GPS)
- Outstanding dues screen with WhatsApp/call reminders
- Salesmen management (create, enable/disable)
- Route Map (native maps with visit pins + location polyline; web summary fallback)
- Foreground location pinger every 5 min for salesmen
- **Orders screen (admin)**: full order list, Total/Uncollected summary, status filter, tap to cycle Pending→Paid→Partial; marking Paid auto-reduces customer outstanding
- **Salesman Leaderboard (admin)**: ranking by sales & visits, period Today/Week/Month, rank medals
- **Beat Plan (salesman)**: today's route in visit order, auto-suggested from preferred order day + due follow-ups, add/reorder/remove stops, progress tracker, WhatsApp/navigate per stop; ownership-enforced (salesman can only add own customers)
- **Live Tracking (admin)**: Map tab Live mode shows all salesmen's latest positions with last-seen time, auto-refresh every 30s; Route mode replays a chosen salesman's saved path for a day. Locations stored permanently in `locations` collection.
- **Attendance**: salesman Check-In / Check-Out with front-camera selfie proof + GPS + time; My Day status card. Admin daily present/absent list (times + hours) and monthly summary per salesman (days present + total hours).
- **Customer Approval workflow**: salesman-created customers are `pending` until an admin approves; once approved the salesman can view but not edit (admin can always edit). Admin can also **reject with a reason** (chips + free text) — rejected customers are hidden from all lists to keep the DB clean (audit trail + reason retained). Admin Approvals screen has Approve + Reject; dashboard tile with pending count badge; Pending chips in list; Approve bar + Pending badge on detail.
- **Attendance Export**: admin one-tap monthly XLSX (Daily + Summary sheets) via download (web) / share sheet (native).
- **Geo-Fence Check-In**: check-in compared to the salesman's territory centroid; if beyond their allowed radius (per-salesman `geofence_radius_km`, default 10km) it's flagged (not blocked) — salesman sees a warning, admin sees a "X km from area" badge.
- **Share customer**: admin/salesman can share a customer's party name + mobile + Google Maps location via WhatsApp (Share action + header button on detail).
- **Item Master & Order Entry**: admin manages product master (code, name, rate, tax %, MRP) with seeded FMCG items; salesman/admin build multi-line orders with a customer + item picker. Each line auto-computes Net = qty×rate×(1−disc%)×(1+tax%); order total live-updates; auto order number (ORD-#####); order detail with line breakdown; admin can cycle payment status Pending→Paid→Partial.
- **Bulk Customer Import (admin)**: upload a Google-Sheet export (.xlsx or .csv) from More → Import customers. Flexible header mapping (Shop/Party Name, Owner/Contact Name, Mobile, Address, Area, Outstanding, Remarks). Duplicate handling by mobile (Skip or Update), optional assignment to a salesman, imported customers set to Approved. Shows created/updated/skipped summary.
- **Billing (formerly Orders)**: simple bill workflow — salesman picks a customer, adds items (auto price/tax/discount/free-qty → Net), saves as a **Draft** (fully editable). Tapping **Submit to Admin** locks the bill so the salesman can no longer edit; admins can always edit or delete any bill. No payment/paid/pending status. Admin can **download an Excel bill register** (one row per line item) with columns: ORDER NUMBER, DATE, PARTY NAME, ITEM CODE, ITEM NAME, QTY, RATE, TAX RATE, ITEM DIS, FREE QUANTITY, MRP, NET, REMARKS (submitted bills only, optional date range).
- Backend tested across 6 iterations

## Feature batch (2026-08-15b)
- **Routes master**: admin adds/edits/deletes route names (More → Routes; 5 seeded). Customers pick a Route on the add/edit form (Area kept for geo-fence). Route shown on customer detail.
- **Custom customer fields**: admin defines own fields on the fly (More → Custom fields) with name + type (Text / Number / Dropdown w/ options). They render automatically on the Add/Edit Customer form and on the customer detail ("Additional Details").
- **Import templates + Item import**: "Download template (.xlsx w/ sample row)" on Customer import; new Item import screen (Item Code, Item Name, Rate, Tax Rate, MRP) with skip/update by code + its own template.
- **Bulk WhatsApp (admin)**: filter customers by Route + Customer Type, search, multi-select / select-all, compose one message with {shop_name} personalization, then a one-by-one send queue (opens each chat pre-filled, tap Next). (True simultaneous bulk needs the paid WhatsApp Business API.)
- Cross-platform confirm dialog helper added (web-safe delete/submit confirms).

## Feature batch (2026-08-15c)
- **Custom field types** extended: added **Multi-select** and **Checkbox (Yes/No)** to the admin field builder (on top of Text/Number/Dropdown). Rendered on customer form + shown on customer detail.
- **Per-salesman edit permission**: Manage Salesmen has a "Can edit customers" toggle. Salesmen can always fix their own PENDING customers; after approval they can edit only if granted this permission.
- **Bulk WhatsApp images**: admin can attach a picture; in the send queue each customer has "Send text" (opens chat, prefilled) and "Send image" (native share sheet with the photo — phone only, not web).
- **Visit tasks (admin-defined)**: More → Visit tasks. Admin builds a per-salesman (or "All") visit checklist — optional "Photo required" + questions (Text/Number/Single-select/Multi-select) each with a Required toggle. On visit logging, required items are enforced. Answers (keyed by question label) + photo saved on the visit and shown in the customer's Visit History for admin.
- **Unique Customer ID**: every customer gets an auto code CUST-00001 (existing backfilled). Import preserves a "Customer ID" column (e.g. SA-0001) if present, else auto-generates. Shown on customer screen + added CUSTOMER ID column to the bill Excel + customer import template.
- **Route-first bill entry**: New Bill shows Route chips; picking a route filters customers to that route; no route = all customers.
- All dates/times now display in IST (Asia/Kolkata); exports too.

## Feature batch (2026-08-16)
- **Visits fully merged into Bills**: the standalone Visit feature is removed. A Bill now captures the outcome (Order / No Order / Follow-up), GPS, admin visit-tasks (with required-photo), and follow-up scheduling. Backend allows 0-item bills for No Order / Follow-up but requires 1+ items when outcome = Order. Bills tab replaces the old Visits tab for both admin and salesman. Dead `/visit/new` route removed.
- **Route-based Beat Plan + Select-all**: the "Add Shops" picker has Route chips (All Routes + each route). Selecting a route filters the shop list to that route; a "Select all / Remove all in {route}" tick adds/removes every shop of that route in one tap. Old "Log a Visit" button is now "New Bill".
- **Bill entry limited to today's Beat Plan (salesman)**: in New Bill, a salesman can only pick from shops added to today's Beat Plan; if the plan is empty they see a hint + "Open Beat Plan" button. Admins still see all customers.
- **Day Wrap-Up (salesman My Day)**: a card showing today's Total Sales, Shops Covered, and Bills count (backend dashboard adds `todays_shops`).
- **No-Order Insights (admin)**: dashboard "No Orders" tile (badge = today's No-Order count via `no_order_today`) opens `/no-order`, a list of shops marked No Order (Today / All filter) with WhatsApp + call follow-up actions.
- **Bill Export date range**: admin Bills export opens a modal with quick ranges (All time / Today / Last 7 days / This month) + Custom from/to (YYYY-MM-DD); backend `/orders/export` already honours from_date/to_date.
- **Beat Reminder on check-out**: when a salesman taps Check Out (shift complete), if any Beat Plan shop still has no bill today they get a confirm nudge listing the unbilled shops ("Check out anyway" / "Not yet").
- **No-Order reasons**: marking a bill "No Order" requires picking one reason from a fixed list (Shop Closed, No Stock, Price Issue, Already Stocked, Owner Absent) plus an optional free-text note. Saved on the order (`no_order_reason`, `no_order_note`), shown on the order detail and in the admin No-Order insights list.
- **Responsive web + PWA (installable)**: on wide browsers the app is centered as a phone-width column on a dark backdrop (`src/components/WebFrame.tsx`, web ≥600px only; native/mobile unchanged). Added a web manifest (`public/manifest.json`), 192/512 icons (`public/icon-*.png`), a minimal no-cache service worker (`public/sw.js`), and PWA/theme/apple meta + SW registration in `app/+html.tsx` so the deployed web build is "Add to Home Screen" installable. Note: `+html.tsx` head tags apply only to the exported production build (not the Metro dev shell); `public/` assets serve in both.

## Backlog / Remaining
- **P1**: True background location (requires dev build + expo-task-manager); Excel/CSV bulk import from the original Google Sheet
- **P2**: WhatsApp Business API (templated bulk); date picker for map/beat day selection; visit photo attachments; export data back to Excel

## Next Tasks
- Import the user's real customer data from the Google Sheet
- Orders screen for admin
- Salesman leaderboard / performance
