// Incremental NDJSON reader and Antigravity event normalizer.
// Unknown and malformed records are deliberately non-fatal; raw process output
// remains the authoritative diagnostic stream.
const { StringDecoder } = require('node:string_decoder');\n\nconst RATE_LIMIT_RE = /(rate[ _-]?limit|usage limit|quota (exceeded|reached)|too many requests|\\b429\\b|limit reached)/i;

function normalizeAgentEvent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const event = value.event;
  if (typeof event !== 'string') return null;

  if (event === 'init') {
    return { type: 'agent-init', conversationId: value.conversation_id || value.init?.conversation_id || null };
  }

  if (event === 'step_update') {
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

  if (event === 'result') {
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
  }

  push(chunk) {
    this.pending += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    const lines = this.pending.split(/\\r?\\n/);
    this.pending = lines.pop() ?? '';
    for (const line of lines) this.parseLine(line);
  }

  end() {
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
      // Keep going. The caller also retains the unmodified stdout/stderr.
    }
  }
}

module.exports = { JsonlEventParser, normalizeAgentEvent };
