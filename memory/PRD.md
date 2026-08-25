# PRD - Nutriscan (Application mobile Expo)

## Vision
Application mobile de suivi nutritionnel : l'utilisateur photographie un repas, l'IA détecte les calories, protéines, glucides et lipides, et propose un plan repas personnalisé selon son profil.

## Stack
- Frontend: Expo Router 6 (React Native 0.81, SDK 54), expo-image-picker, expo-blur, expo-image, expo-linear-gradient
- Backend: FastAPI + MongoDB (motor) + emergentintegrations (Gemini 3 Flash) via Emergent Universal LLM Key
- Auth: Aucune - profil local stocké dans AsyncStorage (user_id)

## Features MVP
1. **Onboarding** (6 étapes) : nom, genre, âge, taille, poids, activité, objectif → calcul BMR/TDEE (Mifflin-St Jeor) + macros
2. **Home (Aujourd'hui)** : anneau de progression calories, barres macros (protéines/glucides/lipides), journal par catégorie (petit-déj / déj / dîner / snack)
3. **Scanner IA** : caméra ou galerie → base64 → Gemini 3 Flash → analyse (nom, calories, macros, ingrédients, confiance) → bottom sheet éditable → sauvegarde
4. **Plan repas** : génération IA d'un plan 7 jours personnalisé (4 repas/jour) selon profil et macros cibles
5. **Progrès** : chart 7 derniers jours (calories vs cible), moyenne, jours OK, résumé profil, reset

## Endpoints Backend
- POST /api/profile - créer profil + calcul cibles
- GET /api/profile/{user_id}
- PUT /api/profile/{user_id}
- POST /api/meals/scan - analyse photo IA (base64 → macros)
- POST /api/meals - logger un repas
- GET /api/meals?user_id=&date=
- GET /api/meals/summary?user_id=&date=
- DELETE /api/meals/{id}
- GET /api/progress?user_id=&days=7
- POST /api/mealplan/generate - plan 7 jours IA
- GET /api/mealplan/{user_id}

## Design
- Personnalité "iOS-Native Clean" (design_guidelines.json)
- Palette Sage Green (#6B8E6B) sur fond crème (#F9F9F7)
- Tabs bas : Aujourd'hui / Scanner / Plan / Progrès

## Roadmap (potentielle)
- Notifications de rappel repas
- Photos stockées via Emergent Object Storage (actuellement base64 en DB pour MVP)
- Partage social des progrès
- Recettes détaillées avec pas-à-pas
