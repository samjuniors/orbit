const test = require('node:test');
const assert = require('node:assert/strict');
const { JsonlEventParser, normalizeAgentEvent } = require('../src/engine/structured-output');

test('parses records split across arbitrary chunks', () => {
  const events = [];
  const parser = new JsonlEventParser(e => events.push(e));
  parser.push('{"event":"init","conversation_');
  parser.push('id":"abc"}\n{"event":"step_update","step_update":{"step_index":2,');
  parser.push('"state":"RUNNING","step_type":"agent_response","text_delta":"hello"}}\n');
  parser.end();
  assert.equal(events.length, 2);
  assert.equal(events[0].type, 'agent-init');
  assert.equal(events[0].conversationId, 'abc');
  assert.equal(events[1].type, 'agent-progress');
  assert.equal(events[1].textDelta, 'hello');
});

test('parses multiple records in one chunk and flushes final unterminated record', () => {
  const events = [];
  const parser = new JsonlEventParser(e => events.push(e));
  parser.push('{"event":"init"}\n{"event":"result","result":{"status":"SUCCESS","response":"ok"}}');
  assert.equal(events.length, 1);
  parser.end();
  assert.equal(events.length, 2);
  assert.equal(events[1].type, 'agent-result');
});

test('malformed, blank, non-object and unknown records are ignored safely', () => {
  const events = [];
  const parser = new JsonlEventParser(e => events.push(e));
  parser.push('\nnot-json\n[]\n{"event":"future_event","data":1}\n{"event":"step_update"}\n');
  parser.end();
  assert.deepEqual(events, []);
});

test('normalizes progress and explicit structured rate-limit signals', () => {
  const progress = normalizeAgentEvent({ event: 'step_update', step_update: { text_delta: '429 too many requests' } });
  const result = normalizeAgentEvent({ event: 'result', result: { status: 'ERROR', error: 'quota exceeded' } });
  assert.equal(progress.rateLimited, true);
  assert.equal(result.rateLimited, true);
  assert.equal(result.status, 'ERROR');
});

test('consumer callback failures do not break parsing', () => {
  const events = [];
  const parser = new JsonlEventParser(() => { throw new Error('consumer'); });
  parser.push('{"event":"init"}\n{"event":"result","result":{"status":"SUCCESS"}}\n');
  parser.end();
  assert.equal(parser.pending, '');
  assert.equal(events.length, 0);
});
