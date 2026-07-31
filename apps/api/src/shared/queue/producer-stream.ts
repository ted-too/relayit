import type { RedisClient } from "bun";
import { type Consumer, createConsumer } from "./consumer";
import { createProducer, type Producer } from "./producer";
import { createReclaimer, type Reclaimer } from "./reclaimer";
import { createScheduler, type Scheduler } from "./scheduler";
import type { StreamConfig } from "./types";

export type ProducerStream<T> = Producer<T> & Scheduler<T>;

export type WorkerStream<T> = Producer<T> &
  Scheduler<T> &
  Consumer<T> &
  Reclaimer<T>;

export function createProducerStream<T>(
  redis: RedisClient,
  config: StreamConfig<T> & { scheduleKey: string }
): ProducerStream<T> {
  const stream = createProducer(redis, config) as ProducerStream<T>;
  Object.assign(stream, createScheduler(redis, config));
  return stream;
}

export function createWorkerStream<T>(
  redis: RedisClient,
  config: StreamConfig<T> & { group: string; scheduleKey: string },
  consumer: string
): WorkerStream<T> {
  const stream = createProducerStream(redis, config) as WorkerStream<T>;
  Object.assign(
    stream,
    createConsumer(redis, config, { group: config.group, consumer })
  );
  Object.assign(
    stream,
    createReclaimer(redis, config, { group: config.group, consumer })
  );
  return stream;
}
