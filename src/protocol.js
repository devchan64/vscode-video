'use strict';

function handleMessage(currentMode, message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return { mode: currentMode, error: 'Invalid message' };
  }
  if (message.type === 'ready') return { mode: currentMode };
  if (message.type === 'setMode' && (message.mode === 'preview' || message.mode === 'edit')) {
    return { mode: message.mode };
  }
  return { mode: currentMode, error: 'Unsupported message' };
}
module.exports = { handleMessage };
