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

// 요청 생명주기 동안만 유효한 AbortController를 만든다. Express 4의 `req.signal`은
// 요청 본문이 소비된 직후 조기 abort되는 문제가 있어 비동기 작업의 취소 신호로 쓸 수 없다.
// 이 컨트롤러는 실제 클라이언트 단절(`request 'aborted'`) 또는 응답이 끝나기 전 연결이
// 닫힐 때(`response 'close'`)에만 abort한다.
export function createRequestAbortController(request, response) {
  const controller = new AbortController();
  const abort = (message) => {
    if (!controller.signal.aborted) controller.abort(createAbortError(message));
  };

  const handleRequestAborted = () => abort("Client aborted the request.");
  const handleResponseClosed = () => {
    if (!response.writableEnded) abort("Client disconnected before the response completed.");
  };

  request.on("aborted", handleRequestAborted);
  response.on("close", handleResponseClosed);

  return {
    signal: controller.signal,
    cleanup() {
      request.off("aborted", handleRequestAborted);
      response.off("close", handleResponseClosed);
    }
  };
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
