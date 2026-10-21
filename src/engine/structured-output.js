// Incremental NDJSON reader and Antigravity event normalizer.
// Unknown and malformed records are non-fatal; raw stdout/stderr remain available.
const { StringDecoder } = require('node:string_decoder');

const RATE_LIMIT_RE = /(rate[ _-]?limit|usage limit|quota (exceeded|reached)|too many requests|\b429\b|limit reached)/i;

function normalizeAgentEvent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (typeof value.event !== 'string') return null;

  if (value.event === 'init') {
    return { type: 'agent-init', conversationId: value.conversation_id || value.init?.conversation_id || null };
  }

  if (value.event === 'step_update') {
    const step = value.step_update;
    if (!step || typeof step !== 'object' || Array.isArray(step)) return null;
    const text = typeof step.text_delta === 'string' ? step.text_delta : '';
    const tool = step.tool_info && typeof step.tool_info === 'object' ? step.tool_info : null;
    return {
      type: 'agent-progress',
      stepIndex: Number.isInteger(step.step_index) ? step.step_index : null,
      state: typeof step.state === 'string' ? step.state : null,
      stepType: typeof step.step_type === 'string' ? step.step_type : null,
      textDelta: text,
      tool: tool ? { name: typeof tool.name === 'string' ? tool.name : null } : null,
      rateLimited: RATE_LIMIT_RE.test(text)
    };
  }

  if (value.event === 'result') {
    const result = value.result;
    if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
    const status = typeof result.status === 'string' ? result.status : null;
    const error = typeof result.error === 'string' ? result.error : '';
    const response = typeof result.response === 'string' ? result.response : '';
    return {
      type: 'agent-result',
      status,
      response,
      error,
      rateLimited: RATE_LIMIT_RE.test(error) || RATE_LIMIT_RE.test(response) || /RATE_LIMIT|QUOTA/i.test(status || '')
    };
  }

  return null;
}

class JsonlEventParser {
  constructor(onEvent = () => {}) {
    this.onEvent = onEvent;
    this.pending = '';
    this.decoder = new StringDecoder('utf8');
  }

  push(chunk) {
    this.pending += Buffer.isBuffer(chunk) ? this.decoder.write(chunk) : String(chunk);
    const lines = this.pending.split(/\r?\n/);
    this.pending = lines.pop() ?? '';
    for (const line of lines) this.parseLine(line);
  }

  end() {
    this.pending += this.decoder.end();
    if (this.pending.trim()) this.parseLine(this.pending);
    this.pending = '';
  }

  parseLine(line) {
    if (!line.trim()) return;
    try {
      const event = normalizeAgentEvent(JSON.parse(line));
      if (event) {
        try { this.onEvent(event); } catch {}
      }
    } catch {
      // Preserve forward progress; raw output is retained by the process runner.
    }
  }
}

module.exports = { JsonlEventParser, normalizeAgentEvent };
