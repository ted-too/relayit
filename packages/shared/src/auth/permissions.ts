import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access";

const statement = {
  ...defaultStatements,
  apiKey: ["create", "revoke"],
  integration: ["create", "update", "delete"],
} as const;

const ac = createAccessControl(statement);

const member = ac.newRole({
  ...memberAc.statements,
});

const admin = ac.newRole({
  ...adminAc.statements,
  apiKey: ["create", "revoke"],
  integration: ["create", "update", "delete"],
});

const owner = ac.newRole({
  ...ownerAc.statements,
  apiKey: ["create", "revoke"],
  integration: ["create", "update", "delete"],
});

export { member, admin, owner, ac };
