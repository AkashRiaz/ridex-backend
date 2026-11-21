export interface IStartConversationPayload {
  listingId: string;
  body?: string;
  quickReplyKey?: string;
  clientId?: string;
}

export interface ISendMessagePayload {
  body?: string;
  quickReplyKey?: string;
  clientId?: string;
}

export interface ISendImagesPayload {
  clientIds?: string[];
}

export interface IArchiveConversationPayload {
  archived: boolean;
}

export interface IMessagesQuery {
  before?: string;
  limit?: number;
}
