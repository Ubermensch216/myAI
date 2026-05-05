export function createAbortError(message = "Operation aborted.") {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

export function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : createAbortError();
  }
}

export function isAbortError(error) {
  return error?.name === "AbortError" || error?.code === "ABORT_ERR";
}

export function createLinkedAbortController(parentSignal, timeoutMs = 0, timeoutMessage = "Operation timed out.") {
  const controller = new AbortController();
  let timer = null;

  const abortFromParent = () => {
    if (!controller.signal.aborted) {
      controller.abort(parentSignal?.reason || createAbortError());
    }
  };

  if (parentSignal?.aborted) {
    abortFromParent();
  } else if (parentSignal) {
    parentSignal.addEventListener("abort", abortFromParent, { once: true });
  }

  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      if (!controller.signal.aborted) {
        controller.abort(createAbortError(timeoutMessage));
      }
    }, timeoutMs);
  }

  return {
    signal: controller.signal,
    cleanup() {
      if (timer) clearTimeout(timer);
      if (parentSignal) parentSignal.removeEventListener("abort", abortFromParent);
    }
  };
}
