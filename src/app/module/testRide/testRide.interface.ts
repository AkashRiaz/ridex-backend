import { TReminderKind } from "./testRide.utils";

export interface IAvailabilityRulePayload {
  listingId?: string | null;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  slotMinutes: number;
  capacity: number;
}

export interface IReplaceAvailabilityPayload {
  rules: IAvailabilityRulePayload[];
}

export interface ICreateBlockedDatePayload {
  // local "YYYY-MM-DD"
  date: string;
  reason?: string;
}

export interface ISlotsQuery {
  listingId: string;
  from?: string;
  to?: string;
}

export interface ICreateTestRidePayload {
  listingId: string;
  startsAt: Date;
  note?: string;
}

export interface IConfirmTestRidePayload {
  note?: string;
}

export interface IDeclineTestRidePayload {
  reason: string;
}

export interface ICancelTestRidePayload {
  reason: string;
}

// BullMQ "scheduled" queue payloads
export interface ITestRideExpireJob {
  testRideId: string;
}

export interface ITestRideReminderJob {
  testRideId: string;
  kind: TReminderKind;
}

// what other modules (events, notifications) get about a test ride
export interface ITestRideRef {
  testRideId: string;
  conversationId: string;
  listingId: string;
  listingTitle: string;
  buyerId: string;
  sellerId: string;
  startsAt: Date;
}
