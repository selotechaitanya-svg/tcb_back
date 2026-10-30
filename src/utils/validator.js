'use strict';

const { BadRequestError } = require('./errors');

/**
 * Validates that a value is a non-empty string within optional length boundaries.
 * @param {any} value
 * @param {string} fieldName
 * @param {object} [options]
 * @param {number} [options.minLength=1]
 * @param {number} [options.maxLength=255]
 * @returns {string} Trimmed string
 */
function validateString(value, fieldName, { minLength = 1, maxLength = 255 } = {}) {
  if (typeof value !== 'string') {
    throw new BadRequestError(`${fieldName} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length < minLength) {
    throw new BadRequestError(`${fieldName} must be at least ${minLength} characters long`);
  }
  if (trimmed.length > maxLength) {
    throw new BadRequestError(`${fieldName} must not exceed ${maxLength} characters`);
  }
  return trimmed;
}

/**
 * Validates that a string is a properly formatted email address.
 * @param {any} email
 * @param {string} [fieldName='Email']
 * @returns {string} Trimmed, lowercased email
 */
function validateEmail(email, fieldName = 'Email') {
  if (typeof email !== 'string') {
    throw new BadRequestError(`${fieldName} must be a string`);
  }
  const trimmed = email.trim();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmed)) {
    throw new BadRequestError(`${fieldName} must be a valid email address`);
  }
  return trimmed.toLowerCase();
}

/**
 * Validates that a role is strictly one of 'Citizen' or 'Hero'.
 * @param {any} role
 * @param {string} [fieldName='Role']
 * @returns {'Citizen'|'Hero'}
 */
function validateRole(role, fieldName = 'Role') {
  if (typeof role !== 'string') {
    throw new BadRequestError(`${fieldName} must be a string`);
  }
  const trimmed = role.trim();
  if (!['Citizen', 'Hero'].includes(trimmed)) {
    throw new BadRequestError(`${fieldName} must be either 'Citizen' or 'Hero'`);
  }
  return trimmed;
}

/**
 * Validates that a severity value is an integer between 1 and 5 inclusive.
 * @param {any} severity
 * @param {string} [fieldName='Severity']
 * @returns {number}
 */
function validateSeverity(severity, fieldName = 'Severity') {
  if (severity === null || severity === undefined || typeof severity === 'boolean') {
    throw new BadRequestError(`${fieldName} must be an integer between 1 and 5`);
  }
  const num = Number(severity);
  if (!Number.isInteger(num) || num < 1 || num > 5) {
    throw new BadRequestError(`${fieldName} must be an integer between 1 and 5`);
  }
  return num;
}

/**
 * Validates the registration request body.
 * @param {object} body
 * @returns {{ username: string, email: string, password: string, role: 'Citizen'|'Hero' }}
 */
function validateRegisterPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestError('Request body is required and must be an object');
  }
  const username = validateString(body.username, 'Username', { minLength: 3, maxLength: 50 });
  const email = validateEmail(body.email, 'Email');
  const password = validateString(body.password, 'Password', { minLength: 6, maxLength: 100 });
  const role = validateRole(body.role, 'Role');
  return { username, email, password, role };
}

/**
 * Validates the login request body.
 * @param {object} body
 * @returns {{ username: string, password: string }}
 */
function validateLoginPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestError('Request body is required and must be an object');
  }
  const username = validateString(body.username, 'Username', { minLength: 1 });
  const password = validateString(body.password, 'Password', { minLength: 1 });
  return { username, password };
}

/**
 * Validates the incident creation request body (for M2 reuse).
 * @param {object} body
 * @returns {{ title: string, description: string, category: string, severity: number, location: string }}
 */
function validateIncidentPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestError('Request body is required and must be an object');
  }
  const title = validateString(body.title, 'Title', { minLength: 1, maxLength: 200 });
  const description = validateString(body.description, 'Description', { minLength: 1, maxLength: 2000 });
  const category = validateString(body.category, 'Category', { minLength: 1, maxLength: 50 });
  const severity = validateSeverity(body.severity, 'Severity');
  const location = validateString(body.location, 'Location', { minLength: 1, maxLength: 200 });
  return { title, description, category, severity, location };
}

module.exports = {
  validateString,
  validateEmail,
  validateRole,
  validateSeverity,
  validateRegisterPayload,
  validateLoginPayload,
  validateIncidentPayload
};
