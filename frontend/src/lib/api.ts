const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL as string;

async function req<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}/api${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${res.status}: ${txt}`);
  }
  return res.json();
}

export const api = {
  createProfile: (data: any) => req('/profile', { method: 'POST', body: JSON.stringify(data) }),
  getProfile: (id: string) => req(`/profile/${id}`),
  updateProfile: (id: string, data: any) => req(`/profile/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  scanMeal: (user_id: string, image_base64: string) =>
    req('/meals/scan', { method: 'POST', body: JSON.stringify({ user_id, image_base64 }) }),
  createMeal: (data: any) => req('/meals', { method: 'POST', body: JSON.stringify(data) }),
  listMeals: (user_id: string, date?: string) =>
    req(`/meals?user_id=${user_id}${date ? `&date=${date}` : ''}`),
  dailySummary: (user_id: string, date?: string) =>
    req(`/meals/summary?user_id=${user_id}${date ? `&date=${date}` : ''}`),
  deleteMeal: (id: string) => req(`/meals/${id}`, { method: 'DELETE' }),
  progress: (user_id: string, days = 7) => req(`/progress?user_id=${user_id}&days=${days}`),
  generateMealPlan: (user_id: string, force = false) =>
    req('/mealplan/generate', { method: 'POST', body: JSON.stringify({ user_id, force }) }),
  getMealPlan: (user_id: string) => req(`/mealplan/${user_id}?auto_refresh=true`),
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
