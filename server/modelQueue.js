import { createAbortError } from "./abort.js";

function clampInt(raw, fallback, min, max) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

class ModelQueue {
  constructor({ name, concurrency, maxQueued }) {
    this.name = name;
    this.concurrency = concurrency;
    this.maxQueued = maxQueued;
    this.running = 0;
    this.queue = [];
    this.completed = 0;
    this.rejected = 0;
  }

  async run(task, { signal, label = "task" } = {}) {
    if (typeof task !== "function") {
      throw new Error(`Queue ${this.name} requires a task function.`);
    }
    if (signal?.aborted) throw signal.reason || createAbortError(`${this.name}:${label} aborted before queueing.`);
    if (this.running < this.concurrency) {
      return this.start(task);
    }
    if (this.queue.length >= this.maxQueued) {
      this.rejected += 1;
      throw new Error(`${this.name} queue is full. Try again shortly.`);
    }

    return new Promise((resolve, reject) => {
      const item = { task, resolve, reject, signal, label, enqueuedAt: Date.now(), abortHandler: null };
      item.abortHandler = () => {
        this.removeQueued(item);
        reject(signal.reason || createAbortError(`${this.name}:${label} aborted while queued.`));
      };
      signal?.addEventListener("abort", item.abortHandler, { once: true });
      this.queue.push(item);
      this.drain();
    });
  }

  stats() {
    return {
      name: this.name,
      concurrency: this.concurrency,
      running: this.running,
      queued: this.queue.length,
      maxQueued: this.maxQueued,
      completed: this.completed,
      rejected: this.rejected
    };
  }

  async start(task) {
    this.running += 1;
    try {
      return await task();
    } finally {
      this.running -= 1;
      this.completed += 1;
      this.drain();
    }
  }

  drain() {
    while (this.running < this.concurrency && this.queue.length) {
      const item = this.queue.shift();
      item.signal?.removeEventListener("abort", item.abortHandler);
      if (item.signal?.aborted) {
        item.reject(item.signal.reason || createAbortError(`${this.name}:${item.label} aborted while queued.`));
        continue;
      }
      this.start(item.task).then(item.resolve, item.reject);
    }
  }

  removeQueued(item) {
    const index = this.queue.indexOf(item);
    if (index >= 0) this.queue.splice(index, 1);
    item.signal?.removeEventListener("abort", item.abortHandler);
  }
}

export const embeddingQueue = new ModelQueue({
  name: "embedding",
  concurrency: clampInt(process.env.EMBED_QUEUE_CONCURRENCY, 2, 1, 16),
  maxQueued: clampInt(process.env.EMBED_QUEUE_MAX_QUEUED, 64, 1, 1000)
});

export const mapReduceQueue = new ModelQueue({
  name: "map_reduce",
  concurrency: clampInt(process.env.MAP_REDUCE_QUEUE_CONCURRENCY, 2, 1, 16),
  maxQueued: clampInt(process.env.MAP_REDUCE_QUEUE_MAX_QUEUED, 32, 1, 1000)
});

export const analysisQueue = new ModelQueue({
  name: "analysis",
  concurrency: clampInt(process.env.ANALYSIS_QUEUE_CONCURRENCY, 2, 1, 16),
  maxQueued: clampInt(process.env.ANALYSIS_QUEUE_MAX_QUEUED, 32, 1, 1000)
});

export const chatQueue = new ModelQueue({
  name: "chat",
  concurrency: clampInt(process.env.CHAT_QUEUE_CONCURRENCY, 4, 1, 64),
  maxQueued: clampInt(process.env.CHAT_QUEUE_MAX_QUEUED, 32, 1, 1000)
});

export const rerankQueue = new ModelQueue({
  name: "rerank",
  concurrency: clampInt(process.env.RERANK_QUEUE_CONCURRENCY, 1, 1, 8),
  maxQueued: clampInt(process.env.RERANK_QUEUE_MAX_QUEUED, 16, 1, 256)
});

// Image generation runs on a separate GPU runtime; keep it off the text queues
// and default to concurrency 1 to protect VRAM.
export const imageQueue = new ModelQueue({
  name: "image",
  concurrency: clampInt(process.env.IMAGE_QUEUE_CONCURRENCY, 1, 1, 4),
  maxQueued: clampInt(process.env.IMAGE_QUEUE_MAX_QUEUED, 16, 1, 256)
});

export function isChatQueueEnabled() {
  return String(process.env.CHAT_QUEUE_ENABLED || "false").toLowerCase() === "true";
}

export function getModelQueueStats() {
  return {
    chat: {
      ...chatQueue.stats(),
      enabled: isChatQueueEnabled()
    },
    embedding: embeddingQueue.stats(),
    mapReduce: mapReduceQueue.stats(),
    analysis: analysisQueue.stats(),
    rerank: rerankQueue.stats(),
    image: imageQueue.stats()
  };
}
