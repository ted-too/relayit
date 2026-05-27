import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access";

const statement = {
  ...defaultStatements,
  message: ["read", "delete"],
  workflow: ["create", "read", "update", "delete"],
  template: ["create", "read", "update", "delete"],
  contact: ["create", "read", "update", "delete"],
  apiKey: ["create", "read", "update", "delete"],
  integration: ["create", "read", "update", "delete"],
} as const;

const ac = createAccessControl(statement);

const member = ac.newRole({
  ...memberAc.statements,
  message: ["read"],
  workflow: ["read"],
  template: ["read"],
  contact: ["read"],
  integration: ["read"],
  apiKey: ["read"],
});

const admin = ac.newRole({
  ...adminAc.statements,
  message: member.statements.message,
  workflow: ["create", "read", "update", "delete"],
  template: ["create", "read", "update", "delete"],
  contact: ["create", "read", "update"],
  apiKey: ["create", "read", "update", "delete"],
  integration: ["create", "read", "update", "delete"],
});

const owner = ac.newRole({
  ...ownerAc.statements,
  message: ["read", "delete"],
  workflow: admin.statements.workflow,
  template: admin.statements.template,
  contact: ["create", "read", "update", "delete"],
  apiKey: admin.statements.apiKey,
  integration: admin.statements.integration,
});

export { ac, admin, member, owner, statement };
