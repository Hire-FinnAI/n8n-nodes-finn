'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FinnApi, FINN_API_VERSION } = require('../dist/credentials/FinnApi.credentials');

test('credential sends the bearer key and Finn-Version, and tests with GET /contacts?page_size=1', () => {
	const cred = new FinnApi();
	assert.equal(cred.name, 'finnApi');
	assert.equal(FINN_API_VERSION, '2026-11-01');
	assert.equal(cred.authenticate.properties.headers.Authorization, '=Bearer {{$credentials.apiKey}}');
	assert.equal(cred.authenticate.properties.headers['Finn-Version'], '2026-11-01');
	assert.equal(cred.test.request.url, '/contacts');
	assert.deepEqual(cred.test.request.qs, { page_size: 1 });
	assert.match(cred.test.request.baseURL, /\$credentials\.baseUrl/);
	const base = cred.properties.find((p) => p.name === 'baseUrl');
	assert.equal(base.default, 'https://api.hirefinn.ai/v1');
	assert.equal(cred.properties.find((p) => p.name === 'apiKey').typeOptions.password, true);
});

test('package.json n8n block points at the built files', () => {
	const pkg = require('../package.json');
	const fs = require('fs');
	const path = require('path');
	assert.ok(pkg.keywords.includes('n8n-community-node-package'));
	assert.equal(pkg.peerDependencies['n8n-workflow'], '*');
	for (const f of [...pkg.n8n.credentials, ...pkg.n8n.nodes]) assert.ok(fs.existsSync(path.join(__dirname, '..', f)), f);
	assert.ok(fs.existsSync(path.join(__dirname, '..', 'dist/nodes/Finn/finn.svg')));
});
