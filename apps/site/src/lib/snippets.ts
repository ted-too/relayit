export interface Snippet {
  readonly code: string;
  readonly id: string;
  readonly lang: string;
}

/** The request card in the hero: the "baton" a developer hands over. */
export const heroRequest: Snippet = {
  code: `POST /messages/email
x-api-key: rel_org_••••7c2d
idempotency-key: order-4821-shipped

{
  "from": "Fernwood Supply <orders@fernwood.shop>",
  "to": "maya.okafor@example.com",
  "template": {
    "id": "order-shipped",
    "variables": { "orderId": "4821" }
  }
}`,
  id: "hero",
  lang: "http",
};

export const selfHostSnippet: Snippet = {
  code: `git clone https://github.com/ted-too/relayit && cd relayit
cp env.example .env
docker compose up -d`,
  id: "selfhost",
  lang: "bash",
};

export const landingSnippets = [heroRequest, selfHostSnippet] as const;
