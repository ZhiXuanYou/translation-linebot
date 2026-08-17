/** GAS Web App entry point. */
function doPost(e, dependencies) {
  var provided = dependencies || {};

  try {
    (provided.process || WebhookHandler.process)(e);
  } catch (error) {
    // Keep the HTTP response stable and never expose request or error details.
  }

  return (provided.htmlService || HtmlService).createHtmlOutput('OK');
}

/**
 * Parses and dispatches webhook events without claiming transport authenticity.
 * Dependencies are injectable so tests never use real GAS or LINE transports.
 */
var WebhookHandler = (function () {
  'use strict';

  function parseRequest(e) {
    if (!e || !e.postData || typeof e.postData.contents !== 'string') {
      return { valid: false, events: [] };
    }

    if (e.postData.contents.trim() === '') {
      return { valid: false, events: [] };
    }

    var payload;
    try {
      payload = JSON.parse(e.postData.contents);
    } catch (error) {
      return { valid: false, events: [] };
    }

    if (!payload || !Array.isArray(payload.events)) {
      return { valid: false, events: [] };
    }

    return {
      valid: true,
      events: payload.events
    };
  }

  function createDependencies_(dependencies) {
    var provided = dependencies || {};
    return {
      getAuthorizationConfig: provided.getAuthorizationConfig || function () {
        return Config.getAuthorizationConfig();
      },
      handleText: provided.handleText || function (event) {
        return TranslationService.handleText(event);
      },
      reply: provided.reply || function (replyToken, text) {
        return LineService.reply(replyToken, text);
      }
    };
  }

  function dispatchEvent_(event, config, dependencies) {
    var classification = LineService.classifyEvent(event, config);

    if (classification === LineService.EVENT_CLASSIFICATION.AUTHORIZED_TEXT) {
      dependencies.handleText(event);
    } else if (classification === LineService.EVENT_CLASSIFICATION.AUTHORIZED_JOIN) {
      dependencies.reply(event && event.replyToken, LineService.WELCOME_MESSAGE);
    }

    return classification;
  }

  function process(e, dependencies) {
    var parsed = parseRequest(e);
    var summary = {
      accepted: parsed.valid,
      eventCount: parsed.events.length,
      classifications: []
    };

    if (!parsed.valid || parsed.events.length === 0) {
      return summary;
    }

    var deps = createDependencies_(dependencies);
    var config;
    try {
      config = deps.getAuthorizationConfig();
    } catch (error) {
      summary.configurationError = true;
      return summary;
    }

    parsed.events.forEach(function (event) {
      try {
        summary.classifications.push(dispatchEvent_(event, config, deps));
      } catch (error) {
        summary.classifications.push('INTERNAL_ERROR');
      }
    });

    return summary;
  }

  return Object.freeze({
    parseRequest: parseRequest,
    process: process
  });
}());
