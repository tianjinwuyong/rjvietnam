import type { FactoryModule } from "../_shared/module";

/**
 * Service — Customer service AI agents (virtual customer service reps).
 * 6 agents: Adrian, Derek, Ryan, Bella, Chloe, Emily.
 * Each has a distinct persona: humor / professional / thoughtful / warm / conversational / empathetic.
 */
export const serviceModule: FactoryModule = {
  key: "service",
  name: "Customer Service Agents",
  owns: ["customer service conversations", "service tickets"],
  routes: [
    {
      method: "GET",
      path: "/service/agents",
      summary: "List all available customer service agent IDs and names",
      requiredPermissions: [],
      public: true,
    },
    {
      method: "POST",
      path: "/service/chat/:agentId",
      summary: "Chat with a specific customer service agent (AI-powered)",
      requiredPermissions: [],
      public: true,
    },
  ],
};
