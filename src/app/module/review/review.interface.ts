export interface ICreateReviewPayload {
  listingId: string;
  rating: number;
  comment?: string;
}

export interface IUpdateReviewPayload {
  rating?: number;
  comment?: string;
}

export interface IReplyToReviewPayload {
  reply: string;
}

export interface IReviewVisibilityPayload {
  isHidden: boolean;
  reason?: string;
}

export type TReviewEligibility =
  | { allowed: true }
  | { allowed: false; reason: string; code: TReviewIneligibleCode };

export type TReviewIneligibleCode =
  | "OWN_LISTING"
  | "LISTING_UNAVAILABLE"
  | "UNVERIFIED"
  | "NO_INTERACTION"
  | "ALREADY_REVIEWED";
