import type { Locale } from "../../../../packages/shared-types/src/factory";
import { apiClient, authStorage } from "./client";

export interface LoginResult {
  token: string;
  user: {
    id: number;
    username: string;
    displayName: string;
    locale: Locale;
    roleKey: string;
    permissions: string[];
  };
  expiresAt: string;
}

export interface SessionResult {
  session: unknown;
  permissions: string[];
}

export const authApi = {
  async login(username: string, password: string): Promise<LoginResult> {
    const result = await apiClient.post<LoginResult>("/auth/login", { username, password });
    authStorage.setToken(result.token);
    return result;
  },

  async logout(): Promise<void> {
    try {
      await apiClient.post("/auth/logout");
    } finally {
      authStorage.clearToken();
    }
  },

  async getSession(): Promise<SessionResult> {
    return apiClient.get<SessionResult>("/auth/session");
  },

  isLoggedIn(): boolean {
    return authStorage.getToken() !== null;
  },
};