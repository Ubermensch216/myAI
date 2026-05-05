# myAI RAG Refactoring Plan

## Overview
This document outlines the execution plan for restructuring the myAI RAG system into two distinct architectural profiles:

1. **Personal PC (Lightweight RAG):** Maintains the current JSON body + IndexedDB + BM25/vector/RRF structure. Focuses on browser storage UX, payload control, embedding validation, and small-scale retrieval quality.
2. **Department GPU Workstation (Server RAG):** A robust, multi-user backend utilizing Qdrant for vector search, SQLite FTS5 for lexical indexing, persistent ingestion job queues, GPU concurrency management, and extensive operational logging.

---

## Execution Sprints

### Sprint 1: RAG Profile Separation & Common Safeguards
**Goal:** Separate personal and department RAG execution paths, validate embeddings, and establish basic retrieval logging.

- **Tasks:**
  - Define `RAG_PROFILE` (`personal` vs `department`) or explicit backend configurations in `server/env.js`.
  - Create the `server/rag/` directory structure.
  - Implement `ragConfig.js`, `personalRag.js`, and `departmentRag.js`.
  - Implement `embeddingValidator.js` to strictly verify embedding dimensions and integrity.
  - Implement `retrievalLogger.js` to output JSONL logs (excluding sensitive payload data).
  - Refactor `/api/chat` in `server/ollama.js` to intelligently route requests to the correct RAG profile based on context (documents vs. notebookId).
  - Update `docs/RAG.md` to document the dual profile architecture.

### Sprint 2: Department Qdrant + FTS Index Adapter
**Goal:** Transition the department notebook search from in-memory JSON/LRU caching to persistent vector and lexical indexes.

- **Tasks:**
  - Freeze the target architecture in `docs/DEPARTMENT_RAG_ARCHITECTURE.md`.
  - Extend `ragConfig.js` so `DEPARTMENT_VECTOR_BACKEND=qdrant` is a recognized degraded-safe backend.
  - Implement `server/indexes/qdrantVectorIndex.js` to interface with Qdrant collection `myai_notebook_chunks`.
  - Add Qdrant health/config reporting without making `/api/status` depend on Qdrant availability.
  - Implement `server/indexes/sqliteFtsIndex.js` utilizing FTS5 for lexical and CJK bigram search.
  - Write administrative scripts: `scripts/rebuild-department-rag-index.mjs` and `scripts/check-department-rag-index.mjs`.
  - Update document ingestion (`addNotebookDocument`) and deletion logic in `server/notebooks.js` to synchronize the JSON source-of-truth with the Qdrant and SQLite indexes.
  - Implement a graceful fallback to JSON/BM25 if Qdrant is temporarily unavailable.

**Execution note:** Do this sprint in small units. First land the Qdrant adapter
and fallback boundary. Then add rebuild/check scripts. Only after those pass
should notebook ingest dual-write to Qdrant.

**Progress:**

- Done: architecture doc, Qdrant adapter boundary, SQLite FTS5 lexical adapter,
  status health metadata, Qdrant/SQLite-first JSON-fallback query path,
  `rag:check` / `rag:rebuild`, notebook add/delete dual-write, and department
  Qdrant deployment examples.
- Next: persistent ingest jobs with retry/progress.

### Sprint 3: Department Ingest Job Queue
**Goal:** Transition admin document uploads from synchronous blocking requests to asynchronous, resilient background jobs.

- **Tasks:**
  - Create `server/ingest/notebookIngestJobs.js`.
  - Introduce job API endpoints: `POST /api/notebooks/:id/ingest-jobs`, `GET /api/notebooks/:id/ingest-jobs/:jobId`, etc.
  - Implement batch embedding generation with robust retry logic, accommodating partial ingestion successes.
  - Update the admin UI in `public/modules/notebook.js` to display live progress bars, chunk statuses (embedded/failed), and job retry actions.

**Progress:**

- Done: persisted job records, background ingest runner, and admin job create/list/read endpoints.
- Next: admin UI polling/progress, retry actions, and finer-grained embedding/indexing progress.

### Sprint 4: Multi-User Concurrency & Operations
**Goal:** Guarantee system stability and fair resource allocation under concurrent multi-user access on the department workstation.

- **Tasks:**
  - Implement `server/modelQueue.js` for managing concurrent access to GPU resources (e.g., `embeddingQueue`, `rerankerQueue`, `mapReduceQueue`).
  - Introduce query concurrency limits (fast-path vs. slow-path differentiation).
  - Create the `GET /api/admin/rag/status` endpoint to monitor queue depths and overall index health.
  - Implement API rate-limiting foundations for `/api/chat`.
  - Ensure the existing `AbortController` flows correctly cancel tasks waiting in the model queues to prevent resource leakage.

### Sprint 5: Reranker Integration & Quality Evaluation
**Goal:** Maximize citation precision for the department RAG profile using a cross-encoder reranking stage.

- **Tasks:**
  - Implement `server/rag/reranker.js`.
  - Integrate the reranker into `departmentRag.js`, processing the top 30 candidates from the RRF fusion step to select the final top 8.
  - Implement strict reranker timeout and degraded fallback strategies.
  - Establish a quality evaluation baseline with `fixtures/rag/department-golden.json`.
  - Develop `scripts/rag-quality-test.mjs` to measure Recall@10, MRR@10, and reranker improvement rates.

### Sprint 6: Department Deployment Package
**Goal:** Provide a standardized, reproducible deployment environment for department workstations.

- **Tasks:**
  - Draft `docker-compose.department.yml` for simplified orchestration of the app and Qdrant.
  - Create an example environment file `.env.department.example`.
  - Develop operational scripts: `scripts/backup-department-rag.mjs` and `scripts/restore-department-rag.mjs`.
  - Finalize documentation in `docs/DEPARTMENT_DEPLOYMENT.md`.
