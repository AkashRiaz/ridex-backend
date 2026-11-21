import { Job } from "bullmq";
import { QUEUE_NAMES, startWorker } from "../lib/queue";
import { IOfferExpireJob } from "../module/offer/offer.interface";
import { OfferService } from "../module/offer/offer.service";
import {
  ITestRideExpireJob,
  ITestRideReminderJob,
} from "../module/testRide/testRide.interface";
import { TestRideService } from "../module/testRide/testRide.service";

/*
 * scheduled queue (delayed domain jobs):
 *   "offer-expire"        at Offer.expiresAt
 *   "test-ride-expire"    at TestRide.startsAt (request never confirmed)
 *   "test-ride-reminder"  24h and 2h before a confirmed ride
 * Every job re-checks the current state, so a late or repeated run is harmless.
 */

export const processScheduledJob = async (job: Job) => {
  if (job.name === "offer-expire") {
    const { offerId } = job.data as IOfferExpireJob;
    const expired = await OfferService.expireOffer(offerId);

    return expired ? "expired" : "skipped: no longer open";
  }

  if (job.name === "test-ride-expire") {
    const { testRideId } = job.data as ITestRideExpireJob;
    const expired = await TestRideService.expireTestRide(testRideId);

    return expired ? "expired" : "skipped: no longer requested";
  }

  if (job.name === "test-ride-reminder") {
    const { testRideId, kind } = job.data as ITestRideReminderJob;
    const sent = await TestRideService.sendTestRideReminder(testRideId, kind);

    return sent ? `reminded (${kind})` : "skipped: not confirmed or started";
  }

  return `skipped: unknown job ${job.name}`;
};

export const startScheduledWorker = () =>
  startWorker(QUEUE_NAMES.scheduled, processScheduledJob, 5);
