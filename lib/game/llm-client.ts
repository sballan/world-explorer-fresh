import { Ollama } from "ollama";
import type {
  ILLMClient,
  LLMChatRequest,
  LLMChatResponse,
} from "./llm-client-interface.ts";

/**
 * Cloud-based LLM client using Ollama API with authentication
 */
export class CloudLLMClient implements ILLMClient {
  private client: Ollama;

  constructor(config?: {
    host?: string;
    apiKey?: string;
  }) {
    const host = config?.host || Deno.env.get("OLLAMA_API_URL") ||
      "https://ollama.com";
    const apiKey = config?.apiKey || Deno.env.get("OLLAMA_API_KEY");

    this.client = new Ollama({
      host,
      headers: apiKey
        ? {
          "Authorization": `Bearer ${apiKey}`,
        }
        : undefined,
    });
  }

  async chat(request: LLMChatRequest): Promise<LLMChatResponse> {
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
  }
}

/**
 * Local LLM client using Ollama with local models (no API key required)
 */
export class LocalLLMClient implements ILLMClient {
  private client: Ollama;
  private defaultModel: string;

  constructor(config?: {
    host?: string;
    defaultModel?: string;
  }) {
    const host = config?.host || "http://localhost:11434";
    this.defaultModel = config?.defaultModel || "gemma3:4b";

    this.client = new Ollama({
      host,
    });
  }

  async chat(request: LLMChatRequest): Promise<LLMChatResponse> {
    // Override with local model if cloud model is specified
    const model = this.isCloudModel(request.model)
      ? this.defaultModel
      : request.model;

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
  }

  private isCloudModel(model: string): boolean {
    // Cloud models typically have specific patterns
    return model.includes("cloud") || model.includes("gpt-oss");
  }
}
