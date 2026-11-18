export {
  buildCustomDomainRootDnsRecords,
  createOwnershipToken,
  customDomainIdentityDnsOwner,
  customDomainRootDnsOwner,
  ownershipChallengeHost,
  ownershipChallengeValue,
  resolveCustomDomainMailFromRecords,
} from "./dns";
export {
  type CreateCustomDomainInput,
  CustomDomainError,
  CustomDomainNotFound,
  completeDomainClaimTransfer,
  createCustomDomain,
  type DeleteCustomDomainInput,
  deleteCustomDomain,
  type PauseCustomDomainInput,
  pauseCustomDomain,
  type UnpauseCustomDomainInput,
  unpauseCustomDomain,
} from "./lifecycle";
export { detectDnsProvider, providerFromNameservers } from "./provider-detection";
