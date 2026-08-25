import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { api, clearAuthTokenCache, setUnauthorizedHandler } from './api';
import { session } from './session';

WebBrowser.maybeCompleteAuthSession();

export type AuthUser = {
  user_id: string;
  email: string;
  name?: string;
  picture?: string;
  has_profile?: boolean;
};

type AuthState = {
  loading: boolean;
  user: AuthUser | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AuthCtx = createContext<AuthState>({
  loading: true,
  user: null,
  signIn: async () => {},
  signOut: async () => {},
  refreshUser: async () => {},
});

const processedSessionIds = new Set<string>();

function extractSessionId(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/[?#&]session_id=([^&#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const pendingSignIn = useRef(false);

  const handleSessionId = useCallback(async (session_id: string) => {
    if (!session_id || processedSessionIds.has(session_id)) return;
    processedSessionIds.add(session_id);
    try {
      const res = await api.exchangeSession(session_id);
      if (res?.session_token) {
        await session.set(res.session_token);
        clearAuthTokenCache();
        setUser(res.user);
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          // Clean session_id from URL, preserve everything else
          const hash = window.location.hash.replace(/[?#&]?session_id=[^&#]+/, '');
          const search = window.location.search.replace(/[?&]session_id=[^&]+/, '').replace(/^\?$/, '');
          window.history.replaceState(window.history.state, '', window.location.pathname + search + hash);
        }
      }
    } catch (e) {
      console.warn('Auth exchange failed', e);
    }
  }, []);

  const bootstrap = useCallback(async () => {
    setLoading(true);
    try {
      // 1. If URL has session_id, process it first
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const sid = extractSessionId(window.location.hash) || extractSessionId(window.location.search);
        if (sid) {
          await handleSessionId(sid);
          setLoading(false);
          return;
        }
      } else {
        const initialUrl = await Linking.getInitialURL();
        const sid = extractSessionId(initialUrl);
        if (sid) {
          await handleSessionId(sid);
          setLoading(false);
          return;
        }
      }
      // 2. Otherwise try existing token
      const token = await session.get();
      if (token) {
        try {
          const me = await api.me();
          setUser(me);
        } catch (_) {
          await session.clear();
          clearAuthTokenCache();
          setUser(null);
        }
      } else {
        setUser(null);
      }
    } finally {
      setLoading(false);
    }
  }, [handleSessionId]);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    bootstrap();
    // Listen for deep link callbacks on mobile
    const sub = Linking.addEventListener('url', (event) => {
      const sid = extractSessionId(event.url);
      if (sid) handleSessionId(sid);
    });
    return () => {
      sub.remove();
      setUnauthorizedHandler(null);
    };
  }, [bootstrap, handleSessionId]);

  const signIn = useCallback(async () => {
    if (pendingSignIn.current) return;
    pendingSignIn.current = true;
    try {
      const redirectUrl =
        Platform.OS === 'web' && typeof window !== 'undefined'
          ? window.location.origin + '/'
          : Linking.createURL('');
      const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.location.href = authUrl;
        return;
      }
      // Register a URL listener BEFORE opening the browser
      let captured: string | null = null;
      const sub = Linking.addEventListener('url', (e) => {
        if (!captured) captured = e.url;
      });
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
      sub.remove();
      let candidate: string | null = (result as any)?.url || null;
      if (!candidate) candidate = captured;
      if (!candidate) candidate = await Linking.getInitialURL();
      const sid = extractSessionId(candidate);
      if (sid) await handleSessionId(sid);
    } finally {
      pendingSignIn.current = false;
    }
  }, [handleSessionId]);

  const signOut = useCallback(async () => {
    try { await api.logout(); } catch (_) {}
    await session.clear();
    clearAuthTokenCache();
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const me = await api.me();
      setUser(me);
    } catch (_) {
      setUser(null);
    }
  }, []);

  return (
    <AuthCtx.Provider value={{ loading, user, signIn, signOut, refreshUser }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() { return useContext(AuthCtx); }
