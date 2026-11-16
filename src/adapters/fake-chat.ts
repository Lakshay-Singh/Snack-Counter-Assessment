/**
 * In-memory fake chat — records all messages for test assertions.
 */

import { ChatPort } from "../ports/chat-port";

export interface ChatMessage {
  to: string;
  message: string;
  timestamp: Date;
  type: "dm" | "channel";
}

export class FakeChat implements ChatPort {
  public readonly messages: ChatMessage[] = [];

  constructor(private clock: () => Date = () => new Date()) {}

  async sendDM(volunteerId: string, message: string): Promise<void> {
    this.messages.push({
      to: volunteerId,
      message,
      timestamp: this.clock(),
      type: "dm",
    });
  }

  async postToOfficeChannel(officeId: string, message: string): Promise<void> {
    this.messages.push({
      to: officeId,
      message,
      timestamp: this.clock(),
      type: "channel",
    });
  }

  /** Test helper: get DMs sent to a specific volunteer */
  dmsSentTo(volunteerId: string): ChatMessage[] {
    return this.messages.filter((m) => m.type === "dm" && m.to === volunteerId);
  }

  /** Test helper: get channel messages for an office */
  channelMessages(officeId: string): ChatMessage[] {
    return this.messages.filter((m) => m.type === "channel" && m.to === officeId);
  }

  clear(): void {
    this.messages.length = 0;
  }
}
