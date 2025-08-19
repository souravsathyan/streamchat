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
      // stop generating text.
      await this.openai.beta.threads.runs.cancel(
        this.openAiThread.id,
        this.run_id
      );
    } catch (error) {
      console.error("", error);
    }
    // Clears the “AI typing indicator” in Stream Chat.
    await this.channel.sendEvent({
      type: "ai_indicator.clear",
      cid: this.message.cid,
      message_id: this.message.id,
    });

    await this.dispose();
  };

  private handleStreamevent = async (
    event: OpenAI.Beta.Assistants.AssistantStreamEvent
  ) => {
    const { cid, id } = this.message;
    // open started run and gives the run id
    if (event.event === "thread.run.created") {
      this.run_id = event.data.id;
    } else if (event.event === "thread.message.delta") {
      // when openai streams the message
      // append text into message, every 1 sec update the message in the stream chat, so user sees the live chat
      const textDelta = event.data.delta.content?.[0];
      if (textDelta?.type === "text" && textDelta.text) {
        this.message.text += textDelta.text.value || "";
        const now = Date.now();
        if (now - this.lastUpdate > 1000) {
          this.chatClient.partialUpdateMessage(id, {
            set: { text: this.message_text },
          });
          this.lastUpdate = now;
        }
        this.chunk_counter += 1;
      }
    } else if (event.event === "thread.message.completed") {
      // when ai finished the generating message, update the stream chat with final message
      this.chatClient.partialUpdateMessage(id, {
        set: {
          text:
            event.data.content[0].type === "text"
              ? event.data.content[0].text.value
              : this.message_text,
        },
      });
      // removes the Ai typing indicator
      this.channel.sendEvent({
        type: "ai_indicator.clear",
        cid: cid,
        message_id: id,
      });
    } else if (event.event === "thread.run.step.created") {
      // when ai is typing , send event to stream that AI is typing
      if (event.data.step_details.type === "message_creation") {
        this.channel.sendEvent({
          type: "ai_indicator.update",
          ai_state: "AI_STATE_GENERATING",
          cid: cid,
          message_id: id,
        });
      }
    }
  };

  run = async () => {
    const { cid, id: message_id } = this.message;
    let isCompleted = false;
    let toolOutputs = [];
    let currentStream: AssistantStream = this.assistantStream;

    try {
      while (!isCompleted) {
        //  listening to the openai srteams
        for await (const event of currentStream) {
          this.handleStreamevent(event);
          // when the AI needs to call tools like web search, and saves the result to toolCalls
          if (
            event.event === "thread.run.requires_action" &&
            event.data.required_action?.type === "submit_tool_outputs"
          ) {
            this.run_id = event.data.id;
            await this.channel.sendEvent({
              type: "ai_indicator.update",
              ai_state: "AI_STATE_CHECKING_SOURCES",
              cid: cid,
              message_id: message_id,
            });
            const toolCalls =
              event.data.required_action.submit_tool_outputs.tool_calls;
            toolOutputs = [];

            for (const toolCall of toolCalls) {
              if (toolCall.function.name === "web_search") {
                try {
                  const args = JSON.parse(toolCall.function.arguments);
                  const searchResult = await this.performWebSearch(args.query);
                  toolOutputs.push({
                    tool_call_id: toolCall.id,
                    output: searchResult,
                  });
                } catch (error) {
                  console.error(
                    "error parsing tool argument or performing web search"
                  );
                  toolOutputs.push({
                    tool_call_id: toolCall.id,
                    otuput: JSON.stringify({ error: "failed to call tool" }),
                  });
                }
              }
            }
            break;
          }

          if (event.event === "thread.run.completed") {
            isCompleted = true;
            break;
          }

          if (event.event === "thread.run.failed") {
            isCompleted = true;
            await this.handleError(
              new Error(event.data.last_error?.message ?? "Run failed")
            );
            break; // Exit the inner loop
          }
        }

        if (isCompleted) {
          break;
        }

        if (toolOutputs.length > 0) {
          currentStream = this.openai.beta.threads.runs.submitToolOutputsStream(
            this.openAiThread.id,
            this.run_id,
            { tool_outputs: toolOutputs }
          );
          toolOutputs = [];
        }
      }
    } catch (error) {
      console.log(error);
      await this.handleError(error as Error);
    } finally {
      await this.dispose();
    }
  };

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
