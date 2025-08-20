import cors from "cors";
import "dotenv/config";
import express from "express";
import AgentsRoutes from "./routes";
import { AIAgent } from "./agents/types";
import { disposeAiAgent } from "./utils/disposeAgent";

const app = express();
app.use(express.json());
app.use(cors({ origin: "*" }));

export const aiAgentCache = new Map<string, AIAgent>();
export const pendingAiAgents = new Set<string>();

const inactivityThreshold = 480 * 60 * 1000;

setInterval(async () => {
  const now = Date.now();
  for (const [userId, aiAgent] of aiAgentCache) {
    if (now - aiAgent.getLastInteraction() > inactivityThreshold) {
      console.log(`Disposing AI Agent due to inactivity: ${userId}`);
      await disposeAiAgent(aiAgent);
      aiAgentCache.delete(userId);
    }
  }
}, 5000);

app.use("/", AgentsRoutes);

const port = process.env.PORT || "3000";

app.listen(port, () => {
  console.log(`Server running in PORT: ${port}`);
});
