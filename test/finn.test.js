'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Finn } = require('../dist/nodes/Finn/Finn.node');
const { fakeContext, done } = require('./helpers');

const node = new Finn();
const run = (ctx) => node.execute.call(ctx);
const contact = (extra = {}) => ({ id: 'c1', name: 'Asha Rao', phones: ['+919812345678'], emails: ['asha@example.com'], stage: 'New', ...extra });

test('create or update: a new contact is created with name, kind and custom fields, then tags and stage are patched', async () => {
	const ctx = fakeContext({
		params: {
			resource: 'contact',
			operation: 'createOrUpdate',
			phone: ' +919812345678 ',
			additionalFields: {
				name: 'Asha Rao',
				kind: 'student',
				tags: 'webinar, hot',
				stage: 'Qualified',
				customFields: { field: [{ key: 'course', value: 'MSc' }, { key: '', value: 'skipped' }] },
			},
		},
		routes: [
			{ method: 'POST', path: '/contacts', status: 201, body: { contact: contact() } },
			{ method: 'PATCH', path: '/contacts/c1', body: { contact: contact({ stage: 'Qualified', tags: ['webinar', 'hot'] }) } },
		],
	});
	const [[item]] = await run(ctx);
	assert.deepEqual(ctx.calls[0].body, { phone: '+919812345678', name: 'Asha Rao', kind: 'student', custom_fields: { course: 'MSc' } });
	assert.deepEqual(ctx.calls[1].body, { tags: ['webinar', 'hot'], stage: 'Qualified' });
	assert.equal(item.json.created, true);
	assert.equal(item.json.phone, '+919812345678');
	assert.equal(item.json.email, 'asha@example.com');
	assert.equal(item.json.stage, 'Qualified');
	assert.deepEqual(item.pairedItem, { item: 0 });
	done(ctx);
});

test('create or update: only create fields means no second request', async () => {
	const ctx = fakeContext({
		params: { resource: 'contact', operation: 'createOrUpdate', phone: '+91981', additionalFields: { name: 'A' } },
		routes: [{ method: 'POST', path: '/contacts', status: 201, body: { contact: contact() } }],
	});
	const [[item]] = await run(ctx);
	assert.equal(item.json.created, true);
	done(ctx);
});

test('create or update: 409 contact_exists patches the existing contact with every field', async () => {
	const ctx = fakeContext({
		params: {
			resource: 'contact',
			operation: 'createOrUpdate',
			phone: '+919812345678',
			additionalFields: { name: 'Asha R', leadStatus: 'qualified', customFields: { field: [{ key: 'course', value: 'MBA' }] } },
		},
		routes: [
			{ method: 'POST', path: '/contacts', status: 409, body: { error: 'contact_exists', message: 'exists', contact_id: 'c9' } },
			{ method: 'PATCH', path: '/contacts/c9', body: { contact: contact({ id: 'c9', name: 'Asha R' }) } },
		],
	});
	const [[item]] = await run(ctx);
	assert.deepEqual(ctx.calls[1].body, { name: 'Asha R', lead_status: 'qualified', custom_fields: { course: 'MBA' } });
	assert.equal(item.json.created, false);
	assert.equal(item.json.id, 'c9');
	done(ctx);
});

test('create or update: 409 with nothing to patch reads the existing contact', async () => {
	const ctx = fakeContext({
		params: { resource: 'contact', operation: 'createOrUpdate', phone: '+91981', additionalFields: {} },
		routes: [
			{ method: 'POST', path: '/contacts', status: 409, body: { error: { code: 'contact_exists', message: 'x', contact_id: 'c9' } } },
			{ method: 'GET', path: '/contacts/c9', body: { contact: contact({ id: 'c9' }) } },
		],
	});
	const [[item]] = await run(ctx);
	assert.equal(item.json.id, 'c9');
	assert.equal(item.json.created, false);
	done(ctx);
});

test('create or update: another 409 is an error', async () => {
	const ctx = fakeContext({
		params: { resource: 'contact', operation: 'createOrUpdate', phone: '+91981', additionalFields: {} },
		routes: [{ method: 'POST', path: '/contacts', status: 409, body: { error: 'idempotency_conflict', message: 'Key reused' } }],
	});
	await assert.rejects(run(ctx), /Key reused/);
});

test('update: patches the filled fields; empty update is refused before any request', async () => {
	const ctx = fakeContext({
		params: { resource: 'contact', operation: 'update', contactId: 'c 1', updateFields: { tags: ['a', ' b '], stage: '' } },
		routes: [{ method: 'PATCH', path: '/contacts/c%201', body: { contact: contact({ tags: ['a', 'b'] }) } }],
	});
	const [[item]] = await run(ctx);
	assert.deepEqual(ctx.calls[0].body, { tags: ['a', 'b'] });
	assert.deepEqual(item.json.tags, ['a', 'b']);

	const empty = fakeContext({ params: { resource: 'contact', operation: 'update', contactId: 'c1', updateFields: {} } });
	await assert.rejects(run(empty), /at least one field/);
	assert.equal(empty.calls.length, 0);
});

test('get: reads one contact', async () => {
	const ctx = fakeContext({
		params: { resource: 'contact', operation: 'get', contactId: 'c1' },
		routes: [{ method: 'GET', path: '/contacts/c1', body: { contact: contact() } }],
	});
	const [[item]] = await run(ctx);
	assert.equal(item.json.name, 'Asha Rao');
	done(ctx);
});

test('search: return all walks every page with q and filters', async () => {
	const ctx = fakeContext({
		params: { resource: 'contact', operation: 'search', query: 'asha', returnAll: true, filters: { stage: 'qualified', tag: '' } },
		routes: [
			{ method: 'GET', path: '/contacts', body: { contacts: [contact(), contact({ id: 'c2' })], page: 1, totalPages: 2 } },
			{ method: 'GET', path: '/contacts', body: { contacts: [contact({ id: 'c3' })], page: 2, totalPages: 2 } },
		],
	});
	const [items] = await run(ctx);
	assert.deepEqual(items.map((i) => i.json.id), ['c1', 'c2', 'c3']);
	assert.deepEqual(ctx.calls[0].qs, { page_size: 100, q: 'asha', stage: 'qualified', page: 1 });
	assert.equal(ctx.calls[1].qs.page, 2);
	done(ctx);
});

test('search: limit stops early', async () => {
	const ctx = fakeContext({
		params: { resource: 'contact', operation: 'search', query: '', returnAll: false, limit: 2, filters: {} },
		routes: [{ method: 'GET', path: '/contacts', body: { contacts: [contact(), contact({ id: 'c2' }), contact({ id: 'c3' })], totalPages: 9 } }],
	});
	const [items] = await run(ctx);
	assert.equal(items.length, 2);
	assert.deepEqual(ctx.calls[0].qs, { page_size: 2, page: 1 });
	done(ctx);
});

test('note: adds the text to the contact', async () => {
	const ctx = fakeContext({
		params: { resource: 'note', operation: 'add', contactId: 'c1', text: 'Called back' },
		routes: [{ method: 'POST', path: '/contacts/c1/notes', status: 201, body: { note: { id: 'n1', type: 'note', text: 'Called back', at: 'now' } } }],
	});
	const [[item]] = await run(ctx);
	assert.deepEqual(ctx.calls[0].body, { text: 'Called back' });
	assert.equal(item.json.id, 'n1');
	assert.equal(item.json.contact_id, 'c1');
	done(ctx);
});

test('agent: starts a case for the contact with title and data', async () => {
	const ctx = fakeContext({
		params: {
			resource: 'agent',
			operation: 'startCase',
			agentId: 'a1',
			contactId: 'c1',
			additionalFields: { title: 'Follow up', data: { field: [{ key: 'course', value: 'MSc' }] } },
		},
		routes: [{ method: 'POST', path: '/agents/a1/cases', status: 201, body: { case_id: 'k1', result: 'opened' } }],
	});
	const [[item]] = await run(ctx);
	assert.deepEqual(ctx.calls[0].body, { subject: { type: 'contact', ref: 'c1' }, title: 'Follow up', data: { course: 'MSc' } });
	assert.equal(item.json.result, 'opened');
	done(ctx);
});

test('agent: a held start (202 pending_approval) comes back as result pending_approval', async () => {
	const ctx = fakeContext({
		params: { resource: 'agent', operation: 'startCase', agentId: 'a1', contactId: 'c1', additionalFields: {} },
		routes: [{ method: 'POST', path: '/agents/a1/cases', status: 202, body: { status: 'pending_approval', approve_url: 'https://x' } }],
	});
	const [[item]] = await run(ctx);
	assert.equal(item.json.result, 'pending_approval');
	assert.equal(item.json.approve_url, 'https://x');
});

test('agent dropdown: pages through GET /agents; a 403 (feature off) gives an empty list', async () => {
	const ctx = fakeContext({
		routes: [
			{ method: 'GET', path: '/agents', body: { data: [{ id: 'a1', name: 'Speed to lead', status: 'published' }], next_cursor: 'n2', has_more: true } },
			{ method: 'GET', path: '/agents', body: { data: [{ id: 'a2', title: 'Chase docs' }], next_cursor: null, has_more: false } },
		],
	});
	const options = await node.methods.loadOptions.getAgents.call(ctx);
	assert.deepEqual(options, [
		{ name: 'Speed to lead (published)', value: 'a1' },
		{ name: 'Chase docs', value: 'a2' },
	]);
	assert.equal(ctx.calls[1].qs.cursor, 'n2');
	done(ctx);

	const off = fakeContext({ routes: [{ method: 'GET', path: '/agents', status: 403, body: { error: 'feature_not_enabled' } }] });
	assert.deepEqual(await node.methods.loadOptions.getAgents.call(off), []);
});

test('errors: 401 and missing scope carry a fix-it hint; continueOnFail keeps going', async () => {
	const ctx = fakeContext({
		params: { resource: 'contact', operation: 'get', contactId: 'c1' },
		routes: [{ method: 'GET', path: '/contacts/c1', status: 401, body: { error: { code: 'invalid_api_key', message: 'Bad key' } } }],
	});
	await assert.rejects(run(ctx), (e) => e.message === 'Bad key' && /Settings › API keys/.test(e.description) && e.httpCode === '401');

	const scope = fakeContext({
		params: { resource: 'note', operation: 'add', contactId: 'c1', text: 'x' },
		routes: [{ method: 'POST', path: '/contacts/c1/notes', status: 403, body: { error: { code: 'insufficient_scope', message: 'Needs scope', required_scope: 'crm:write' } } }],
	});
	await assert.rejects(run(scope), (e) => /`crm:write`/.test(e.description));

	const soft = fakeContext({
		continueOnFail: true,
		items: [{ json: {} }, { json: {} }],
		params: { resource: 'contact', operation: 'get', contactId: 'c1' },
		routes: [
			{ method: 'GET', path: '/contacts/c1', status: 429, body: { error: 'rate_limited', message: 'Slow down' }, headers: { 'retry-after': '7' } },
			{ method: 'GET', path: '/contacts/c1', body: { contact: contact() } },
		],
	});
	const [items] = await run(soft);
	assert.deepEqual(items[0].json, { error: 'Slow down' });
	assert.equal(items[1].json.id, 'c1');
});
