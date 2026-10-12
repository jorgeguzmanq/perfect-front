/** El prompt vive en comment-storage (lo comparten la CLI y el servidor local); se reexporta aquí. */
export { buildAgentPrompt, buildInboxPrompt, formatPromptBlock, PROMPT_BEGIN, PROMPT_END } from "@perfect-front/comment-storage";
export type { AgentPromptContext, InboxPromptInfo } from "@perfect-front/comment-storage";
