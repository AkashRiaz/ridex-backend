import { JobsOptions, Processor, Queue, Worker } from "bullmq";
import { config } from "../config";
import { redisClient } from "./redis";

/*
 * BullMQ on the existing Redis (node-redis client, no ioredis).
 * Queues are created lazily so tests and scripts that never enqueue
 * open no extra connections. Workers run in the API process for now
 * and are started from server.ts.
 */

export const QUEUE_NAMES = {
  notificationEmail: "notification-email",
  // delayed domain jobs: offer expiry, test ride expiry and reminders
  scheduled: "scheduled",
  // saved-search alert matching for new and price-dropped listings
  savedSearch: "saved-search",
} as const;

type TQueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

const prefix = `${config.app_name.toLowerCase()}:queue`;

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 30_000 },
  removeOnComplete: 500,
  removeOnFail: 200,
};

const queues = new Map<TQueueName, Queue>();
const workers: Worker[] = [];

export const getQueue = (name: TQueueName) => {
  let queue = queues.get(name);

  if (!queue) {
    queue = new Queue(name, {
      connection: redisClient.duplicate(),
      prefix,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    queue.on("error", (error) =>
      console.error(`Queue "${name}" error:`, error),
    );
    queues.set(name, queue);
  }

  return queue;
};

/*
 * Never throws into the request cycle: a failed enqueue is logged only.
 */
export const enqueueJob = async <T>(
  name: TQueueName,
  jobName: string,
  data: T,
  options: JobsOptions = {},
) => {
  try {
    await getQueue(name).add(jobName, data, options);
  } catch (error) {
    console.error(`Failed to enqueue "${jobName}" on "${name}":`, error);
  }
};

/*
 * Worker connections run with the node-redis command timeout turned off
 * (0 = off). node-redis cancels commands after 5s by default, and a worker
 * keeps its connection busy with long blocking waits for new jobs, so its
 * commands kept hitting that limit: an idle worker logged ~16 "TimeoutError"s
 * per second (1,123 in a 70s test) and retried in a tight loop.
 * With the timeout off: 0 errors in the same test, and jobs are still picked
 * up within a second. BullMQ bounds each wait itself (with a watchdog).
 * Keep this: the queue connection and the app client keep the 5s default.
 */
const createWorkerConnection = () =>
  redisClient.duplicate({ commandOptions: { timeout: 0 } });

export const startWorker = <T>(
  name: TQueueName,
  processor: Processor<T>,
  concurrency = 5,
) => {
  const worker = new Worker<T>(name, processor, {
    connection: createWorkerConnection(),
    prefix,
    concurrency,
  });

  worker.on("failed", (job, error) => {
    console.error(
      `Job "${job?.name}" (${job?.id}) on "${name}" failed:`,
      error.message,
    );
  });
  worker.on("error", (error) =>
    console.error(`Worker "${name}" error:`, error),
  );

  workers.push(worker);

  return worker;
};

export const closeQueues = async () => {
  await Promise.allSettled(workers.map((worker) => worker.close()));
  await Promise.allSettled([...queues.values()].map((queue) => queue.close()));
};
