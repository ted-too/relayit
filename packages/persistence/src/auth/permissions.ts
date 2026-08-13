import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access";

export const statement = {
  ...defaultStatements,
  message: ["read", "delete"],
  workflow: ["create", "read", "update", "delete"],
  template: ["create", "read", "update", "delete"],
  contact: ["create", "read", "update", "delete"],
  apiKey: ["create", "read", "update", "delete"],
  integration: ["create", "read", "update", "delete"],
  appEnvironment: ["read", "delete"],
  topic: ["create", "read", "update", "delete"],
  segment: ["create", "read", "update", "delete"],
  campaign: ["create", "read", "update"],
  usage: ["read"],
  billingUser: ["update"],
  webhookEndpoint: ["create", "read", "update", "delete"],
} as const;

export const ac = createAccessControl(statement);

export const member = ac.newRole({
  ...memberAc.statements,
  message: ["read"],
  workflow: ["read"],
  template: ["read"],
  contact: ["read"],
  integration: ["read"],
  apiKey: ["read"],
  appEnvironment: ["read"],
  topic: ["read"],
  segment: ["read"],
  campaign: ["read"],
  usage: ["read"],
  webhookEndpoint: ["read"],
});

export const admin = ac.newRole({
  ...adminAc.statements,
  message: member.statements.message,
  workflow: ["create", "read", "update", "delete"],
  template: ["create", "read", "update", "delete"],
  contact: ["create", "read", "update"],
  apiKey: ["create", "read", "update", "delete"],
  integration: ["create", "read", "update", "delete"],
  appEnvironment: ["read", "delete"],
  topic: ["create", "read", "update", "delete"],
  segment: ["create", "read", "update", "delete"],
  campaign: ["create", "read", "update"],
  usage: ["read"],
  webhookEndpoint: ["create", "read", "update", "delete"],
});

export const owner = ac.newRole({
  ...ownerAc.statements,
  message: ["read", "delete"],
  workflow: admin.statements.workflow,
  template: admin.statements.template,
  contact: ["create", "read", "update", "delete"],
  apiKey: admin.statements.apiKey,
  integration: admin.statements.integration,
  appEnvironment: ["read", "delete"],
  topic: ["create", "read", "update", "delete"],
  segment: ["create", "read", "update", "delete"],
  campaign: ["create", "read", "update"],
  usage: ["read"],
  billingUser: ["update"],
  webhookEndpoint: ["create", "read", "update", "delete"],
});
