**I. Goal**

Implement a robust background worker (`apps/worker`) that consumes message IDs from a Redis Stream (`messageQueue`), fetches message details from PostgreSQL, processes the message by sending it via the appropriate external provider (initially SES/SNS), updates the message status in PostgreSQL, and acknowledges the message in Redis.

**II. Core Architecture & Packages**

- **`@repo/shared`:** Provides shared constants (`AVAILABLE_CHANNELS`, `AVAILABLE_MESSAGE_STATUSES`, `ProviderType`, `ChannelType`) and Zod validation schemas/types (`SendMessagePayload`, `ProviderCredentials`). Used by API, Worker, and potentially Web.
- **`@repo/db`:** Manages database schema (Drizzle), DB client (`db`), Redis client (`redis` via Bun), reusable Redis stream operations (`queueMessage`, `acknowledgeMessage`), and message lifecycle DB operations (`fetchMessageDetails`, `updateMessageStatus`, `logMessageEvent`). Used by API and Worker.
- **`apps/api`:** (Existing) Handles HTTP requests, validates input, creates initial message records in DB, and queues message IDs using `queueMessage` from `@repo/db`.
- **`apps/worker`:** (To Be Implemented) The background process that consumes from Redis, orchestrates message processing, interacts with external provider SDKs, and uses operations from `@repo/db`.

**III. Implementation Steps & File Structure**

**Phase 1: Enhance `@repo/db`**

1.  **File:** `packages/db/src/lib/redis.ts`

    - **Verify/Add:**
      - `MESSAGE_QUEUE_STREAM` constant.
      - `queueMessage(messageId: string): Promise<string>` function (for API).
      - `acknowledgeMessage(streamId: string, groupName: string): Promise<number>` function:
        - Uses `redis.send("XACK", [MESSAGE_QUEUE_STREAM, groupName, streamId])`.
        - Returns the result of XACK (number of messages acknowledged).
    - **Responsibility:** Centralizes Redis stream interaction logic.

2.  **File:** `packages/db/src/lib/message-ops.ts` **(New)**

    - **Implement:**
      - `fetchMessageDetails(messageId: string): Promise<MessageWithRelations | null>`:
        - Uses `db.query.message.findFirst(...)` with `with` clause to include `projectProviderAssociation` and its nested `providerCredential`.
        - Define `MessageWithRelations` type extending the base message type with these relations.
      - `updateMessageStatus(tx: Transaction | typeof db, messageId: string, status: MessageStatus, reason?: string): Promise<void>`:
        - Accepts an optional transaction object (`tx`) for atomicity if needed elsewhere.
        - Updates `message` table's `status`, `statusReason`, and `lastStatusAt` fields.
      - `logMessageEvent(tx: Transaction | typeof db, messageId: string, status: MessageStatus, details?: any): Promise<void>`:
        - Accepts an optional transaction object (`tx`).
        - Inserts a new record into the `message_event` table.
    - **Responsibility:** Provides specific database operations for the message lifecycle.

3.  **File:** `packages/db/src/index.ts`
    - **Verify/Add Exports:**
      - Export `db`, `schema`.
      - Export crypto functions.
      - Export `MESSAGE_QUEUE_STREAM`, `queueMessage`, `acknowledgeMessage` from `lib/redis.ts`.
      - Export `fetchMessageDetails`, `updateMessageStatus`, `logMessageEvent` from `lib/message-ops.ts`.

**Phase 2: Implement `apps/worker`**

4.  **File:** `apps/worker/src/lib/providers/interface.ts` **(New)**

    - **Define:**

      - `ProviderSendResult { success: boolean; details?: any; error?: string }` interface.
      - `INotificationProvider` interface:

        ```typescript
        import { ProviderCredentials, SendMessagePayload } from "@repo/shared";

        export interface INotificationProvider {
          send(
            credentials: ProviderCredentials,
            messagePayload: SendMessagePayload["payload"],
            recipient: string
          ): Promise<ProviderSendResult>;
        }
        ```

    - **Responsibility:** Defines the contract for all notification provider implementations.

5.  **Files:** `apps/worker/src/lib/providers/*.ts` (e.g., `ses.ts`, `sns.ts`) **(New)**

    - **Implement:**
      - Import `INotificationProvider`, `ProviderSendResult`, relevant types from `@repo/shared`.
      - Import necessary SDKs (e.g., `@aws-sdk/client-ses`).
      - Create classes (e.g., `SESProvider`) implementing `INotificationProvider`.
      - Implement the `send` method, handle SDK calls, map responses/errors to `ProviderSendResult`.
    - **Responsibility:** Contains logic specific to each external notification service.

6.  **File:** `apps/worker/src/lib/providers/index.ts` **(New)**

    - **Implement:**
      - Import `INotificationProvider` and specific provider classes (e.g., `SESProvider`).
      - Import `ChannelType` from `@repo/shared`.
      - Export `getProvider(channel: ChannelType): INotificationProvider`: A factory function that returns the appropriate provider instance based on the channel type (e.g., `if (channel === 'email') return new SESProvider();`).
    - **Responsibility:** Selects and provides the correct provider implementation.

7.  **File:** `apps/worker/src/lib/process-message.ts` **(New)**

    - **Implement:**
      - Import required functions from `@repo/db` (`fetchMessageDetails`, `updateMessageStatus`, `logMessageEvent`, `acknowledgeMessage`, `MESSAGE_QUEUE_STREAM`).
      - Import `getProvider` from `./providers`.
      - Define `handleMessage(internalMessageId: string, messageStreamId: string, consumerGroupName: string): Promise<void>`:
        - Outer `try...finally` block to ensure acknowledgment.
        - Inner `try...catch` block for processing logic.
        - **Try (Processing):**
          - Fetch message details using `fetchMessageDetails`. Handle `null`.
          - Update status to 'processing' via `updateMessageStatus` (potentially wrap subsequent steps in DB transaction).
          - Get provider using `getProvider`.
          - Call provider `.send()`.
          - Update status ('sent'/'failed') and log event using `updateMessageStatus` and `logMessageEvent`.
        - **Catch (Processing Error):**
          - Log error.
          - Update status to 'failed' and log event (if message details were fetched).
        - **Finally (Acknowledgment):**
          - Call `acknowledgeMessage(messageStreamId, consumerGroupName)`.
    - **Responsibility:** Orchestrates the processing steps for a single message, including error handling and acknowledgment.

8.  **File:** `apps/worker/src/index.ts` **(Refactor/Implement)**
    - **Implement:**
      - Imports: `redis` from `bun`, functions/constants from `@repo/db`, `handleMessage` from `./lib/process-message.ts`.
      - Constants: `CONSUMER_GROUP_NAME`, `CONSUMER_NAME`, `BLOCK_TIMEOUT_MS`.
      - `initializeConsumerGroup()`: Function to create/ensure Redis group exists.
      - `processMessages()`: The main loop.
        - Uses `redis.send("XREADGROUP", ...)` to read from the stream.
        - Parses response to get `messageStreamId` and `internalMessageId`.
        - Calls `await handleMessage(internalMessageId, messageStreamId, CONSUMER_GROUP_NAME)`. Include basic try/catch around this call for safety.
      - `startWorker()`: Entry function. Checks Redis ping (`redis.send("PING")`), calls `initializeConsumerGroup`, calls `processMessages`.
      - Initial execution: `startWorker().catch(...)`.
      - (Optional Later): Implement graceful shutdown logic (`process.on('SIGTERM', ...)`).
    - **Responsibility:** Entry point, main worker loop, Redis group initialization, basic Redis connection check, top-level orchestration.

**IV. Data Flow Summary**

1.  API (`/send`) receives request -> Validates -> Creates `message` (status: `queued`) in DB -> Calls `queueMessage(messageId)` from `@repo/db`.
2.  `queueMessage` adds `messageId` to `messageQueue` Redis Stream.
3.  Worker (`index.ts`) loop calls `XREADGROUP`, receives `messageStreamId` and `internalMessageId`.
4.  Worker calls `handleMessage(internalMessageId, messageStreamId)`.
5.  `handleMessage` calls `fetchMessageDetails` from `@repo/db`.
6.  `handleMessage` calls `updateMessageStatus` ('processing') from `@repo/db`.
7.  `handleMessage` calls `getProvider` -> calls provider `send` method.
8.  Provider `send` interacts with external service (e.g., AWS SES).
9.  `handleMessage` calls `updateMessageStatus` ('sent'/'failed') & `logMessageEvent` from `@repo/db`.
10. `handleMessage` calls `acknowledgeMessage` from `@repo/db`.
11. `acknowledgeMessage` calls `XACK` on Redis Stream.
12. Worker loop continues.

This plan provides a structured approach to building the worker, maximizing code reuse and maintainability.
