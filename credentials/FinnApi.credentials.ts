import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export const FINN_API_VERSION = '2026-11-01';

export class FinnApi implements ICredentialType {
	name = 'finnApi';

	displayName = 'Finn API';

	documentationUrl = 'https://hirefinn.ai';

	icon = 'file:finn.svg' as const;

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			placeholder: 'finn_live_...',
			description:
				'An organization API key from Finn › Settings › API keys. Needs crm:read and crm:write, operator:write to start agents, and admin:webhooks for the trigger.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.hirefinn.ai/v1',
			description: 'Finn public API v1. Change it only for staging or a self-hosted gateway.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
				'Finn-Version': FINN_API_VERSION,
				Accept: 'application/json',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl.replace(/\\/+$/, "")}}',
			url: '/contacts',
			qs: { page_size: 1 },
		},
	};
}
