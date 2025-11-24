import type {
  ILLMClient,
  LLMChatRequest,
  LLMChatResponse,
} from "./interface.ts";

/**
 * Sequential mock LLM client for testing without network calls
 * Returns responses in sequential order each time chat() is called
 */
export class SequentialMockLLMClient implements ILLMClient {
  private responses: string[];
  private currentIndex: number = 0;
  private defaultResponse: string;

  constructor(config?: {
    responses?: string[];
    defaultResponse?: string;
  }) {
    this.responses = config?.responses || [];
    this.defaultResponse = config?.defaultResponse || "{}";
  }

  chat(_request: LLMChatRequest): Promise<LLMChatResponse> {
    // Return the next response in sequence
    if (this.currentIndex < this.responses.length) {
      const content = this.responses[this.currentIndex];
      this.currentIndex++;
      return Promise.resolve({
        message: {
          content,
        },
      });
    }

    // If we've exhausted the responses, return default
    return Promise.resolve({
      message: {
        content: this.defaultResponse,
      },
    });
  }

  /**
   * Reset the sequence to start from the beginning
   */
  reset(): void {
    this.currentIndex = 0;
  }

  /**
   * Get the current position in the sequence
   */
  getCurrentIndex(): number {
    return this.currentIndex;
  }

  /**
   * Add a response to the end of the sequence
   */
  addResponse(response: string): void {
    this.responses.push(response);
  }

  /**
   * Get the total number of responses configured
   */
  getResponseCount(): number {
    return this.responses.length;
  }
}
