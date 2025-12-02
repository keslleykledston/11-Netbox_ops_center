/**
 * Log Sanitizer Module
 * Prevents secrets and sensitive data from being logged
 */

// Patterns to detect and redact
const SENSITIVE_PATTERNS = [
  // Passwords
  { pattern: /password["\s:=]+[^"\s,}]+/gi, replacement: 'password=***REDACTED***' },
  { pattern: /"password"\s*:\s*"[^"]*"/gi, replacement: '"password":"***REDACTED***"' },

  // Tokens
  { pattern: /token["\s:=]+[^"\s,}]+/gi, replacement: 'token=***REDACTED***' },
  { pattern: /"token"\s*:\s*"[^"]*"/gi, replacement: '"token":"***REDACTED***"' },
  { pattern: /Bearer\s+[A-Za-z0-9_\-\.]+/gi, replacement: 'Bearer ***REDACTED***' },

  // API Keys
  { pattern: /api[_-]?key["\s:=]+[^"\s,}]+/gi, replacement: 'api_key=***REDACTED***' },
  { pattern: /"api[_-]?key"\s*:\s*"[^"]*"/gi, replacement: '"api_key":"***REDACTED***"' },

  // SSH Keys
  { pattern: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(RSA\s+)?PRIVATE\s+KEY-----/gi, replacement: '***SSH_PRIVATE_KEY_REDACTED***' },

  // Database URLs
  { pattern: /postgresql:\/\/[^:]+:[^@]+@[^\s]+/gi, replacement: 'postgresql://***REDACTED***@***REDACTED***' },
  { pattern: /mysql:\/\/[^:]+:[^@]+@[^\s]+/gi, replacement: 'mysql://***REDACTED***@***REDACTED***' },

  // SNMP Communities
  { pattern: /community["\s:=]+[^"\s,}]+/gi, replacement: 'community=***REDACTED***' },
  { pattern: /"community"\s*:\s*"[^"]*"/gi, replacement: '"community":"***REDACTED***"' },

  // JWT tokens (basic detection)
  { pattern: /eyJ[A-Za-z0-9_\-]+\.eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+/g, replacement: '***JWT_REDACTED***' },

  // Generic secrets
  { pattern: /secret["\s:=]+[^"\s,}]+/gi, replacement: 'secret=***REDACTED***' },
  { pattern: /"secret"\s*:\s*"[^"]*"/gi, replacement: '"secret":"***REDACTED***"' },
];

// Fields that should always be redacted in JSON objects
const SENSITIVE_FIELD_NAMES = [
  'password',
  'passwordHash',
  'credPasswordEnc',
  'token',
  'apiKey',
  'api_key',
  'secret',
  'privateKey',
  'private_key',
  'snmpCommunity',
  'community',
  'authorization',
];

/**
 * Sanitize a string to remove sensitive information
 * @param {string} input - String to sanitize
 * @returns {string} Sanitized string
 */
export function sanitizeString(input) {
  if (typeof input !== 'string') return input;

  let sanitized = input;
  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement);
  }

  return sanitized;
}

/**
 * Sanitize an object to remove sensitive fields
 * @param {any} obj - Object to sanitize
 * @param {number} maxDepth - Maximum recursion depth
 * @returns {any} Sanitized object
 */
export function sanitizeObject(obj, maxDepth = 5) {
  if (maxDepth <= 0) return '[MAX_DEPTH_REACHED]';
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return sanitizeString(String(obj));

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item, maxDepth - 1));
  }

  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();

    // Check if field name is sensitive
    if (SENSITIVE_FIELD_NAMES.some(field => lowerKey.includes(field.toLowerCase()))) {
      sanitized[key] = '***REDACTED***';
    } else if (typeof value === 'object') {
      sanitized[key] = sanitizeObject(value, maxDepth - 1);
    } else if (typeof value === 'string') {
      sanitized[key] = sanitizeString(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Safe console.log wrapper that sanitizes output
 */
export function safeLog(...args) {
  const sanitized = args.map(arg => {
    if (typeof arg === 'string') return sanitizeString(arg);
    if (typeof arg === 'object') return sanitizeObject(arg);
    return arg;
  });
  console.log(...sanitized);
}

/**
 * Safe console.error wrapper that sanitizes output
 */
export function safeError(...args) {
  const sanitized = args.map(arg => {
    if (typeof arg === 'string') return sanitizeString(arg);
    if (typeof arg === 'object') return sanitizeObject(arg);
    return arg;
  });
  console.error(...sanitized);
}

/**
 * Safe console.warn wrapper that sanitizes output
 */
export function safeWarn(...args) {
  const sanitized = args.map(arg => {
    if (typeof arg === 'string') return sanitizeString(arg);
    if (typeof arg === 'object') return sanitizeObject(arg);
    return arg;
  });
  console.warn(...sanitized);
}

/**
 * Create a logger instance with automatic sanitization
 */
export function createSafeLogger(prefix = '') {
  const addPrefix = (msg) => prefix ? `[${prefix}] ${msg}` : msg;

  return {
    log: (...args) => safeLog(addPrefix(''), ...args),
    info: (...args) => safeLog(addPrefix('INFO'), ...args),
    warn: (...args) => safeWarn(addPrefix('WARN'), ...args),
    error: (...args) => safeError(addPrefix('ERROR'), ...args),
    debug: (...args) => {
      if (process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development') {
        safeLog(addPrefix('DEBUG'), ...args);
      }
    },
  };
}

/**
 * Test sanitizer with common secret patterns
 */
export function testSanitizer() {
  const tests = [
    { input: 'password=mySecret123', expected: 'password=***REDACTED***' },
    { input: '{"token":"abc123xyz"}', expected: '{"token":"***REDACTED***"}' },
    { input: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c', expected: 'Bearer ***JWT_REDACTED***' },
    { input: 'postgresql://user:pass123@localhost:5432/db', expected: 'postgresql://***REDACTED***@***REDACTED***' },
  ];

  console.log('[SANITIZER-TEST] Running tests...');
  let passed = 0;
  for (const test of tests) {
    const result = sanitizeString(test.input);
    const success = result.includes('***REDACTED***');
    console.log(`[${success ? 'PASS' : 'FAIL'}] ${test.input} → ${result}`);
    if (success) passed++;
  }
  console.log(`[SANITIZER-TEST] ${passed}/${tests.length} tests passed`);
}

export default {
  sanitizeString,
  sanitizeObject,
  safeLog,
  safeError,
  safeWarn,
  createSafeLogger,
  testSanitizer,
};
