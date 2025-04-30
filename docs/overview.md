# RelayIt - Detailed Overview

## 1. Overview

RelayIt is a notification delivery service designed to abstract the complexities of integrating with multiple communication APIs. It provides developers with a single, reliable endpoint to send messages to their users across various channels like Email, SMS, WhatsApp, and Discord, handling queueing, rate limiting, and provider-specific logic automatically.

The service is designed to be self-hosted using Docker containers.

## 2. Core Features and Implementation

### 2.1. Message Ingestion (`/send` API Endpoint)

- **Purpose**: The single entry point for applications to submit notification requests.
- **Key Features**:
  - Tenant/User identification via secure API keys.
  - Payload validation: Ensures required fields (channel, recipient, content) are present and correctly formatted.
  - Channel specification: Determines the target delivery method (e.g., `email`, `sms`, `whatsapp`, `discord`).
  - Content formatting options (e.g., plain text, HTML for email).
  - Immediate acknowledgement upon successful request validation and queueing.
- **Implementation**:
  - Built using a lightweight web framework (e.g., Hono on Bun).
  - Asynchronous processing: Validates request quickly and hands off to the queueing system.

### 2.2. Queueing System (`messageQueue` service)

- **Purpose**: Decouples message ingestion from processing and delivery, ensuring reliability and handling bursts.
- **Key Features**:
  - Guaranteed message persistence until processed.
  - FIFO (First-In, First-Out) processing as a baseline, potential for prioritization later.
  - Retry mechanisms for transient processing failures.
  - Dead-letter queue (DLQ) for messages that fail repeatedly.
- **Implementation**:
  - Leverages Redis Streams as the message broker for persistence and decoupling.
  - Consumers (workers) pull messages from the queue for processing.

### 2.3. Routing & Processing Engine (`processorWorker` service)

- **Purpose**: Consumes messages from the queue, determines the correct provider using user-provided credentials, formats the message, and initiates delivery.
- **Key Features**:
  - Dynamic routing based on the `channel` specified in the message.
  - Loads appropriate provider connector based on the channel.
  - Retrieves user-specific credentials for the target provider securely.
  - Applies channel-specific formatting or transformations if needed.
  - Handles rate limiting logic _before_ calling the external API.
- **Implementation**:
  - Worker services implemented potentially as separate Docker containers/processes.
  - Fetches credentials associated with the tenant/API key from the `tenantService`.

### 2.4. Provider Connectors (`providerConnectors` module)

- **Purpose**: Handles the specific logic for interacting with each external notification service API using the credentials provided by the user/tenant.
- **MVP Connectors**:
  - **Email (SES)**: Uses AWS SDK to interact with SES API. Handles required parameters like `Source`, `Destination`, `Message`.
  - **SMS (SNS)**: Uses AWS SDK to interact with SNS API for sending SMS messages.
  - **WhatsApp (Custom Bot)**: Interacts with the WhatsApp Business API (or chosen provider) via a dedicated bot/integration layer.
  - **Discord (Custom Bot)**: Uses Discord API via a bot token to send messages to specified channels or users.
- **Key Features**:
  - API client implementation for each service.
  - Provider-specific error handling and retry logic (e.g., handling specific API errors).
  - Adherence to each provider's rate limits and best practices.
  - Translates generic RelayIt status updates to provider-specific statuses.

### 2.5. Status Tracking & Webhooks (`messageStatus` service)

- **Purpose**: Tracks the lifecycle of each message and notifies the originating application of status changes.
- **Key Features**:
  - Stores message status history (e.g., `received`, `queued`, `processing`, `sent`, `delivered` (if available), `failed`).
  - Provides an API endpoint for users to query message status by ID.
  - Sends outbound webhooks to user-configured endpoints upon status changes (e.g., `sent`, `failed`).
  - Includes error details for failed messages.
- **Implementation**:
  - Database (e.g., PostgreSQL, DynamoDB) to store message status.
  - Asynchronous webhook delivery system to avoid blocking processing.

### 2.6. Tenant/User Management (`tenantService` / `user` table)

- **Purpose**: Manages user accounts, API keys, provider credentials, and configurations.
- **Key Features**:
  - Secure user registration and login (future web UI).
  - API key generation, management, and revocation.
  - Secure storage for user-provided provider credentials (e.g., SES keys, SNS keys, WhatsApp/Discord tokens).
  - Configuration settings per user/tenant (e.g., webhook URLs, default sender IDs).
  - Usage tracking for potential future billing or quotas.

## 3. How It All Works Together

1.  **Request Submission**: A user's application sends a POST request to RelayIt's `/send` endpoint with API key, channel, recipient, and content.
2.  **Validation & Queueing**: RelayIt validates the request and API key. If valid, it places the message details onto the `messageQueue` and returns a unique message ID to the caller.
3.  **Processing**: A `processorWorker` picks up the message from the queue.
4.  **Routing**: The worker identifies the target channel (e.g., `email`).
5.  **Connection & Credentials**: It loads the `Email (SES)` provider connector and retrieves the user's stored SES credentials.
6.  **Delivery Attempt**: The connector formats the request for the SES API using the user's credentials, respects rate limits, and calls the SES API to send the email.
7.  **Status Update**: The connector receives a response from SES (e.g., success or failure). It updates the `messageStatus` service with the outcome.
8.  **Webhook Notification**: The `messageStatus` service triggers a webhook (if configured) to the user's application endpoint, notifying them of the final status (e.g., `sent` or `failed` with details).

## 4. Design Goals

- **Reliability**: Ensure messages are not lost and are delivered even with transient failures.
- **Scalability**: Handle increasing message volume by scaling workers and queue infrastructure.
- **Extensibility**: Easily add support for new notification channels (providers) in the future.
- **Simplicity**: Provide a simple, unified API for developers, hiding the complexity of individual providers.
- **Observability**: Offer clear status tracking and logs for debugging and monitoring.
- **Security**: Protect user data, API keys, and securely handle user-provided credentials.

This more detailed structure aims to create a robust, scalable, and developer-friendly notification relay service, deployable via Docker and leveraging user-provided credentials.
