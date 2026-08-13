export { acceptTransactionalEmail } from "./accept";
export type {
  AcceptedTransactionalEmail,
  AcceptTransactionalEmailInput,
  EmailAttachmentInput,
  EmailContentInput,
} from "./contracts";
export {
  type EmailAcceptAttachmentReason,
  EmailAcceptInfrastructureError,
  EmailAcceptPersistenceError,
  EmailAcceptRejected,
  type EmailAcceptRejectedDetails,
} from "./errors";
