import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from './api';
import { WorkCalendar } from '@shared/sla';

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function useCalendar() {
  const q = useQuery({ queryKey: ['calendar'], queryFn: () => get('/calendar'), staleTime: 60_000 });
  return useMemo(() => (q.data ? new WorkCalendar(q.data) : null), [q.data]);
}

export interface Dept {
  id: number;
  code: string;
  name: string;
  parentId: number | null;
  level: number;
  active: boolean;
  focalUserId: number | null;
  focalUserName: string | null;
  focalUserActive: boolean | null;
}

export const useDepartments = () =>
  useQuery<Dept[]>({ queryKey: ['departments'], queryFn: () => get('/departments'), staleTime: 60_000 });

export const useUsers = (params?: any) =>
  useQuery<any[]>({ queryKey: ['users', params], queryFn: () => get('/users', params), staleTime: 30_000 });

export const useBranches = () => useQuery<any[]>({ queryKey: ['branches'], queryFn: () => get('/branches'), staleTime: 300_000 });
export const useRms = () => useQuery<any[]>({ queryKey: ['rms'], queryFn: () => get('/rms'), staleTime: 300_000 });
export const useProvinces = () => useQuery<any[]>({ queryKey: ['provinces'], queryFn: () => get('/provinces'), staleTime: 300_000 });
export const useWards = () => useQuery<any[]>({ queryKey: ['wards'], queryFn: () => get('/wards'), staleTime: 300_000 });

export const useProducts = () => useQuery<any[]>({ queryKey: ['products'], queryFn: () => get('/products') });
export const useOperations = () => useQuery<any[]>({ queryKey: ['operations'], queryFn: () => get('/operations') });
