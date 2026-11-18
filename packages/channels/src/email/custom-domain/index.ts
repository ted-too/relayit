export {
  buildCustomDomainRootDnsRecords,
  createOwnershipToken,
  customDomainIdentityDnsOwner,
  customDomainRootDnsOwner,
  ownershipChallengeHost,
  ownershipChallengeValue,
  resolveCustomDomainMailFromRecords,
} from "./dns";
export { DeleteDomainIdentityHandlerError, emailDeleteDomainIdentityHandler } from "./handlers";
export { type EmailDeleteDomainIdentityPayload, emailDeleteDomainIdentityJob } from "./jobs";
export {
  type CreateCustomDomainInput,
  CustomDomainError,
  completeDomainClaimTransfer,
  createCustomDomain,
  type DeleteCustomDomainInput,
  deleteCustomDomain,
  type PauseCustomDomainInput,
  pauseCustomDomain,
  removeDeletedProjectDomains,
  removeUnlinkedDomains,
  type UnpauseCustomDomainInput,
  unpauseCustomDomain,
} from "./lifecycle";
export { detectDnsProvider, providerFromNameservers } from "./provider-detection";
