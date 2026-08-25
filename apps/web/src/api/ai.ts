import { apiClient } from "./client";

export interface AiHealth {
  reachable: boolean;
  modelAvailable: boolean;
  models: { name: string; size: number; modified: string }[];
}

export interface AiChatRequest {
  message: string;
  locale?: string;
}

export interface AiChatResponse {
  reply: string;
}

/** Health — no auth required */
export async function getAiHealth(): Promise<AiHealth> {
  return apiClient.get<AiHealth>("/ai/health");
}

/** General AI chat with the factory assistant */
export async function postAiChat(body: AiChatRequest): Promise<AiChatResponse> {
  return apiClient.post<AiChatResponse>("/ai/chat", body);
}
