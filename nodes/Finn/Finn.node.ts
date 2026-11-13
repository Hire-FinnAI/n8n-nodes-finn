import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { contactFields, contactOperations } from './ContactDescription';
import { agentFields, agentOperations, noteFields, noteOperations } from './NoteAgentDescription';
import { errorOf, finnRequest, flatContact, keyValues, tagList } from './GenericFunctions';

const present = (v: unknown) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);

/** The PATCH /contacts/{id} body for the fields the user filled in. Tags replace the contact's whole tag list. */
export const patchBody = (fields: IDataObject): IDataObject => {
	const body: IDataObject = {};
	if (present(fields.name)) body.name = fields.name;
	if (present(fields.tags)) {
		const tags = tagList(fields.tags);
		if (tags.length) body.tags = tags;
	}
	if (present(fields.stage)) body.stage = fields.stage;
	if (present(fields.leadStatus)) body.lead_status = fields.leadStatus;
	const custom = keyValues(fields.customFields);
	if (Object.keys(custom).length) body.custom_fields = custom;
	return body;
};

export class Finn implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Finn',
		name: 'finn',
		icon: 'file:finn.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Work with contacts, notes and Operator agents in Finn',
		defaults: { name: 'Finn' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'finnApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Agent', value: 'agent' },
					{ name: 'Contact', value: 'contact' },
					{ name: 'Note', value: 'note' },
				],
				default: 'contact',
			},
			...contactOperations,
			...contactFields,
			...noteOperations,
			...noteFields,
			...agentOperations,
			...agentFields,
		],
	};

	methods = {
		loadOptions: {
			// Listing agents needs the v1_agent_build feature; without it the list is empty and the user pastes an ID.
			async getAgents(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const out: INodePropertyOptions[] = [];
				let cursor: string | undefined;
				for (let page = 0; page < 5; page++) {
					const qs: IDataObject = { limit: 100 };
					if (cursor) qs.cursor = cursor;
					const response = await finnRequest.call(this, 'GET', '/agents', { qs, allow: [403, 404] });
					if (response.statusCode >= 400) break;
					for (const a of (response.body.data as IDataObject[]) || []) {
						const name = String(a.name || a.title || a.id);
						out.push({ name: a.status ? `${name} (${a.status})` : name, value: String(a.id) });
					}
					cursor = response.body.next_cursor ? String(response.body.next_cursor) : undefined;
					if (!response.body.has_more || !cursor) break;
				}
				return out;
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const out: INodeExecutionData[] = [];
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		for (let i = 0; i < items.length; i++) {
			try {
				const rows = await run.call(this, resource, operation, i);
				for (const json of rows) out.push({ json, pairedItem: { item: i } });
			} catch (error) {
				if (this.continueOnFail()) {
					out.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				throw error;
			}
		}
		return [out];
	}
}

const id = (v: unknown) => encodeURIComponent(String(v).trim());

async function run(this: IExecuteFunctions, resource: string, operation: string, i: number): Promise<IDataObject[]> {
	if (resource === 'contact') {
		if (operation === 'createOrUpdate') return [await createOrUpdate.call(this, i)];

		if (operation === 'update') {
			const contactId = this.getNodeParameter('contactId', i) as string;
			const body = patchBody(this.getNodeParameter('updateFields', i, {}) as IDataObject);
			if (!Object.keys(body).length) {
				throw new NodeOperationError(this.getNode(), 'Fill in at least one field to update.', { itemIndex: i });
			}
			const response = await finnRequest.call(this, 'PATCH', `/contacts/${id(contactId)}`, { body });
			return [flatContact(response.body.contact)];
		}

		if (operation === 'get') {
			const contactId = this.getNodeParameter('contactId', i) as string;
			const response = await finnRequest.call(this, 'GET', `/contacts/${id(contactId)}`);
			return [flatContact(response.body.contact)];
		}

		if (operation === 'search') return search.call(this, i);
	}

	if (resource === 'note' && operation === 'add') {
		const contactId = this.getNodeParameter('contactId', i) as string;
		const text = this.getNodeParameter('text', i) as string;
		const response = await finnRequest.call(this, 'POST', `/contacts/${id(contactId)}/notes`, { body: { text } });
		return [{ contact_id: contactId, ...((response.body.note as IDataObject) || response.body) }];
	}

	if (resource === 'agent' && operation === 'startCase') {
		const agentId = this.getNodeParameter('agentId', i) as string;
		const contactId = this.getNodeParameter('contactId', i) as string;
		const extra = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
		const body: IDataObject = { subject: { type: 'contact', ref: contactId } };
		if (present(extra.title)) body.title = extra.title;
		const data = keyValues(extra.data);
		if (Object.keys(data).length) body.data = data;
		const response = await finnRequest.call(this, 'POST', `/agents/${id(agentId)}/cases`, { body });
		// A held start (202) waits for a person in Finn to approve it.
		if (response.statusCode === 202 && response.body.status === 'pending_approval') {
			return [{ ...response.body, result: 'pending_approval' }];
		}
		return [response.body];
	}

	throw new NodeOperationError(this.getNode(), `Unsupported operation "${operation}" for "${resource}".`, {
		itemIndex: i,
	});
}

// Finn keys contacts by phone. Create first; Finn answers 409 contact_exists with the existing contact's id, and
// then the same fields are written with PATCH.
async function createOrUpdate(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	const phone = String(this.getNodeParameter('phone', i)).trim();
	const fields = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
	const all = patchBody(fields);

	const createBody: IDataObject = { phone };
	if (all.name) createBody.name = all.name;
	if (present(fields.kind)) createBody.kind = fields.kind;
	if (all.custom_fields) createBody.custom_fields = all.custom_fields;

	const create = await finnRequest.call(this, 'POST', '/contacts', { body: createBody, allow: [409] });

	let contactId: string;
	let contact: IDataObject | undefined;
	let patch: IDataObject;
	let created: boolean;
	if (create.statusCode === 409) {
		const { code, message } = errorOf(409, create.body);
		const err = create.body.error as IDataObject | undefined;
		// Finn's v1 errors carry extra context in error.fields ({ field: 'contact_id', value }); older bodies had it flat.
		const extras = err && typeof err === 'object' && Array.isArray(err.fields) ? (err.fields as IDataObject[]) : [];
		const existing =
			create.body.contact_id ||
			(err && typeof err === 'object' ? err.contact_id : undefined) ||
			extras.find((f) => f && f.field === 'contact_id')?.value;
		if (code !== 'contact_exists' || !existing) {
			throw new NodeOperationError(this.getNode(), message, { itemIndex: i });
		}
		contactId = String(existing);
		created = false;
		patch = all;
	} else {
		contact = create.body.contact as IDataObject | undefined;
		contactId = String(contact && contact.id);
		created = true;
		// Create takes only phone, name, kind and custom fields; the rest is set right after.
		const { name, custom_fields: cf, ...rest } = all;
		patch = rest;
	}

	if (Object.keys(patch).length || !contact) {
		const hasPatch = Object.keys(patch).length > 0;
		const response = await finnRequest.call(this, hasPatch ? 'PATCH' : 'GET', `/contacts/${id(contactId)}`, {
			...(hasPatch ? { body: patch } : {}),
		});
		contact = response.body.contact as IDataObject;
	}
	return { ...flatContact(contact), created };
}

async function search(this: IExecuteFunctions, i: number): Promise<IDataObject[]> {
	const query = this.getNodeParameter('query', i, '') as string;
	const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
	const returnAll = this.getNodeParameter('returnAll', i, false) as boolean;
	const limit = returnAll ? Infinity : (this.getNodeParameter('limit', i, 50) as number);

	const qs: IDataObject = { page_size: Math.min(100, Number.isFinite(limit) ? limit : 100) };
	if (present(query)) qs.q = query;
	for (const key of ['stage', 'tag', 'kind']) if (present(filters[key])) qs[key] = filters[key];

	const out: IDataObject[] = [];
	for (let page = 1; out.length < limit; page++) {
		const response = await finnRequest.call(this, 'GET', '/contacts', { qs: { ...qs, page } });
		const contacts = (response.body.contacts as IDataObject[]) || [];
		for (const c of contacts) {
			if (out.length >= limit) break;
			out.push(flatContact(c));
		}
		const totalPages = Number(response.body.totalPages ?? response.body.total_pages ?? page);
		if (!contacts.length || page >= totalPages) break;
	}
	return out;
}
