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
  completeDomainClaimTransfer,
  createCustomDomain,
  type DeleteCustomDomainInput,
  deleteCustomDomain,
  type PauseCustomDomainInput,
  pauseCustomDomain,
  type UnpauseCustomDomainInput,
  unpauseCustomDomain,
} from "./lifecycle";
