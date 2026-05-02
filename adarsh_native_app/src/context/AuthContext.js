import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiPost, apiGet, loadStoredAuth, clearAuth, fetchInitialCsrf } from '../api/client';

const AuthContext = createContext(null);

const AUTH_STORAGE_KEY = 'adarsh_auth_state';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isImpersonating, setIsImpersonating] = useState(false);
  const [originalUser, setOriginalUser] = useState(null);

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

          // Restore impersonation state
          const impState = await AsyncStorage.getItem('adarsh_impersonate_state');
          if (impState) {
            const parsedImp = JSON.parse(impState);
            setIsImpersonating(true);
            setOriginalUser(parsedImp.originalUser || null);
          }

          // Try to refresh user profile from server
          try {
            const { ok, status, data } = await apiGet('/app/api/profile/');
            if (status === 401 || status === 403) {
              // Session expired — auto logout
              setUser(null);
              setIsAuthenticated(false);
              setIsImpersonating(false);
              setOriginalUser(null);
              await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
              await AsyncStorage.removeItem('adarsh_impersonate_state');
              await clearAuth();
            } else if (ok && data?.success) {
              const refreshed = {
                ...parsed,
                name: data.data?.name || parsed.name,
                email: data.data?.email || parsed.email,
                phone: data.data?.phone || parsed.phone || '',
                role: data.data?.role || parsed.role,
                permissions: data.data?.permissions || parsed.permissions || {},
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
        permissions: data.permissions || {},
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
    setIsImpersonating(false);
    setOriginalUser(null);
    try {
      // Panel subdomain doesn't use /panel/ prefix — it's just /auth/logout/
      await apiPost('/auth/logout/', {});
    } catch (e) {
      // Network failure during logout is fine — session will expire on server
    }
    await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
    await AsyncStorage.removeItem('adarsh_impersonate_state');
    await clearAuth();
  }, []);

  const checkSession = useCallback(async () => {
    try {
      // Use profile endpoint — it's accessible to all authenticated roles,
      // unlike server-info which is super_admin only.
      const { ok, status } = await apiGet('/app/api/profile/');
      if (status === 401 || status === 403) {
        setUser(null);
        setIsAuthenticated(false);
        setIsImpersonating(false);
        setOriginalUser(null);
        await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
        await AsyncStorage.removeItem('adarsh_impersonate_state');
        await clearAuth();
        return false;
      }
      return ok;
    } catch (e) {
      return false;
    }
  }, []);

  const startImpersonation = useCallback(async (userId) => {
    try {
      const { data } = await apiPost('/app/api/impersonate/start/', { user_id: userId });
      if (data?.success) {
        // Save original user before switching
        const currentUser = user;
        setOriginalUser(currentUser);
        setIsImpersonating(true);
        await AsyncStorage.setItem('adarsh_impersonate_state', JSON.stringify({ originalUser: currentUser }));

        // Refresh profile to get impersonated user's data
        const { ok, data: profileData } = await apiGet('/app/api/profile/');
        if (ok && profileData?.success) {
          const impUser = {
            email: profileData.data?.email || '',
            name: profileData.data?.name || data.user_name || '',
            role: profileData.data?.role || data.role || '',
            permissions: profileData.data?.permissions || {},
            phone: profileData.data?.phone || '',
            loggedInAt: Date.now(),
          };
          setUser(impUser);
          await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(impUser));
        }
        return { success: true, message: data.message || 'Switched successfully' };
      }
      return { success: false, message: data?.message || 'Failed to switch' };
    } catch (e) {
      return { success: false, message: 'Network error' };
    }
  }, [user]);

  const stopImpersonation = useCallback(async () => {
    try {
      const { data } = await apiPost('/app/api/impersonate/stop/', {});
      if (data?.success) {
        setIsImpersonating(false);
        await AsyncStorage.removeItem('adarsh_impersonate_state');

        // Refresh profile to get original user's data
        const { ok, data: profileData } = await apiGet('/app/api/profile/');
        if (ok && profileData?.success) {
          const restoredUser = {
            email: profileData.data?.email || originalUser?.email || '',
            name: profileData.data?.name || originalUser?.name || '',
            role: profileData.data?.role || originalUser?.role || '',
            permissions: profileData.data?.permissions || originalUser?.permissions || {},
            phone: profileData.data?.phone || originalUser?.phone || '',
            loggedInAt: Date.now(),
          };
          setUser(restoredUser);
          setOriginalUser(null);
          await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(restoredUser));
        } else {
          // Fallback to stored original
          if (originalUser) {
            setUser(originalUser);
            setOriginalUser(null);
            await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(originalUser));
          }
        }
        return { success: true, message: data.message || 'Returned to your account' };
      }
      return { success: false, message: data?.message || 'Failed' };
    } catch (e) {
      return { success: false, message: 'Network error' };
    }
  }, [originalUser]);

  const value = {
    user,
    isLoading,
    isAuthenticated,
    isImpersonating,
    originalUser,
    login,
    logout,
    checkSession,
    startImpersonation,
    stopImpersonation,
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
