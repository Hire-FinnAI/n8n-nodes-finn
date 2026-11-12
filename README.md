# n8n-nodes-finn

n8n community nodes for [finn](https://hirefinn.ai). They work through Finn's public API v1 and use an organization API key. They mirror the Finn Zapier app (`finn-zapier`).

Status: local only. Not pushed to any remote, not published to npm, not submitted to n8n.

## What it does

| Node | Resource / event | Finn API |
|---|---|---|
| Finn Trigger | Contact Created | webhook `contact.created` |
| Finn Trigger | Contact Stage Changed | webhook `contact.stage_changed` (adds `stage_from`, `stage_to`, `changed_by`) |
| Finn Trigger | Lead Created | webhook `lead.created` (adds `lead`, `lead_via`) |
| Finn Trigger | Form Submitted | webhook `form.submitted` (adds form, submission, `answers`, `answers_by_field`, `form_text`) |
| Finn | Contact › Create or Update | `POST /contacts`; on 409 `contact_exists`, `PATCH /contacts/{id}` |
| Finn | Contact › Update | `PATCH /contacts/{id}` |
| Finn | Contact › Get | `GET /contacts/{id}` |
| Finn | Contact › Search | `GET /contacts?q=&stage=&tag=&kind=&page=&page_size=` |
| Finn | Note › Add | `POST /contacts/{id}/notes` |
| Finn | Agent › Start Case | `POST /agents/{id}/cases` with `subject = {type: "contact", ref}`; agent list from `GET /agents` |

The credential is an API key plus a base URL (default `https://api.hirefinn.ai/v1`). Every request sends `Authorization: Bearer finn_live_…` and `Finn-Version: 2026-11-01`. The credential test is `GET /contacts?page_size=1`.

The Finn node sets `usableAsTool`, so an n8n AI Agent can use it as a tool.

## What a workspace needs

- **Key scopes:**
  - `crm:read` and `crm:write` for contacts and notes
  - `operator:write` to start agents
  - `admin:webhooks` for the Finn Trigger
- **Registry features:**
  - `v1_webhooks` for the Finn Trigger. Without it, activating a workflow fails with `webhooks_api_not_enabled`.
  - `v1_agent_build` for the agent dropdown. Without it the list is empty and the user pastes an agent ID or uses an expression.
- **Backend release:** the `form.submitted` event comes from backend PR [hirefinnai/hirefinn-web-app-backend#637](https://github.com/hirefinnai/hirefinn-web-app-backend/pull/637), which is still a draft. Until it is live, Finn refuses an endpoint that lists `form.submitted`.
- **Limits:**
  - Finn allows 5 webhook endpoints per org. Each active workflow with a Finn Trigger uses one, however many events it picks. While n8n listens for a test event it uses one more for a short time.
  - API rate limits: reads 300 per minute, writes 120 per minute. A 429 becomes a node error that says when to retry.

## How the trigger works

- **Activating a workflow** creates one webhook endpoint for the chosen events, with a fresh `Idempotency-Key`. n8n stores the endpoint's ID and its `whsec_` secret in the workflow's static data.
- **Deactivating** deletes the endpoint. A 404 (already deleted in Finn) counts as done.
- **Changed settings:** if the events or the n8n webhook URL changed, the old endpoint is deleted before a new one is made, so no orphan uses up the 5-endpoint limit.
- **Signatures:** each delivery's `X-Finn-Signature` (`t=<unix>,v1=<hex>`, HMAC-SHA256 of `${t}.${body}`) is checked against the raw body. The tolerance is 10 minutes, and rotated secrets are accepted. A delivery that does not match gets a 401 and does not run the workflow.
- **Events not picked** (for example a test ping) are acknowledged and skipped.
- **Duplicates:** Finn delivers at least once. To de-duplicate, use `event_id` (for forms, `submission_id`), for example with n8n's Remove Duplicates node.
- **Form answers:** a public or embedded form that lands on a contact Finn already had (`trust: claimed_existing`) still triggers, with `answers_withheld: true` and no answers. Answers are visitor text, so treat them as untrusted.

## Develop

```bash
npm install --ignore-scripts
```

```bash
npm test
```

`npm test` runs `tsc`, copies the icons into `dist/`, then runs `node --test` with a mocked `httpRequestWithAuthentication`, so nothing touches the network. `--ignore-scripts` skips a native build in an `n8n-workflow` dependency that fails on Node 26 and isn't needed here.

To try it in a local n8n:

```bash
npm run build && npm link
```

```bash
mkdir -p ~/.n8n/custom && cd ~/.n8n/custom && npm link n8n-nodes-finn
```

Then restart n8n. The Finn Trigger needs a public webhook URL that Finn can reach, such as n8n cloud or a tunnel.

## Publish (manual steps for the user)

1. **Check the package:**
   - Settle the `author`, `homepage` and `license` fields in `package.json`.
   - Replace the placeholder `finn.svg` icons (in `credentials/`, `nodes/Finn/` and `nodes/FinnTrigger/`) with the real logo.
   - Run the n8n linter (`npx @n8n/node-cli lint`, or the `eslint-plugin-n8n-nodes-base` rules from the starter) and fix what it finds.
2. **Test against real Finn:** use a real key on an org with `v1_webhooks` on. Activate a Finn Trigger, check that one endpoint appears in Finn, then deactivate it and check that the endpoint is gone. Confirm `api.hirefinn.ai/v1` answers; the OpenAPI spec says `/api/v1`.
3. **Ship `form.submitted`:** merge and deploy backend #637 first, or remove the Form Submitted option before publishing.
4. **Create the GitHub repo:** create it under the Finn org, add it as a remote, and push. Then add `repository` and `bugs` URLs to `package.json`, because the n8n verification checks them.
5. **Publish to npm:** run `npm login` with the Finn npm account, then `npm publish --access public`. The name must start with `n8n-nodes-` and the keywords must include `n8n-community-node-package`; both are already set.
6. **Optional, verified listing:** submit the package in the n8n Creator Portal so it shows up in n8n Cloud's node panel. That needs `npx @n8n/scan-community-package n8n-nodes-finn` to pass and no runtime dependencies (this package has none).
