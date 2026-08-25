import { session } from './session';

const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL as string;

// Module-level token cache — cleared on logout
let cachedToken: string | null | undefined = undefined;

export async function primeAuthToken() {
  cachedToken = await session.get();
}
export function clearAuthTokenCache() { cachedToken = null; }

async function getToken(): Promise<string | null> {
  if (cachedToken === undefined) cachedToken = await session.get();
  return cachedToken;
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) { onUnauthorized = fn; }

async function req<T = any>(path: string, opts: RequestInit & { timeout?: number; auth?: boolean } = {}): Promise<T> {
  const { timeout, auth = true, ...rest } = opts;
  const controller = new AbortController();
  const timer = timeout ? setTimeout(() => controller.abort(), timeout) : null;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((rest.headers as Record<string, string>) || {}),
  };
  if (auth) {
    const t = await getToken();
    if (t) headers.Authorization = `Bearer ${t}`;
  }
  try {
    const res = await fetch(`${BASE_URL}/api${path}`, { ...rest, signal: controller.signal, headers });
    if (res.status === 401 && auth) {
      cachedToken = null;
      await session.clear();
      onUnauthorized?.();
    }
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`${res.status}: ${txt}`);
    }
    return res.json();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const api = {
  // Auth
  exchangeSession: (session_id: string) =>
    req('/auth/session', { method: 'POST', body: JSON.stringify({ session_id }), auth: false }),
  me: () => req('/auth/me'),
  logout: () => req('/auth/logout', { method: 'POST' }),
  deleteAccount: () => req('/auth/account', { method: 'DELETE' }),

  // Profile (derived from auth)
  createProfile: (data: any) => req('/profile', { method: 'POST', body: JSON.stringify(data) }),
  getProfile: () => req('/profile'),
  updateProfile: (data: any) => req('/profile', { method: 'PUT', body: JSON.stringify(data) }),

  // Meals
  scanMeal: (image_base64: string) =>
    req('/meals/scan', { method: 'POST', body: JSON.stringify({ image_base64 }), timeout: 55000 }),
  createMeal: (data: any) => req('/meals', { method: 'POST', body: JSON.stringify(data) }),
  listMeals: (date?: string) => req(`/meals${date ? `?date=${date}` : ''}`),
  dailySummary: (date?: string) => req(`/meals/summary${date ? `?date=${date}` : ''}`),
  deleteMeal: (id: string) => req(`/meals/${id}`, { method: 'DELETE' }),

  // Progress + plan
  progress: (days = 7) => req(`/progress?days=${days}`),
  generateMealPlan: (force = false) =>
    req('/mealplan/generate', { method: 'POST', body: JSON.stringify({ force }), timeout: 55000 }),
  getMealPlan: () => req('/mealplan?auto_refresh=true', { timeout: 55000 }),
  getMealPlanNoRefresh: () => req('/mealplan?auto_refresh=false'),
};

export const COLORS = {
  surface: '#F9F9F7',
  surface2: '#FFFFFF',
  surface3: '#F0F0EA',
  text: '#1C1C1E',
  textSecondary: '#3A3A3C',
  textMuted: '#636366',
  brand: '#6B8E6B',
  brandPrimary: '#4A6B4A',
  brandSecondary: '#E1EBE1',
  brandTertiary: '#F0F5F0',
  success: '#34C759',
  warning: '#FF9500',
  error: '#FF3B30',
  border: '#E5E5E0',
  borderStrong: '#C7C7C0',
  protein: '#4A6B4A',
  carbs: '#FF9500',
  fat: '#FF3B30',
};
