import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiPost, apiGet, loadStoredAuth, clearAuth, fetchInitialCsrf } from '../api/client';

const AuthContext = createContext(null);

const AUTH_STORAGE_KEY = 'adarsh_auth_state';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Load stored auth on mount + refresh profile from server
  useEffect(() => {
    (async () => {
      try {
        await loadStoredAuth();
        const stored = await AsyncStorage.getItem(AUTH_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          setUser(parsed);
          setIsAuthenticated(true);

          // Try to refresh user profile from server
          try {
            const { ok, status, data } = await apiGet('/app/api/profile/');
            if (status === 401 || status === 403) {
              // Session expired — auto logout
              setUser(null);
              setIsAuthenticated(false);
              await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
              await clearAuth();
            } else if (ok && data?.success) {
              const refreshed = {
                ...parsed,
                name: data.data?.name || parsed.name,
                email: data.data?.email || parsed.email,
                phone: data.data?.phone || parsed.phone || '',
                role: data.data?.role || parsed.role,
              };
              setUser(refreshed);
              await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(refreshed));
            }
          } catch (e) {
            // Network error — keep cached data
          }
        }
      } catch (e) {
        // silent
      }
      setIsLoading(false);
    })();
  }, []);

  const login = useCallback(async (email, password, forceLogoutOther = false) => {
    // Ensure we have a CSRF token
    await fetchInitialCsrf();

    const body = { email, password };
    if (forceLogoutOther) body.force_logout_other = true;

    const { ok, data } = await apiPost('/app/api/auth/login/', body);

    if (data.success) {
      const userData = {
        email,
        name: data.user_name || data.name || email,
        role: data.role || '',
        loggedInAt: Date.now(),
      };
      setUser(userData);
      setIsAuthenticated(true);
      await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(userData));
      return { success: true, data };
    }

    return { success: false, data };
  }, []);

  const logout = useCallback(async () => {
    // Always clear local state first — even if server call fails
    setUser(null);
    setIsAuthenticated(false);
    try {
      // Panel subdomain doesn't use /panel/ prefix — it's just /auth/logout/
      await apiPost('/auth/logout/', {});
    } catch (e) {
      // Network failure during logout is fine — session will expire on server
    }
    await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
    await clearAuth();
  }, []);

  const checkSession = useCallback(async () => {
    try {
      const { ok, status } = await apiGet('/app/api/server-info/');
      if (status === 401 || status === 403) {
        setUser(null);
        setIsAuthenticated(false);
        await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
        return false;
      }
      return ok;
    } catch (e) {
      return false;
    }
  }, []);

  const value = {
    user,
    isLoading,
    isAuthenticated,
    login,
    logout,
    checkSession,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
