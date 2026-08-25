import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const KEY = 'nutriscan_session_token';

async function webGet(k: string) { return typeof window !== 'undefined' ? window.localStorage.getItem(k) : null; }
async function webSet(k: string, v: string) { if (typeof window !== 'undefined') window.localStorage.setItem(k, v); }
async function webDel(k: string) { if (typeof window !== 'undefined') window.localStorage.removeItem(k); }

export const session = {
  async get(): Promise<string | null> {
    if (Platform.OS === 'web') return webGet(KEY);
    return SecureStore.getItemAsync(KEY);
  },
  async set(token: string) {
    if (Platform.OS === 'web') return webSet(KEY, token);
    return SecureStore.setItemAsync(KEY, token);
  },
  async clear() {
    if (Platform.OS === 'web') return webDel(KEY);
    return SecureStore.deleteItemAsync(KEY);
  },
};
