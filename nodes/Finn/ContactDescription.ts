import type { INodeProperties } from 'n8n-workflow';

const show = (operation: string[]) => ({ show: { resource: ['contact'], operation } });

export const contactOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['contact'] } },
		options: [
			{
				name: 'Create or Update',
				value: 'createOrUpdate',
				description: 'Create a contact, or update the contact that already has this phone number',
				action: 'Create or update a contact',
			},
			{ name: 'Get', value: 'get', description: 'Get a contact by ID', action: 'Get a contact' },
			{
				name: 'Search',
				value: 'search',
				description: 'Search contacts by name, number, email or Case ID',
				action: 'Search contacts',
			},
			{ name: 'Update', value: 'update', description: 'Update a contact by ID', action: 'Update a contact' },
		],
		default: 'createOrUpdate',
	},
];

// Fields Finn's PATCH /contacts/{id} takes. Shared by Create or Update and Update.
const writableFields: INodeProperties[] = [
	{
		displayName: 'Custom Fields',
		name: 'customFields',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		placeholder: 'Add Custom Field',
		default: {},
		description: 'Field keys as in Finn › Settings › Fields, e.g. course = MSc Data Science',
		options: [
			{
				name: 'field',
				displayName: 'Field',
				values: [
					{ displayName: 'Key', name: 'key', type: 'string', default: '' },
					{ displayName: 'Value', name: 'value', type: 'string', default: '' },
				],
			},
		],
	},
	{
		displayName: 'Lead Status',
		name: 'leadStatus',
		type: 'options',
		options: [
			{ name: 'Contacted', value: 'contacted' },
			{ name: 'Converted', value: 'converted' },
			{ name: 'Lost', value: 'lost' },
			{ name: 'New', value: 'new' },
			{ name: 'Qualified', value: 'qualified' },
		],
		default: 'new',
	},
	{ displayName: 'Name', name: 'name', type: 'string', default: '' },
	{
		displayName: 'Stage',
		name: 'stage',
		type: 'string',
		default: '',
		description: 'The pipeline stage exactly as it appears in Finn. Finn refuses a move its stage rules do not allow.',
	},
	{
		displayName: 'Tags',
		name: 'tags',
		type: 'string',
		default: '',
		placeholder: 'webinar, hot',
		description: "Comma-separated. Replaces all of the contact's tags.",
	},
];

export const contactFields: INodeProperties[] = [
	{
		displayName: 'Phone',
		name: 'phone',
		type: 'string',
		required: true,
		default: '',
		placeholder: '+919812345678',
		description: 'With country code. Finn matches existing contacts by phone.',
		displayOptions: show(['createOrUpdate']),
	},
	{
		displayName: 'Contact ID',
		name: 'contactId',
		type: 'string',
		required: true,
		default: '',
		description: 'The Finn contact ID, e.g. contact_id from the Finn Trigger',
		displayOptions: show(['get', 'update']),
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: show(['createOrUpdate']),
		options: [
			...writableFields,
			{
				displayName: 'Record Kind',
				name: 'kind',
				type: 'string',
				default: '',
				description:
					'Only used for a new contact, in workspaces with several record kinds (e.g. student). Leave empty for the default.',
			},
		],
	},
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: show(['update']),
		options: writableFields,
	},
	{
		displayName: 'Search Text',
		name: 'query',
		type: 'string',
		default: '',
		description: 'Name, number, email or Case ID. Leave empty to list contacts.',
		displayOptions: show(['search']),
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: show(['search']),
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: { show: { resource: ['contact'], operation: ['search'], returnAll: [false] } },
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: show(['search']),
		options: [
			{
				displayName: 'Record Kind',
				name: 'kind',
				type: 'string',
				default: '',
				description: 'A record kind key, or all',
			},
			{
				displayName: 'Stage Key',
				name: 'stage',
				type: 'string',
				default: '',
				description: 'Only contacts at this stage key (lowercase, e.g. qualified)',
			},
			{ displayName: 'Tag', name: 'tag', type: 'string', default: '', description: 'Only contacts with this tag' },
		],
	},
];
