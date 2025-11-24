import { Ollama } from "ollama";
import type {
  ILLMClient,
  LLMChatRequest,
  LLMChatResponse,
} from "./interface.ts";

/**
 * Local LLM client using Ollama with local models (no API key required)
 */
export class LocalLLMClient implements ILLMClient {
  private client: Ollama;
  private host: string;
  private defaultModel: string;

  constructor(config?: {
    host?: string;
    defaultModel?: string;
  }) {
    this.host = config?.host || "http://localhost:11434";
    this.defaultModel = config?.defaultModel || "gemma3:4b";

    this.client = new Ollama({
      host: this.host,
    });
  }

  async chat(request: LLMChatRequest): Promise<LLMChatResponse> {
    // Override with local model if cloud model is specified
    const model = this.isCloudModel(request.model)
      ? this.defaultModel
      : request.model;

    try {
      const response = await this.client.chat({
        model,
        messages: request.messages,
        format: request.format,
      });

      return {
        message: {
          content: response.message.content,
        },
      };
    } catch (error) {
      const context = [
        `Host: ${this.host}`,
        `Model: ${model} (requested: ${request.model})`,
      ].join("\n  ");

      const originalMessage = error instanceof Error
        ? error.message
        : String(error);

      throw new Error(
        `LLM request failed:\n  ${context}\n  Original error: ${originalMessage}`,
      );
    }
  }

  private isCloudModel(model: string): boolean {
    // Cloud models typically have specific patterns
    return model.includes("cloud") || model.includes("gpt-oss");
  }
}
