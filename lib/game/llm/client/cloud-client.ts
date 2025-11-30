import { Ollama } from "ollama";
import type {
  ILLMClient,
  LLMChatRequest,
  LLMChatResponse,
} from "./interface.ts";

/**
 * Cloud-based LLM client using Ollama API with authentication
 */
export class CloudLLMClient implements ILLMClient {
  private client: Ollama;
  private host: string;
  private hasApiKey: boolean;

  constructor(config?: {
    host?: string;
    apiKey?: string;
  }) {
    this.host = config?.host || Deno.env.get("OLLAMA_API_URL") ||
      "https://ollama.com";
    const apiKey = config?.apiKey || Deno.env.get("OLLAMA_API_KEY");
    this.hasApiKey = !!apiKey;

    this.client = new Ollama({
      host: this.host,
      headers: apiKey
        ? {
          "Authorization": `Bearer ${apiKey}`,
        }
        : undefined,
    });
  }

  async chat(request: LLMChatRequest): Promise<LLMChatResponse> {
    try {
      const response = await this.client.chat({
        model: request.model,
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
        `API Key configured: ${this.hasApiKey}`,
        `Model: ${request.model}`,
      ].join("\n  ");

      const originalMessage = error instanceof Error
        ? error.message
        : String(error);

      throw new Error(
        `LLM request failed:\n  ${context}\n  Original error: ${originalMessage}`,
      );
    }
  }
}
