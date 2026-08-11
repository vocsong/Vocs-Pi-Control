/**
 * Maps normalized PiDriverEvents to protocol EventEnvelopeInits.
 *
 * Used by BOTH sides of the pipeline so the mapping lives in exactly one
 * place: the workspace agent (real Pi sessions) and the control server
 * (mock sessions, and re-publishing agent events to browsers).
 */

import {
  EVENT_TYPES,
  type EventEnvelopeInit,
} from "@pi-control/protocol";
import type { PiDriverEvent } from "./index.js";

export function driverEventToEnvelope(sessionId: string, event: PiDriverEvent): EventEnvelopeInit {
  const base = { scope: "session" as const, sessionId };
  switch (event.type) {
    case "user.message":
      return {
        ...base,
        type: EVENT_TYPES.userMessage,
        payload: { sessionId, messageId: event.messageId, content: event.content, createdAt: event.createdAt },
      };
    case "assistant.start":
    case "assistant.end":
      return { ...base, type: event.type, payload: { sessionId, messageId: event.messageId } };
    case "assistant.delta":
    case "thinking.delta":
      return { ...base, type: event.type, payload: { sessionId, messageId: event.messageId, content: event.text } };
    case "thinking.start":
    case "thinking.end":
      return { ...base, type: event.type, payload: { sessionId, messageId: event.messageId } };
    case "tool.start":
      return {
        ...base,
        type: EVENT_TYPES.toolStart,
        payload: { sessionId, toolCallId: event.toolCallId, name: event.name, input: event.input },
      };
    case "tool.update":
      return { ...base, type: EVENT_TYPES.toolUpdate, payload: { sessionId, toolCallId: event.toolCallId, output: event.output } };
    case "tool.end":
      return {
        ...base,
        type: EVENT_TYPES.toolEnd,
        payload: { sessionId, toolCallId: event.toolCallId, output: event.output, durationMs: event.durationMs },
      };
    case "tool.error":
      return { ...base, type: EVENT_TYPES.toolError, payload: { sessionId, toolCallId: event.toolCallId, error: event.error } };
    case "state":
      return { ...base, type: EVENT_TYPES.sessionState, payload: { sessionId, status: event.status } };
    case "model.updated":
      return { ...base, type: EVENT_TYPES.modelUpdated, payload: { sessionId, model: event.model } };
    case "usage.updated":
      return { ...base, type: EVENT_TYPES.usageUpdated, payload: { sessionId, usage: event.usage } };
    case "error":
      return { ...base, type: EVENT_TYPES.sessionError, payload: { sessionId, message: event.message } };
    case "closed":
      return { ...base, type: EVENT_TYPES.sessionClosed, payload: { sessionId, reason: event.reason } };
  }
}
