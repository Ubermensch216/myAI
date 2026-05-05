/**
 * Validate a batch of embedding vectors.
 *
 * Throws on:
 *   - non-array result
 *   - vector count mismatch with `expectedCount`
 *   - empty / non-array vector
 *   - non-finite element
 *   - inconsistent dim across vectors
 *   - dim mismatch with `expectedDim`
 *
 * Returns { count, dim } on success.
 */
export function validateEmbeddingBatch(vectors, options = {}) {
  const { expectedDim, expectedCount } = options;

  if (!Array.isArray(vectors)) {
    throw new Error("Embeddings result is not an array.");
  }
  if (Number.isFinite(expectedCount) && vectors.length !== expectedCount) {
    throw new Error(
      `Embedding count mismatch: expected ${expectedCount}, got ${vectors.length}.`
    );
  }

  let dim = Number.isFinite(expectedDim) ? expectedDim : null;
  for (let i = 0; i < vectors.length; i += 1) {
    const vec = vectors[i];
    if (!Array.isArray(vec) || vec.length === 0) {
      throw new Error(`Embedding[${i}] is empty or not an array.`);
    }
    if (dim == null) {
      dim = vec.length;
    } else if (vec.length !== dim) {
      throw new Error(
        `Embedding[${i}] dim ${vec.length} does not match expected ${dim}.`
      );
    }
    for (let j = 0; j < vec.length; j += 1) {
      if (!Number.isFinite(vec[j])) {
        throw new Error(`Embedding[${i}][${j}] is not a finite number.`);
      }
    }
  }

  return { count: vectors.length, dim: dim ?? 0 };
}
