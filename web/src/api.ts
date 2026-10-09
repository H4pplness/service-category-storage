import axios from 'axios';
import type { FormInstance } from 'antd';

export const TOKEN_KEY = 'dcms_token';

export const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use((cfg) => {
  const t = localStorage.getItem(TOKEN_KEY);
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401 && !location.pathname.startsWith('/login')) {
      localStorage.removeItem(TOKEN_KEY);
      location.href = '/login';
    }
    return Promise.reject(err);
  },
);

export const get = <T = any>(url: string, params?: any) => api.get<T>(url, { params }).then((r) => r.data);
export const post = <T = any>(url: string, body?: any) => api.post<T>(url, body).then((r) => r.data);
export const put = <T = any>(url: string, body?: any) => api.put<T>(url, body).then((r) => r.data);
export const del = <T = any>(url: string) => api.delete<T>(url).then((r) => r.data);

export function uploadFiles(url: string, files: File[]) {
  const fd = new FormData();
  files.forEach((f) => fd.append('files', f, f.name));
  return api.post(url, fd).then((r) => r.data);
}

export function errMsg(e: any): string {
  return e?.response?.data?.message || e?.message || 'Có lỗi xảy ra';
}

export function fieldErrors(e: any): Record<string, string> {
  return e?.response?.data?.fieldErrors || {};
}

/** Đẩy lỗi theo trường từ server vào antd Form (trường động có tiền tố "dyn."). */
export function applyFieldErrors(form: FormInstance, e: any): boolean {
  const fe = fieldErrors(e);
  const entries = Object.entries(fe);
  if (!entries.length) return false;
  form.setFields(
    entries.map(([name, msg]) => ({
      name: name.startsWith('dyn.') ? ['dyn', name.slice(4)] : name,
      errors: [msg],
    })),
  );
  const first = entries[0][0];
  form.scrollToField(first.startsWith('dyn.') ? ['dyn', first.slice(4)] : first, { block: 'center' });
  return true;
}

export function downloadUrl(id: number, inline = false) {
  const t = localStorage.getItem(TOKEN_KEY) || '';
  return `/api/attachments/${id}/download?token=${encodeURIComponent(t)}${inline ? '&inline=1' : ''}`;
}
