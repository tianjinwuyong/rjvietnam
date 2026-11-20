import request from './http';

export async function apiGet<T>(url: string, params?: Record<string, any>): Promise<T> {
  const response = await request.get(url, { params });
  return response.data;
}

export async function apiPost<T>(url: string, data?: any): Promise<T> {
  const response = await request.post(url, data);
  return response.data;
}

export async function apiPostFormData<T>(url: string, formData: FormData): Promise<T> {
  const response = await request.post(url, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
}

export async function apiPut<T>(url: string, data?: any): Promise<T> {
  const response = await request.put(url, data);
  return response.data;
}

export async function apiPatch<T>(url: string, data?: any): Promise<T> {
  const response = await request.patch(url, data);
  return response.data;
}

export async function apiDelete<T>(url: string): Promise<T> {
  const response = await request.delete(url);
  return response.data;
}
