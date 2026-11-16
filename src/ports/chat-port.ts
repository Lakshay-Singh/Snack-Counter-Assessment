/**
 * Port for the internal chat system.
 * Production: Slack/Teams adapter. Tests: FakeChat.
 */
export interface ChatPort {
  /** Send a message to a specific volunteer */
  sendDM(volunteerId: string, message: string): Promise<void>;

  /** Post to an office's channel */
  postToOfficeChannel(officeId: string, message: string): Promise<void>;
}
