/**
 * Script Properties access boundary.
 * No property values are embedded in source code.
 */
var Config = (function () {
  'use strict';

  var PROPERTY_KEYS = Object.freeze({
    LINE_CHANNEL_ACCESS_TOKEN: 'LINE_CHANNEL_ACCESS_TOKEN',
    LINE_CHANNEL_SECRET: 'LINE_CHANNEL_SECRET',
    GEMINI_API_KEY: 'GEMINI_API_KEY',
    GEMINI_MODEL: 'GEMINI_MODEL',
    ALLOWED_GROUP_ID: 'ALLOWED_GROUP_ID',
    ADMIN_USER_ID: 'ADMIN_USER_ID'
  });

  var ALL_REQUIRED_KEYS = Object.freeze([
    PROPERTY_KEYS.LINE_CHANNEL_ACCESS_TOKEN,
    PROPERTY_KEYS.LINE_CHANNEL_SECRET,
    PROPERTY_KEYS.GEMINI_API_KEY,
    PROPERTY_KEYS.GEMINI_MODEL,
    PROPERTY_KEYS.ALLOWED_GROUP_ID,
    PROPERTY_KEYS.ADMIN_USER_ID
  ]);

  var AUTHORIZATION_KEYS = Object.freeze([
    PROPERTY_KEYS.ALLOWED_GROUP_ID,
    PROPERTY_KEYS.ADMIN_USER_ID
  ]);

  var LINE_REPLY_KEYS = Object.freeze([
    PROPERTY_KEYS.LINE_CHANNEL_ACCESS_TOKEN
  ]);

  var GEMINI_KEYS = Object.freeze([
    PROPERTY_KEYS.GEMINI_API_KEY,
    PROPERTY_KEYS.GEMINI_MODEL
  ]);

  function getPropertyStore_(propertyStore) {
    if (propertyStore) {
      return propertyStore;
    }

    return PropertiesService.getScriptProperties();
  }

  function isMissing_(value) {
    return typeof value !== 'string' || value.trim() === '';
  }

  function validate(config, requiredKeys) {
    var keys = requiredKeys || ALL_REQUIRED_KEYS;
    var missing = [];

    keys.forEach(function (key) {
      if (!config || isMissing_(config[key])) {
        missing.push(key);
      }
    });

    return missing;
  }

  function load(requiredKeys, propertyStore) {
    var keys = requiredKeys || ALL_REQUIRED_KEYS;
    var store = getPropertyStore_(propertyStore);
    var config = {};

    keys.forEach(function (key) {
      config[key] = store.getProperty(key);
    });

    var missing = validate(config, keys);
    if (missing.length > 0) {
      throw new Error('CONFIG_MISSING: ' + missing.join(', '));
    }

    return Object.freeze(config);
  }

  function getAuthorizationConfig(propertyStore) {
    return load(AUTHORIZATION_KEYS, propertyStore);
  }

  function getLineReplyConfig(propertyStore) {
    return load(LINE_REPLY_KEYS, propertyStore);
  }

  function getGeminiConfig(propertyStore) {
    return load(GEMINI_KEYS, propertyStore);
  }

  return Object.freeze({
    PROPERTY_KEYS: PROPERTY_KEYS,
    ALL_REQUIRED_KEYS: ALL_REQUIRED_KEYS,
    AUTHORIZATION_KEYS: AUTHORIZATION_KEYS,
    LINE_REPLY_KEYS: LINE_REPLY_KEYS,
    GEMINI_KEYS: GEMINI_KEYS,
    load: load,
    validate: validate,
    getAuthorizationConfig: getAuthorizationConfig,
    getLineReplyConfig: getLineReplyConfig,
    getGeminiConfig: getGeminiConfig
  });
}());
