import { createContext, useCallback, useContext, useEffect, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Permission } from '@sisurat/shared';
import { api, ApiError, setCsrfToken } from '../../lib/api';
import type { Me } from '../../types/api';

interface AuthState {
  user: Me | null;
  loading: boolean;
  can: (...perms: Permission[]) => boolean;
  login: (username: string, password: string) => Promise<Me>;
  logout: () => Promise<void>;
  refresh: () => Promise<unknown>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        const res = await api.get<{ user: Me; csrfToken: string }>('/auth/me');
        setCsrfToken(res.csrfToken);
        return res.user;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  useEffect(() => {
    const onExpired = () => {
      setCsrfToken(null);
      qc.setQueryData(['me'], null);
    };
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, [qc]);

  /** Drops every cached query except the session itself (clear() would detach the ['me'] observer). */
  const clearUserData = useCallback(() => qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' }), [qc]);

  const loginMutation = useMutation({
    mutationFn: (v: { username: string; password: string }) => api.post<{ user: Me; csrfToken: string }>('/auth/login', v),
  });

  const login = useCallback(
    async (username: string, password: string) => {
      const res = await loginMutation.mutateAsync({ username, password });
      setCsrfToken(res.csrfToken);
      clearUserData();
      qc.setQueryData(['me'], res.user);
      return res.user;
    },
    [loginMutation, qc, clearUserData],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setCsrfToken(null);
      clearUserData();
      qc.setQueryData(['me'], null);
    }
  }, [qc, clearUserData]);

  const user = me.data ?? null;
  const can = useCallback((...perms: Permission[]) => !!user && perms.some((p) => user.permissions.includes(p)), [user]);

  return (
    <AuthContext.Provider value={{ user, loading: me.isLoading, can, login, logout, refresh: me.refetch }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
