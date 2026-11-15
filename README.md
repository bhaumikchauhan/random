# FMCG CRM Hub

A mobile-first field sales CRM built for FMCG (Fast-Moving Consumer Goods) distributors and their salesmen. It tracks customers, orders, visits, attendance, beat plans, and live locations — all from a single cross-platform app.

---

## What it does

**For admins**
- Dashboard with today's revenue, bills, active salesmen, outstanding dues, and no-order count
- Manage salesmen (create, edit, enable/disable, set geofence radius, grant customer-edit rights)
- Full customer lifecycle — add, edit, approve/reject new customers added by salesmen, bulk import from XLSX/CSV
- Product (item) master — add, edit, deactivate, bulk import
- Route/beat management — define named routes and assign customers
- Custom customer fields — text, number, dropdown, multiselect, checkbox
- Visit task configuration — require a photo and/or answers to custom questions on every bill
- Orders — view all bills, export to XLSX with line-item detail
- Attendance — daily check-in/check-out report with GPS coordinates and geofence flagging, monthly XLSX export
- Live map — real-time location of all salesmen
- Leaderboard — daily / weekly / monthly ranking by sales and bill count
- Outstanding dues list sorted by amount
- Bulk WhatsApp messaging to customers
- Approval queue for salesman-submitted customers

**For salesmen**
- Day view: beat plan with ordered stops, check visited/unvisited, follow-up reminders
- Create and edit draft orders with line items (qty, discount, free qty, MRP), then submit to lock
- Record visit outcomes: Order / No Order / Follow-up with reason, notes, GPS, and optional task photo
- View their own customers, visit history, and outstanding amounts
- Customer creation (goes to admin approval queue)
- Attendance check-in / check-out with selfie photo support
- Beat plan — auto-suggested from preferred order days and pending follow-ups, or manually set

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.11 + FastAPI + Motor (async MongoDB) |
| Database | MongoDB |
| Auth | JWT (30-day tokens), bcrypt passwords |
| Frontend | React Native (Expo 54) with Expo Router — targets iOS, Android, and web |
| Maps | react-native-maps (native) / Google Maps embed (web) |
| File storage | Object store via emergentintegrations proxy |
| Spreadsheet I/O | openpyxl for XLSX import/export |

---

## Project structure

```
FMCG-CRM-main/
├── backend/
│   ├── server.py          # Single-file FastAPI app (all routes)
│   ├── requirements.txt
│   └── tests/             # pytest suites
└── frontend/
    ├── app/               # Expo Router file-based routes
    │   ├── (admin)/       # Admin tab layout: Dashboard, Customers, Visits, Map, More
    │   ├── (salesman)/    # Salesman tab layout: Day, Customers, Visits, Map, More
    │   ├── customer/      # Customer detail, new, edit screens
    │   └── order/         # Order detail and new order screens
    ├── src/
    │   ├── api.ts         # Typed API client
    │   ├── auth.tsx       # Auth context (JWT stored in SecureStore)
    │   ├── theme.ts       # Design tokens
    │   └── locationTracker.ts  # Background GPS pinging
    └── assets/
```

---

## Seed credentials

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@fmcg.com | admin123 |
| Salesman | john@fmcg.com | sales123 |
| Salesman | priya@fmcg.com | sales123 |

---

## Running locally

### Backend

```bash
cd backend
cp .env.example .env   # set MONGO_URL, DB_NAME, JWT_SECRET
pip install -r requirements.txt
uvicorn server:app --reload
```

API available at `http://localhost:8000/api`.

### Frontend

```bash
cd frontend
yarn install
yarn start          # Expo dev server
# then press w (web), a (Android), or i (iOS)
```

---

## Key API endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/auth/login | Login, returns JWT |
| GET | /api/dashboard | KPI summary |
| GET/POST | /api/customers | List / create customers |
| POST | /api/customers/import | Bulk import from XLSX/CSV |
| GET/POST | /api/orders | List / create orders (bills) |
| GET | /api/orders/export | Download all bills as XLSX |
| GET/POST | /api/visits | List / create visit records |
| GET/POST | /api/beat-plan | Get or set daily visit plan |
| POST | /api/attendance/check-in | Salesman check-in with GPS |
| POST | /api/attendance/check-out | Salesman check-out |
| GET | /api/attendance/export | Monthly attendance XLSX |
| GET | /api/locations/latest | Live position of all salesmen |
| GET | /api/leaderboard | Sales ranking by period |
| GET/POST | /api/items | Product master |
| POST | /api/items/import | Bulk import items from XLSX/CSV |
| GET/PUT | /api/visit-tasks | Admin-defined visit checklist |
| GET/POST | /api/customer-fields | Custom customer field definitions |
| GET/POST | /api/routes | Route / beat master |
| POST | /api/upload | Upload a photo or file |
