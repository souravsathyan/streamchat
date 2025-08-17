import OpenAI from "openai";
import type { AssistantStream } from "openai/lib/AssistantStream";
import type { Channel, Event, MessageResponse, StreamChat } from "stream-chat";

export class OpenAiResponseHandler {
  private message_text = ""; //accumlates complete ai response
  private chunk_counter = 0; // track no.of chunks recieved for monitoring and debugging
  private run_id = ""; // unique openai run id for operation
  private isDone = false;
  private lastUpdate = 0;

  constructor(
    private readonly openai: OpenAI,
    private readonly openAiThread: OpenAI.Beta.Threads.Thread,
    private readonly assistantStream: AssistantStream,
    private readonly chatClient: StreamChat,
    private readonly channel: Channel,
    private readonly message: MessageResponse,
    private readonly onDisposal: () => void
  ) {
    this.chatClient.on("ai_indicator.stop", this.handleStopGenerating);
  }

  private handleStopGenerating = async (event: Event) => {
    if (this.isDone || event?.message_id !== this.message.id) {
      return;
    }
    console.log("Stop generating for message", this.message.id);
    if (!this.openai || !this.openAiThread || this.run_id) {
      return;
    }
    try {
      await this.openai.beta.threads.runs.cancel(
        this.run_id,
        this.openAiThread.id,
        {}
      );
    } catch (error) {
      console.error("", error);
    }

    await this.channel.sendEvent({
      type: "ai_indicator.clear",
      cid: this.message.cid,
      message_id: this.message.id,
    });
    await this.dispose;
  };

  run = async () => {};

  dispose = async () => {
    if (this.isDone) {
      return;
    }
    this.isDone = true;
    this.chatClient.off("ai_indicator.stop", this.handleStopGenerating);
    this.onDisposal();
  };

  private handleError = async (error: Error) => {
    if (this.isDone) {
      return;
    }
    await this.channel.sendEvent({
      type: "ai_indicator.update",
      ai_state: "AI_STATE_ERROR",
      cid: this.message.cid,
      message_id: this.message.id,
    });
    await this.chatClient.partialUpdateMessage(this.message.id, {
      set: {
        text: error.message ?? "Error generating the message",
      },
    });

    await this.dispose();
  };

  private performWebSearch = async (query: string): Promise<string> => {
    const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

    if (!TAVILY_API_KEY) {
      return JSON.stringify({
        error: "Web Search is not available, API key not configured",
      });
    }

    try {
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TAVILY_API_KEY}`,
        },
        body: JSON.stringify({
          query: query,
          search_depth: "advanced",
          max_result: 3,
          include_answer: true,
          include_raw_content: true,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.log(`Tavily search failed for the query ${query}`, errorText);
        return JSON.stringify({
          error: `Search failed with status: ${response.status}`,
          details: errorText,
        });
      }

      const data = await response.json();
      console.log(`Tavily search success for query ${query}`);
      return JSON.stringify(data);
    } catch (e) {
      console.log(`An Exception Occured during search for ${query} :`, e);
      return JSON.stringify({
        error: "An error occured during the web search",
      });
    }
  };
}
