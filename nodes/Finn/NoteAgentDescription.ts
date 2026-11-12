import type { INodeProperties } from 'n8n-workflow';

export const noteOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['note'] } },
		options: [{ name: 'Add', value: 'add', description: 'Add a note to a contact', action: 'Add a note' }],
		default: 'add',
	},
];

export const noteFields: INodeProperties[] = [
	{
		displayName: 'Contact ID',
		name: 'contactId',
		type: 'string',
		required: true,
		default: '',
		description: 'The Finn contact the note goes on',
		displayOptions: { show: { resource: ['note'], operation: ['add'] } },
	},
	{
		displayName: 'Text',
		name: 'text',
		type: 'string',
		typeOptions: { rows: 4 },
		required: true,
		default: '',
		description: 'Up to 2,000 characters',
		displayOptions: { show: { resource: ['note'], operation: ['add'] } },
	},
];

export const agentOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['agent'] } },
		options: [
			{
				name: 'Start Case',
				value: 'startCase',
				description: 'Start a Finn Operator agent for a contact, e.g. a follow-up or speed-to-lead agent',
				action: 'Start an agent case',
			},
		],
		default: 'startCase',
	},
];

const startCase = { show: { resource: ['agent'], operation: ['startCase'] } };

export const agentFields: INodeProperties[] = [
	{
		displayName: 'Agent Name or ID',
		name: 'agentId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getAgents' },
		required: true,
		default: '',
		description:
			'A published Operator agent. If the list is empty, paste the agent ID from its page in Finn. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		displayOptions: startCase,
	},
	{
		displayName: 'Contact ID',
		name: 'contactId',
		type: 'string',
		required: true,
		default: '',
		description: 'The Finn contact the agent works on',
		displayOptions: startCase,
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: startCase,
		options: [
			{
				displayName: 'Case Data',
				name: 'data',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				placeholder: 'Add Value',
				default: {},
				description: 'Values the agent reads, e.g. course = MSc',
				options: [
					{
						name: 'field',
						displayName: 'Value',
						values: [
							{ displayName: 'Key', name: 'key', type: 'string', default: '' },
							{ displayName: 'Value', name: 'value', type: 'string', default: '' },
						],
					},
				],
			},
			{
				displayName: 'Case Title',
				name: 'title',
				type: 'string',
				default: '',
				description: 'Shown on the case in Finn',
			},
		],
	},
];
