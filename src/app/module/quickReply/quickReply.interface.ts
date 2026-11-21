export interface ICreateQuickReplyPayload {
  text: string;
}

export interface IUpdateQuickReplyPayload {
  text?: string;
  sortOrder?: number;
}
