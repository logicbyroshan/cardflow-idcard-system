import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiPost, apiGet, loadStoredAuth, clearAuth, fetchInitialCsrf } from '../api/client';

const AuthContext = createContext(null);

const AUTH_STORAGE_KEY = 'adarsh_auth_state';

const enrichUser = (userObj) => {
  if (!userObj) return null;
  const r = userObj.role || '';
  return {
    ...userObj,
    isSuperAdmin: ['super_admin', 'pro_user'].includes(r),
    isOperator: r === 'admin_staff',
    isAdmin: ['super_admin', 'pro_user', 'admin_staff'].includes(r),
    isClient: r === 'client' || r === 'guest_user',
    isAssistant: r === 'client_staff',
  };
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isImpersonating, setIsImpersonating] = useState(false);
  const [originalUser, setOriginalUser] = useState(null);
  const [isAppUnlocked, setIsAppUnlocked] = useState(false);
  const [isMpinCreated, setIsMpinCreated] = useState(false);
  const [isSilentAuthFailed, setIsSilentAuthFailed] = useState(false);
  const [isSessionKicked, setIsSessionKicked] = useState(false);

  const refreshProfile = useCallback(async () => {
    try {
      const { ok, status, data } = await apiGet('/api/mobile/profile/');
      if (status === 401 || status === 403) {
        // If session expired on backend but profile is stored, do NOT perform a hard logout.
        // Simply lock the app (so they enter MPIN or password to trigger re-login).
        const stored = await AsyncStorage.getItem(AUTH_STORAGE_KEY);
        const credentials = await AsyncStorage.getItem('adarsh_user_credentials');
        if (stored) {
          setIsAppUnlocked(false); // Force lock
          if (!credentials) {
            setIsSilentAuthFailed(true);
          }
        } else {
          setUser(null);
          setIsAuthenticated(false);
          setIsImpersonating(false);
          setOriginalUser(null);
          setIsAppUnlocked(false);
          setIsMpinCreated(false);
          setIsSilentAuthFailed(false);
          await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
          await clearAuth();
        }
      } else if (ok && data?.success) {
        setUser(prev => {
          const base = prev || {};
          const role = data.data?.role || base.role || '';
          const refreshed = enrichUser({
            ...base,
            name: data.data?.name || base.name || '',
            email: data.data?.email || base.email || '',
            phone: data.data?.phone || base.phone || '',
            role: role,
            client_id: data.data?.client_id || base.client_id,
            can_manage_clients: typeof data.data?.can_manage_clients === 'boolean' ? data.data.can_manage_clients : !!base.can_manage_clients,
            can_manage_staff: typeof data.data?.can_manage_staff === 'boolean' ? data.data.can_manage_staff : !!base.can_manage_staff,
            permissions: data.data?.permissions || base.permissions || {},
          });
          AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(refreshed)).catch(() => {});
          return refreshed;
        });
      }
    } catch (e) {
      console.log('Profile refresh failed', e);
    }
  }, []);

  // Safety: Force loading false after 5 seconds if it gets stuck
  useEffect(() => {
    const timer = setTimeout(() => {
      if (isLoading) {
        console.log('[Auth] Safety trigger: forcing isLoading false');
        setIsLoading(false);
      }
    }, 5000);
    return () => clearTimeout(timer);
  }, [isLoading]);

  // Load stored auth on mount + setup foreground sync
  useEffect(() => {
    (async () => {
      try {
        const kicked = await AsyncStorage.getItem('adarsh_session_kicked');
        if (kicked === 'true') {
          setIsSessionKicked(true);
        }
        await loadStoredAuth();
        const stored = await AsyncStorage.getItem(AUTH_STORAGE_KEY);
        if (stored) {
          const parsed = enrichUser(JSON.parse(stored));
          setUser(parsed);
          setIsAuthenticated(true);
          
          // Check if MPIN is set for this user
          const mpin = await AsyncStorage.getItem(`adarsh_mpin_${parsed.email.toLowerCase()}`);
          if (mpin) {
            setIsMpinCreated(true);
            setIsAppUnlocked(false); // Must unlock on fresh app open
          } else {
            setIsMpinCreated(false);
            setIsAppUnlocked(false); // Must create MPIN
          }
          
          // Restore impersonation state
          const impState = await AsyncStorage.getItem('adarsh_impersonate_state');
          if (impState) {
            const parsedImp = JSON.parse(impState);
            setIsImpersonating(true);
            setOriginalUser(parsedImp.originalUser || null);
          }

          // Initial background sync
          refreshProfile();
        }
      } catch (e) {
        console.log('[Auth] Init failed', e);
      } finally {
        console.log('[Auth] Initial loading finished');
        setIsLoading(false);
      }
    })();

    // Foreground sync listener
    const { AppState } = require('react-native');
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        refreshProfile();
      }
    });
    return () => subscription.remove();
  }, [refreshProfile]);

  const login = useCallback(async (email, password, forceLogoutOther = false) => {
    // Ensure we have a CSRF token
    await fetchInitialCsrf();

    const body = { email, password };
    if (forceLogoutOther) body.force_logout_other = true;

    const { ok, data } = await apiPost('/api/mobile/auth/login/', body);

    if (data.success) {
      const u = data.user || {};
      const userData = enrichUser({
        email,
        name: u.full_name || u.name || data.user_name || data.name || email,
        role: u.role || data.role || '',
        client_id: u.client_id || data.client_id,
        phone: u.phone || data.phone || '',
        can_manage_clients: !!data.can_manage_clients,
        can_manage_staff: !!data.can_manage_staff,
        permissions: data.permissions || {},
        loggedInAt: Date.now(),
      });
      setUser(userData);
      setIsAuthenticated(true);
      await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(userData));

      // Save user credentials for background session renewal
      await AsyncStorage.setItem('adarsh_user_credentials', JSON.stringify({ email, password }));

      // Check if MPIN is set for this user
      const mpin = await AsyncStorage.getItem(`adarsh_mpin_${email.toLowerCase()}`);
      if (mpin) {
        setIsMpinCreated(true);
        setIsAppUnlocked(true); // Logged in with password, unlock app
      } else {
        setIsMpinCreated(false);
        setIsAppUnlocked(false); // Force them to set MPIN
      }

      return { success: true, data };
    }

    return { success: false, data };
  }, []);

  const startImpersonation = useCallback(async (userId) => {
    try {
      const { data } = await apiPost('/api/mobile/impersonate/start/', { user_id: userId });
      if (data?.success) {
        // Save original user before switching
        const currentUser = user;
        setOriginalUser(currentUser);
        setIsImpersonating(true);
        await AsyncStorage.setItem('adarsh_impersonate_state', JSON.stringify({ originalUser: currentUser }));

        // Refresh profile to get impersonated user's data
        const { ok, data: profileData } = await apiGet('/api/mobile/profile/');
        if (ok && profileData?.success) {
          const impUser = enrichUser({
            email: profileData.data?.email || '',
            name: profileData.data?.name || data.user_name || '',
            role: profileData.data?.role || data.role || '',
            permissions: profileData.data?.permissions || {},
            phone: profileData.data?.phone || '',
            loggedInAt: Date.now(),
          });
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
      const { data } = await apiPost('/api/mobile/impersonate/stop/', {});
      if (data?.success) {
        setIsImpersonating(false);
        await AsyncStorage.removeItem('adarsh_impersonate_state');

        // Refresh profile to get original user's data
        const { ok, data: profileData } = await apiGet('/api/mobile/profile/');
        if (ok && profileData?.success) {
          const restoredUser = enrichUser({
            email: profileData.data?.email || originalUser?.email || '',
            name: profileData.data?.name || originalUser?.name || '',
            role: profileData.data?.role || originalUser?.role || '',
            permissions: profileData.data?.permissions || originalUser?.permissions || {},
            phone: profileData.data?.phone || originalUser?.phone || '',
            loggedInAt: Date.now(),
          });
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

  const createMpin = useCallback(async (newMpin) => {
    if (!user?.email) return false;
    const emailKey = user.email.toLowerCase();
    await AsyncStorage.setItem(`adarsh_mpin_${emailKey}`, newMpin);
    setIsMpinCreated(true);
    setIsAppUnlocked(true);
    return true;
  }, [user]);

  const verifyMpin = useCallback(async (enteredMpin) => {
    if (!user?.email) return false;
    const emailKey = user.email.toLowerCase();
    const stored = await AsyncStorage.getItem(`adarsh_mpin_${emailKey}`);
    if (stored === enteredMpin) {
      setIsAppUnlocked(true);
      setIsSilentAuthFailed(false);

      // Silently renew backend session in background
      (async () => {
        try {
          const credsStr = await AsyncStorage.getItem('adarsh_user_credentials');
          if (credsStr) {
            const { email, password } = JSON.parse(credsStr);
            const res = await login(email, password);
            if (!res.success) {
              setIsSilentAuthFailed(true);
              setIsAppUnlocked(false); // Relock if password invalid
            }
          } else {
            setIsSilentAuthFailed(true);
            setIsAppUnlocked(false); // Relock if no credentials stored
          }
        } catch (e) {
          console.log('[Auth] Background login renewal failed', e);
        }
      })();

      return true;
    }
    return false;
  }, [user, login]);

  const changeMpin = useCallback(async (oldMpin, newMpin) => {
    if (!user?.email) return false;
    const emailKey = user.email.toLowerCase();
    const stored = await AsyncStorage.getItem(`adarsh_mpin_${emailKey}`);
    if (stored === oldMpin) {
      await AsyncStorage.setItem(`adarsh_mpin_${emailKey}`, newMpin);
      return true;
    }
    return false;
  }, [user]);

  const forgotMpin = useCallback(async () => {
    const email = user?.email;
    if (email) {
      await AsyncStorage.removeItem(`adarsh_mpin_${email.toLowerCase()}`);
    }
    await logout();
  }, [user, logout]);

  const resetMpinWithPassword = useCallback(async (password) => {
    if (!user?.email) return { success: false, error: 'No user email found' };
    const email = user.email;
    const result = await login(email, password);
    if (result.success) {
      const emailKey = email.toLowerCase();
      await AsyncStorage.removeItem(`adarsh_mpin_${emailKey}`);
      setIsMpinCreated(false);
      setIsAppUnlocked(false);
      return { success: true };
    }
    return { success: false, error: result.data?.message || 'Invalid password' };
  }, [user, login]);

  const logout = useCallback(async () => {
    if (isImpersonating) {
      const res = await stopImpersonation();
      return res;
    }

    // Always clear local state first — even if server call fails
    setUser(null);
    setIsAuthenticated(false);
    setIsImpersonating(false);
    setOriginalUser(null);
    setIsAppUnlocked(false);
    setIsMpinCreated(false);
    setIsSilentAuthFailed(false);
    try {
      // Standard logout endpoint
      await apiPost('/api/mobile/auth/logout/', {});
    } catch (e) {
      // Network failure during logout is fine — session will expire on server
    }
    await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
    await AsyncStorage.removeItem('adarsh_impersonate_state');
    await AsyncStorage.removeItem('adarsh_csrf_token');
    await AsyncStorage.removeItem('adarsh_cookies');
    await AsyncStorage.removeItem('adarsh_user_credentials');
    await clearAuth();
  }, [isImpersonating, stopImpersonation]);

  const checkSession = useCallback(async () => {
    try {
      const { ok, status } = await apiGet('/api/mobile/profile/');
      if (status === 401 || status === 403) {
        setUser(null);
        setIsAuthenticated(false);
        setIsImpersonating(false);
        setOriginalUser(null);
        setIsAppUnlocked(false);
        setIsMpinCreated(false);
        setIsSilentAuthFailed(false);
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

  const handleSessionKicked = useCallback(async () => {
    setUser(null);
    setIsAuthenticated(false);
    setIsImpersonating(false);
    setOriginalUser(null);
    setIsAppUnlocked(false);
    setIsMpinCreated(false);
    setIsSilentAuthFailed(false);
    setIsSessionKicked(true);

    await AsyncStorage.setItem('adarsh_session_kicked', 'true');
    await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
    await AsyncStorage.removeItem('adarsh_impersonate_state');
    await AsyncStorage.removeItem('adarsh_csrf_token');
    await AsyncStorage.removeItem('adarsh_cookies');
    await AsyncStorage.removeItem('adarsh_user_credentials');
    await clearAuth();
  }, []);

  useEffect(() => {
    const { registerSessionKickedCallback } = require('../api/client');
    registerSessionKickedCallback(handleSessionKicked);
    return () => {
      registerSessionKickedCallback(null);
    };
  }, [handleSessionKicked]);

  const resolveKicked = useCallback(async () => {
    setIsSessionKicked(false);
    await AsyncStorage.removeItem('adarsh_session_kicked');
  }, []);

  const value = {
    user,
    isLoading,
    isAuthenticated,
    isImpersonating,
    originalUser,
    isAppUnlocked,
    isMpinCreated,
    isSilentAuthFailed,
    isSessionKicked,
    setIsSilentAuthFailed,
    setIsAppUnlocked,
    login,
    logout,
    checkSession,
    refreshProfile,
    startImpersonation,
    stopImpersonation,
    createMpin,
    verifyMpin,
    changeMpin,
    forgotMpin,
    resetMpinWithPassword,
    resolveKicked,
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
