from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import json
import re
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Literal
import uuid
from datetime import datetime, timezone

from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")

app = FastAPI()
api_router = APIRouter(prefix="/api")


# ---------- Models ----------
class Profile(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    age: int
    gender: Literal["male", "female", "other"]
    height_cm: float
    weight_kg: float
    activity: Literal["sedentary", "light", "moderate", "active", "very_active"]
    goal: Literal["lose", "maintain", "gain"]
    daily_calories: int = 0
    protein_g: int = 0
    carbs_g: int = 0
    fat_g: int = 0
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class ProfileCreate(BaseModel):
    name: str
    age: int
    gender: Literal["male", "female", "other"]
    height_cm: float
    weight_kg: float
    activity: Literal["sedentary", "light", "moderate", "active", "very_active"]
    goal: Literal["lose", "maintain", "gain"]


class MealScanRequest(BaseModel):
    user_id: str
    image_base64: str


class MealScanResult(BaseModel):
    name: str
    calories: int
    protein_g: float
    carbs_g: float
    fat_g: float
    portion: str
    confidence: float
    ingredients: List[str] = []


class Meal(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    name: str
    calories: int
    protein_g: float
    carbs_g: float
    fat_g: float
    portion: str
    category: Literal["breakfast", "lunch", "dinner", "snack"] = "snack"
    image_base64: Optional[str] = None
    date: str  # YYYY-MM-DD
    logged_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class MealCreate(BaseModel):
    user_id: str
    name: str
    calories: int
    protein_g: float
    carbs_g: float
    fat_g: float
    portion: str
    category: Literal["breakfast", "lunch", "dinner", "snack"] = "snack"
    image_base64: Optional[str] = None
    date: Optional[str] = None


class MealPlanDay(BaseModel):
    day: str
    breakfast: dict
    lunch: dict
    dinner: dict
    snack: dict


class MealPlan(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    days: List[dict]
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


# ---------- Helpers ----------
def compute_targets(p: ProfileCreate) -> dict:
    # Mifflin-St Jeor
    if p.gender == "male":
        bmr = 10 * p.weight_kg + 6.25 * p.height_cm - 5 * p.age + 5
    else:
        bmr = 10 * p.weight_kg + 6.25 * p.height_cm - 5 * p.age - 161
    factors = {"sedentary": 1.2, "light": 1.375, "moderate": 1.55, "active": 1.725, "very_active": 1.9}
    tdee = bmr * factors[p.activity]
    if p.goal == "lose":
        tdee -= 500
    elif p.goal == "gain":
        tdee += 400
    daily_calories = int(round(tdee))
    protein_g = int(round(p.weight_kg * 1.8))
    fat_g = int(round(daily_calories * 0.25 / 9))
    carbs_g = int(round((daily_calories - protein_g * 4 - fat_g * 9) / 4))
    return {"daily_calories": daily_calories, "protein_g": protein_g, "carbs_g": max(carbs_g, 50), "fat_g": fat_g}


def extract_json(text: str) -> dict:
    text = text.strip()
    # remove code fences
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    # find first { ... last }
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1:
        text = text[start:end + 1]
    return json.loads(text)


# ---------- Routes ----------
@api_router.get("/")
async def root():
    return {"message": "Nutriscan API"}


@api_router.post("/profile", response_model=Profile)
async def create_profile(payload: ProfileCreate):
    targets = compute_targets(payload)
    profile = Profile(**payload.model_dump(), **targets)
    doc = profile.model_dump()
    await db.profiles.insert_one(doc)
    return profile


@api_router.get("/profile/{user_id}", response_model=Profile)
async def get_profile(user_id: str):
    doc = await db.profiles.find_one({"id": user_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Profile not found")
    return Profile(**doc)


@api_router.put("/profile/{user_id}", response_model=Profile)
async def update_profile(user_id: str, payload: ProfileCreate):
    targets = compute_targets(payload)
    update = {**payload.model_dump(), **targets}
    await db.profiles.update_one({"id": user_id}, {"$set": update})
    doc = await db.profiles.find_one({"id": user_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Profile not found")
    return Profile(**doc)


@api_router.post("/meals/scan", response_model=MealScanResult)
async def scan_meal(payload: MealScanRequest):
    if not EMERGENT_LLM_KEY:
        raise HTTPException(500, "LLM key not configured")

    system_prompt = (
        "You are a nutrition expert AI. Analyze the meal photo and estimate nutrition. "
        "ALWAYS respond with ONLY valid JSON, no prose, no markdown. Schema:\n"
        "{\"name\": string, \"calories\": integer, \"protein_g\": number, "
        "\"carbs_g\": number, \"fat_g\": number, \"portion\": string (e.g. '1 bowl'), "
        "\"confidence\": number (0-1), \"ingredients\": [string]}"
    )
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"scan-{uuid.uuid4()}",
        system_message=system_prompt,
    ).with_model("gemini", "gemini-3-flash-preview")

    image = ImageContent(image_base64=payload.image_base64)
    msg = UserMessage(
        text="Analyze this meal photo. Return ONLY the JSON, no extra text.",
        file_contents=[image],
    )
    try:
        response = await chat.send_message(msg)
    except Exception as e:
        logging.exception("LLM scan failed")
        raise HTTPException(500, f"AI analysis failed: {e}")

    try:
        data = extract_json(response)
    except Exception:
        logging.error("Failed to parse LLM output: %s", response)
        raise HTTPException(500, "Could not parse AI result")

    return MealScanResult(
        name=str(data.get("name", "Meal")),
        calories=int(data.get("calories", 0)),
        protein_g=float(data.get("protein_g", 0)),
        carbs_g=float(data.get("carbs_g", 0)),
        fat_g=float(data.get("fat_g", 0)),
        portion=str(data.get("portion", "1 serving")),
        confidence=float(data.get("confidence", 0.7)),
        ingredients=[str(x) for x in data.get("ingredients", [])][:10],
    )


@api_router.post("/meals", response_model=Meal)
async def create_meal(payload: MealCreate):
    date = payload.date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    meal = Meal(**payload.model_dump(exclude={"date"}), date=date)
    await db.meals.insert_one(meal.model_dump())
    return meal


@api_router.get("/meals", response_model=List[Meal])
async def list_meals(user_id: str, date: Optional[str] = None):
    q = {"user_id": user_id}
    if date:
        q["date"] = date
    docs = await db.meals.find(q, {"_id": 0}).sort("logged_at", -1).to_list(500)
    return [Meal(**d) for d in docs]


@api_router.get("/meals/summary")
async def daily_summary(user_id: str, date: Optional[str] = None):
    date = date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    docs = await db.meals.find({"user_id": user_id, "date": date}, {"_id": 0}).to_list(500)
    totals = {"calories": 0, "protein_g": 0.0, "carbs_g": 0.0, "fat_g": 0.0, "count": len(docs)}
    for d in docs:
        totals["calories"] += int(d.get("calories", 0))
        totals["protein_g"] += float(d.get("protein_g", 0))
        totals["carbs_g"] += float(d.get("carbs_g", 0))
        totals["fat_g"] += float(d.get("fat_g", 0))
    return {"date": date, **totals}


@api_router.delete("/meals/{meal_id}")
async def delete_meal(meal_id: str):
    r = await db.meals.delete_one({"id": meal_id})
    return {"deleted": r.deleted_count}


@api_router.get("/progress")
async def get_progress(user_id: str, days: int = 7):
    profile = await db.profiles.find_one({"id": user_id}, {"_id": 0})
    target = profile.get("daily_calories", 2000) if profile else 2000
    from datetime import timedelta
    today = datetime.now(timezone.utc).date()
    result = []
    for i in range(days - 1, -1, -1):
        d = today - timedelta(days=i)
        ds = d.strftime("%Y-%m-%d")
        docs = await db.meals.find({"user_id": user_id, "date": ds}, {"_id": 0}).to_list(500)
        cals = sum(int(x.get("calories", 0)) for x in docs)
        prot = sum(float(x.get("protein_g", 0)) for x in docs)
        result.append({"date": ds, "calories": cals, "protein_g": prot, "target": target})
    return {"days": result, "target": target}


class MealPlanRequest(BaseModel):
    user_id: str


@api_router.post("/mealplan/generate")
async def generate_meal_plan(payload: MealPlanRequest):
    if not EMERGENT_LLM_KEY:
        raise HTTPException(500, "LLM key not configured")
    profile = await db.profiles.find_one({"id": payload.user_id}, {"_id": 0})
    if not profile:
        raise HTTPException(404, "Profile not found")

    system_prompt = (
        "You are a certified nutritionist AI. Generate a 7-day personalized meal plan. "
        "ALWAYS respond with ONLY valid JSON, no prose, no markdown. Schema:\n"
        "{\"days\":[{\"day\":\"Monday\",\"breakfast\":{\"name\":string,\"calories\":int,\"protein_g\":number,"
        "\"carbs_g\":number,\"fat_g\":number,\"description\":string},"
        "\"lunch\":{...same...},\"dinner\":{...same...},\"snack\":{...same...}}, ... 7 entries]}"
    )
    user_text = (
        f"Create a healthy 7-day meal plan for a {profile['age']}yo {profile['gender']}, "
        f"{profile['height_cm']}cm, {profile['weight_kg']}kg, activity: {profile['activity']}, "
        f"goal: {profile['goal']}. Daily target: {profile['daily_calories']} kcal, "
        f"{profile['protein_g']}g protein, {profile['carbs_g']}g carbs, {profile['fat_g']}g fat. "
        "Use diverse, tasty, realistic meals."
    )
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"plan-{uuid.uuid4()}",
        system_message=system_prompt,
    ).with_model("gemini", "gemini-3-flash-preview")

    try:
        response = await chat.send_message(UserMessage(text=user_text))
        data = extract_json(response)
    except Exception as e:
        logging.exception("Meal plan generation failed")
        raise HTTPException(500, f"AI plan failed: {e}")

    plan = MealPlan(user_id=payload.user_id, days=data.get("days", []))
    # replace any existing plan for the user
    await db.mealplans.delete_many({"user_id": payload.user_id})
    await db.mealplans.insert_one(plan.model_dump())
    return plan.model_dump()


@api_router.get("/mealplan/{user_id}")
async def get_meal_plan(user_id: str):
    doc = await db.mealplans.find_one({"user_id": user_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "No meal plan yet")
    return doc


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
