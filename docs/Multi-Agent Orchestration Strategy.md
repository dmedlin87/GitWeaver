# **Multi-Agent Orchestration Strategy & Routing Architecture**

## **1\. Architectural Philosophy**

The GitWeaver orchestration model operates on the principles of **semantic compression**, **context pruning**, and **absolute verification**. Human inputs are inherently non-deterministic and prone to scope creep. To prevent prompt drift, hallucinations, and broken builds, GitWeaver does not rely on a monolithic model or a single bloated conversation window.

Instead, the system enforces a strict separation of concerns, routing tasks to specific models based on their absolute comparative advantages.

* **Conversational Isolation:** The architecture absorbs conversational ambiguity at the edge (frontend) and maintains strict, programmatic determinism in the core (backend).  
* **Resource Optimization:** Expensive, high-reasoning models are reserved exclusively for architectural planning and risk assessment. Faster, highly optimized models execute the isolated implementations.  
* **Context Pruning:** Executors do not receive the conversational history or unstructured ideation from the planning phase. They receive only the finalized, heavily compressed architectural decisions necessary to complete their specific isolated task.

## **2\. Agent Roles and Routing Matrix**

In standard execution, the system utilizes a heterogeneous fleet of models, mapped strictly to specific task classifications and reasoning requirements. *(Note: See Section 4 for Developer Mode overrides).*

| Designation | Target Model | Compute Tier | Task Scope | Core Directives & Constraints |
| :---- | :---- | :---- | :---- | :---- |
| **Ingestion & Controller** | Gemini 3 Flash | Fast / Conversational | chat, intent-parsing | Acts as the semantic compressor at the edge. Interacts with the user to brainstorm and resolve ambiguity. Does not write execution code. Outputs a structured, deterministic JSON intent payload via tool call to the Orchestrator CLI. |
| **Planner & Auditor** | Codex | Max Reasoning (xhigh / med) | plan, audit, repair-plan | Analyzes structured intent to generate a flawless, typed JSON DAG of TaskContracts (in xhigh mode). Defines writeScope, dependencies, and execution paths. In med mode, acts as the Independent Plan Auditor to detect lockfile conflicts and enforce ownership modes. |
| **Primary Executor** | Claude 4.6 Sonnet | Idiomatic Execution | code, refactor, test, deps | The default executor for standard codebase mutation. Operates strictly within isolated worktrees. Bound absolutely to the TaskContract with zero tolerance for scope creep. Receives *only* the pruned architectural decisions to maximize context efficiency. |
| **Context & Multimodal** | Gemini 3 Pro | Deep Context / Multimodal | ui, multimodal, macro-refactor | Deployed for tasks requiring repository-wide architectural comprehension (\>40 files) or visual asset processing (e.g., SVG generation, UI design review). Absorbs massive context windows that exceed standard executor efficiency. |

## **3\. Orchestration Meta-Workflow**

This flow defines how the system transitions a user's raw intent into verified, merged repository state across the multi-agent roster.

### **Phase 1: Ingest (Semantic Compression)**

1. User provides natural language input to the **Ingestion Agent**.  
2. The agent iteratively refines the request, prompting the user for necessary constraints and implementation preferences.  
3. Once agreed upon, the agent performs a tool call to the Orchestrator CLI, passing a strictly formatted JSON payload representing the sanitized objective. All conversational bloat is discarded.

### **Phase 2: Plan & Freeze (DAG Generation)**

1. Orchestrator routes the payload to the **Planner**.  
2. Planner generates a DAG of TaskContracts (defining writeScope, expected.files, etc.).  
3. Orchestrator invokes the **Auditor** to evaluate the DAG for hot-resource contention (e.g., package.json, tsconfig.json).  
4. **User Approval (Optional but Recommended):** The orchestrator halts execution and surfaces the parsed DAG payload for explicit user authorization.  
5. The plan is frozen. TaskContract hashes become immutable.

### **Phase 3: Dispatch & Execute (Isolated Worktrees)**

1. The LockManager provisions resources and isolated git worktrees.  
2. The deterministic router evaluates the TaskContract.type and assigns the execution to either the **Primary Executor** or the **Context Engine**.  
3. Agents execute their tasks within the bounds of their isolated branches. They are fed an optimized context window containing *only* the architectural summary and the files within their writeScope.

### **Phase 4: Integration (Verification Gate)**

1. Agents submit their commits to the Orchestrator.  
2. Orchestrator enforces the **Canonical Path Policy** (fail-closed scope check).  
3. If scope passes, the orchestrator merges the commit and mandates a Post-Merge Gate execution (e.g., automated browser tests, pnpm tsc, or test suites).

### **Phase 5: Repair (Bounded Debug Escalation)**

1. If the Post-Merge Gate fails (e.g., an unhandled edge case is discovered), the Orchestrator extracts deterministic error signatures.  
2. A strictly narrowed writeScope is generated, launching a specialized "Debug" task assigned back to the executing agent. This isolates the agent's focus entirely on resolving the specific error trace.  
3. If the repair budget is exhausted, the task is escalated to a higher compute tier or hard-fails with a specific machine-readable reason code.

## **4\. Developer Mode (Global Model Override)**

To facilitate rapid local development, preserve high-tier compute quotas, and accelerate testing feedback loops, the orchestrator implements a global model override.

* **Invocation**: orchestrator run "\<prompt\>" \--dev-mode (or \--force-model=gemini-flash)  
* **Mechanism**: The deterministic router bypasses the standard TaskContract.type evaluation matrix. It intercepts all routing requests and forces the **Planner**, **Auditor**, **Primary Executor**, and **Context Engine** designations to instantiate the Gemini Flash provider adapter.  
* **Rationale**: High-reasoning models (e.g., Codex xhigh or Claude Opus) introduce significant latency (up to 5 minutes for DAG generation alone) and rapidly consume strict pro-tier subscription quotas. Developer mode trades high-reasoning accuracy for high-speed feedback, allowing engineers to rapidly validate the Orchestrator runtime, state transitions, lock acquisition, and integration pipelines without exhausting premium API quotas.