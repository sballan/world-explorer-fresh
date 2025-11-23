/**
 * Message type for LLM chat history
 */
export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Request structure for LLM chat
 */
export interface LLMChatRequest {
  model: string;
  messages: LLMMessage[];
  format?: "json";
}

/**
 * Response structure from LLM chat
 */
export interface LLMChatResponse {
  message: {
    content: string;
  };
}

/**
 * Interface for LLM client implementations
 * Supports cloud, local, and mock implementations
 */
export interface ILLMClient {
  /**
   * Send a chat request to the LLM
   */
  chat(request: LLMChatRequest): Promise<LLMChatResponse>;
}
