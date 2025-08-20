import { Request, Response } from "express";
import { aiAgentCache, pendingAiAgents } from "..";
import { serverClient } from "../serverClient";
import { createAgent } from "../agents/createAgent";
import { AgentPlatform } from "../agents/types";

export const startAiAgent = async (req: Request, res: Response) => {
  const { channel_id, channel_type } = req.body;
  console.log(`[API] /start-ai-agent called for channel: ${channel_id}`);

  if (!channel_id) {
    res.status(400).json({
      error: "Missing required fields",
    });
  }

  const user_id = `ai-bot-${channel_id.replace(/[!]/g, "")}`;

  try {
    if (!aiAgentCache.has(user_id) && !pendingAiAgents.has(user_id)) {
      console.log(`[API] creating new agent for ${user_id}`);

      await serverClient.upsertUser({
        id: user_id,
        name: "AI Writing Assistant",
      });

      const channel = serverClient.channel(channel_type, channel_id);
      await channel.addMembers([user_id]);

      const agent = await createAgent(
        user_id,
        AgentPlatform.GEMINI,
        channel_type,
        channel_id
      );

      await agent.init();

      // Final check to prevent race conditions where an agent might have been added
      // while this one was initializing.
      if (aiAgentCache.has(user_id)) {
        await agent.dispose();
      } else {
        aiAgentCache.set(user_id, agent);
      }
    } else {
      console.log(`AI Agent ${user_id} already started or is pending.`);
    }
    res.json({ message: "AI agent started", data: [] });
  } catch (error) {
    const errorMessage = (error as Error).message;
    console.error("Failed to start AI Agent", errorMessage);
    res
      .status(500)
      .json({ error: "Failed to start AI Agent", reason: errorMessage });
  } finally {
    pendingAiAgents.delete(user_id);
  }
};
