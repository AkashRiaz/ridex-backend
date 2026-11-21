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

export const startWorker = <T>(
  name: TQueueName,
  processor: Processor<T>,
  concurrency = 5,
) => {
  const worker = new Worker<T>(name, processor, {
    connection: redisClient.duplicate(),
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
