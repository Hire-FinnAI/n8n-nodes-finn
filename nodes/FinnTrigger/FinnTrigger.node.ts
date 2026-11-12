import { randomUUID } from 'crypto';
import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { finnRequest, flatContact, signatureValid } from '../Finn/GenericFunctions';

// The trigger rides Finn's outbound webhooks: activating a workflow adds one webhook endpoint for the chosen events,
// deactivating deletes it. The org needs the v1_webhooks feature and the key the admin:webhooks scope; Finn allows
// 5 endpoints per org, and n8n's "listen for test event" uses one while it listens.

export const EVENTS = ['contact.created', 'contact.stage_changed', 'lead.created', 'form.submitted'];

/** One output item per delivery: the contact's fields at the top, the event and its own fields next to them. */
export const shapeEvent = (body: IDataObject): IDataObject => {
	const data = (body.data || {}) as IDataObject;
	const contact = data.contact as IDataObject | undefined;
	const row: IDataObject = {
		...(contact ? flatContact(contact) : {}),
		event: body.event ?? null,
		event_id: body.event_id ?? null,
		occurred_at: body.occurred_at ?? body.created_at ?? null,
		contact_id: contact ? (contact.id ?? null) : null,
	};

	if (body.event === 'contact.stage_changed') {
		const change = (data.change || {}) as IDataObject;
		const by = (change.user ?? change.by ?? null) as IDataObject | string | null;
		row.stage_from = change.from === undefined ? null : change.from;
		row.stage_to = change.to === undefined ? ((contact && contact.stage) ?? null) : change.to;
		row.changed_by = by && typeof by === 'object' ? (by.name ?? by.id ?? null) : by;
	}

	if (body.event === 'lead.created') {
		const lead = (data.lead || null) as IDataObject | null;
		row.lead = lead;
		row.lead_via = lead ? (lead.via ?? null) : null;
	}

	if (body.event === 'form.submitted') {
		// When a public form lands on a contact Finn already had (trust "claimed_existing"), Finn withholds the
		// answers: the item still comes through, with answers_withheld true and no answers.
		const form = (data.form || {}) as IDataObject;
		const answers = (Array.isArray(form.answers) ? form.answers : []) as IDataObject[];
		const byField: IDataObject = {};
		for (const a of answers) if (a && a.field_id) byField[String(a.field_id)] = a.value as string;
		Object.assign(row, {
			form_id: form.id ?? null,
			form_name: form.name ?? null,
			submission_id: form.submission_id ?? null,
			submitted_at: form.submitted_at ?? body.occurred_at ?? null,
			via: form.via ?? null,
			trust: form.trust ?? null,
			new_contact: form.new_contact === undefined ? null : form.new_contact,
			applied_fields: form.applied_fields ?? [],
			answers_withheld: form.answers_withheld === true,
			answers,
			answers_by_field: byField,
			form_text: answers.map((a) => `${a.label || a.field_id}: ${a.value}`).join('\n') || null,
		});
	}

	if (!contact) row.data = data;
	return row;
};

export class FinnTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Finn Trigger',
		name: 'finnTrigger',
		icon: 'file:finn.svg',
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description: 'Starts the workflow when contacts, leads or form submissions happen in Finn',
		defaults: { name: 'Finn Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'finnApi', required: true }],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				required: true,
				default: ['contact.created'],
				description: 'One Finn webhook endpoint carries all chosen events. Finn allows 5 endpoints per workspace.',
				options: [
					{
						name: 'Contact Created',
						value: 'contact.created',
						description: 'A contact was created in Finn',
					},
					{
						name: 'Contact Stage Changed',
						value: 'contact.stage_changed',
						description: 'A contact moved to another pipeline stage',
					},
					{
						name: 'Form Submitted',
						value: 'form.submitted',
						description: 'A form was submitted, by a new or an existing contact, with its answers',
					},
					{
						name: 'Lead Created',
						value: 'lead.created',
						description: 'A new lead arrived (form, ad, call, chat, API)',
					},
				],
			},
		],
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				const id = staticData.webhookId as string | undefined;
				if (!id) return false;
				const response = await finnRequest.call(this, 'GET', `/webhook_endpoints/${encodeURIComponent(id)}`, {
					allow: [404],
				});
				if (response.statusCode === 404) {
					clearStatic(staticData);
					return false;
				}
				const want = [...(this.getNodeParameter('events') as string[])].sort().join(',');
				const have = [...((response.body.events as string[]) || [])].sort().join(',');
				if (response.body.url !== this.getNodeWebhookUrl('default') || want !== have) {
					// Settings changed since the endpoint was made: drop it so create() makes a fresh one, rather than
					// leaving an orphan that counts against the 5-endpoint limit.
					await finnRequest.call(this, 'DELETE', `/webhook_endpoints/${encodeURIComponent(id)}`, { allow: [404] });
					clearStatic(staticData);
					return false;
				}
				return true;
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const events = this.getNodeParameter('events') as string[];
				const response = await finnRequest.call(this, 'POST', '/webhook_endpoints', {
					// Finn can require an Idempotency-Key on create; a fresh one per activation, so an endpoint deleted
					// earlier is never replayed.
					headers: { 'Idempotency-Key': `n8n-${randomUUID()}` },
					body: { url: this.getNodeWebhookUrl('default') as string, events, enabled: true },
				});
				const staticData = this.getWorkflowStaticData('node');
				staticData.webhookId = response.body.id as string;
				staticData.webhookSecret = (response.body.secret as string) || null;
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				const id = staticData.webhookId as string | undefined;
				if (id) {
					// Already gone (deleted in Finn) is fine.
					await finnRequest.call(this, 'DELETE', `/webhook_endpoints/${encodeURIComponent(id)}`, { allow: [404] });
				}
				clearStatic(staticData);
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const body = (this.getBodyData() || {}) as IDataObject;
		const secret = this.getWorkflowStaticData('node').webhookSecret as string | undefined;

		if (secret) {
			const req = this.getRequestObject() as { rawBody?: Buffer | string };
			const raw = req.rawBody !== undefined ? req.rawBody.toString() : JSON.stringify(body);
			const header = this.getHeaderData()['x-finn-signature'] as string | undefined;
			if (!signatureValid(secret, header, raw)) {
				const res = this.getResponseObject();
				res.status(401).send('Invalid X-Finn-Signature').end();
				return { noWebhookResponse: true };
			}
		}

		const events = this.getNodeParameter('events') as string[];
		// Acknowledge events this node does not listen to (e.g. a test ping) without running the workflow.
		if (typeof body.event === 'string' && !events.includes(body.event)) return { webhookResponse: { ignored: true } };

		return { workflowData: [this.helpers.returnJsonArray([shapeEvent(body)])] };
	}
}

const clearStatic = (staticData: IDataObject) => {
	delete staticData.webhookId;
	delete staticData.webhookSecret;
};
