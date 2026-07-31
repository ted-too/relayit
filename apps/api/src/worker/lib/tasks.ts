import { verifyDomainTask } from "@repo/api/channels/email/sending-identity/tasks/verify-domain";
import { verifyOwnershipTask } from "@repo/api/channels/email/sending-identity/tasks/verify-ownership";
import { verifyProviderTask } from "@repo/api/channels/email/sending-identity/tasks/verify-provider";
import { verifyProviderIdentityTask } from "@repo/api/channels/email/sending-identity/tasks/verify-provider-identity";
import { verifySandboxDomainTask } from "@repo/api/channels/email/sending-identity/tasks/verify-sandbox-domain";
import type { Task } from "@repo/api/tasks";

export const WORKER_TASKS = [
  verifyDomainTask,
  verifyOwnershipTask,
  verifyProviderTask,
  verifyProviderIdentityTask,
  verifySandboxDomainTask,
] satisfies Task<unknown>[];
