# PRD - Nutriscan (Application mobile Expo)

## Vision
App mobile de suivi nutritionnel : l'utilisateur photographie un repas, l'IA détecte les macros, et un plan repas de saison est régénéré chaque semaine.

## Stack
- Frontend: Expo Router 6 (React Native 0.81, SDK 54), Reanimated, expo-image-picker, expo-blur, expo-secure-store
- Backend: FastAPI + MongoDB (motor) + emergentintegrations (Gemini 3.1 Pro) + slowapi + httpx
- Auth: **Emergent-managed Google Auth** (Bearer session_token 7 jours, TTL Mongo)

## Sécurité (audit v1 passé)
- Toutes les routes `/api/*` (sauf `GET /` et `POST /auth/session`) requièrent un Bearer token valide
- `user_id` **jamais** accepté depuis le client — dérivé de la session côté serveur
- Ownership check sur DELETE meals (403 si ce n'est pas le propriétaire)
- Rate limits : 30/h sur `/meals/scan`, 10/h sur `/mealplan/generate` (par user)
- Cap taille : image_base64 ≤ 8 MB → 413
- Messages d'erreur sanitisés (pas de traceback ni de clé exposée)
- Sessions stockées dans `expo-secure-store` sur mobile, `localStorage` sur web

## Endpoints Backend
- Public : `GET /api/`, `POST /api/auth/session`
- Auth : `GET /api/auth/me`, `POST /api/auth/logout`, `POST/GET/PUT /api/profile`, `POST/GET /api/meals`, `GET /api/meals/summary`, `DELETE /api/meals/{id}`, `GET /api/progress`, `POST /api/mealplan/generate`, `GET /api/mealplan`, `POST /api/meals/scan`

## Features
1. Écran `/login` avec Google Auth (image hero, USPs, bouton Google)
2. Onboarding 6 étapes → calcul BMR/TDEE + macros
3. Home : anneau calorique animé, streak, repas par catégorie
4. Scanner IA avec réticule animé et bottom-sheet éditable
5. Plan repas hebdomadaire de saison, auto-renouvelé chaque lundi
6. Progrès : bar chart 7 jours, insights, résumé profil, déconnexion

## Roadmap potentielle
- Liste de courses agrégée
- Régimes (végé, vegan, halal, sans gluten)
- Swap intelligent d'un repas
- Recettes détaillées pas-à-pas
