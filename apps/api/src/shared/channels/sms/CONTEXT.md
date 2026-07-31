# SMS

The SMS channel: how a project sends SMS (and related A2P messaging) through Relayit. Planned Provider: AWS End User Messaging. **Full SMS ubiquitous language is deferred** until the SMS product surface is designed; only shared Channel module nouns are sketched here.

## Language

**Provider**:
Same meaning as in Channels — e.g. AWS End User Messaging, managed or customer-connected. Setup assistance, not a full control-plane proxy.
_Avoid_: Integration, channel

**Deliverability**:
SMS-channel delivery health and signals, and the channel’s answer to whether sending may proceed.
_Avoid_: Usage (that is Messages)

## Modules

- **Providers** — vendor capability for SMS delivery
- **Sending Identity** — module for setup required to send *as* / *from*; user-facing entities are concrete (phone number, sender ID, …), not an umbrella “origination identity” product noun
- **Deliverability** — channel delivery signals and send-gating for SMS
