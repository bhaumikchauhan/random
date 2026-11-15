from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Annotated, Any, Optional, List
from pathlib import Path
import os
import uuid
import logging

import jwt
import bcrypt
import requests
from bson import ObjectId
from dotenv import load_dotenv
from fastapi import (
    FastAPI, APIRouter, Depends, HTTPException, status,
    UploadFile, File, Query, Response,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from fastapi import Request as FastAPIRequest
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, EmailStr, Field
from motor.motor_asyncio import AsyncIOMotorClient

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ["JWT_SECRET"]
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY", "")
APP_NAME = os.environ.get("APP_NAME", "fmcg-crm-hub")
JWT_ALGO = "HS256"
ACCESS_TOKEN_HOURS = 24 * 30  # 30 days for field usage

STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"

logger = logging.getLogger("fmcg-crm")
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")

# App-wide display timezone (Vadodara, Gujarat, India -> IST)
from zoneinfo import ZoneInfo
IST = ZoneInfo("Asia/Kolkata")

def to_ist(dt: Optional[datetime]) -> Optional[datetime]:
    if not dt:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(IST)

# ============ Storage helpers ============
_storage_key: Optional[str] = None

def _init_storage() -> Optional[str]:
    global _storage_key
    if _storage_key:
        return _storage_key
    if not EMERGENT_KEY:
        return None
    try:
        r = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
        r.raise_for_status()
        _storage_key = r.json()["storage_key"]
        return _storage_key
    except Exception as e:
        logger.error(f"Storage init failed: {e}")
        return None

def _put_object(path: str, data: bytes, content_type: str) -> dict:
    global _storage_key
    key = _init_storage()
    if not key:
        raise HTTPException(500, "Storage not configured")
    r = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data, timeout=120,
    )
    if r.status_code == 503:
        _storage_key = None
        key = _init_storage()
        r = requests.put(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key, "Content-Type": content_type},
            data=data, timeout=120,
        )
    r.raise_for_status()
    return r.json()

def _get_object(path: str):
    key = _init_storage()
    if not key:
        raise HTTPException(500, "Storage not configured")
    r = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    r.raise_for_status()
    return r.content, r.headers.get("Content-Type", "application/octet-stream")


# ============ Password helpers ============
def hash_password(p: str) -> str:
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()

def verify_password(p: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(p.encode(), h.encode())
    except Exception:
        return False


# ============ Enums / Models ============
class Role(str, Enum):
    admin = "admin"
    salesman = "salesman"


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: str
    email: EmailStr
    name: str
    role: Role
    mobile: Optional[str] = None
    area: Optional[str] = None
    active: bool = True
    geofence_radius_km: Optional[float] = None
    can_edit_customers: bool = False


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class SalesmanCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=4, max_length=128)
    name: str
    mobile: Optional[str] = None
    area: Optional[str] = None
    geofence_radius_km: Optional[float] = 10


class SalesmanUpdate(BaseModel):
    name: Optional[str] = None
    mobile: Optional[str] = None
    area: Optional[str] = None
    active: Optional[bool] = None
    password: Optional[str] = None
    geofence_radius_km: Optional[float] = None
    can_edit_customers: Optional[bool] = None


class CustomerIn(BaseModel):
    shop_name: str
    customer_code: Optional[str] = None
    owner_name: Optional[str] = None
    mobile: Optional[str] = None
    whatsapp: Optional[str] = None
    gst_number: Optional[str] = None
    address: Optional[str] = None
    area: Optional[str] = None
    city: Optional[str] = None
    customer_type: Optional[str] = None
    salesman_id: Optional[str] = None
    gps_lat: Optional[float] = None
    gps_lng: Optional[float] = None
    shop_photo: Optional[str] = None
    visiting_card: Optional[str] = None
    product_category: Optional[str] = None
    brands_purchased: Optional[str] = None
    customer_status: Optional[str] = "Active"
    preferred_order_day: Optional[str] = None
    credit_limit: Optional[float] = 0
    payment_terms: Optional[str] = None
    outstanding: Optional[float] = 0
    remarks: Optional[str] = None
    route: Optional[str] = None
    custom: Optional[dict] = None


class RouteIn(BaseModel):
    name: str


class RouteOut(BaseModel):
    id: str
    name: str


class CustomFieldIn(BaseModel):
    label: str
    type: str = "text"          # text | number | dropdown | multiselect | checkbox
    options: List[str] = []


class CustomFieldOut(BaseModel):
    id: str
    label: str
    key: str
    type: str
    options: List[str] = []


class CustomerOut(CustomerIn):
    id: str
    salesman_name: Optional[str] = None
    last_visit: Optional[datetime] = None
    next_followup: Optional[datetime] = None
    last_order_amount: Optional[float] = 0
    approval_status: str = "approved"
    rejection_reason: Optional[str] = None
    created_at: datetime


class ImportResult(BaseModel):
    total_rows: int
    created: int
    updated: int
    skipped: int
    errors: List[str] = []


class VisitIn(BaseModel):
    customer_id: str
    gps_lat: Optional[float] = None
    gps_lng: Optional[float] = None
    visit_result: str  # Order / No Order / Follow-up
    order_amount: Optional[float] = 0
    remarks: Optional[str] = None
    next_followup: Optional[datetime] = None
    task_photo: Optional[str] = None
    task_answers: Optional[dict] = None


class VisitOut(VisitIn):
    id: str
    customer_name: Optional[str] = None
    salesman_id: str
    salesman_name: Optional[str] = None
    visit_date: datetime


class VisitQuestion(BaseModel):
    id: str
    label: str
    type: str = "text"          # text | number | single | multi
    options: List[str] = []
    required: bool = False


class VisitTaskConfig(BaseModel):
    target: str                 # "all" or a salesman_id
    require_photo: bool = False
    questions: List[VisitQuestion] = []


class VisitTaskOut(VisitTaskConfig):
    target_name: Optional[str] = None


class OrderIn(BaseModel):
    customer_id: str
    total_amount: float
    status: str = "draft"       # draft (editable) | submitted (locked for salesman)
    remarks: Optional[str] = None


class OrderLineIn(BaseModel):
    item_id: str
    qty: float
    discount: float = 0      # percentage
    free_qty: float = 0


class OrderLineOut(BaseModel):
    item_id: str
    item_code: str
    item_name: str
    qty: float
    rate: float
    tax_rate: float
    discount: float = 0
    free_qty: float = 0
    mrp: float = 0
    net: float


class OrderCreate(BaseModel):
    customer_id: str
    lines: List[OrderLineIn] = []
    remarks: Optional[str] = None
    outcome: str = "Order"          # Order | No Order | Follow-up
    gps_lat: Optional[float] = None
    gps_lng: Optional[float] = None
    next_followup: Optional[datetime] = None
    task_photo: Optional[str] = None
    task_answers: Optional[dict] = None
    no_order_reason: Optional[str] = None
    no_order_note: Optional[str] = None


class OrderOut(OrderIn):
    id: str
    order_number: Optional[str] = None
    customer_name: Optional[str] = None
    salesman_id: str
    salesman_name: Optional[str] = None
    order_date: datetime
    lines: List[OrderLineOut] = []
    outcome: str = "Order"
    gps_lat: Optional[float] = None
    gps_lng: Optional[float] = None
    next_followup: Optional[datetime] = None
    task_photo: Optional[str] = None
    task_answers: Optional[dict] = None
    no_order_reason: Optional[str] = None
    no_order_note: Optional[str] = None


class ItemIn(BaseModel):
    item_code: str
    item_name: str
    rate: float = 0
    tax_rate: float = 0
    mrp: float = 0
    active: bool = True


class ItemOut(ItemIn):
    id: str
    created_at: datetime


class LocationPing(BaseModel):
    lat: float
    lng: float
    accuracy: Optional[float] = None
    timestamp: Optional[datetime] = None


class LocationOut(BaseModel):
    id: str
    salesman_id: str
    salesman_name: Optional[str] = None
    lat: float
    lng: float
    accuracy: Optional[float] = None
    timestamp: datetime


# ============ App / DB setup ============
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)

async def seed_data(db):
    # Seed admin
    admin_email = "admin@fmcg.com"
    if not await db.users.find_one({"email": admin_email}):
        await db.users.insert_one({
            "email": admin_email,
            "password_hash": hash_password("admin123"),
            "name": "Admin User",
            "role": "admin",
            "mobile": "9999999999",
            "area": "All",
            "active": True,
            "created_at": datetime.now(timezone.utc),
        })
        logger.info("Seeded admin user")

    # Seed sample items (product master)
    if await db.items.count_documents({}) == 0:
        sample_items = [
            {"item_code": "FMCG001", "item_name": "Aashirvaad Atta 5kg", "rate": 240, "tax_rate": 5, "mrp": 275},
            {"item_code": "FMCG002", "item_name": "Tata Salt 1kg", "rate": 22, "tax_rate": 5, "mrp": 28},
            {"item_code": "FMCG003", "item_name": "Fortune Sunflower Oil 1L", "rate": 130, "tax_rate": 5, "mrp": 155},
            {"item_code": "FMCG004", "item_name": "Parle-G Biscuit (Pack of 12)", "rate": 96, "tax_rate": 18, "mrp": 120},
            {"item_code": "FMCG005", "item_name": "Colgate Toothpaste 200g", "rate": 88, "tax_rate": 18, "mrp": 110},
            {"item_code": "FMCG006", "item_name": "Surf Excel 1kg", "rate": 105, "tax_rate": 18, "mrp": 130},
            {"item_code": "FMCG007", "item_name": "Maggi Noodles (Pack of 12)", "rate": 132, "tax_rate": 18, "mrp": 168},
            {"item_code": "FMCG008", "item_name": "Amul Butter 500g", "rate": 245, "tax_rate": 12, "mrp": 275},
        ]
        for it in sample_items:
            it["active"] = True
            it["created_at"] = datetime.now(timezone.utc)
        await db.items.insert_many(sample_items)
        logger.info(f"Seeded {len(sample_items)} items")

    # Seed sample routes
    if await db.routes.count_documents({}) == 0:
        for rn in ["North", "South", "East", "West", "Central"]:
            await db.routes.insert_one({"name": rn, "created_at": datetime.now(timezone.utc)})
        logger.info("Seeded sample routes")

    # Backfill customer_code for existing customers (CUST-#####)
    missing = db.customers.find({"$or": [{"customer_code": {"$exists": False}}, {"customer_code": None}]}).sort("created_at", 1)
    async for c in missing:
        code = await _next_customer_code(db)
        await db.customers.update_one({"_id": c["_id"]}, {"$set": {"customer_code": code}})

    # Seed 2 salesmen
    salesmen_seed = [
        {"email": "john@fmcg.com", "password": "sales123", "name": "John Doe", "mobile": "9876543210", "area": "Central"},
        {"email": "priya@fmcg.com", "password": "sales123", "name": "Priya Sharma", "mobile": "9876500001", "area": "South"},
    ]
    salesman_ids = {}
    for s in salesmen_seed:
        existing = await db.users.find_one({"email": s["email"]})
        if existing:
            salesman_ids[s["name"]] = str(existing["_id"])
            continue
        doc = {
            "email": s["email"],
            "password_hash": hash_password(s["password"]),
            "name": s["name"],
            "role": "salesman",
            "mobile": s["mobile"],
            "area": s["area"],
            "active": True,
            "created_at": datetime.now(timezone.utc),
        }
        res = await db.users.insert_one(doc)
        salesman_ids[s["name"]] = str(res.inserted_id)
        logger.info(f"Seeded salesman {s['name']}")

    # Seed customers only if none exist
    count = await db.customers.count_documents({})
    if count == 0 and salesman_ids:
        john_id = salesman_ids.get("John Doe")
        priya_id = salesman_ids.get("Priya Sharma")
        customers = [
            {"shop_name": "Super Mart", "owner_name": "Rajesh Kumar", "mobile": "9876543211", "whatsapp": "9876543211",
             "address": "123 MG Road", "area": "Central", "city": "Mumbai", "customer_type": "Retailer",
             "salesman_id": john_id, "gps_lat": 19.0760, "gps_lng": 72.8777,
             "product_category": "Groceries", "brands_purchased": "Brand A, Brand B",
             "customer_status": "Active", "credit_limit": 50000, "payment_terms": "Net 30",
             "outstanding": 2500, "remarks": "Good customer"},
            {"shop_name": "Electronics Hub", "owner_name": "Priya Iyer", "mobile": "9876543212", "whatsapp": "9876543212",
             "address": "456 Main Street", "area": "South", "city": "Mumbai", "customer_type": "Distributor",
             "salesman_id": priya_id, "gps_lat": 19.1136, "gps_lng": 72.8697,
             "product_category": "Electronics", "brands_purchased": "Brand C",
             "customer_status": "Active", "credit_limit": 100000, "payment_terms": "Net 60",
             "outstanding": 15000, "remarks": "Follow up new products"},
            {"shop_name": "Local Grocer", "owner_name": "Anil Singh", "mobile": "9876543213", "whatsapp": "9876543213",
             "address": "789 Oak Avenue", "area": "West", "city": "Mumbai", "customer_type": "Retailer",
             "salesman_id": john_id, "gps_lat": 19.0330, "gps_lng": 72.8296,
             "product_category": "Groceries", "brands_purchased": "Brand A",
             "customer_status": "Active", "credit_limit": 10000, "payment_terms": "Net 15",
             "outstanding": 0, "remarks": "Regular"},
            {"shop_name": "Fresh Foods Corner", "owner_name": "Sunita Devi", "mobile": "9876543214", "whatsapp": "9876543214",
             "address": "12 Market Lane", "area": "Central", "city": "Mumbai", "customer_type": "Retailer",
             "salesman_id": john_id, "gps_lat": 19.0850, "gps_lng": 72.8800,
             "product_category": "Groceries", "brands_purchased": "Brand B, Brand D",
             "customer_status": "Active", "credit_limit": 30000, "payment_terms": "Net 30",
             "outstanding": 4200, "remarks": "Weekly orders"},
            {"shop_name": "Value Bazaar", "owner_name": "Ramesh Patel", "mobile": "9876543215", "whatsapp": "9876543215",
             "address": "34 Station Road", "area": "South", "city": "Mumbai", "customer_type": "Wholesaler",
             "salesman_id": priya_id, "gps_lat": 19.1200, "gps_lng": 72.8500,
             "product_category": "General", "brands_purchased": "Brand A, Brand C, Brand E",
             "customer_status": "Active", "credit_limit": 80000, "payment_terms": "Net 45",
             "outstanding": 22500, "remarks": "High volume, needs attention"},
        ]
        for c in customers:
            c["created_at"] = datetime.now(timezone.utc)
            c["last_order_amount"] = 0
        await db.customers.insert_many(customers)
        logger.info(f"Seeded {len(customers)} customers")

@asynccontextmanager
async def lifespan(app: FastAPI):
    client = AsyncIOMotorClient(MONGO_URL, tz_aware=True, tzinfo=timezone.utc)
    db = client[DB_NAME]
    await db.users.create_index("email", unique=True)
    await db.customers.create_index("salesman_id")
    await db.visits.create_index([("salesman_id", 1), ("visit_date", -1)])
    await db.locations.create_index([("salesman_id", 1), ("timestamp", -1)])
    await db.attendance.create_index([("salesman_id", 1), ("date", 1)], unique=True)
    await db.items.create_index("item_code", unique=True)
    app.state.db = db
    app.state.mongo = client
    # init storage best-effort
    try:
        _init_storage()
    except Exception as e:
        logger.warning(f"storage init: {e}")
    await seed_data(db)
    yield
    client.close()


app = FastAPI(title="FMCG CRM API", lifespan=lifespan)
api = APIRouter(prefix="/api")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_db():
    return app.state.db


def create_token(user: dict) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user["_id"]),
        "role": user["role"],
        "iat": now,
        "exp": now + timedelta(hours=ACCESS_TOKEN_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


def _user_out(u: dict) -> UserOut:
    return UserOut(
        id=str(u["_id"]),
        email=u["email"],
        name=u.get("name", ""),
        role=u["role"],
        mobile=u.get("mobile"),
        area=u.get("area"),
        active=u.get("active", True),
        geofence_radius_km=u.get("geofence_radius_km"),
        can_edit_customers=u.get("can_edit_customers", False),
    )


async def current_user(token: Annotated[Optional[str], Depends(oauth2_scheme)], db=Depends(get_db)) -> dict:
    if not token:
        raise HTTPException(401, "Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
        uid = payload.get("sub")
        if not uid or not ObjectId.is_valid(uid):
            raise HTTPException(401, "Invalid token")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid or expired token")
    u = await db.users.find_one({"_id": ObjectId(uid)})
    if not u or not u.get("active", True):
        raise HTTPException(401, "User not active")
    return u


def require_admin(user=Depends(current_user)):
    if user["role"] != "admin":
        raise HTTPException(403, "Admin only")
    return user


# ============ Auth ============
@api.post("/auth/login", response_model=TokenOut)
async def login(request: FastAPIRequest, db=Depends(get_db)):
    # Accept JSON (app/tests) and form-data (Swagger Authorize button)
    ct = request.headers.get("content-type", "")
    if "application/json" in ct:
        payload = await request.json()
        email = str(payload.get("email", "")).lower().strip()
        password = str(payload.get("password", ""))
    else:
        form = await request.form()
        email = str(form.get("username", "")).lower().strip()
        password = str(form.get("password", ""))
    if not email or not password:
        raise HTTPException(422, "email and password required")
    u = await db.users.find_one({"email": email})
    if not u or not verify_password(password, u["password_hash"]):
        raise HTTPException(401, "Incorrect email or password")
    if not u.get("active", True):
        raise HTTPException(403, "User disabled")
    return TokenOut(access_token=create_token(u), user=_user_out(u))


@api.get("/auth/me", response_model=UserOut)
async def me(user=Depends(current_user)):
    return _user_out(user)


# ============ Salesmen management (admin) ============
@api.get("/salesmen", response_model=List[UserOut])
async def list_salesmen(user=Depends(current_user), db=Depends(get_db)):
    cursor = db.users.find({"role": "salesman"}).sort("name", 1)
    result = []
    async for s in cursor:
        result.append(_user_out(s))
    return result


@api.post("/salesmen", response_model=UserOut, status_code=201)
async def create_salesman(body: SalesmanCreate, admin=Depends(require_admin), db=Depends(get_db)):
    email = body.email.lower().strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(409, "Email already exists")
    doc = {
        "email": email,
        "password_hash": hash_password(body.password),
        "name": body.name,
        "role": "salesman",
        "mobile": body.mobile,
        "area": body.area,
        "geofence_radius_km": body.geofence_radius_km or 10,
        "active": True,
        "created_at": datetime.now(timezone.utc),
    }
    res = await db.users.insert_one(doc)
    doc["_id"] = res.inserted_id
    return _user_out(doc)


@api.patch("/salesmen/{salesman_id}", response_model=UserOut)
async def update_salesman(salesman_id: str, body: SalesmanUpdate, admin=Depends(require_admin), db=Depends(get_db)):
    if not ObjectId.is_valid(salesman_id):
        raise HTTPException(404, "Not found")
    update = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if "password" in update:
        update["password_hash"] = hash_password(update.pop("password"))
    if not update:
        raise HTTPException(400, "No changes")
    res = await db.users.find_one_and_update(
        {"_id": ObjectId(salesman_id), "role": "salesman"},
        {"$set": update},
        return_document=True,
    )
    if not res:
        raise HTTPException(404, "Not found")
    return _user_out(res)


# ============ Customers ============
async def _resolve_salesman_names(db, customers: list) -> list:
    ids = list({c.get("salesman_id") for c in customers if c.get("salesman_id")})
    valid_ids = [ObjectId(i) for i in ids if ObjectId.is_valid(i)]
    users = {}
    if valid_ids:
        async for u in db.users.find({"_id": {"$in": valid_ids}}):
            users[str(u["_id"])] = u.get("name")
    for c in customers:
        c["salesman_name"] = users.get(c.get("salesman_id"))
    return customers


def _customer_out(c: dict) -> CustomerOut:
    return CustomerOut(
        id=str(c["_id"]),
        shop_name=c.get("shop_name", ""),
        customer_code=c.get("customer_code"),
        owner_name=c.get("owner_name"),
        mobile=c.get("mobile"),
        whatsapp=c.get("whatsapp"),
        gst_number=c.get("gst_number"),
        address=c.get("address"),
        area=c.get("area"),
        city=c.get("city"),
        customer_type=c.get("customer_type"),
        salesman_id=c.get("salesman_id"),
        salesman_name=c.get("salesman_name"),
        gps_lat=c.get("gps_lat"),
        gps_lng=c.get("gps_lng"),
        shop_photo=c.get("shop_photo"),
        visiting_card=c.get("visiting_card"),
        product_category=c.get("product_category"),
        brands_purchased=c.get("brands_purchased"),
        customer_status=c.get("customer_status", "Active"),
        preferred_order_day=c.get("preferred_order_day"),
        credit_limit=c.get("credit_limit", 0) or 0,
        payment_terms=c.get("payment_terms"),
        outstanding=c.get("outstanding", 0) or 0,
        remarks=c.get("remarks"),
        route=c.get("route"),
        custom=c.get("custom") or {},
        last_visit=c.get("last_visit"),
        next_followup=c.get("next_followup"),
        last_order_amount=c.get("last_order_amount", 0) or 0,
        approval_status=c.get("approval_status", "approved"),
        rejection_reason=c.get("rejection_reason"),
        created_at=c.get("created_at", datetime.now(timezone.utc)),
    )


@api.get("/customers", response_model=List[CustomerOut])
async def list_customers(
    q: Optional[str] = None,
    area: Optional[str] = None,
    route: Optional[str] = None,
    customer_type: Optional[str] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    salesman_id: Optional[str] = None,
    approval: Optional[str] = None,  # pending / approved
    user=Depends(current_user),
    db=Depends(get_db),
):
    query: dict = {}
    if user["role"] == "salesman":
        query["salesman_id"] = str(user["_id"])
    elif salesman_id:
        query["salesman_id"] = salesman_id
    if area:
        query["area"] = area
    if route:
        query["route"] = route
    if customer_type:
        query["customer_type"] = customer_type
    if status_filter:
        query["customer_status"] = status_filter
    if approval == "pending":
        query["approval_status"] = "pending"
    elif approval == "approved":
        query["approval_status"] = "approved"
    elif approval == "rejected":
        query["approval_status"] = "rejected"
    else:
        # By default hide rejected customers to keep lists clean
        query["approval_status"] = {"$ne": "rejected"}
    if q:
        query["$or"] = [
            {"shop_name": {"$regex": q, "$options": "i"}},
            {"owner_name": {"$regex": q, "$options": "i"}},
            {"mobile": {"$regex": q}},
            {"area": {"$regex": q, "$options": "i"}},
        ]
    docs = []
    async for c in db.customers.find(query).sort("shop_name", 1):
        docs.append(c)
    await _resolve_salesman_names(db, docs)
    return [_customer_out(c) for c in docs]


@api.post("/customers", response_model=CustomerOut, status_code=201)
async def create_customer(body: CustomerIn, user=Depends(current_user), db=Depends(get_db)):
    doc = body.model_dump()
    if user["role"] == "salesman":
        doc["salesman_id"] = str(user["_id"])
        doc["approval_status"] = "pending"   # needs admin approval
    else:
        doc["approval_status"] = "approved"  # admin-created is auto-approved
    if not doc.get("customer_code"):
        doc["customer_code"] = await _next_customer_code(db)
    doc["created_at"] = datetime.now(timezone.utc)
    doc["last_order_amount"] = 0
    res = await db.customers.insert_one(doc)
    doc["_id"] = res.inserted_id
    await _resolve_salesman_names(db, [doc])
    return _customer_out(doc)


async def _next_customer_code(db) -> str:
    seq = await db.counters.find_one_and_update(
        {"_id": "customer_code"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True,
    )
    return f"CUST-{seq.get('seq', 1):05d}"


# ---- Bulk import from Google Sheet export (.xlsx / .csv) ----
_IMPORT_HEADER_MAP = {
    "customer_code": ["customer id", "customer code", "cust id", "cust code", "code", "id", "party code", "party id"],
    "shop_name": ["shop name", "party name", "shop/party name", "shop", "party", "customer name", "name", "shopname", "partyname"],
    "owner_name": ["owner name", "contact name", "owner/contact name", "owner", "contact", "contact person", "ownername"],
    "mobile": ["mobile", "mobile no", "mobile number", "phone", "phone number", "contact number", "mobile no.", "whatsapp"],
    "address": ["address", "shop address", "full address", "addr"],
    "area": ["area", "region", "zone", "route", "beat"],
    "outstanding": ["outstanding", "outstanding amount", "balance", "dues", "outstanding amt", "amount"],
    "remarks": ["remarks", "remark", "notes", "note", "comment", "comments"],
}


def _norm_header(h: str) -> str:
    return "".join(ch for ch in str(h).strip().lower() if ch.isalnum())


def _build_col_index(headers: list) -> dict:
    """Map normalized sheet headers -> our field names."""
    idx = {}
    for i, raw in enumerate(headers):
        norm = _norm_header(raw)
        if not norm:
            continue
        for field, aliases in _IMPORT_HEADER_MAP.items():
            if field in idx:
                continue
            norm_aliases = [_norm_header(a) for a in aliases]
            if norm in norm_aliases:
                idx[field] = i
                break
    return idx


def _clean_mobile(val: Any) -> Optional[str]:
    if val is None:
        return None
    s = str(val).strip()
    if s.endswith(".0"):
        s = s[:-2]
    digits = "".join(ch for ch in s if ch.isdigit())
    return digits or None


def _cell_str(val: Any) -> Optional[str]:
    if val is None:
        return None
    s = str(val).strip()
    if s.endswith(".0") and s[:-2].isdigit():
        s = s[:-2]
    return s or None


def _cell_float(val: Any) -> float:
    if val is None:
        return 0.0
    s = str(val).strip().replace(",", "").replace("₹", "")
    try:
        return float(s)
    except ValueError:
        return 0.0


def _parse_rows(filename: str, data: bytes) -> list:
    """Return list of row-lists (first row = headers)."""
    name = (filename or "").lower()
    if name.endswith(".csv") or name.endswith(".txt"):
        import csv, io
        text = data.decode("utf-8-sig", errors="replace")
        reader = csv.reader(io.StringIO(text))
        return [row for row in reader]
    # default: xlsx
    import io
    from openpyxl import load_workbook
    wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    ws = wb.active
    rows = []
    for r in ws.iter_rows(values_only=True):
        rows.append(list(r))
    wb.close()
    return rows


@api.post("/customers/import", response_model=ImportResult)
async def import_customers(
    file: UploadFile = File(...),
    duplicate_mode: str = Query("skip", pattern="^(skip|update)$"),
    salesman_id: Optional[str] = Query(None),
    user=Depends(require_admin),
    db=Depends(get_db),
):
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "Empty file")
    try:
        rows = await run_in_threadpool(_parse_rows, file.filename or "", raw)
    except Exception as e:
        raise HTTPException(400, f"Could not read file: {e}")

    # drop fully-empty rows
    rows = [r for r in rows if any(c not in (None, "") for c in r)]
    if len(rows) < 2:
        raise HTTPException(400, "File has no data rows")

    col = _build_col_index(rows[0])
    if "shop_name" not in col:
        raise HTTPException(400, "Could not find a Shop/Party Name column in the file header")

    assigned_salesman = None
    if salesman_id:
        if not ObjectId.is_valid(salesman_id):
            raise HTTPException(400, "Invalid salesman_id")
        assigned_salesman = salesman_id

    created = updated = skipped = 0
    errors: list = []

    def _get(row, field):
        i = col.get(field)
        if i is None or i >= len(row):
            return None
        return row[i]

    for line_no, row in enumerate(rows[1:], start=2):
        shop = _cell_str(_get(row, "shop_name"))
        if not shop:
            skipped += 1
            continue
        mobile = _clean_mobile(_get(row, "mobile"))
        code = _cell_str(_get(row, "customer_code"))
        fields = {
            "shop_name": shop,
            "owner_name": _cell_str(_get(row, "owner_name")),
            "mobile": mobile,
            "address": _cell_str(_get(row, "address")),
            "area": _cell_str(_get(row, "area")),
            "outstanding": _cell_float(_get(row, "outstanding")),
            "remarks": _cell_str(_get(row, "remarks")),
        }
        try:
            existing = None
            if mobile:
                existing = await db.customers.find_one({"mobile": mobile})
            if not existing and code:
                existing = await db.customers.find_one({"customer_code": code})
            if existing:
                if duplicate_mode == "update":
                    upd = {k: v for k, v in fields.items() if v is not None}
                    if assigned_salesman:
                        upd["salesman_id"] = assigned_salesman
                    await db.customers.update_one({"_id": existing["_id"]}, {"$set": upd})
                    updated += 1
                else:
                    skipped += 1
                continue
            doc = {k: v for k, v in fields.items() if v is not None}
            doc["customer_code"] = code or await _next_customer_code(db)
            doc["approval_status"] = "approved"
            doc["customer_status"] = doc.get("customer_status", "Active")
            doc["created_at"] = datetime.now(timezone.utc)
            doc["last_order_amount"] = 0
            if assigned_salesman:
                doc["salesman_id"] = assigned_salesman
            await db.customers.insert_one(doc)
            created += 1
        except Exception as e:
            errors.append(f"Row {line_no}: {e}")

    return ImportResult(total_rows=len(rows) - 1, created=created, updated=updated, skipped=skipped, errors=errors[:20])


@api.get("/customers/{cid}", response_model=CustomerOut)
async def get_customer(cid: str, user=Depends(current_user), db=Depends(get_db)):
    if not ObjectId.is_valid(cid):
        raise HTTPException(404, "Not found")
    c = await db.customers.find_one({"_id": ObjectId(cid)})
    if not c:
        raise HTTPException(404, "Not found")
    if user["role"] == "salesman" and c.get("salesman_id") != str(user["_id"]):
        raise HTTPException(403, "Forbidden")
    await _resolve_salesman_names(db, [c])
    return _customer_out(c)


@api.patch("/customers/{cid}", response_model=CustomerOut)
async def update_customer(cid: str, body: CustomerIn, user=Depends(current_user), db=Depends(get_db)):
    if not ObjectId.is_valid(cid):
        raise HTTPException(404, "Not found")
    existing = await db.customers.find_one({"_id": ObjectId(cid)})
    if not existing:
        raise HTTPException(404, "Not found")
    if user["role"] == "salesman":
        if existing.get("salesman_id") != str(user["_id"]):
            raise HTTPException(403, "Forbidden")
        # Once approved by admin, salesmen can edit only if granted permission
        approved = existing.get("approval_status", "approved") != "pending"
        if approved and not user.get("can_edit_customers", False):
            raise HTTPException(403, "You don't have permission to edit customers. Ask an admin.")
    update = {k: v for k, v in body.model_dump().items() if v is not None}
    update.pop("customer_code", None)   # code is immutable once assigned
    if user["role"] == "salesman":
        update["salesman_id"] = str(user["_id"])
    await db.customers.update_one({"_id": ObjectId(cid)}, {"$set": update})
    c = await db.customers.find_one({"_id": ObjectId(cid)})
    await _resolve_salesman_names(db, [c])
    return _customer_out(c)


@api.patch("/customers/{cid}/approve", response_model=CustomerOut)
async def approve_customer(cid: str, admin=Depends(require_admin), db=Depends(get_db)):
    if not ObjectId.is_valid(cid):
        raise HTTPException(404, "Not found")
    c = await db.customers.find_one_and_update(
        {"_id": ObjectId(cid)},
        {"$set": {"approval_status": "approved", "approved_at": datetime.now(timezone.utc)}},
        return_document=True,
    )
    if not c:
        raise HTTPException(404, "Not found")
    await _resolve_salesman_names(db, [c])
    return _customer_out(c)


class RejectBody(BaseModel):
    reason: Optional[str] = None


@api.patch("/customers/{cid}/reject", response_model=CustomerOut)
async def reject_customer(cid: str, body: RejectBody, admin=Depends(require_admin), db=Depends(get_db)):
    if not ObjectId.is_valid(cid):
        raise HTTPException(404, "Not found")
    c = await db.customers.find_one_and_update(
        {"_id": ObjectId(cid)},
        {"$set": {
            "approval_status": "rejected",
            "rejection_reason": (body.reason or "").strip() or "Not specified",
            "rejected_at": datetime.now(timezone.utc),
        }},
        return_document=True,
    )
    if not c:
        raise HTTPException(404, "Not found")
    await _resolve_salesman_names(db, [c])
    return _customer_out(c)


@api.delete("/customers/{cid}")
async def delete_customer(cid: str, admin=Depends(require_admin), db=Depends(get_db)):
    if not ObjectId.is_valid(cid):
        raise HTTPException(404, "Not found")
    await db.customers.delete_one({"_id": ObjectId(cid)})
    return {"ok": True}


# ============ Visits ============
def _visit_out(v: dict) -> VisitOut:
    return VisitOut(
        id=str(v["_id"]),
        customer_id=v["customer_id"],
        customer_name=v.get("customer_name"),
        salesman_id=v["salesman_id"],
        salesman_name=v.get("salesman_name"),
        visit_date=v.get("visit_date", datetime.now(timezone.utc)),
        gps_lat=v.get("gps_lat"),
        gps_lng=v.get("gps_lng"),
        visit_result=v.get("visit_result", ""),
        order_amount=v.get("order_amount", 0) or 0,
        remarks=v.get("remarks"),
        next_followup=v.get("next_followup"),
        task_photo=v.get("task_photo"),
        task_answers=v.get("task_answers") or {},
    )


async def _applicable_visit_config(db, salesman_id: str) -> Optional[dict]:
    cfg = await db.visit_tasks.find_one({"target": salesman_id})
    if not cfg:
        cfg = await db.visit_tasks.find_one({"target": "all"})
    return cfg


@api.get("/visits", response_model=List[VisitOut])
async def list_visits(
    salesman_id: Optional[str] = None,
    customer_id: Optional[str] = None,
    date: Optional[str] = None,  # YYYY-MM-DD
    user=Depends(current_user),
    db=Depends(get_db),
):
    query: dict = {}
    if user["role"] == "salesman":
        query["salesman_id"] = str(user["_id"])
    elif salesman_id:
        query["salesman_id"] = salesman_id
    if customer_id:
        query["customer_id"] = customer_id
    if date:
        try:
            day = datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            query["visit_date"] = {"$gte": day, "$lt": day + timedelta(days=1)}
        except ValueError:
            raise HTTPException(400, "Invalid date")
    docs = []
    async for v in db.visits.find(query).sort("visit_date", -1):
        docs.append(v)
    return [_visit_out(v) for v in docs]


@api.post("/visits", response_model=VisitOut, status_code=201)
async def create_visit(body: VisitIn, user=Depends(current_user), db=Depends(get_db)):
    if not ObjectId.is_valid(body.customer_id):
        raise HTTPException(400, "Invalid customer_id")
    cust = await db.customers.find_one({"_id": ObjectId(body.customer_id)})
    if not cust:
        raise HTTPException(404, "Customer not found")
    if user["role"] == "salesman" and cust.get("salesman_id") != str(user["_id"]):
        raise HTTPException(403, "Not your customer")

    # Enforce admin-defined visit tasks
    cfg = await _applicable_visit_config(db, str(user["_id"]))
    if cfg:
        if cfg.get("require_photo") and not body.task_photo:
            raise HTTPException(400, "A photo is required for this visit")
        answers = body.task_answers or {}
        for q in cfg.get("questions", []):
            if q.get("required"):
                val = answers.get(q["label"])
                if val is None or val == "" or (isinstance(val, list) and len(val) == 0):
                    raise HTTPException(400, f"Please answer required question: {q.get('label')}")

    doc = body.model_dump()
    doc["visit_date"] = datetime.now(timezone.utc)
    doc["salesman_id"] = str(user["_id"])
    doc["salesman_name"] = user.get("name")
    doc["customer_name"] = cust.get("shop_name")
    res = await db.visits.insert_one(doc)
    doc["_id"] = res.inserted_id

    # Update customer aggregates
    cust_update = {"last_visit": doc["visit_date"]}
    if body.next_followup:
        cust_update["next_followup"] = body.next_followup
    if body.order_amount and body.order_amount > 0:
        cust_update["last_order_amount"] = body.order_amount
    await db.customers.update_one({"_id": ObjectId(body.customer_id)}, {"$set": cust_update})

    # Create Order row if there is an order amount
    if body.order_amount and body.order_amount > 0:
        await db.orders.insert_one({
            "customer_id": body.customer_id,
            "customer_name": cust.get("shop_name"),
            "salesman_id": str(user["_id"]),
            "salesman_name": user.get("name"),
            "order_date": doc["visit_date"],
            "total_amount": body.order_amount,
            "status": "submitted",
            "remarks": body.remarks,
        })
    return _visit_out(doc)


# ============ Orders ============
def _order_out(o: dict) -> OrderOut:
    return OrderOut(
        id=str(o["_id"]),
        order_number=o.get("order_number"),
        customer_id=o["customer_id"],
        customer_name=o.get("customer_name"),
        salesman_id=o["salesman_id"],
        salesman_name=o.get("salesman_name"),
        order_date=o.get("order_date", datetime.now(timezone.utc)),
        total_amount=o.get("total_amount", 0) or 0,
        status=o.get("status", "draft"),
        remarks=o.get("remarks"),
        lines=[OrderLineOut(**ln) for ln in o.get("lines", [])],
        outcome=o.get("outcome", "Order"),
        gps_lat=o.get("gps_lat"),
        gps_lng=o.get("gps_lng"),
        next_followup=o.get("next_followup"),
        task_photo=o.get("task_photo"),
        task_answers=o.get("task_answers") or {},
        no_order_reason=o.get("no_order_reason"),
        no_order_note=o.get("no_order_note"),
    )


async def _next_order_number(db) -> str:
    seq = await db.counters.find_one_and_update(
        {"_id": "order_number"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True,
    )
    n = seq.get("seq", 1)
    return f"ORD-{n:05d}"


def _compute_line(item: dict, qty: float, discount_pct: float, free_qty: float) -> dict:
    rate = float(item.get("rate", 0) or 0)
    tax_rate = float(item.get("tax_rate", 0) or 0)
    gross = qty * rate
    after_disc = gross * (1 - (discount_pct or 0) / 100.0)
    tax_amt = after_disc * tax_rate / 100.0
    net = round(after_disc + tax_amt, 2)
    return {
        "item_id": str(item["_id"]),
        "item_code": item.get("item_code", ""),
        "item_name": item.get("item_name", ""),
        "qty": qty,
        "rate": rate,
        "tax_rate": tax_rate,
        "discount": discount_pct or 0,
        "free_qty": free_qty or 0,
        "mrp": float(item.get("mrp", 0) or 0),
        "net": net,
    }


@api.get("/orders", response_model=List[OrderOut])
async def list_orders(user=Depends(current_user), db=Depends(get_db)):
    query = {} if user["role"] == "admin" else {"salesman_id": str(user["_id"])}
    docs = []
    async for o in db.orders.find(query).sort("order_date", -1):
        docs.append(o)
    return [_order_out(o) for o in docs]


@api.get("/orders/export")
async def export_orders(from_date: Optional[str] = Query(None), to_date: Optional[str] = Query(None),
                        admin=Depends(require_admin), db=Depends(get_db)):
    import io
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill

    query: dict = {"status": "submitted"}
    date_q: dict = {}
    if from_date:
        try:
            date_q["$gte"] = datetime.fromisoformat(from_date).replace(tzinfo=timezone.utc)
        except ValueError:
            raise HTTPException(400, "Invalid from_date (use YYYY-MM-DD)")
    if to_date:
        try:
            dt = datetime.fromisoformat(to_date).replace(tzinfo=timezone.utc)
            date_q["$lte"] = dt + timedelta(days=1)
        except ValueError:
            raise HTTPException(400, "Invalid to_date (use YYYY-MM-DD)")
    if date_q:
        query["order_date"] = date_q

    headers = ["ORDER NUMBER", "DATE", "CUSTOMER ID", "PARTY NAME", "ITEM CODE", "ITEM NAME", "QTY",
               "RATE", "TAX RATE", "ITEM DIS", "FREE QUANTITY", "MRP", "NET", "REMARKS"]
    wb = Workbook()
    ws = wb.active
    ws.title = "Bills"
    ws.append(headers)
    header_fill = PatternFill("solid", fgColor="2E7D32")
    for cell in ws[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = header_fill

    # Map customer_id -> customer_code
    code_map = {}
    async for c in db.customers.find({}, {"customer_code": 1}):
        code_map[str(c["_id"])] = c.get("customer_code", "")

    async for o in db.orders.find(query).sort("order_date", 1):
        odate = o.get("order_date")
        date_str = to_ist(odate).strftime("%d-%m-%Y") if isinstance(odate, datetime) else ""
        cust_code = code_map.get(o.get("customer_id", ""), "")
        lines = o.get("lines", [])
        if not lines:
            continue
        for ln in lines:
            ws.append([
                o.get("order_number", ""), date_str, cust_code, o.get("customer_name", ""),
                ln.get("item_code", ""), ln.get("item_name", ""), ln.get("qty", 0),
                ln.get("rate", 0), ln.get("tax_rate", 0), ln.get("discount", 0),
                ln.get("free_qty", 0), ln.get("mrp", 0), ln.get("net", 0),
                o.get("remarks", "") or "",
            ])

    widths = [14, 12, 14, 24, 12, 28, 8, 10, 10, 10, 14, 10, 12, 24]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[ws.cell(row=1, column=i).column_letter].width = w

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return Response(
        content=buf.read(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="bills.xlsx"'},
    )


@api.get("/orders/{order_id}", response_model=OrderOut)
async def get_order(order_id: str, user=Depends(current_user), db=Depends(get_db)):
    if not ObjectId.is_valid(order_id):
        raise HTTPException(404, "Not found")
    o = await db.orders.find_one({"_id": ObjectId(order_id)})
    if not o:
        raise HTTPException(404, "Not found")
    if user["role"] == "salesman" and o.get("salesman_id") != str(user["_id"]):
        raise HTTPException(403, "Forbidden")
    return _order_out(o)


async def _build_lines(db, body_lines) -> list:
    lines = []
    for ln in body_lines:
        if not ObjectId.is_valid(ln.item_id):
            raise HTTPException(400, f"Invalid item_id {ln.item_id}")
        item = await db.items.find_one({"_id": ObjectId(ln.item_id)})
        if not item:
            raise HTTPException(404, f"Item not found: {ln.item_id}")
        if ln.qty <= 0:
            raise HTTPException(400, "Quantity must be greater than 0")
        lines.append(_compute_line(item, ln.qty, ln.discount, ln.free_qty))
    return lines


@api.post("/orders", response_model=OrderOut, status_code=201)
async def create_order(body: OrderCreate, user=Depends(current_user), db=Depends(get_db)):
    if not ObjectId.is_valid(body.customer_id):
        raise HTTPException(400, "Invalid customer_id")
    cust = await db.customers.find_one({"_id": ObjectId(body.customer_id)})
    if not cust:
        raise HTTPException(404, "Customer not found")
    if user["role"] == "salesman" and cust.get("salesman_id") != str(user["_id"]):
        raise HTTPException(403, "Not your customer")
    if body.outcome == "Order" and not body.lines:
        raise HTTPException(400, "Add at least one item")

    # Enforce admin-defined visit/bill tasks (apply to all bills)
    cfg = await _applicable_visit_config(db, str(user["_id"]))
    if cfg:
        if cfg.get("require_photo") and not body.task_photo:
            raise HTTPException(400, "A photo is required for this bill")
        answers = body.task_answers or {}
        for q in cfg.get("questions", []):
            if q.get("required"):
                val = answers.get(q["label"])
                if val is None or val == "" or (isinstance(val, list) and len(val) == 0):
                    raise HTTPException(400, f"Please answer required question: {q.get('label')}")

    lines = await _build_lines(db, body.lines) if body.lines else []
    total = round(sum(l["net"] for l in lines), 2)
    now = datetime.now(timezone.utc)
    doc = {
        "order_number": await _next_order_number(db),
        "customer_id": body.customer_id,
        "customer_name": cust.get("shop_name"),
        "salesman_id": str(user["_id"]),
        "salesman_name": user.get("name"),
        "order_date": now,
        "total_amount": total,
        "status": "draft",
        "remarks": body.remarks,
        "lines": lines,
        "outcome": body.outcome,
        "gps_lat": body.gps_lat,
        "gps_lng": body.gps_lng,
        "next_followup": body.next_followup,
        "task_photo": body.task_photo,
        "task_answers": body.task_answers or {},
        "no_order_reason": body.no_order_reason if body.outcome == "No Order" else None,
        "no_order_note": body.no_order_note if body.outcome == "No Order" else None,
    }
    res = await db.orders.insert_one(doc)
    doc["_id"] = res.inserted_id
    # Update customer summary (last visit / follow-up / last order)
    cust_update = {"last_visit": now}
    if body.next_followup:
        cust_update["next_followup"] = body.next_followup
    if total > 0:
        cust_update["last_order_amount"] = total
    await db.customers.update_one({"_id": ObjectId(body.customer_id)}, {"$set": cust_update})
    return _order_out(doc)


@api.put("/orders/{order_id}", response_model=OrderOut)
async def update_order(order_id: str, body: OrderCreate, user=Depends(current_user), db=Depends(get_db)):
    if not ObjectId.is_valid(order_id):
        raise HTTPException(404, "Not found")
    order = await db.orders.find_one({"_id": ObjectId(order_id)})
    if not order:
        raise HTTPException(404, "Not found")
    if user["role"] == "salesman":
        if order.get("salesman_id") != str(user["_id"]):
            raise HTTPException(403, "Forbidden")
        if order.get("status", "draft") == "submitted":
            raise HTTPException(403, "This bill was submitted and is locked. Ask an admin to edit it.")
    if body.outcome == "Order" and not body.lines:
        raise HTTPException(400, "Add at least one item")
    if not ObjectId.is_valid(body.customer_id):
        raise HTTPException(400, "Invalid customer_id")
    cust = await db.customers.find_one({"_id": ObjectId(body.customer_id)})
    if not cust:
        raise HTTPException(404, "Customer not found")

    lines = await _build_lines(db, body.lines) if body.lines else []
    total = round(sum(l["net"] for l in lines), 2)
    await db.orders.update_one({"_id": ObjectId(order_id)}, {"$set": {
        "customer_id": body.customer_id,
        "customer_name": cust.get("shop_name"),
        "total_amount": total,
        "remarks": body.remarks,
        "lines": lines,
        "outcome": body.outcome,
        "gps_lat": body.gps_lat if body.gps_lat is not None else order.get("gps_lat"),
        "gps_lng": body.gps_lng if body.gps_lng is not None else order.get("gps_lng"),
        "next_followup": body.next_followup,
        "task_photo": body.task_photo if body.task_photo is not None else order.get("task_photo"),
        "task_answers": body.task_answers if body.task_answers is not None else order.get("task_answers", {}),
        "no_order_reason": body.no_order_reason if body.outcome == "No Order" else None,
        "no_order_note": body.no_order_note if body.outcome == "No Order" else None,
    }})
    order = await db.orders.find_one({"_id": ObjectId(order_id)})
    return _order_out(order)


@api.post("/orders/{order_id}/submit", response_model=OrderOut)
async def submit_order(order_id: str, user=Depends(current_user), db=Depends(get_db)):
    if not ObjectId.is_valid(order_id):
        raise HTTPException(404, "Not found")
    order = await db.orders.find_one({"_id": ObjectId(order_id)})
    if not order:
        raise HTTPException(404, "Not found")
    if user["role"] == "salesman" and order.get("salesman_id") != str(user["_id"]):
        raise HTTPException(403, "Forbidden")
    await db.orders.update_one({"_id": ObjectId(order_id)}, {"$set": {"status": "submitted"}})
    order["status"] = "submitted"
    return _order_out(order)


@api.delete("/orders/{order_id}")
async def delete_order(order_id: str, user=Depends(current_user), db=Depends(get_db)):
    if not ObjectId.is_valid(order_id):
        raise HTTPException(404, "Not found")
    order = await db.orders.find_one({"_id": ObjectId(order_id)})
    if not order:
        raise HTTPException(404, "Not found")
    if user["role"] == "salesman":
        if order.get("salesman_id") != str(user["_id"]):
            raise HTTPException(403, "Forbidden")
        if order.get("status", "draft") == "submitted":
            raise HTTPException(403, "Submitted bills can only be deleted by an admin")
    await db.orders.delete_one({"_id": ObjectId(order_id)})
    return {"ok": True}# ============ Items (Product master) ============
@api.get("/items", response_model=List[ItemOut])
async def list_items(q: Optional[str] = None, user=Depends(current_user), db=Depends(get_db)):
    query: dict = {"active": {"$ne": False}}
    if q:
        query["$or"] = [
            {"item_name": {"$regex": q, "$options": "i"}},
            {"item_code": {"$regex": q, "$options": "i"}},
        ]
    docs = []
    async for it in db.items.find(query).sort("item_name", 1):
        docs.append(ItemOut(
            id=str(it["_id"]), item_code=it.get("item_code", ""), item_name=it.get("item_name", ""),
            rate=it.get("rate", 0) or 0, tax_rate=it.get("tax_rate", 0) or 0, mrp=it.get("mrp", 0) or 0,
            active=it.get("active", True), created_at=it.get("created_at", datetime.now(timezone.utc)),
        ))
    return docs


@api.post("/items", response_model=ItemOut, status_code=201)
async def create_item(body: ItemIn, admin=Depends(require_admin), db=Depends(get_db)):
    existing = await db.items.find_one({"item_code": body.item_code})
    if existing:
        raise HTTPException(409, "Item code already exists")
    doc = body.model_dump()
    doc["created_at"] = datetime.now(timezone.utc)
    res = await db.items.insert_one(doc)
    doc["_id"] = res.inserted_id
    return ItemOut(id=str(doc["_id"]), created_at=doc["created_at"], **body.model_dump())


@api.patch("/items/{item_id}", response_model=ItemOut)
async def update_item(item_id: str, body: ItemIn, admin=Depends(require_admin), db=Depends(get_db)):
    if not ObjectId.is_valid(item_id):
        raise HTTPException(404, "Not found")
    await db.items.update_one({"_id": ObjectId(item_id)}, {"$set": body.model_dump()})
    it = await db.items.find_one({"_id": ObjectId(item_id)})
    if not it:
        raise HTTPException(404, "Not found")
    return ItemOut(
        id=str(it["_id"]), item_code=it.get("item_code", ""), item_name=it.get("item_name", ""),
        rate=it.get("rate", 0) or 0, tax_rate=it.get("tax_rate", 0) or 0, mrp=it.get("mrp", 0) or 0,
        active=it.get("active", True), created_at=it.get("created_at", datetime.now(timezone.utc)),
    )


@api.delete("/items/{item_id}")
async def delete_item(item_id: str, admin=Depends(require_admin), db=Depends(get_db)):
    if not ObjectId.is_valid(item_id):
        raise HTTPException(404, "Not found")
    await db.items.delete_one({"_id": ObjectId(item_id)})
    return {"ok": True}


# ============ Routes master ============
@api.get("/routes", response_model=List[RouteOut])
async def list_routes(user=Depends(current_user), db=Depends(get_db)):
    docs = []
    async for r in db.routes.find({}).sort("name", 1):
        docs.append(RouteOut(id=str(r["_id"]), name=r.get("name", "")))
    return docs


@api.post("/routes", response_model=RouteOut, status_code=201)
async def create_route(body: RouteIn, admin=Depends(require_admin), db=Depends(get_db)):
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Route name required")
    existing = await db.routes.find_one({"name": {"$regex": f"^{name}$", "$options": "i"}})
    if existing:
        raise HTTPException(409, "Route already exists")
    res = await db.routes.insert_one({"name": name, "created_at": datetime.now(timezone.utc)})
    return RouteOut(id=str(res.inserted_id), name=name)


@api.delete("/routes/{route_id}")
async def delete_route(route_id: str, admin=Depends(require_admin), db=Depends(get_db)):
    if not ObjectId.is_valid(route_id):
        raise HTTPException(404, "Not found")
    await db.routes.delete_one({"_id": ObjectId(route_id)})
    return {"ok": True}


# ============ Custom customer fields ============
def _slugify(label: str) -> str:
    base = "".join(ch if ch.isalnum() else "_" for ch in label.strip().lower()).strip("_")
    while "__" in base:
        base = base.replace("__", "_")
    return base or "field"


@api.get("/customer-fields", response_model=List[CustomFieldOut])
async def list_customer_fields(user=Depends(current_user), db=Depends(get_db)):
    docs = []
    async for f in db.customer_fields.find({}).sort("created_at", 1):
        docs.append(CustomFieldOut(
            id=str(f["_id"]), label=f.get("label", ""), key=f.get("key", ""),
            type=f.get("type", "text"), options=f.get("options", []) or [],
        ))
    return docs


@api.post("/customer-fields", response_model=CustomFieldOut, status_code=201)
async def create_customer_field(body: CustomFieldIn, admin=Depends(require_admin), db=Depends(get_db)):
    label = body.label.strip()
    if not label:
        raise HTTPException(400, "Field label required")
    if body.type not in ("text", "number", "dropdown", "multiselect", "checkbox"):
        raise HTTPException(400, "Invalid field type")
    options = [o.strip() for o in (body.options or []) if o.strip()]
    if body.type in ("dropdown", "multiselect") and not options:
        raise HTTPException(400, "This field needs at least one option")
    key = _slugify(label)
    existing = await db.customer_fields.find_one({"key": key})
    if existing:
        key = f"{key}_{str(ObjectId())[-4:]}"
    doc = {"label": label, "key": key, "type": body.type, "options": options, "created_at": datetime.now(timezone.utc)}
    res = await db.customer_fields.insert_one(doc)
    return CustomFieldOut(id=str(res.inserted_id), label=label, key=key, type=body.type, options=options)


@api.delete("/customer-fields/{field_id}")
async def delete_customer_field(field_id: str, admin=Depends(require_admin), db=Depends(get_db)):
    if not ObjectId.is_valid(field_id):
        raise HTTPException(404, "Not found")
    await db.customer_fields.delete_one({"_id": ObjectId(field_id)})
    return {"ok": True}


# ============ Visit tasks (admin-defined visit checklist) ============
async def _visit_task_out(db, cfg: dict) -> VisitTaskOut:
    target = cfg.get("target", "all")
    name = "All salesmen"
    if target != "all" and ObjectId.is_valid(target):
        u = await db.users.find_one({"_id": ObjectId(target)})
        name = u.get("name") if u else target
    return VisitTaskOut(
        target=target, require_photo=cfg.get("require_photo", False),
        questions=[VisitQuestion(**q) for q in cfg.get("questions", [])], target_name=name,
    )


@api.get("/visit-tasks", response_model=List[VisitTaskOut])
async def list_visit_tasks(admin=Depends(require_admin), db=Depends(get_db)):
    out = []
    async for cfg in db.visit_tasks.find({}):
        out.append(await _visit_task_out(db, cfg))
    return out


@api.put("/visit-tasks", response_model=VisitTaskOut)
async def upsert_visit_task(body: VisitTaskConfig, admin=Depends(require_admin), db=Depends(get_db)):
    if body.target != "all" and not ObjectId.is_valid(body.target):
        raise HTTPException(400, "Invalid target")
    doc = {
        "target": body.target,
        "require_photo": body.require_photo,
        "questions": [q.model_dump() for q in body.questions],
        "updated_at": datetime.now(timezone.utc),
    }
    await db.visit_tasks.update_one({"target": body.target}, {"$set": doc}, upsert=True)
    cfg = await db.visit_tasks.find_one({"target": body.target})
    return await _visit_task_out(db, cfg)


@api.delete("/visit-tasks/{target}")
async def delete_visit_task(target: str, admin=Depends(require_admin), db=Depends(get_db)):
    await db.visit_tasks.delete_one({"target": target})
    return {"ok": True}


@api.get("/visit-tasks/applicable", response_model=Optional[VisitTaskConfig])
async def get_applicable_visit_task(user=Depends(current_user), db=Depends(get_db)):
    cfg = await _applicable_visit_config(db, str(user["_id"]))
    if not cfg:
        return None
    return VisitTaskConfig(
        target=cfg.get("target", "all"), require_photo=cfg.get("require_photo", False),
        questions=[VisitQuestion(**q) for q in cfg.get("questions", [])],
    )


# ============ Item bulk import ============
_ITEM_HEADER_MAP = {
    "item_code": ["item code", "code", "sku", "itemcode"],
    "item_name": ["item name", "name", "product", "product name", "itemname"],
    "rate": ["rate", "price", "selling price", "net rate"],
    "tax_rate": ["tax rate", "tax", "gst", "tax %", "gst %"],
    "mrp": ["mrp", "max retail price", "mrp ₹"],
}


def _build_item_col_index(headers: list) -> dict:
    idx = {}
    for i, raw in enumerate(headers):
        norm = _norm_header(raw)
        if not norm:
            continue
        for field, aliases in _ITEM_HEADER_MAP.items():
            if field in idx:
                continue
            if norm in [_norm_header(a) for a in aliases]:
                idx[field] = i
                break
    return idx


@api.post("/items/import", response_model=ImportResult)
async def import_items(
    file: UploadFile = File(...),
    duplicate_mode: str = Query("skip", pattern="^(skip|update)$"),
    admin=Depends(require_admin),
    db=Depends(get_db),
):
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "Empty file")
    try:
        rows = await run_in_threadpool(_parse_rows, file.filename or "", raw)
    except Exception as e:
        raise HTTPException(400, f"Could not read file: {e}")
    rows = [r for r in rows if any(c not in (None, "") for c in r)]
    if len(rows) < 2:
        raise HTTPException(400, "File has no data rows")
    col = _build_item_col_index(rows[0])
    if "item_code" not in col or "item_name" not in col:
        raise HTTPException(400, "File must have Item Code and Item Name columns")

    created = updated = skipped = 0
    errors: list = []

    def _get(row, field):
        i = col.get(field)
        if i is None or i >= len(row):
            return None
        return row[i]

    for line_no, row in enumerate(rows[1:], start=2):
        code = _cell_str(_get(row, "item_code"))
        name = _cell_str(_get(row, "item_name"))
        if not code or not name:
            skipped += 1
            continue
        fields = {
            "item_code": code, "item_name": name,
            "rate": _cell_float(_get(row, "rate")),
            "tax_rate": _cell_float(_get(row, "tax_rate")),
            "mrp": _cell_float(_get(row, "mrp")),
            "active": True,
        }
        try:
            existing = await db.items.find_one({"item_code": code})
            if existing:
                if duplicate_mode == "update":
                    await db.items.update_one({"_id": existing["_id"]}, {"$set": fields})
                    updated += 1
                else:
                    skipped += 1
                continue
            fields["created_at"] = datetime.now(timezone.utc)
            await db.items.insert_one(fields)
            created += 1
        except Exception as e:
            errors.append(f"Row {line_no}: {e}")

    return ImportResult(total_rows=len(rows) - 1, created=created, updated=updated, skipped=skipped, errors=errors[:20])


# ============ Import templates ============
def _make_template(headers: list, sample: list) -> bytes:
    import io
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    wb = Workbook()
    ws = wb.active
    ws.append(headers)
    fill = PatternFill("solid", fgColor="2E7D32")
    for cell in ws[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = fill
    ws.append(sample)
    for i, h in enumerate(headers, start=1):
        ws.column_dimensions[ws.cell(row=1, column=i).column_letter].width = max(14, len(str(h)) + 4)
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.read()


@api.get("/import-templates/customers")
async def customers_import_template(admin=Depends(require_admin)):
    data = await run_in_threadpool(
        _make_template,
        ["Customer ID", "Shop/Party Name", "Owner/Contact Name", "Mobile", "Address", "Area", "Outstanding Amount", "Remarks"],
        ["SA-0001", "Sunrise Kirana", "Ramesh Kumar", "9876500011", "12 MG Road", "East", 1500, "Monthly buyer"],
    )
    return Response(content=data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": 'attachment; filename="customer_import_template.xlsx"'})


@api.get("/import-templates/items")
async def items_import_template(admin=Depends(require_admin)):
    data = await run_in_threadpool(
        _make_template,
        ["Item Code", "Item Name", "Rate", "Tax Rate", "MRP"],
        ["FMCG100", "Sample Product 1kg", 100, 5, 120],
    )
    return Response(content=data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": 'attachment; filename="item_import_template.xlsx"'})


# ============ Leaderboard ============
def _period_start(period: str) -> datetime:
    now = datetime.now(timezone.utc)
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    if period == "week":
        start = start - timedelta(days=start.weekday())
    elif period == "month":
        start = start.replace(day=1)
    return start


@api.get("/leaderboard")
async def leaderboard(period: str = "week", admin=Depends(require_admin), db=Depends(get_db)):
    if period not in ("today", "week", "month"):
        period = "week"
    start = _period_start(period)

    # Bills per salesman (was visits)
    visit_agg = {}
    async for row in db.orders.aggregate([
        {"$match": {"order_date": {"$gte": start}}},
        {"$group": {"_id": "$salesman_id", "visits": {"$sum": 1}}},
    ]):
        visit_agg[row["_id"]] = row["visits"]

    # Orders per salesman
    order_agg = {}
    async for row in db.orders.aggregate([
        {"$match": {"order_date": {"$gte": start}}},
        {"$group": {"_id": "$salesman_id", "sales": {"$sum": "$total_amount"}, "orders": {"$sum": 1}}},
    ]):
        order_agg[row["_id"]] = {"sales": float(row["sales"] or 0), "orders": row["orders"]}

    rows = []
    async for s in db.users.find({"role": "salesman"}):
        sid = str(s["_id"])
        o = order_agg.get(sid, {"sales": 0.0, "orders": 0})
        rows.append({
            "salesman_id": sid,
            "name": s.get("name"),
            "area": s.get("area"),
            "visits": visit_agg.get(sid, 0),
            "sales": o["sales"],
            "orders": o["orders"],
            "active": s.get("active", True),
        })
    rows.sort(key=lambda r: (r["sales"], r["visits"]), reverse=True)
    for i, r in enumerate(rows):
        r["rank"] = i + 1
    return {"period": period, "start": start.isoformat(), "rows": rows}


# ============ Beat Plan ============
WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


class BeatPlanIn(BaseModel):
    date: str  # YYYY-MM-DD
    customer_ids: List[str]
    salesman_id: Optional[str] = None


async def _build_beat_stops(db, salesman_id: str, date_str: str, customer_ids: List[str]):
    day = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    day_end = day + timedelta(days=1)
    # visited customers today
    visited = set()
    async for v in db.visits.find({"salesman_id": salesman_id, "visit_date": {"$gte": day, "$lt": day_end}}):
        visited.add(v.get("customer_id"))

    stops = []
    for idx, cid in enumerate(customer_ids):
        if not ObjectId.is_valid(cid):
            continue
        c = await db.customers.find_one({"_id": ObjectId(cid)})
        if not c:
            continue
        # Only include customers assigned to this salesman
        if c.get("salesman_id") != salesman_id:
            continue
        stops.append({
            "customer_id": cid,
            "shop_name": c.get("shop_name"),
            "owner_name": c.get("owner_name"),
            "area": c.get("area"),
            "mobile": c.get("mobile"),
            "whatsapp": c.get("whatsapp"),
            "gps_lat": c.get("gps_lat"),
            "gps_lng": c.get("gps_lng"),
            "outstanding": float(c.get("outstanding", 0) or 0),
            "order": len(stops) + 1,
            "visited": cid in visited,
        })
    return stops


@api.get("/beat-plan")
async def get_beat_plan(date: Optional[str] = None, salesman_id: Optional[str] = None,
                        user=Depends(current_user), db=Depends(get_db)):
    date_str = date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    target = str(user["_id"]) if user["role"] == "salesman" else (salesman_id or str(user["_id"]))

    plan = await db.beatplans.find_one({"salesman_id": target, "date": date_str})
    customer_ids = plan["customer_ids"] if plan else []

    # Auto-suggest if no plan stored: customers whose preferred_order_day == weekday, or followups due
    if not plan:
        weekday = WEEKDAYS[datetime.strptime(date_str, "%Y-%m-%d").weekday()]
        day_end = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc) + timedelta(days=1)
        suggested = []
        async for c in db.customers.find({"salesman_id": target}).sort("area", 1):
            pref = (c.get("preferred_order_day") or "").strip().lower()
            due = c.get("next_followup") and c["next_followup"] < day_end
            if pref == weekday.lower() or due:
                suggested.append(str(c["_id"]))
        customer_ids = suggested

    stops = await _build_beat_stops(db, target, date_str, customer_ids)
    return {"date": date_str, "salesman_id": target, "auto": not plan, "stops": stops}


@api.post("/beat-plan")
async def set_beat_plan(body: BeatPlanIn, user=Depends(current_user), db=Depends(get_db)):
    target = str(user["_id"]) if user["role"] == "salesman" else (body.salesman_id or str(user["_id"]))

    # Only allow customers that actually belong to the target salesman
    valid_ids = [ObjectId(cid) for cid in body.customer_ids if ObjectId.is_valid(cid)]
    owned = set()
    if valid_ids:
        async for c in db.customers.find({"_id": {"$in": valid_ids}, "salesman_id": target}):
            owned.add(str(c["_id"]))
    filtered_ids = [cid for cid in body.customer_ids if cid in owned]

    await db.beatplans.update_one(
        {"salesman_id": target, "date": body.date},
        {"$set": {"salesman_id": target, "date": body.date, "customer_ids": filtered_ids,
                  "updated_at": datetime.now(timezone.utc)}},
        upsert=True,
    )
    stops = await _build_beat_stops(db, target, body.date, filtered_ids)
    return {"date": body.date, "salesman_id": target, "auto": False, "stops": stops}


# ============ Attendance ============
class AttendanceMark(BaseModel):
    lat: Optional[float] = None
    lng: Optional[float] = None
    photo: Optional[str] = None  # storage path of selfie


def _haversine_km(lat1, lng1, lat2, lng2) -> float:
    import math
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2)
    return R * 2 * math.asin(math.sqrt(a))


async def _territory_center(db, salesman_id: str):
    """Centroid of the salesman's customers that have GPS — used as geofence center."""
    lats, lngs = [], []
    async for c in db.customers.find({"salesman_id": salesman_id, "gps_lat": {"$ne": None}}):
        if c.get("gps_lat") is not None and c.get("gps_lng") is not None:
            lats.append(c["gps_lat"]); lngs.append(c["gps_lng"])
    if not lats:
        return None
    return (sum(lats) / len(lats), sum(lngs) / len(lngs))


def _hours_between(ci, co) -> Optional[float]:
    if not ci or not co:
        return None
    return round((co - ci).total_seconds() / 3600.0, 2)


def _attendance_out(a: dict) -> dict:
    ci = a.get("check_in_time")
    co = a.get("check_out_time")
    return {
        "id": str(a["_id"]),
        "salesman_id": a.get("salesman_id"),
        "salesman_name": a.get("salesman_name"),
        "date": a.get("date"),
        "check_in_time": ci.isoformat() if ci else None,
        "check_in_lat": a.get("check_in_lat"),
        "check_in_lng": a.get("check_in_lng"),
        "check_in_photo": a.get("check_in_photo"),
        "check_in_distance_km": a.get("check_in_distance_km"),
        "check_in_flagged": a.get("check_in_flagged", False),
        "check_out_time": co.isoformat() if co else None,
        "check_out_lat": a.get("check_out_lat"),
        "check_out_lng": a.get("check_out_lng"),
        "check_out_photo": a.get("check_out_photo"),
        "total_hours": _hours_between(ci, co),
    }


@api.get("/attendance/today")
async def attendance_today(user=Depends(current_user), db=Depends(get_db)):
    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    a = await db.attendance.find_one({"salesman_id": str(user["_id"]), "date": date_str})
    if not a:
        return {"date": date_str, "checked_in": False, "checked_out": False, "record": None}
    out = _attendance_out(a)
    return {
        "date": date_str,
        "checked_in": a.get("check_in_time") is not None,
        "checked_out": a.get("check_out_time") is not None,
        "record": out,
    }


@api.post("/attendance/check-in")
async def attendance_check_in(body: AttendanceMark, user=Depends(current_user), db=Depends(get_db)):
    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    existing = await db.attendance.find_one({"salesman_id": str(user["_id"]), "date": date_str})
    if existing and existing.get("check_in_time"):
        raise HTTPException(400, "Already checked in today")
    now = datetime.now(timezone.utc)

    # Geo-fence: compare check-in location against territory centroid
    distance_km = None
    flagged = False
    warning = None
    if body.lat is not None and body.lng is not None:
        center = await _territory_center(db, str(user["_id"]))
        if center:
            distance_km = round(_haversine_km(body.lat, body.lng, center[0], center[1]), 2)
            radius = float(user.get("geofence_radius_km") or 10)
            if distance_km > radius:
                flagged = True
                warning = f"You are {distance_km} km from your work area (allowed {radius} km). This check-in is flagged for review."

    doc = {
        "salesman_id": str(user["_id"]),
        "salesman_name": user.get("name"),
        "date": date_str,
        "check_in_time": now,
        "check_in_lat": body.lat,
        "check_in_lng": body.lng,
        "check_in_photo": body.photo,
        "check_in_distance_km": distance_km,
        "check_in_flagged": flagged,
    }
    await db.attendance.update_one(
        {"salesman_id": str(user["_id"]), "date": date_str},
        {"$set": doc},
        upsert=True,
    )
    a = await db.attendance.find_one({"salesman_id": str(user["_id"]), "date": date_str})
    out = _attendance_out(a)
    out["warning"] = warning
    return out


@api.post("/attendance/check-out")
async def attendance_check_out(body: AttendanceMark, user=Depends(current_user), db=Depends(get_db)):
    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    existing = await db.attendance.find_one({"salesman_id": str(user["_id"]), "date": date_str})
    if not existing or not existing.get("check_in_time"):
        raise HTTPException(400, "You must check in first")
    if existing.get("check_out_time"):
        raise HTTPException(400, "Already checked out today")
    await db.attendance.update_one(
        {"_id": existing["_id"]},
        {"$set": {
            "check_out_time": datetime.now(timezone.utc),
            "check_out_lat": body.lat,
            "check_out_lng": body.lng,
            "check_out_photo": body.photo,
        }},
    )
    a = await db.attendance.find_one({"_id": existing["_id"]})
    return _attendance_out(a)


@api.get("/attendance")
async def list_attendance(date: Optional[str] = None, salesman_id: Optional[str] = None,
                          user=Depends(current_user), db=Depends(get_db)):
    date_str = date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    query: dict = {"date": date_str}
    if user["role"] == "salesman":
        query["salesman_id"] = str(user["_id"])
    elif salesman_id:
        query["salesman_id"] = salesman_id

    present = {}
    async for a in db.attendance.find(query):
        present[a["salesman_id"]] = _attendance_out(a)

    # For admin, list all salesmen with present/absent status
    rows = []
    if user["role"] == "admin":
        async for s in db.users.find({"role": "salesman"}).sort("name", 1):
            sid = str(s["_id"])
            if salesman_id and sid != salesman_id:
                continue
            rec = present.get(sid)
            rows.append({
                "salesman_id": sid,
                "salesman_name": s.get("name"),
                "area": s.get("area"),
                "present": rec is not None,
                "record": rec,
            })
    else:
        rec = present.get(str(user["_id"]))
        rows.append({
            "salesman_id": str(user["_id"]),
            "salesman_name": user.get("name"),
            "area": user.get("area"),
            "present": rec is not None,
            "record": rec,
        })
    return {"date": date_str, "rows": rows}


@api.get("/attendance/summary")
async def attendance_summary(month: Optional[str] = None, admin=Depends(require_admin), db=Depends(get_db)):
    # month format YYYY-MM
    month_str = month or datetime.now(timezone.utc).strftime("%Y-%m")

    agg = {}
    async for a in db.attendance.find({"date": {"$regex": f"^{month_str}"}}):
        sid = a["salesman_id"]
        entry = agg.setdefault(sid, {"days": 0, "hours": 0.0})
        if a.get("check_in_time"):
            entry["days"] += 1
            h = _hours_between(a.get("check_in_time"), a.get("check_out_time"))
            if h:
                entry["hours"] += h

    rows = []
    async for s in db.users.find({"role": "salesman"}).sort("name", 1):
        sid = str(s["_id"])
        e = agg.get(sid, {"days": 0, "hours": 0.0})
        rows.append({
            "salesman_id": sid,
            "salesman_name": s.get("name"),
            "area": s.get("area"),
            "days_present": e["days"],
            "total_hours": round(e["hours"], 1),
        })
    rows.sort(key=lambda r: r["days_present"], reverse=True)
    return {"month": month_str, "rows": rows}


@api.get("/attendance/export")
async def attendance_export(month: Optional[str] = None, admin=Depends(require_admin), db=Depends(get_db)):
    """One-tap monthly attendance sheet (XLSX) for payroll."""
    import io
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill

    month_str = month or datetime.now(timezone.utc).strftime("%Y-%m")

    # gather records
    records = []
    async for a in db.attendance.find({"date": {"$regex": f"^{month_str}"}}).sort("date", 1):
        records.append(a)

    # salesman names
    names = {}
    async for s in db.users.find({"role": "salesman"}):
        names[str(s["_id"])] = {"name": s.get("name"), "area": s.get("area")}

    wb = Workbook()
    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="4D7C0F", end_color="4D7C0F", fill_type="solid")

    # Sheet 1: Daily
    ws = wb.active
    ws.title = "Daily"
    headers = ["Date", "Salesman", "Area", "Check In", "Check Out", "Hours", "Check-In Location", "Flagged (far)"]
    ws.append(headers)
    for i, _ in enumerate(headers, 1):
        cell = ws.cell(row=1, column=i)
        cell.font = header_font
        cell.fill = header_fill

    def fmt(dt):
        return to_ist(dt).strftime("%H:%M") if dt else ""

    for a in records:
        info = names.get(a.get("salesman_id"), {})
        ci = a.get("check_in_time")
        co = a.get("check_out_time")
        loc = ""
        if a.get("check_in_lat") is not None:
            loc = f"{a['check_in_lat']:.5f}, {a['check_in_lng']:.5f}"
        ws.append([
            a.get("date"),
            info.get("name") or a.get("salesman_name"),
            info.get("area") or "",
            fmt(ci), fmt(co),
            _hours_between(ci, co) or "",
            loc,
            "YES" if a.get("check_in_flagged") else "",
        ])

    # Sheet 2: Summary
    ws2 = wb.create_sheet("Summary")
    ws2.append(["Salesman", "Area", "Days Present", "Total Hours"])
    for i in range(1, 5):
        cell = ws2.cell(row=1, column=i)
        cell.font = header_font
        cell.fill = header_fill

    agg = {}
    for a in records:
        sid = a.get("salesman_id")
        e = agg.setdefault(sid, {"days": 0, "hours": 0.0})
        if a.get("check_in_time"):
            e["days"] += 1
            h = _hours_between(a.get("check_in_time"), a.get("check_out_time"))
            if h:
                e["hours"] += h
    for sid, info in names.items():
        e = agg.get(sid, {"days": 0, "hours": 0.0})
        ws2.append([info.get("name"), info.get("area") or "", e["days"], round(e["hours"], 1)])

    # autosize-ish
    for sheet in (ws, ws2):
        for col in sheet.columns:
            width = max((len(str(c.value)) for c in col if c.value is not None), default=10)
            sheet.column_dimensions[col[0].column_letter].width = min(width + 4, 40)

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    filename = f"attendance_{month_str}.xlsx"
    return Response(
        content=buf.read(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ============ Locations ============
@api.post("/locations", response_model=LocationOut)
async def post_location(body: LocationPing, user=Depends(current_user), db=Depends(get_db)):
    ts = body.timestamp or datetime.now(timezone.utc)
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    doc = {
        "salesman_id": str(user["_id"]),
        "salesman_name": user.get("name"),
        "lat": body.lat,
        "lng": body.lng,
        "accuracy": body.accuracy,
        "timestamp": ts,
    }
    res = await db.locations.insert_one(doc)
    doc["_id"] = res.inserted_id
    return LocationOut(
        id=str(doc["_id"]), salesman_id=doc["salesman_id"],
        salesman_name=doc["salesman_name"], lat=doc["lat"], lng=doc["lng"],
        accuracy=doc.get("accuracy"), timestamp=doc["timestamp"],
    )


@api.get("/locations", response_model=List[LocationOut])
async def list_locations(
    salesman_id: Optional[str] = None,
    date: Optional[str] = None,
    user=Depends(current_user),
    db=Depends(get_db),
):
    query: dict = {}
    if user["role"] == "salesman":
        query["salesman_id"] = str(user["_id"])
    elif salesman_id:
        query["salesman_id"] = salesman_id
    if date:
        try:
            day = datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            query["timestamp"] = {"$gte": day, "$lt": day + timedelta(days=1)}
        except ValueError:
            raise HTTPException(400, "Invalid date")
    docs = []
    async for l in db.locations.find(query).sort("timestamp", 1):
        docs.append(l)
    return [
        LocationOut(
            id=str(l["_id"]), salesman_id=l["salesman_id"],
            salesman_name=l.get("salesman_name"), lat=l["lat"], lng=l["lng"],
            accuracy=l.get("accuracy"), timestamp=l["timestamp"],
        )
        for l in docs
    ]


@api.get("/locations/latest", response_model=List[LocationOut])
async def latest_locations(admin=Depends(require_admin), db=Depends(get_db)):
    """Latest location per salesman."""
    pipeline = [
        {"$sort": {"timestamp": -1}},
        {"$group": {
            "_id": "$salesman_id",
            "doc": {"$first": "$$ROOT"},
        }},
    ]
    result = []
    async for row in db.locations.aggregate(pipeline):
        l = row["doc"]
        result.append(LocationOut(
            id=str(l["_id"]), salesman_id=l["salesman_id"],
            salesman_name=l.get("salesman_name"), lat=l["lat"], lng=l["lng"],
            accuracy=l.get("accuracy"), timestamp=l["timestamp"],
        ))
    return result


# ============ Dashboard ============
@api.get("/dashboard")
async def dashboard(user=Depends(current_user), db=Depends(get_db)):
    now = datetime.now(timezone.utc)
    start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end_of_day = start_of_day + timedelta(days=1)

    scope = {}
    if user["role"] == "salesman":
        scope = {"salesman_id": str(user["_id"])}

    total_customers = await db.customers.count_documents(scope)
    todays_visits = await db.orders.count_documents({**scope, "order_date": {"$gte": start_of_day, "$lt": end_of_day}})
    active_salesmen = await db.users.count_documents({"role": "salesman", "active": True})

    # Outstanding sum
    pipeline = [{"$match": scope}, {"$group": {"_id": None, "total": {"$sum": "$outstanding"}}}]
    out_agg = await db.customers.aggregate(pipeline).to_list(1)
    total_outstanding = float(out_agg[0]["total"]) if out_agg else 0.0

    # Today's revenue
    pipeline_orders = [
        {"$match": {**({"salesman_id": str(user["_id"])} if user["role"] == "salesman" else {}),
                    "order_date": {"$gte": start_of_day, "$lt": end_of_day}}},
        {"$group": {"_id": None, "total": {"$sum": "$total_amount"}}},
    ]
    rev_agg = await db.orders.aggregate(pipeline_orders).to_list(1)
    todays_revenue = float(rev_agg[0]["total"]) if rev_agg else 0.0

    # Shops covered today (distinct customers billed today) + No-Order count today
    today_scope = {**scope, "order_date": {"$gte": start_of_day, "$lt": end_of_day}}
    todays_shop_ids = await db.orders.distinct("customer_id", today_scope)
    todays_shops = len(todays_shop_ids)
    no_order_today = await db.orders.count_documents({**today_scope, "outcome": "No Order"})

    # Recent bills (was visits)
    query_bills = scope.copy()
    recent = []
    async for o in db.orders.find(query_bills).sort("order_date", -1).limit(10):
        recent.append(_order_out(o).model_dump(mode="json"))

    return {
        "total_customers": total_customers,
        "todays_visits": todays_visits,
        "active_salesmen": active_salesmen,
        "total_outstanding": total_outstanding,
        "todays_revenue": todays_revenue,
        "todays_shops": todays_shops,
        "no_order_today": no_order_today,
        "recent_visits": recent,
    }


@api.get("/customers-outstanding", response_model=List[CustomerOut])
async def outstanding_customers(user=Depends(current_user), db=Depends(get_db)):
    query = {"outstanding": {"$gt": 0}}
    if user["role"] == "salesman":
        query["salesman_id"] = str(user["_id"])
    docs = []
    async for c in db.customers.find(query).sort("outstanding", -1):
        docs.append(c)
    await _resolve_salesman_names(db, docs)
    return [_customer_out(c) for c in docs]


# ============ Uploads ============
@api.post("/upload")
async def upload_file(file: UploadFile = File(...), user=Depends(current_user)):
    if not file.filename:
        raise HTTPException(400, "No filename")
    ext = Path(file.filename).suffix.lower() or ".bin"
    fname = f"{uuid.uuid4().hex}{ext}"
    obj_path = f"{APP_NAME}/uploads/{user['_id']}/{fname}"
    data = await file.read()
    ct = file.content_type or "application/octet-stream"
    await run_in_threadpool(_put_object, obj_path, data, ct)
    return {"path": obj_path, "size": len(data), "content_type": ct}


@api.get("/files/{full_path:path}")
async def get_file(full_path: str):
    try:
        content, ct = await run_in_threadpool(_get_object, full_path)
    except requests.HTTPError as e:
        raise HTTPException(404, "File not found")
    return Response(content=content, media_type=ct)


# Health
@api.get("/")
async def root():
    return {"ok": True, "service": "FMCG CRM API"}


app.include_router(api)


@app.on_event("shutdown")
async def shutdown():
    try:
        app.state.mongo.close()
    except Exception:
        pass
