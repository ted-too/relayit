import { ruleTester } from "../test/ruleTester.ts";
import rule from "./static-error-message.ts";

const message =
  "Keep an error's `message` static; put the identifiers and other varying data in their own fields.";

ruleTester.run("static-error-message", rule, {
  valid: [
    {
      name: "allows a static message with the identifier in a field",
      code: `new MessageDeliveryTerminalError({ deliveryId, message: "Email Delivery not found", stage: "load" });`,
    },
    {
      name: "allows a template literal without interpolation",
      code: "new MessageDeliveryTerminalError({ message: `Email Delivery not found` });",
    },
    {
      name: "allows choosing between static messages",
      code: `new UsageLimitError({ message: daily ? "Daily limit exceeded" : "Monthly limit exceeded" });`,
    },
    {
      name: "ignores built-in errors",
      code: "new Error(`Delivery ${deliveryId} not found`);",
    },
    {
      name: "ignores message fields on objects that are not errors",
      code: "commit({ message: `feat: add ${path}` });",
    },
  ],
  invalid: [
    {
      name: "reports an interpolated identifier",
      code: 'new MessageDeliveryTerminalError({ deliveryId, message: `Email Delivery ${deliveryId} not found`, stage: "load" });',
      errors: [{ message }],
    },
    {
      name: "reports an interpolated expression",
      code: 'new EmailAcceptRejectedError({ code: "invalid_attachment", message: `Attachment "${file.name}" exceeds the limit` });',
      errors: [{ message }],
    },
  ],
});
