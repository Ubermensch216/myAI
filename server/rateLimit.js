function clampInt(raw, fallback, min, max) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function getClientKey(request) {
  return request.ip
    || request.socket?.remoteAddress
    || request.headers?.["x-forwarded-for"]?.split(",")[0]?.trim()
    || "unknown";
}

export function createRateLimiter({
  name,
  windowMs = 60_000,
  max,
  keyPrefix = "",
  skip = () => false
}) {
  const buckets = new Map();
  const limit = Math.max(1, Number(max || 1));
  const windowSize = Math.max(1000, Number(windowMs || 60_000));

  return function rateLimiter(request, response, next) {
    if (skip(request)) {
      next();
      return;
    }

    const now = Date.now();
    const key = `${keyPrefix}${getClientKey(request)}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowSize };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    const remaining = Math.max(0, limit - bucket.count);
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));

    response.setHeader("X-RateLimit-Limit", String(limit));
    response.setHeader("X-RateLimit-Remaining", String(remaining));
    response.setHeader("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > limit) {
      response.setHeader("Retry-After", String(retryAfterSeconds));
      response.status(429).json({
        error: "요청이 너무 많습니다. 잠시 후 다시 시도하세요.",
        rateLimit: {
          name,
          limit,
          retryAfterSeconds
        }
      });
      return;
    }

    if (buckets.size > 5000) cleanupBuckets(buckets, now);
    next();
  };
}

export const rateLimitDefaults = {
  chat: {
    max: clampInt(process.env.RATE_LIMIT_CHAT_PER_MINUTE, 20, 1, 1000),
    windowMs: 60_000
  },
  visualize: {
    max: clampInt(process.env.RATE_LIMIT_VISUALIZE_PER_MINUTE, 10, 1, 1000),
    windowMs: 60_000
  },
  upload: {
    max: clampInt(process.env.RATE_LIMIT_UPLOAD_PER_MINUTE, 8, 1, 1000),
    windowMs: 60_000
  },
  lightweight: {
    max: clampInt(process.env.RATE_LIMIT_LIGHTWEIGHT_PER_MINUTE, 30, 1, 2000),
    windowMs: 60_000
  },
  adminWrite: {
    max: clampInt(process.env.RATE_LIMIT_ADMIN_WRITE_PER_MINUTE, 10, 1, 1000),
    windowMs: 60_000
  }
};

export function getRateLimitConfig() {
  return rateLimitDefaults;
}

function cleanupBuckets(buckets, now) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}
