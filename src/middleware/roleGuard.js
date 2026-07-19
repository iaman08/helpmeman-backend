/**
 * Backward compatibility wrapper for roleGuard.
 * New code should import directly from './rbac'.
 */
const { roleGuard } = require('./rbac');

module.exports = { roleGuard };
