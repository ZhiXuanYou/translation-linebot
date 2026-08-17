/**
 * LINE boundary for source inspection, authorization, event classification,
 * join handling, and replies.
 */
var LineService = (function () {
  'use strict';

  var EVENT_CLASSIFICATION = Object.freeze({
    AUTHORIZED_TEXT: 'AUTHORIZED_TEXT',
    AUTHORIZED_NON_TEXT: 'AUTHORIZED_NON_TEXT',
    AUTHORIZED_JOIN: 'AUTHORIZED_JOIN',
    UNAUTHORIZED: 'UNAUTHORIZED',
    UNSUPPORTED: 'UNSUPPORTED'
  });

  var REPLY_ENDPOINT = 'https://api.line.me/v2/bot/message/reply';
  var WELCOME_MESSAGE = '🇹🇼 我會自動將中文與印尼文互相翻譯。\n' +
    '🇮🇩 Saya akan menerjemahkan bahasa Mandarin Tradisional dan bahasa Indonesia secara otomatis.';

  function getSource(event) {
    if (!event || !event.source || typeof event.source.type !== 'string') {
      return null;
    }

    if (event.source.type === 'group') {
      return {
        type: 'group',
        groupId: event.source.groupId
      };
    }

    if (event.source.type === 'user') {
      return {
        type: 'user',
        userId: event.source.userId
      };
    }

    return {
      type: event.source.type
    };
  }

  function isAuthorized(source, config) {
    if (!source || !config) {
      return false;
    }

    if (source.type === 'group') {
      return typeof source.groupId === 'string' &&
        source.groupId !== '' &&
        source.groupId === config.ALLOWED_GROUP_ID;
    }

    if (source.type === 'user') {
      return typeof source.userId === 'string' &&
        source.userId !== '' &&
        source.userId === config.ADMIN_USER_ID;
    }

    return false;
  }

  function isTextMessage(event) {
    return Boolean(
      event &&
      event.type === 'message' &&
      event.message &&
      event.message.type === 'text'
    );
  }

  function classifyEvent(event, config) {
    var source = getSource(event);

    if (!isAuthorized(source, config)) {
      return EVENT_CLASSIFICATION.UNAUTHORIZED;
    }

    if (event.type === 'join') {
      return source.type === 'group'
        ? EVENT_CLASSIFICATION.AUTHORIZED_JOIN
        : EVENT_CLASSIFICATION.UNSUPPORTED;
    }

    if (event.type === 'message') {
      return isTextMessage(event)
        ? EVENT_CLASSIFICATION.AUTHORIZED_TEXT
        : EVENT_CLASSIFICATION.AUTHORIZED_NON_TEXT;
    }

    return EVENT_CLASSIFICATION.UNSUPPORTED;
  }

  function handleJoin(event, config) {
    return classifyEvent(event, config);
  }

  function isNonEmptyString_(value) {
    return typeof value === 'string' && value.trim() !== '';
  }

  function createReplyRequest(replyToken, text, accessToken) {
    if (!isNonEmptyString_(replyToken) ||
        !isNonEmptyString_(text) ||
        !isNonEmptyString_(accessToken)) {
      return null;
    }

    return {
      url: REPLY_ENDPOINT,
      options: {
        method: 'post',
        contentType: 'application/json',
        headers: {
          Authorization: 'Bearer ' + accessToken
        },
        muteHttpExceptions: true,
        payload: JSON.stringify({
          replyToken: replyToken,
          messages: [{
            type: 'text',
            text: text
          }]
        })
      }
    };
  }

  function defaultTransport_(url, options) {
    return UrlFetchApp.fetch(url, options);
  }

  function reply(replyToken, text, dependencies) {
    if (!isNonEmptyString_(replyToken) || !isNonEmptyString_(text)) {
      return {
        ok: false,
        errorType: 'INVALID_INPUT'
      };
    }

    var deps = dependencies || {};
    var config;
    try {
      config = deps.config || Config.getLineReplyConfig(deps.propertyStore);
    } catch (error) {
      return {
        ok: false,
        errorType: 'CONFIGURATION'
      };
    }

    var request = createReplyRequest(
      replyToken,
      text,
      config.LINE_CHANNEL_ACCESS_TOKEN
    );
    if (!request) {
      return {
        ok: false,
        errorType: 'INVALID_INPUT'
      };
    }

    var response;
    try {
      response = (deps.transport || defaultTransport_)(request.url, request.options);
    } catch (error) {
      return {
        ok: false,
        errorType: 'TRANSPORT_ERROR'
      };
    }

    if (!response || typeof response.getResponseCode !== 'function') {
      return {
        ok: false,
        errorType: 'PROVIDER_RESPONSE_ERROR'
      };
    }

    var statusCode;
    try {
      statusCode = response.getResponseCode();
    } catch (error) {
      return {
        ok: false,
        errorType: 'PROVIDER_RESPONSE_ERROR'
      };
    }

    if (typeof statusCode !== 'number' || !isFinite(statusCode)) {
      return {
        ok: false,
        errorType: 'PROVIDER_RESPONSE_ERROR'
      };
    }

    if (statusCode >= 200 && statusCode < 300) {
      return {
        ok: true,
        statusCode: statusCode
      };
    }

    return {
      ok: false,
      errorType: 'HTTP_ERROR',
      statusCode: statusCode
    };
  }

  return Object.freeze({
    EVENT_CLASSIFICATION: EVENT_CLASSIFICATION,
    REPLY_ENDPOINT: REPLY_ENDPOINT,
    WELCOME_MESSAGE: WELCOME_MESSAGE,
    getSource: getSource,
    isAuthorized: isAuthorized,
    isTextMessage: isTextMessage,
    classifyEvent: classifyEvent,
    handleJoin: handleJoin,
    createReplyRequest: createReplyRequest,
    reply: reply
  });
}());
