import express from "express";
import { startAiAgent } from "../controller/start-ai-agent";
import { getAgentStatus } from "../controller/agent-status";
import { createToken } from "../controller/token";

const AgentsRoutes = express.Router();

AgentsRoutes.get("/agent-status", getAgentStatus);

AgentsRoutes.post("/start-ai-agent", startAiAgent);
AgentsRoutes.post("/stop-ai-agent", getAgentStatus);
AgentsRoutes.post("/token", createToken);

export default AgentsRoutes;
