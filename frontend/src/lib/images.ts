/** Generate a nice Unsplash food image URL from a meal name */
export function foodImageUrl(name: string, w = 800, h = 600): string {
  const query = encodeURIComponent(`${name} food meal`);
  return `https://source.unsplash.com/${w}x${h}/?${query}`;
}

/** Deterministic fallback pool for meal placeholders */
const POOL = [
  'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=800&q=80',
  'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=800&q=80',
  'https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=800&q=80',
  'https://images.unsplash.com/photo-1565958011703-44f9829ba187?w=800&q=80',
  'https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=800&q=80',
  'https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?w=800&q=80',
  'https://images.unsplash.com/photo-1484723091739-30a097e8f929?w=800&q=80',
];

export function fallbackFoodImage(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return POOL[hash % POOL.length];
}
