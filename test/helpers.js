'use strict';

const assert = require('node:assert/strict');

const BASE = 'https://api.test.finn/v1';

/**
 * A fake n8n node context. `routes` is the HTTP Finn answers, in order: { method, path, status, body, headers }.
 * Every request goes through helpers.httpRequestWithAuthentication, as in n8n; nothing touches the network.
 */
const fakeContext = ({ params = {}, items = [{ json: {} }], routes = [], staticData = {}, continueOnFail = false, webhook = {} } = {}) => {
	const calls = [];
	const queue = [...routes];
	const responseLog = { status: null, sent: null };
	const ctx = {
		calls,
		queue,
		staticData,
		responseLog,
		getNode: () => ({ name: 'Finn', type: 'n8n-nodes-finn.finn', typeVersion: 1, parameters: {} }),
		getCredentials: async (name) => {
			assert.equal(name, 'finnApi');
			return { apiKey: 'finn_live_test', baseUrl: `${BASE}/` };
		},
		getInputData: () => items,
		getNodeParameter: (name, _i, fallback) => {
			if (name in params) return params[name];
			if (fallback !== undefined) return fallback;
			throw new Error(`missing parameter ${name}`);
		},
		continueOnFail: () => continueOnFail,
		getWorkflowStaticData: () => staticData,
		getNodeWebhookUrl: () => 'https://n8n.example.com/webhook/abc/webhook',
		getBodyData: () => webhook.body,
		getHeaderData: () => webhook.headers || {},
		getRequestObject: () => ({ rawBody: webhook.rawBody }),
		getResponseObject: () => {
			const res = {
				status: (s) => ((responseLog.status = s), res),
				send: (b) => ((responseLog.sent = b), res),
				end: () => res,
			};
			return res;
		},
		helpers: {
			returnJsonArray: (rows) => rows.map((json) => ({ json })),
			httpRequestWithAuthentication: async function (credentialType, options) {
				assert.equal(credentialType, 'finnApi');
				calls.push(options);
				const next = queue.shift();
				assert.ok(next, `unexpected request ${options.method} ${options.url}`);
				assert.equal(options.method, next.method);
				assert.equal(options.url, `${BASE}${next.path}`);
				assert.equal(options.returnFullResponse, true);
				assert.equal(options.ignoreHttpStatusErrors, true);
				return { statusCode: next.status || 200, body: next.body || {}, headers: next.headers || {} };
			},
		},
	};
	return ctx;
};

const done = (ctx) => assert.equal(ctx.queue.length, 0, `requests not made: ${ctx.queue.map((r) => `${r.method} ${r.path}`).join(', ')}`);

module.exports = { fakeContext, done, BASE };
