# RelayIt - Detailed Overview

## 1. Overview

RelayIt is a notification delivery service designed to abstract the complexities of integrating with multiple communication APIs. It provides developers with a single, reliable endpoint to send messages to their users across various channels like Email, SMS, WhatsApp, and Discord, handling queueing, rate limiting, and provider-specific logic automatically.

The service is designed to be self-hosted using a Docker stack (e.g., via `docker-compose`).

## 2. Core Features and Implementation

### 2.1. Message Ingestion (`/send` API Endpoint)

- **Purpose**: The single entry point for applications to submit notification requests.
- **Key Features**:
  - Tenant/User identification via secure API keys.
  - Payload validation: Ensures required fields (channel, recipient, content) are present and correctly formatted.
  - Channel specification: Determines the target delivery method (e.g., `email`, `sms`, `whatsapp`, `discord`).
  - Content formatting options (e.g., plain text, HTML for email).
  - Immediate acknowledgement upon successful request validation and placement onto the Redis queue.
- **Implementation**:
  - Built using the **Hono** web framework on the Bun runtime.
  - Quickly validates the request and pushes the message details onto a **Redis Stream**.

### 2.2. Queueing System (`messageQueue` using Redis Streams)

- **Purpose**: Decouples message ingestion from processing and delivery using Redis Streams, ensuring reliability and handling bursts.
- **Key Features**:
  - Guaranteed message persistence within Redis until processed.
  - FIFO (First-In, First-Out) processing via Redis Stream consumption.
  - Support for consumer groups for scaling workers.
  - Retry mechanisms for transient processing failures (handled by workers).
  - Dead-letter queue (DLQ) mechanism for messages that fail repeatedly (potentially another Redis Stream).
- **Implementation**:
  - Utilizes **Redis Streams** as the message broker.
  - Dedicated worker services consume messages from the stream.

### 2.3. Routing & Processing Engine (Worker Services)

- **Purpose**: Dedicated worker services consume messages from the Redis Stream queue, determine the correct provider using user-provided credentials, format the message, and initiate delivery.
- **Key Features**:
  - Dynamic routing based on the `channel` specified in the message.
  - Loads appropriate provider connector based on the channel.
  - Retrieves user-specific credentials securely from the **PostgreSQL** database.
  - Applies channel-specific formatting or transformations if needed.
  - Handles rate limiting logic (potentially using Redis) _before_ calling the external API.
- **Implementation**:
  - Implemented as separate Docker containers/processes (likely using Node.js/Bun).
  - Workers continuously poll or block on the Redis Stream for new messages.
  - Update message status in the **PostgreSQL** database upon completion or failure.

### 2.4. Provider Connectors (`providerConnectors` module)

- **Purpose**: Handles the specific logic for interacting with each external notification service API using the credentials provided by the user/tenant.
- **Planned Connectors**:
  - **Email (SES)**: Uses AWS SDK to interact with SES API. (MVP)
  - **SMS (SNS)**: Uses AWS SDK to interact with SNS API for sending SMS messages. (MVP)
  - **WhatsApp (Custom Bot/Integration)**: Interacts with the WhatsApp Business API (or chosen provider) via a dedicated bot/integration layer. (Planned V2.0)
  - **Discord (Custom Bot)**: Uses Discord API via a bot token to send messages to specified channels or users. (Planned V2.0)
- **Key Features**:
  - API client implementation for each service.
  - Provider-specific error handling and retry logic (e.g., handling specific API errors).
  - Adherence to each provider's rate limits and best practices.
  - Translates generic RelayIt status updates to provider-specific statuses.

### 2.5. Status Tracking & Webhooks (`messageStatus` service & Webhook Workers)

- **Purpose**: Tracks the lifecycle of each message in PostgreSQL and notifies the originating application of status changes via webhooks, managed via Redis.
- **Key Features**:
  - Stores message status history (e.g., `received`, `queued`, `processing`, `sent`, `delivered` (if available), `failed`) in the `message` and `message_event` tables.
  - Provides an API endpoint for users to query message status by ID.
  - Sends outbound webhooks to user-configured endpoints upon status changes (e.g., `sent`, `failed`).
  - Includes error details for failed messages.
- **Implementation**:
  - Uses **PostgreSQL** database to store message status and event history.
  - Asynchronous webhook delivery: When a status update occurs that should trigger a webhook, a job is placed onto a dedicated **Redis Stream/Queue**.
  - Separate webhook worker services consume from this Redis queue and attempt delivery to the user's configured URL, handling retries.

### 2.6. Tenant/User Management (Implemented - `auth.ts` schema)

- **Purpose**: Manages user accounts, API keys, provider credentials, organizations, and configurations within the **PostgreSQL** database.
- **Key Features**:
  - Secure user registration and login using Lucia-Auth.
  - API key generation, management, and revocation.
  - Secure storage for user-provided provider credentials (encrypted in PostgreSQL).
  - Configuration settings per user/organization (e.g., webhook URLs).
  - Organization and project structures for multi-tenancy.

### 2.7. Organization and User Management (Implemented)

- **Purpose**: Manages user accounts, organizations, and role-based permissions within PostgreSQL.
- **Key Features**:
  - User registration and authentication with support for OAuth providers
  - Organization creation and management
  - Role-based access control (owner, admin, member)
  - Organization invitations with expiry and acceptance tracking
  - Passkey (WebAuthn) integration for secure authentication
- **Implementation**:
  - Data stored in **PostgreSQL** (`user`, `organization`, `member`, `invitation` tables).
  - Users can be members of multiple organizations.
  - Each user has a specific role within an organization.
  - API key generation and management for programmatic access (`apiKey` table).

### 2.8. Project Management (Implemented)

- **Purpose**: Allows organizations to segment and organize their notification services within PostgreSQL.
- **Key Features**:
  - Projects are created within organizations.
  - Each project has a unique slug within its organization.
  - Projects can store additional metadata.
  - CRUD operations for managing projects.
- **Implementation**:
  - RESTful API (`apps/api/src/routes/projects.ts`) interacting with **PostgreSQL** (`project` table).
  - Projects serve as a container for credentials, webhooks, and messages.

### 2.9. Provider Credential Management (Implemented)

- **Purpose**: Securely stores and manages credentials for external notification services in PostgreSQL.
- **Key Features**:
  - Support for various provider types (email, SMS, etc.).
  - Credentials can be scoped to an organization or specific project.
  - Encrypted storage of sensitive credential data in the database.
  - Unique slugs for easy reference.
- **Implementation**:
  - CRUD API (`apps/api/src/routes/providers.ts`) interacting with **PostgreSQL** (`providerCredential` table).
  - Active/inactive status tracking.
  - Validation of credentials.
  - Organization or project-level scoping.

### 2.10. Webhook Configuration Management (Implemented)

- **Purpose**: Allows projects to configure webhook endpoints stored in PostgreSQL.
- **Key Features**:
  - Project-scoped webhook endpoints.
  - Configurable event types for triggering webhooks.
  - Optional secret for webhook signature verification (stored encrypted).
  - Active/inactive status control.
- **Implementation**:
  - RESTful API (`apps/api/src/routes/webhooks.ts`) interacting with **PostgreSQL** (`webhookEndpoint` table).
  - Secure storage of webhook secrets.

### 2.11. Message Management and Tracking (Implemented)

- **Purpose**: Provides visibility into message status and history stored in PostgreSQL.
- **Key Features**:
  - Filtering and pagination of messages by status, channel, and search terms.
  - Detailed status tracking throughout the message lifecycle.
  - Association with projects, API keys, and provider credentials.
- **Implementation**:
  - RESTful API (`apps/api/src/routes/messages.ts`) querying **PostgreSQL** (`message`, `message_event` tables) with comprehensive filtering options.

## 3. How It All Works Together (with Hono, Redis, PostgreSQL)

1.  **Request Submission**: A user's application sends a POST request to RelayIt's `/send` endpoint (Hono) with API key, channel, recipient, and content.
2.  **Validation & Queueing**: Hono validates the request and API key. If valid, it places the message details onto the **Redis Stream** (`messageQueue`) and returns a unique message ID to the caller.
3.  **Processing**: A dedicated **Worker Service** picks up the message from the Redis Stream.
4.  **Routing**: The worker identifies the target channel (e.g., `email`).
5.  **Connection & Credentials**: It loads the appropriate Provider Connector (e.g., `Email (SES)`) and retrieves the user's stored SES credentials from **PostgreSQL**.
6.  **Delivery Attempt**: The connector formats the request for the SES API using the user's credentials, respects rate limits, and calls the SES API to send the email.
7.  **Status Update**: The connector (or worker) receives a response from SES. It updates the message status in **PostgreSQL** (e.g., `sent` or `failed` with details) and logs a `message_event`.
8.  **Webhook Trigger**: If the status update matches a configured webhook endpoint's event types (checked against **PostgreSQL**), a job is placed onto a separate **Redis Stream/Queue** for webhooks.
9.  **Webhook Delivery**: A dedicated **Webhook Worker** picks up the job from Redis and sends the POST request to the configured user endpoint.

## 4. Current API Routes (Hono Backend)

### 4.1. Project Routes (`/projects`)

- **POST /generate-slug**: Generate a unique slug for a project
- **POST /**: Create a new project
- **GET /**: List all projects in the organization
- **GET /:projectId**: Get a specific project by ID
- **PATCH /:projectId**: Update a project by ID

### 4.2. Webhook Routes (Scoped under Project: `/projects/:projectId/webhooks`)

- **POST /**: Create a new webhook endpoint for a project
- **GET /**: List all webhook endpoints for a project
- **GET /:webhookId**: Get a specific webhook endpoint
- **PATCH /:webhookId**: Update a webhook endpoint
- **DELETE /:webhookId**: Delete a webhook endpoint

### 4.3. Message Routes (Scoped under Project: `/projects/:projectId/messages`)

- **GET /**: List messages for a project with filtering and pagination

### 4.4. Provider Routes (`/providers`)

- **POST /**: Create new provider credentials (org or project scope)
- **GET /**: List all provider credentials for an organization
- **GET /:providerId**: Get specific provider credentials
- **PATCH /:providerId**: Update provider credentials
- **DELETE /:providerId**: Delete provider credentials

### 4.5. Send Route (`/send`)

- **POST /**: Submit a new notification request (handled by Hono, queues to Redis)

## 5. Design Goals

- **Reliability**: Ensure messages are not lost and are delivered even with transient failures (using Redis persistence and worker retries).
- **Scalability**: Handle increasing message volume by scaling API instances and Worker Services independently.
- **Extensibility**: Easily add support for new notification channels (providers) by creating new connector modules.
- **Simplicity**: Provide a simple, unified API for developers, hiding the complexity of individual providers.
- **Observability**: Offer clear status tracking (PostgreSQL) and logs for debugging and monitoring.
- **Security**: Protect user data, API keys, and securely handle user-provided credentials (encryption in PostgreSQL).
- **Multi-tenancy**: Support multiple organizations with isolated data and configurations (using PostgreSQL schemas and relations).

This more detailed structure aims to create a robust, scalable, and developer-friendly notification relay service, deployable via Docker and leveraging user-provided credentials, built with Hono, PostgreSQL, and Redis.
