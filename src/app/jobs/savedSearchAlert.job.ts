import { Job } from "bullmq";
import { QUEUE_NAMES, startWorker } from "../lib/queue";
import { ISavedSearchMatchJob } from "../module/savedSearch/savedSearch.interface";
import { SavedSearchService } from "../module/savedSearch/savedSearch.service";

/*
 * saved-search queue:
 *   "match-listing"  a listing went live or dropped its price → find matching saved searches
 * The job re-reads the listing, so a late run for a listing that was sold meanwhile does nothing.
 */
export const processSavedSearchJob = async (job: Job) => {
  if (job.name === "match-listing") {
    const matched = await SavedSearchService.matchListing(
      job.data as ISavedSearchMatchJob,
    );

    return `matched ${matched} saved search(es)`;
  }

  return `skipped: unknown job ${job.name}`;
};

// low concurrency: one job can run many search queries
export const startSavedSearchWorker = () =>
  startWorker(QUEUE_NAMES.savedSearch, processSavedSearchJob, 2);
