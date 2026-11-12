'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { FinnTrigger, shapeEvent } = require('../dist/nodes/FinnTrigger/FinnTrigger.node');
const { signatureValid } = require('../dist/nodes/Finn/GenericFunctions');
const { fakeContext, done } = require('./helpers');

const node = new FinnTrigger();
const hooks = node.webhookMethods.default;
const HOOK_URL = 'https://n8n.example.com/webhook/abc/webhook';
const SECRET = 'whsec_test';

const sign = (body, secret = SECRET, t = Math.floor(Date.now() / 1000)) =>
	`t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;

const contact = { id: 'c1', name: 'Ravi Rao', phones: ['+919800000091'], emails: [], stage: 'qualified' };

const formBody = (form) => ({
	event: 'form.submitted',
	event_id: `crm:form_submitted:${form.submission_id}`,
	occurred_at: '2026-11-11T09:30:02.000Z',
	data: { contact, form },
});

test('create: subscribes one endpoint to the chosen events and keeps its secret', async () => {
	const ctx = fakeContext({
		params: { events: ['contact.created', 'form.submitted'] },
		routes: [{ method: 'POST', path: '/webhook_endpoints', status: 201, body: { id: 'we_1', url: HOOK_URL, secret: SECRET } }],
	});
	assert.equal(await hooks.create.call(ctx), true);
	assert.deepEqual(ctx.calls[0].body, { url: HOOK_URL, events: ['contact.created', 'form.submitted'], enabled: true });
	assert.match(ctx.calls[0].headers['Idempotency-Key'], /^n8n-[0-9a-f-]{36}$/);
	assert.deepEqual(ctx.staticData, { webhookId: 'we_1', webhookSecret: SECRET });
	done(ctx);
});

test('create: webhooks off for the org explains the v1_webhooks feature', async () => {
	const ctx = fakeContext({
		params: { events: ['contact.created'] },
		routes: [{ method: 'POST', path: '/webhook_endpoints', status: 403, body: { error: { code: 'webhooks_api_not_enabled', message: 'Webhooks are not enabled' } } }],
	});
	await assert.rejects(hooks.create.call(ctx), (e) => /v1_webhooks/.test(e.description));
});

test('checkExists: none stored, gone in Finn, settings changed, or the same', async () => {
	assert.equal(await hooks.checkExists.call(fakeContext({ params: { events: ['contact.created'] } })), false);

	const gone = fakeContext({
		params: { events: ['contact.created'] },
		staticData: { webhookId: 'we_1', webhookSecret: SECRET },
		routes: [{ method: 'GET', path: '/webhook_endpoints/we_1', status: 404 }],
	});
	assert.equal(await hooks.checkExists.call(gone), false);
	assert.deepEqual(gone.staticData, {});

	const changed = fakeContext({
		params: { events: ['contact.created', 'lead.created'] },
		staticData: { webhookId: 'we_1', webhookSecret: SECRET },
		routes: [
			{ method: 'GET', path: '/webhook_endpoints/we_1', body: { id: 'we_1', url: HOOK_URL, events: ['contact.created'] } },
			{ method: 'DELETE', path: '/webhook_endpoints/we_1', status: 204 },
		],
	});
	assert.equal(await hooks.checkExists.call(changed), false);
	assert.deepEqual(changed.staticData, {});
	done(changed);

	const same = fakeContext({
		params: { events: ['lead.created', 'contact.created'] },
		staticData: { webhookId: 'we_1', webhookSecret: SECRET },
		routes: [{ method: 'GET', path: '/webhook_endpoints/we_1', body: { id: 'we_1', url: HOOK_URL, events: ['contact.created', 'lead.created'] } }],
	});
	assert.equal(await hooks.checkExists.call(same), true);
	assert.equal(same.staticData.webhookId, 'we_1');
});

test('delete: removes the endpoint, a 404 is fine, a 500 is an error', async () => {
	const ctx = fakeContext({ staticData: { webhookId: 'we_1', webhookSecret: SECRET }, routes: [{ method: 'DELETE', path: '/webhook_endpoints/we_1', status: 404 }] });
	assert.equal(await hooks.delete.call(ctx), true);
	assert.deepEqual(ctx.staticData, {});
	done(ctx);

	const broken = fakeContext({ staticData: { webhookId: 'we_1' }, routes: [{ method: 'DELETE', path: '/webhook_endpoints/we_1', status: 500, body: { error: 'internal' } }] });
	await assert.rejects(hooks.delete.call(broken));
});

test('webhook: a correctly signed delivery runs the workflow', async () => {
	const body = { event: 'contact.created', event_id: 'evt_1', occurred_at: '2026-11-11T09:00:00Z', data: { contact } };
	const raw = JSON.stringify(body);
	const ctx = fakeContext({
		params: { events: ['contact.created'] },
		staticData: { webhookId: 'we_1', webhookSecret: SECRET },
		webhook: { body, rawBody: Buffer.from(raw), headers: { 'x-finn-signature': sign(raw) } },
	});
	const out = await node.webhook.call(ctx);
	const [[item]] = out.workflowData;
	assert.equal(item.json.event, 'contact.created');
	assert.equal(item.json.contact_id, 'c1');
	assert.equal(item.json.phone, '+919800000091');
	assert.equal(item.json.email, null);
});

test('webhook: a wrong or missing signature is refused with 401 and does not run', async () => {
	const body = { event: 'contact.created', data: { contact } };
	const raw = JSON.stringify(body);
	for (const header of [sign(raw, 'whsec_other'), undefined]) {
		const ctx = fakeContext({
			params: { events: ['contact.created'] },
			staticData: { webhookSecret: SECRET },
			webhook: { body, rawBody: raw, headers: header ? { 'x-finn-signature': header } : {} },
		});
		const out = await node.webhook.call(ctx);
		assert.deepEqual(out, { noWebhookResponse: true });
		assert.equal(ctx.responseLog.status, 401);
	}
});

test('webhook: without a raw body the parsed JSON is verified; other events are acknowledged and skipped', async () => {
	const body = { event: 'lead.created', event_id: 'evt_2', data: { contact, lead: { id: 'l1', via: 'form' } } };
	const ctx = fakeContext({
		params: { events: ['lead.created'] },
		staticData: { webhookSecret: SECRET },
		webhook: { body, headers: { 'x-finn-signature': sign(JSON.stringify(body)) } },
	});
	const [[item]] = (await node.webhook.call(ctx)).workflowData;
	assert.equal(item.json.lead_via, 'form');
	assert.deepEqual(item.json.lead, { id: 'l1', via: 'form' });

	const other = { event: 'call.completed', data: {} };
	const skip = fakeContext({
		params: { events: ['lead.created'] },
		staticData: { webhookSecret: SECRET },
		webhook: { body: other, headers: { 'x-finn-signature': sign(JSON.stringify(other)) } },
	});
	const out = await node.webhook.call(skip);
	assert.equal(out.workflowData, undefined);
	assert.deepEqual(out.webhookResponse, { ignored: true });
});

test('shape: form.submitted with answers', () => {
	const row = shapeEvent(
		formBody({
			id: 'f1',
			name: 'Book a consultation',
			submission_id: 's1',
			submitted_at: '2026-11-11T09:30:02.000Z',
			via: 'public',
			trust: 'new',
			new_contact: true,
			applied_fields: ['budget'],
			answers: [
				{ field_id: 'name', label: 'Your name', value: 'Ravi Rao' },
				{ field_id: 'budget', label: 'Budget (INR)', value: '15000' },
			],
		}),
	);
	assert.equal(row.event_id, 'crm:form_submitted:s1');
	assert.equal(row.form_name, 'Book a consultation');
	assert.equal(row.submission_id, 's1');
	assert.equal(row.trust, 'new');
	assert.equal(row.new_contact, true);
	assert.equal(row.answers_withheld, false);
	assert.deepEqual(row.answers_by_field, { name: 'Ravi Rao', budget: '15000' });
	assert.equal(row.form_text, 'Your name: Ravi Rao\nBudget (INR): 15000');
	assert.equal(row.contact_id, 'c1');
});

test('shape: form.submitted on an existing contact withholds answers', () => {
	const row = shapeEvent(formBody({ id: 'f1', name: 'F', submission_id: 's2', via: 'embed', trust: 'claimed_existing', new_contact: false, applied_fields: [], answers_withheld: true }));
	assert.equal(row.answers_withheld, true);
	assert.deepEqual(row.answers, []);
	assert.equal(row.form_text, null);
	assert.equal(row.new_contact, false);
});

test('shape: stage change carries from, to and who', () => {
	const row = shapeEvent({ event: 'contact.stage_changed', event_id: 'e', data: { contact, change: { from: 'new', to: 'qualified', user: { id: 'u1', name: 'Priya' } } } });
	assert.deepEqual([row.stage_from, row.stage_to, row.changed_by], ['new', 'qualified', 'Priya']);
	const bare = shapeEvent({ event: 'contact.stage_changed', data: { contact } });
	assert.deepEqual([bare.stage_from, bare.stage_to, bare.changed_by], [null, 'qualified', null]);
});

test('signatureValid: tolerance, rotated secrets and junk headers', () => {
	const body = '{"a":1}';
	const now = Date.now();
	const t = Math.floor(now / 1000);
	assert.equal(signatureValid(SECRET, sign(body, SECRET, t), body, 600, now), true);
	assert.equal(signatureValid(SECRET, sign(body, SECRET, t - 601), body, 600, now), false);
	const rotated = `${sign(body, 'whsec_old', t)},v1=${sign(body, SECRET, t).split('v1=')[1]}`;
	assert.equal(signatureValid(SECRET, rotated, body, 600, now), true);
	assert.equal(signatureValid(SECRET, 'garbage', body), false);
	assert.equal(signatureValid(SECRET, sign(body), '{"a":2}'), false);
	assert.equal(signatureValid(undefined, sign(body), body), false);
});
