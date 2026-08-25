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
    week_start: str  # ISO date of Monday of the plan's week
    days: List[dict]
    generation_meta: dict = Field(default_factory=dict)  # model, tokens, target_hit, etc.
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


def current_monday_iso() -> str:
    """Return the ISO date (YYYY-MM-DD) of Monday of the current UTC week."""
    from datetime import timedelta
    today = datetime.now(timezone.utc).date()
    monday = today - timedelta(days=today.weekday())
    return monday.isoformat()


# Text model used for meal-plan reasoning. Vision uses same model for photos.
AI_MODEL_PROVIDER = "gemini"
AI_MODEL_NAME = "gemini-3.1-pro-preview"


async def ask_llm_json(system_prompt: str, user_text: str,
                       image_b64: Optional[str] = None,
                       max_attempts: int = 2) -> dict:
    """Call the LLM, extract JSON, retry on parse errors with a corrective nudge."""
    last_error: Optional[str] = None
    last_raw: Optional[str] = None
    for attempt in range(1, max_attempts + 1):
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"llm-{uuid.uuid4()}",
            system_message=system_prompt,
        ).with_model(AI_MODEL_PROVIDER, AI_MODEL_NAME)
        text = user_text
        if attempt > 1 and last_raw is not None:
            text = (
                "Your previous response was not valid JSON matching the schema. "
                f"Error: {last_error}. Return ONLY a valid JSON object matching the schema. "
                "No prose, no markdown, no code fences."
            )
        files = [ImageContent(image_base64=image_b64)] if image_b64 else None
        msg = UserMessage(text=text, file_contents=files) if files else UserMessage(text=text)
        try:
            response = await chat.send_message(msg)
            last_raw = response
            return extract_json(response)
        except Exception as e:
            last_error = str(e)[:200]
            logging.warning("LLM attempt %d failed: %s", attempt, last_error)
            continue
    raise RuntimeError(f"LLM failed after {max_attempts} attempts: {last_error}")


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
    result = await db.profiles.update_one({"id": user_id}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(404, "Profile not found")
    # Invalidate cached meal plan since macros/goal changed
    await db.mealplans.delete_many({"user_id": user_id})
    doc = await db.profiles.find_one({"id": user_id}, {"_id": 0})
    return Profile(**doc)


@api_router.post("/meals/scan", response_model=MealScanResult)
async def scan_meal(payload: MealScanRequest):
    if not EMERGENT_LLM_KEY:
        raise HTTPException(500, "LLM key not configured")

    system_prompt = (
        "You are a certified nutritionist AI with strong food-photography vision. "
        "Analyze the meal photo carefully and estimate its nutrition.\n\n"
        "METHOD (follow every step, silently):\n"
        "1. Identify each visible food item and its cooking method (grilled, fried, raw, sauced...).\n"
        "2. Estimate the portion of EACH item in grams using visual cues (plate size, cutlery, hand).\n"
        "3. Sum the calories, protein, carbs and fat across items using standard USDA nutrition data.\n"
        "4. Pick a short human-readable dish name (French preferred when the plat is French cuisine, "
        "otherwise the most common name in the photo's language).\n"
        "5. Set confidence based on visibility: 0.9+ obvious single dish, 0.7 mixed plate, 0.4 blurry/ambiguous.\n\n"
        "STRICT OUTPUT: respond with ONLY a valid JSON object, no markdown, no code fences, no prose.\n"
        "Schema (all keys required):\n"
        "{\n"
        '  "name": string,                 // short dish name\n'
        '  "calories": integer,            // total kcal (must be > 0 and < 3000)\n'
        '  "protein_g": number,            // grams (>= 0, <= 200)\n'
        '  "carbs_g": number,              // grams (>= 0, <= 300)\n'
        '  "fat_g": number,                // grams (>= 0, <= 200)\n'
        '  "portion": string,              // e.g. "1 bol (300g)", "1 assiette", "150g"\n'
        '  "confidence": number,           // 0..1\n'
        '  "ingredients": [string]         // 2-8 items visible in the photo\n'
        "}\n"
        "If the photo shows NO food, still return the schema with calories=0, confidence<=0.2 and name=\"Non-alimentaire\"."
    )
    user_text = (
        "Analyse cette photo de repas et retourne uniquement le JSON demandé. "
        "Les valeurs de calories et macros doivent être cohérentes entre elles "
        "(kcal ≈ 4×protéines + 4×glucides + 9×lipides, tolérance 15%)."
    )

    try:
        data = await ask_llm_json(system_prompt, user_text, image_b64=payload.image_base64, max_attempts=2)
    except Exception as e:
        logging.exception("LLM scan failed")
        raise HTTPException(500, f"AI analysis failed: {e}")

    # Clamp + coerce
    def clampf(v, lo, hi, default=0.0):
        try:
            x = float(v)
        except Exception:
            return default
        return max(lo, min(hi, x))

    calories = int(clampf(data.get("calories", 0), 0, 3000))
    protein_g = clampf(data.get("protein_g", 0), 0, 200)
    carbs_g = clampf(data.get("carbs_g", 0), 0, 300)
    fat_g = clampf(data.get("fat_g", 0), 0, 200)
    confidence = clampf(data.get("confidence", 0.6), 0.0, 1.0, 0.6)

    # Macro-caloric consistency check — if wildly off, recompute calories from macros
    macro_kcal = 4 * protein_g + 4 * carbs_g + 9 * fat_g
    if macro_kcal > 0 and (calories == 0 or abs(calories - macro_kcal) / max(calories, macro_kcal) > 0.35):
        calories = int(round(macro_kcal))
        confidence = min(confidence, 0.7)

    return MealScanResult(
        name=str(data.get("name", "Repas")).strip()[:80] or "Repas",
        calories=calories,
        protein_g=protein_g,
        carbs_g=carbs_g,
        fat_g=fat_g,
        portion=str(data.get("portion", "1 portion")).strip()[:60] or "1 portion",
        confidence=confidence,
        ingredients=[str(x).strip()[:40] for x in (data.get("ingredients") or [])][:10],
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
    force: bool = False


async def _generate_and_store_plan(user_id: str, profile: dict) -> dict:
    """Core plan generation with strong prompt + validation. Persists and returns the plan dict."""
    if not EMERGENT_LLM_KEY:
        raise HTTPException(500, "LLM key not configured")

    week_start = current_monday_iso()

    # Seasonality hint helps the AI pick appropriate ingredients
    month = datetime.now(timezone.utc).month
    seasons = {12: "hiver", 1: "hiver", 2: "hiver", 3: "printemps", 4: "printemps", 5: "printemps",
               6: "été", 7: "été", 8: "été", 9: "automne", 10: "automne", 11: "automne"}
    season = seasons[month]

    # Explicit list of seasonal produce (hémisphère nord / France) — the AI must
    # anchor at least 60% of its plant ingredients in this list.
    seasonal_map = {
        "hiver": {
            "légumes": ["poireau", "chou frisé", "chou-fleur", "chou de Bruxelles", "endive", "carotte",
                        "panais", "topinambour", "courge butternut", "potiron", "épinard", "mâche",
                        "betterave", "céleri-rave", "navet", "salsifis", "champignon de Paris"],
            "fruits": ["orange", "clémentine", "pomelo", "kiwi", "pomme", "poire", "banane",
                       "grenade", "kaki", "fruit de la passion", "citron"],
            "protéines": ["saumon", "cabillaud", "sardine", "poulet", "dinde", "œuf", "lentille",
                          "haricot rouge", "pois chiche", "tofu", "gruyère"],
        },
        "printemps": {
            "légumes": ["asperge", "artichaut", "petit pois", "radis", "épinard", "fève", "carotte nouvelle",
                        "oignon nouveau", "salade", "roquette", "courgette", "concombre", "navet nouveau",
                        "chou-rave"],
            "fruits": ["fraise", "rhubarbe", "cerise", "pomme", "kiwi", "citron", "banane", "abricot"],
            "protéines": ["cabillaud", "truite", "poulet", "agneau", "œuf", "chèvre frais", "tofu",
                          "lentille corail"],
        },
        "été": {
            "légumes": ["tomate", "courgette", "aubergine", "poivron", "concombre", "haricot vert",
                        "maïs doux", "salade", "roquette", "radis", "brocoli", "artichaut", "avocat",
                        "fenouil", "oignon rouge"],
            "fruits": ["pêche", "nectarine", "abricot", "melon", "pastèque", "cerise", "fraise",
                       "framboise", "myrtille", "prune", "figue", "citron"],
            "protéines": ["thon", "maquereau", "sardine", "poulet", "crevette", "œuf", "mozzarella",
                          "feta", "pois chiche", "haricot blanc", "tofu"],
        },
        "automne": {
            "légumes": ["courge butternut", "potiron", "champignon de Paris", "cèpes", "chou",
                        "chou-fleur", "carotte", "poireau", "brocoli", "épinard", "betterave",
                        "topinambour", "panais", "céleri", "endive"],
            "fruits": ["pomme", "poire", "raisin", "coing", "figue", "prune", "noix", "noisette",
                       "châtaigne", "kiwi", "citron"],
            "protéines": ["saumon", "canard", "poulet", "dinde", "œuf", "lentille", "haricot",
                          "champignon", "tofu", "comté"],
        },
    }
    sp = seasonal_map[season]
    seasonal_hint = (
        f"Produits de saison ({season}) à privilégier :\n"
        f"- Légumes : {', '.join(sp['légumes'])}\n"
        f"- Fruits : {', '.join(sp['fruits'])}\n"
        f"- Protéines : {', '.join(sp['protéines'])}\n"
        "Au moins 60% des ingrédients végétaux du plan doivent provenir de cette liste. "
        "Bannis les produits totalement hors-saison (fraises en hiver, courge en été, etc.)."
    )

    system_prompt = (
        "Tu es un(e) nutritionniste diplômé(e) et chef cuisinier(e). Ta mission : générer un plan repas "
        "hebdomadaire personnalisé, réaliste, VARIÉ, savoureux et facile à préparer, avec des macros "
        "précises et cohérentes avec le profil de l'utilisateur.\n\n"
        "RÈGLES STRICTES :\n"
        "1. 7 jours (Monday à Sunday), 4 repas par jour (breakfast, lunch, dinner, snack).\n"
        "2. Aucun plat ne se répète dans la semaine (ni breakfast, ni lunch, ni dinner). Le snack peut se répéter max 2 fois.\n"
        "3. Variété : mélange cuisines française, méditerranéenne, asiatique, moyen-orientale. Alterne poissons/viandes/végétarien.\n"
        "4. Chaque repas doit respecter la répartition classique : petit-déj ~25%, déjeuner ~35%, dîner ~30%, snack ~10% de l'objectif journalier.\n"
        "5. La somme des calories des 4 repas d'un jour doit être à ±5% de l'objectif journalier (STRICT).\n"
        "6. kcal ≈ 4×protéines + 4×glucides + 9×lipides (tolérance 10%).\n"
        "7. Le champ 'description' doit contenir 1 phrase courte (< 90 caractères) avec les ingrédients clés.\n"
        "8. Nom du repas en FRANÇAIS, capitalisé, sans emoji.\n\n"
        "SORTIE STRICTE : réponds UNIQUEMENT avec le JSON, sans markdown, sans code fence, sans texte.\n"
        "Schéma :\n"
        "{\n"
        '  "days": [\n'
        '    {\n'
        '      "day": "Monday",\n'
        '      "breakfast": {"name": string, "calories": int, "protein_g": number, "carbs_g": number, "fat_g": number, "description": string},\n'
        '      "lunch": {...},\n'
        '      "dinner": {...},\n'
        '      "snack": {...}\n'
        '    }, ...7 entries total in the exact order Monday..Sunday\n'
        '  ]\n'
        "}"
    )

    user_text = (
        f"Profil : {profile['age']} ans, {profile['gender']}, {profile['height_cm']} cm, {profile['weight_kg']} kg, "
        f"activité {profile['activity']}, objectif {profile['goal']}.\n"
        f"Objectifs quotidiens : {profile['daily_calories']} kcal, {profile['protein_g']} g protéines, "
        f"{profile['carbs_g']} g glucides, {profile['fat_g']} g lipides.\n\n"
        f"{seasonal_hint}\n\n"
        f"Semaine du {week_start} (utilise cette date comme graine de variation pour proposer un menu différent des semaines précédentes).\n"
        "Génère un plan complet, gourmand, équilibré et RIGOUREUSEMENT DE SAISON maintenant."
    )

    try:
        data = await ask_llm_json(system_prompt, user_text, max_attempts=2)
    except Exception as e:
        logging.exception("Meal plan generation failed")
        raise HTTPException(500, f"AI plan failed: {e}")

    days = data.get("days") or []
    # Normalize + validate
    expected_days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    normalized: List[dict] = []
    target = profile["daily_calories"]

    def _norm_meal(m: dict) -> dict:
        if not isinstance(m, dict):
            m = {}
        return {
            "name": str(m.get("name", "Repas")).strip()[:80] or "Repas",
            "calories": max(0, int(round(float(m.get("calories", 0) or 0)))),
            "protein_g": max(0.0, float(m.get("protein_g", 0) or 0)),
            "carbs_g": max(0.0, float(m.get("carbs_g", 0) or 0)),
            "fat_g": max(0.0, float(m.get("fat_g", 0) or 0)),
            "description": str(m.get("description", "")).strip()[:160],
        }

    by_day = {d.get("day"): d for d in days if isinstance(d, dict)}
    total_hit = 0
    for day_name in expected_days:
        raw = by_day.get(day_name) or {}
        entry = {
            "day": day_name,
            "breakfast": _norm_meal(raw.get("breakfast", {})),
            "lunch": _norm_meal(raw.get("lunch", {})),
            "dinner": _norm_meal(raw.get("dinner", {})),
            "snack": _norm_meal(raw.get("snack", {})),
        }
        day_cal = sum(entry[k]["calories"] for k in ("breakfast", "lunch", "dinner", "snack"))
        if target > 0 and abs(day_cal - target) / target <= 0.08:
            total_hit += 1
        normalized.append(entry)

    plan = MealPlan(
        user_id=user_id,
        week_start=week_start,
        days=normalized,
        generation_meta={
            "model": AI_MODEL_NAME,
            "days_on_target": total_hit,
            "season": season,
        },
    )
    # replace any existing plan for the user
    await db.mealplans.delete_many({"user_id": user_id})
    await db.mealplans.insert_one(plan.model_dump())
    return plan.model_dump()


@api_router.post("/mealplan/generate")
async def generate_meal_plan(payload: MealPlanRequest):
    profile = await db.profiles.find_one({"id": payload.user_id}, {"_id": 0})
    if not profile:
        raise HTTPException(404, "Profile not found")
    # If not forcing and a fresh plan for this week already exists, return it
    if not payload.force:
        existing = await db.mealplans.find_one({"user_id": payload.user_id}, {"_id": 0})
        if existing and existing.get("week_start") == current_monday_iso():
            return existing
    return await _generate_and_store_plan(payload.user_id, profile)


@api_router.get("/mealplan/{user_id}")
async def get_meal_plan(user_id: str, auto_refresh: bool = True):
    """Return the user's plan. If auto_refresh=True and the stored plan is from a previous
    week, silently regenerate a fresh plan for the current week."""
    doc = await db.mealplans.find_one({"user_id": user_id}, {"_id": 0})
    current_week = current_monday_iso()
    if not doc:
        raise HTTPException(404, "No meal plan yet")
    if auto_refresh and doc.get("week_start") != current_week:
        profile = await db.profiles.find_one({"id": user_id}, {"_id": 0})
        if profile:
            try:
                fresh = await _generate_and_store_plan(user_id, profile)
                fresh["auto_refreshed"] = True
                return fresh
            except Exception as e:
                # Fall back to stale plan if regen fails, but flag it
                logging.warning("Auto-refresh failed, returning stale plan: %s", e)
                doc["stale"] = True
                return doc
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
