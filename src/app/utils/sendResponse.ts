import { Response } from "express";

// standard pagination meta; modules may add extras (e.g. statusCounts)
type TPageMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  [key: string]: unknown;
};

// cursor pagination (chat messages): page numbers break while new rows keep arriving
type TCursorMeta = {
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
};

type TMeta = TPageMeta | TCursorMeta;

type TResponseData<T> = {
  success: boolean;
  statusCode: number;
  message: string;
  data?: T;
  meta?: TMeta;
};

export const sendResponse = <T>(res: Response, data: TResponseData<T>) => {
  res.status(data.statusCode).json({
    success: data.success,
    statusCode: data.statusCode,
    message: data.message,
    data: data.data,
    meta: data.meta,
  });
};
