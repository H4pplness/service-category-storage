import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { get, post, TOKEN_KEY } from './api';

export interface User {
  id: number;
  username: string;
  fullName: string;
  role: 'ADMIN' | 'USER';
  title?: string;
  departmentId: number | null;
  departmentName: string | null;
  active: boolean;
}

interface AuthCtx {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AuthCtx>(null as any);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const qc = useQueryClient();

  useEffect(() => {
    if (!localStorage.getItem(TOKEN_KEY)) {
      setLoading(false);
      return;
    }
    get<User>('/auth/me')
      .then(setUser)
      .catch(() => localStorage.removeItem(TOKEN_KEY))
      .finally(() => setLoading(false));
  }, []);

  const login = async (username: string, password: string) => {
    const r = await post<{ token: string; user: User }>('/auth/login', { username, password });
    localStorage.setItem(TOKEN_KEY, r.token);
    qc.clear();
    setUser(r.user);
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    qc.clear();
    setUser(null);
  };

  return <Ctx.Provider value={{ user, loading, isAdmin: user?.role === 'ADMIN', login, logout }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
