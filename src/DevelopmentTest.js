/** Phase 3 mock tests. No real GAS service or external API is used. */
function runPhase3MockTests() {
  var passed = 0;
  var failed = 0;
  var mockGroupId = 'mock-group-allowed';
  var mockAdminId = 'mock-user-admin';
  var mockStore = createMockPropertyStore_({
    ALLOWED_GROUP_ID: mockGroupId,
    ADMIN_USER_ID: mockAdminId
  });
  var config = Config.getAuthorizationConfig(mockStore);

  function assertEqual(name, actual, expected) {
    if (actual === expected) {
      passed += 1;
      console.log('PASS: ' + name);
      return;
    }

    failed += 1;
    console.log('FAIL: ' + name + ' (expected ' + expected + ', got ' + actual + ')');
  }

  function classify(event) {
    return LineService.classifyEvent(event, config);
  }

  var types = LineService.EVENT_CLASSIFICATION;

  assertEqual('allowed group text', classify(mockMessageEvent_('group', mockGroupId, 'text')), types.AUTHORIZED_TEXT);
  assertEqual('other group text', classify(mockMessageEvent_('group', 'mock-group-other', 'text')), types.UNAUTHORIZED);
  assertEqual('admin private text', classify(mockMessageEvent_('user', mockAdminId, 'text')), types.AUTHORIZED_TEXT);
  assertEqual('other private text', classify(mockMessageEvent_('user', 'mock-user-other', 'text')), types.UNAUTHORIZED);
  assertEqual('allowed group image', classify(mockMessageEvent_('group', mockGroupId, 'image')), types.AUTHORIZED_NON_TEXT);
  assertEqual('allowed group sticker', classify(mockMessageEvent_('group', mockGroupId, 'sticker')), types.AUTHORIZED_NON_TEXT);
  assertEqual('allowed group audio', classify(mockMessageEvent_('group', mockGroupId, 'audio')), types.AUTHORIZED_NON_TEXT);
  assertEqual('allowed group join', classify(mockJoinEvent_('group', mockGroupId)), types.AUTHORIZED_JOIN);
  assertEqual('other group join', classify(mockJoinEvent_('group', 'mock-group-other')), types.UNAUTHORIZED);
  assertEqual('missing source', classify({ type: 'message', message: { type: 'text', text: 'mock' } }), types.UNAUTHORIZED);
  assertEqual('group missing groupId', classify(mockMessageEvent_('group', null, 'text')), types.UNAUTHORIZED);
  assertEqual('private missing userId', classify(mockMessageEvent_('user', null, 'text')), types.UNAUTHORIZED);
  assertEqual('unsupported source type', classify(mockMessageEvent_('room', 'mock-room', 'text')), types.UNAUTHORIZED);
  assertEqual('authorized irrelevant event', classify({ type: 'follow', source: { type: 'user', userId: mockAdminId } }), types.UNSUPPORTED);
  assertEqual('source extraction omits sender userId', Object.prototype.hasOwnProperty.call(
    LineService.getSource({ source: { type: 'group', groupId: mockGroupId, userId: 'mock-sender' } }),
    'userId'
  ), false);

  var missingError = '';
  try {
    Config.getAuthorizationConfig(createMockPropertyStore_({
      ALLOWED_GROUP_ID: mockGroupId,
      ADMIN_USER_ID: '   '
    }));
  } catch (error) {
    missingError = error.message;
  }

  assertEqual('missing config names property only', missingError, 'CONFIG_MISSING: ADMIN_USER_ID');
  assertEqual('authorization config reads only two keys', mockStore.getReadCount(), 2);

  console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) {
    throw new Error('PHASE3_TEST_FAILED: ' + failed);
  }

  return {
    passed: passed,
    failed: failed
  };
}

function createMockPropertyStore_(values) {
  var readCount = 0;

  return {
    getProperty: function (key) {
      readCount += 1;
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
    },
    getReadCount: function () {
      return readCount;
    }
  };
}

function mockMessageEvent_(sourceType, sourceId, messageType) {
  var source = { type: sourceType };
  if (sourceType === 'group' && sourceId !== null) {
    source.groupId = sourceId;
  } else if (sourceType === 'user' && sourceId !== null) {
    source.userId = sourceId;
  }

  return {
    type: 'message',
    source: source,
    message: {
      type: messageType,
      text: messageType === 'text' ? 'mock message' : undefined
    }
  };
}

function mockJoinEvent_(sourceType, sourceId) {
  var source = { type: sourceType };
  if (sourceType === 'group' && sourceId !== null) {
    source.groupId = sourceId;
  }

  return {
    type: 'join',
    source: source
  };
}

/** Phase 4 webhook and LINE reply tests using injected local mocks only. */
function runPhase4MockTests() {
  var passed = 0;
  var failed = 0;
  var mockGroupId = 'mock-group-allowed';
  var mockAdminId = 'mock-user-admin';
  var mockReplyToken = 'mock-reply-token';
  var mockAccessToken = 'mock-access-token';
  var mockChannelSecret = 'mock-channel-secret';
  var mockPrivateText = 'mock-private-message';
  var config = {
    ALLOWED_GROUP_ID: mockGroupId,
    ADMIN_USER_ID: mockAdminId
  };

  function assertEqual(name, actual, expected) {
    if (actual === expected) {
      passed += 1;
      console.log('PASS: ' + name);
      return;
    }

    failed += 1;
    console.log('FAIL: ' + name);
  }

  function createWebhookEvent(events) {
    return {
      postData: {
        contents: JSON.stringify({ events: events })
      }
    };
  }

  function processOne(event) {
    var textCalls = 0;
    var replyCalls = [];
    var summary = WebhookHandler.process(createWebhookEvent([event]), {
      getAuthorizationConfig: function () {
        return config;
      },
      handleText: function () {
        textCalls += 1;
      },
      reply: function (replyToken, text) {
        replyCalls.push({ replyToken: replyToken, text: text });
        return { ok: true, statusCode: 200 };
      }
    });

    return {
      summary: summary,
      textCalls: textCalls,
      replyCalls: replyCalls
    };
  }

  var validParse = WebhookHandler.parseRequest(createWebhookEvent([
    mockMessageEvent_('group', mockGroupId, 'text')
  ]));
  assertEqual('valid webhook accepted', validParse.valid, true);
  assertEqual('valid webhook has one event', validParse.events.length, 1);

  var emptyParse = WebhookHandler.parseRequest(createWebhookEvent([]));
  assertEqual('empty events accepted', emptyParse.valid, true);
  assertEqual('empty events count', emptyParse.events.length, 0);
  assertEqual('empty body rejected', WebhookHandler.parseRequest({ postData: { contents: '' } }).valid, false);
  assertEqual('malformed JSON rejected', WebhookHandler.parseRequest({ postData: { contents: '{' } }).valid, false);
  assertEqual('missing postData rejected', WebhookHandler.parseRequest({}).valid, false);
  assertEqual('missing contents rejected', WebhookHandler.parseRequest({ postData: {} }).valid, false);
  assertEqual('missing events rejected', WebhookHandler.parseRequest({
    postData: { contents: JSON.stringify({}) }
  }).valid, false);
  assertEqual('non-array events rejected', WebhookHandler.parseRequest({
    postData: { contents: JSON.stringify({ events: {} }) }
  }).valid, false);

  var htmlOutput = { outputType: 'HtmlOutput', content: 'OK' };
  var htmlOutputCalls = 0;
  var doPostResponse = doPost({}, {
    process: function () {
      throw new Error('mock webhook processing failure');
    },
    htmlService: {
      createHtmlOutput: function (content) {
        htmlOutputCalls += 1;
        htmlOutput.content = content;
        return htmlOutput;
      }
    }
  });
  assertEqual('doPost creates one HtmlOutput', htmlOutputCalls, 1);
  assertEqual('doPost returns HtmlOutput', doPostResponse.outputType, 'HtmlOutput');
  assertEqual('doPost returns fixed OK content', doPostResponse.content, 'OK');

  var noWriteSummary = WebhookHandler.process(createWebhookEvent([
    mockMessageEvent_('group', 'mock-group-unknown', 'text')
  ]), {
    getAuthorizationConfig: function () {
      return config;
    }
  });
  assertEqual('unknown group remains unauthorized after temporary cleanup',
    noWriteSummary.classifications[0], LineService.EVENT_CLASSIFICATION.UNAUTHORIZED);

  var allowedGroupText = processOne(mockMessageEvent_('group', mockGroupId, 'text'));
  assertEqual('allowed group reaches translation boundary', allowedGroupText.textCalls, 1);
  var adminText = processOne(mockMessageEvent_('user', mockAdminId, 'text'));
  assertEqual('admin private reaches translation boundary', adminText.textCalls, 1);
  var otherGroupText = processOne(mockMessageEvent_('group', 'mock-group-other', 'text'));
  assertEqual('other group skips translation boundary', otherGroupText.textCalls, 0);
  var otherUserText = processOne(mockMessageEvent_('user', 'mock-user-other', 'text'));
  assertEqual('other user skips translation boundary', otherUserText.textCalls, 0);

  ['image', 'sticker', 'audio'].forEach(function (messageType) {
    var result = processOne(mockMessageEvent_('group', mockGroupId, messageType));
    assertEqual(messageType + ' skips translation boundary', result.textCalls, 0);
    assertEqual(messageType + ' skips reply transport', result.replyCalls.length, 0);
  });

  var allowedJoinEvent = mockJoinEvent_('group', mockGroupId);
  allowedJoinEvent.replyToken = mockReplyToken;
  var allowedJoin = processOne(allowedJoinEvent);
  assertEqual('allowed join replies once', allowedJoin.replyCalls.length, 1);
  assertEqual('allowed join uses event reply token', allowedJoin.replyCalls[0].replyToken, mockReplyToken);
  assertEqual('allowed join uses fixed welcome', allowedJoin.replyCalls[0].text, LineService.WELCOME_MESSAGE);

  var otherJoinEvent = mockJoinEvent_('group', 'mock-group-other');
  otherJoinEvent.replyToken = mockReplyToken;
  assertEqual('other group join does not reply', processOne(otherJoinEvent).replyCalls.length, 0);

  var request = LineService.createReplyRequest(mockReplyToken, 'mock reply text', mockAccessToken);
  var requestPayload = JSON.parse(request.options.payload);
  assertEqual('reply endpoint is correct', request.url, LineService.REPLY_ENDPOINT);
  assertEqual('reply method is POST', request.options.method, 'post');
  assertEqual('reply content type is JSON', request.options.contentType, 'application/json');
  assertEqual('reply authorization is Bearer', request.options.headers.Authorization, 'Bearer ' + mockAccessToken);
  assertEqual('reply payload token is correct', requestPayload.replyToken, mockReplyToken);
  assertEqual('reply payload has one message', requestPayload.messages.length, 1);
  assertEqual('reply payload supports text only', requestPayload.messages[0].type, 'text');

  var transportCalls = 0;
  var missingTokenResult = LineService.reply('', 'mock reply text', {
    config: { LINE_CHANNEL_ACCESS_TOKEN: mockAccessToken },
    transport: function () {
      transportCalls += 1;
    }
  });
  assertEqual('missing reply token is invalid', missingTokenResult.errorType, 'INVALID_INPUT');
  assertEqual('missing reply token skips transport', transportCalls, 0);

  function responseWithCode(statusCode) {
    return {
      getResponseCode: function () {
        return statusCode;
      }
    };
  }

  function replyWithTransport(transport) {
    return LineService.reply(mockReplyToken, 'mock reply text', {
      config: { LINE_CHANNEL_ACCESS_TOKEN: mockAccessToken },
      transport: transport
    });
  }

  var successResult = replyWithTransport(function () { return responseWithCode(200); });
  assertEqual('LINE success is ok', successResult.ok, true);
  assertEqual('LINE success retains status', successResult.statusCode, 200);

  var clientError = replyWithTransport(function () { return responseWithCode(400); });
  assertEqual('LINE 4xx is not ok', clientError.ok, false);
  assertEqual('LINE 4xx uses safe error type', clientError.errorType, 'HTTP_ERROR');
  assertEqual('LINE 4xx retains status', clientError.statusCode, 400);

  var serverError = replyWithTransport(function () { return responseWithCode(503); });
  assertEqual('LINE 5xx is not ok', serverError.ok, false);
  assertEqual('LINE 5xx uses safe error type', serverError.errorType, 'HTTP_ERROR');
  assertEqual('LINE 5xx retains status', serverError.statusCode, 503);

  var transportError = replyWithTransport(function () {
    throw new Error('mock transport failure containing ' + mockAccessToken);
  });
  assertEqual('transport exception uses safe error type', transportError.errorType, 'TRANSPORT_ERROR');

  var malformedResponse = replyWithTransport(function () { return {}; });
  assertEqual('malformed provider response is safe', malformedResponse.errorType, 'PROVIDER_RESPONSE_ERROR');

  var responseCodeError = replyWithTransport(function () {
    return {
      getResponseCode: function () {
        throw new Error('mock response failure');
      }
    };
  });
  assertEqual('response code exception is safe', responseCodeError.errorType, 'PROVIDER_RESPONSE_ERROR');

  var diagnostics = JSON.stringify({
    clientError: clientError,
    serverError: serverError,
    transportError: transportError,
    malformedResponse: malformedResponse,
    responseCodeError: responseCodeError
  });
  assertEqual('diagnostics omit access token', diagnostics.indexOf(mockAccessToken), -1);
  assertEqual('diagnostics omit channel secret', diagnostics.indexOf(mockChannelSecret), -1);
  assertEqual('diagnostics omit reply token', diagnostics.indexOf(mockReplyToken), -1);
  assertEqual('diagnostics omit private text', diagnostics.indexOf(mockPrivateText), -1);

  var replyStore = createMockPropertyStore_({
    LINE_CHANNEL_ACCESS_TOKEN: mockAccessToken
  });
  Config.getLineReplyConfig(replyStore);
  assertEqual('reply config reads only access token', replyStore.getReadCount(), 1);

  console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) {
    throw new Error('PHASE4_TEST_FAILED: ' + failed);
  }

  return {
    passed: passed,
    failed: failed
  };
}

function runAllMockTests() {
  var phase3 = runPhase3MockTests();
  var phase4 = runPhase4MockTests();
  var phase5 = runPhase5MockTests();
  var phase6 = runPhase6MockTests();
  var total = {
    passed: phase3.passed + phase4.passed + phase5.passed + phase6.passed,
    failed: phase3.failed + phase4.failed + phase5.failed + phase6.failed
  };
  console.log('TOTAL: ' + total.passed + ' passed, ' + total.failed + ' failed');
  return total;
}

/** Phase 5 Gemini and single-message translation tests with mock transports. */
function runPhase5MockTests() {
  var passed = 0;
  var failed = 0;
  var mockApiKey = 'mock-gemini-api-key';
  var mockModel = 'gemini-3.5-flash-lite';
  var mockLineToken = 'mock-line-access-token';
  var mockLineSecret = 'mock-line-channel-secret';
  var mockPrivateText = 'mock-private-care-message';
  var aiConfig = {
    GEMINI_API_KEY: mockApiKey,
    GEMINI_MODEL: mockModel
  };

  function assertEqual(name, actual, expected) {
    if (actual === expected) {
      passed += 1;
      console.log('PASS: ' + name);
      return;
    }

    failed += 1;
    console.log('FAIL: ' + name);
  }

  function response(statusCode, body) {
    return {
      getResponseCode: function () {
        return statusCode;
      },
      getContentText: function () {
        return body;
      }
    };
  }

  function providerBody(output) {
    return JSON.stringify({
      candidates: [{
        content: {
          parts: [{ text: typeof output === 'string' ? output : JSON.stringify(output) }]
        }
      }]
    });
  }

  function translateWithOutput(text, output) {
    return AiService.translate(text, {
      config: aiConfig,
      transport: function () {
        return response(200, providerBody(output));
      }
    });
  }

  var request = AiService.buildRequest(mockPrivateText, aiConfig);
  var requestPayload = JSON.parse(request.options.payload);
  var requestInput = JSON.parse(requestPayload.contents[0].parts[0].text);
  var prompt = requestPayload.systemInstruction.parts[0].text;
  assertEqual('Gemini request uses injected model', request.url.indexOf(encodeURIComponent(mockModel)) >= 0, true);
  assertEqual('Gemini request uses injected API key', request.url.indexOf(encodeURIComponent(mockApiKey)) >= 0, true);
  assertEqual('Gemini request method is POST', request.options.method, 'post');
  assertEqual('Gemini request content type is JSON', request.options.contentType, 'application/json');
  assertEqual('Gemini request carries current text', requestInput.currentMessage, mockPrivateText);
  assertEqual('Gemini request has empty history by default', requestInput.conversationHistory.length, 0);
  assertEqual('prompt limits role to translation', prompt.indexOf('only task is translation') >= 0, true);
  assertEqual('prompt includes care context', prompt.indexOf('阿嬤') >= 0, true);
  assertEqual('prompt addresses Ibu', prompt.indexOf('Ibu') >= 0, true);
  assertEqual('prompt preserves medical values', prompt.indexOf('blood pressure') >= 0 && prompt.indexOf('doses') >= 0, true);
  assertEqual('prompt defines English fallback', prompt.indexOf('English-only') >= 0 && prompt.indexOf('zh-TW') >= 0, true);
  assertEqual('request uses JSON response MIME type', requestPayload.generationConfig.responseMimeType, 'application/json');
  assertEqual('request requires translatedText', requestPayload.generationConfig.responseSchema.required.indexOf('translatedText') >= 0, true);
  assertEqual('request excludes LINE access token', request.options.payload.indexOf(mockLineToken), -1);
  assertEqual('request excludes LINE channel secret', request.options.payload.indexOf(mockLineSecret), -1);

  var geminiStore = createMockPropertyStore_({
    GEMINI_API_KEY: mockApiKey,
    GEMINI_MODEL: mockModel
  });
  var loadedAiConfig = Config.getGeminiConfig(geminiStore);
  assertEqual('Gemini config gets API key', loadedAiConfig.GEMINI_API_KEY, mockApiKey);
  assertEqual('Gemini config gets model', loadedAiConfig.GEMINI_MODEL, mockModel);
  assertEqual('Gemini config reads only two properties', geminiStore.getReadCount(), 2);

  var missingApiKey = '';
  try {
    Config.getGeminiConfig(createMockPropertyStore_({ GEMINI_MODEL: mockModel }));
  } catch (error) {
    missingApiKey = error.message;
  }
  assertEqual('missing Gemini API key names property only', missingApiKey, 'CONFIG_MISSING: GEMINI_API_KEY');

  var missingModel = '';
  try {
    Config.getGeminiConfig(createMockPropertyStore_({ GEMINI_API_KEY: mockApiKey }));
  } catch (error) {
    missingModel = error.message;
  }
  assertEqual('missing Gemini model names property only', missingModel, 'CONFIG_MISSING: GEMINI_MODEL');

  var aiOnlyStore = createMockPropertyStore_({
    GEMINI_API_KEY: mockApiKey,
    GEMINI_MODEL: mockModel
  });
  Config.getGeminiConfig(aiOnlyStore);
  assertEqual('Gemini config does not require LINE properties', aiOnlyStore.getReadCount(), 2);

  var chinese = translateWithOutput('阿嬤吃飯了嗎？', {
    sourceLanguage: 'zh-TW',
    targetLanguage: 'id',
    translatedText: 'Apakah Nenek sudah makan?'
  });
  assertEqual('Chinese translates to Indonesian target', chinese.targetLanguage, 'id');
  assertEqual('Chinese final LINE format', TranslationService.formatTranslation(chinese), '🇮🇩：Apakah Nenek sudah makan?');

  var indonesian = translateWithOutput('Nenek sudah makan.', {
    sourceLanguage: 'id',
    targetLanguage: 'zh-TW',
    translatedText: '阿嬤已經吃飯了。'
  });
  assertEqual('Indonesian translates to Traditional Chinese target', indonesian.targetLanguage, 'zh-TW');
  assertEqual('Indonesian final LINE format', TranslationService.formatTranslation(indonesian), '🇹🇼：阿嬤已經吃飯了。');

  var english = translateWithOutput('Grandma has eaten.', {
    sourceLanguage: 'en',
    targetLanguage: 'zh-TW',
    translatedText: '阿嬤已經吃飯了。'
  });
  assertEqual('English without context targets Traditional Chinese', english.targetLanguage, 'zh-TW');
  assertEqual('English final LINE format', TranslationService.formatTranslation(english), '🇹🇼：阿嬤已經吃飯了。');

  var mixed = translateWithOutput('阿嬤 sudah makan 了嗎？', {
    sourceLanguage: 'mixed',
    targetLanguage: 'id',
    translatedText: 'Apakah Nenek sudah makan?'
  });
  assertEqual('mixed input is accepted', mixed.ok, true);
  assertEqual('mixed input has valid target', mixed.targetLanguage, 'id');

  var medicalText = '血壓 145/80，15:30 吃 1/2 顆。';
  var medical = translateWithOutput(medicalText, {
    sourceLanguage: 'zh-TW',
    targetLanguage: 'id',
    translatedText: 'Tekanan darah 145/80, minum 1/2 tablet pukul 15:30.'
  });
  var medicalDisplay = TranslationService.formatTranslation(medical);
  assertEqual('blood pressure is not rewritten', medicalDisplay.indexOf('145/80') >= 0, true);
  assertEqual('dose is not rewritten', medicalDisplay.indexOf('1/2') >= 0, true);
  assertEqual('time is not rewritten', medicalDisplay.indexOf('15:30') >= 0, true);

  function translateWithResponse(mockResponse) {
    return AiService.translate(mockPrivateText, {
      config: aiConfig,
      transport: function () {
        return mockResponse;
      }
    });
  }

  var error400 = translateWithResponse(response(400, 'mock provider body'));
  assertEqual('Gemini 400 is HTTP error', error400.errorType, 'AI_HTTP_ERROR');
  assertEqual('Gemini 400 keeps safe status', error400.statusCode, 400);
  assertEqual('Gemini 429 is rate limit', translateWithResponse(response(429, 'mock')).errorType, 'AI_RATE_LIMIT');
  assertEqual('Gemini 500 is HTTP error', translateWithResponse(response(500, 'mock')).errorType, 'AI_HTTP_ERROR');

  var networkError = AiService.translate(mockPrivateText, {
    config: aiConfig,
    transport: function () {
      throw new Error('mock network error with ' + mockApiKey);
    }
  });
  assertEqual('Gemini network exception is safe', networkError.errorType, 'AI_TRANSPORT_ERROR');
  assertEqual('Gemini malformed JSON is rejected', translateWithResponse(response(200, '{')).errorType, 'AI_INVALID_JSON');
  assertEqual('Gemini missing candidates is rejected', translateWithResponse(response(200, '{}')).errorType, 'AI_INVALID_RESPONSE');
  assertEqual('invalid structured output is rejected', translateWithResponse(response(200, providerBody('{'))).errorType, 'AI_INVALID_OUTPUT');
  assertEqual('empty translation is rejected', translateWithOutput(mockPrivateText, {
    sourceLanguage: 'zh-TW', targetLanguage: 'id', translatedText: '   '
  }).errorType, 'AI_INVALID_OUTPUT');
  assertEqual('unsupported target language is rejected', translateWithOutput(mockPrivateText, {
    sourceLanguage: 'zh-TW', targetLanguage: 'en', translatedText: 'mock'
  }).errorType, 'AI_INVALID_OUTPUT');
  assertEqual('extra structured field is rejected', translateWithOutput(mockPrivateText, {
    sourceLanguage: 'zh-TW', targetLanguage: 'id', translatedText: 'mock', explanation: 'mock'
  }).errorType, 'AI_INVALID_OUTPUT');
  assertEqual('flag inside AI translation is rejected', translateWithOutput(mockPrivateText, {
    sourceLanguage: 'zh-TW', targetLanguage: 'id', translatedText: '🇮🇩：mock'
  }).errorType, 'AI_INVALID_OUTPUT');

  var safeDiagnostics = JSON.stringify({
    error400: error400,
    networkError: networkError,
    invalidJson: translateWithResponse(response(200, '{'))
  });
  assertEqual('AI diagnostics omit API key', safeDiagnostics.indexOf(mockApiKey), -1);
  assertEqual('AI diagnostics omit LINE token', safeDiagnostics.indexOf(mockLineToken), -1);
  assertEqual('AI diagnostics omit LINE secret', safeDiagnostics.indexOf(mockLineSecret), -1);
  assertEqual('AI diagnostics omit private text', safeDiagnostics.indexOf(mockPrivateText), -1);
  assertEqual('AI diagnostics omit provider body', safeDiagnostics.indexOf('mock provider body'), -1);

  var integrationText = '阿嬤吃飯了嗎？';
  var integrationReplyToken = 'mock-integration-reply-token';
  var integrationEvent = mockMessageEvent_('group', 'mock-group-allowed', 'text');
  integrationEvent.message.text = integrationText;
  integrationEvent.replyToken = integrationReplyToken;
  var integrationAiInput = '';
  var integrationReplies = [];
  var integrationResult;
  WebhookHandler.process({
    postData: { contents: JSON.stringify({ events: [integrationEvent] }) }
  }, {
    getAuthorizationConfig: function () {
      return { ALLOWED_GROUP_ID: 'mock-group-allowed', ADMIN_USER_ID: 'mock-user-admin' };
    },
    handleText: function (event) {
      integrationResult = TranslationService.handleText(event, {
        aiTranslate: function (text) {
          integrationAiInput = text;
          return {
            ok: true,
            sourceLanguage: 'zh-TW',
            targetLanguage: 'id',
            translatedText: 'Apakah Nenek sudah makan?'
          };
        },
        lineReply: function (replyToken, text) {
          integrationReplies.push({ replyToken: replyToken, text: text });
          return { ok: true, statusCode: 200 };
        }
      });
    },
    reply: function () {
      throw new Error('join reply should not run');
    }
  });
  assertEqual('integration passes source text to AI', integrationAiInput, integrationText);
  assertEqual('integration replies once', integrationReplies.length, 1);
  assertEqual('integration uses translated LINE text', integrationReplies[0].text, '🇮🇩：Apakah Nenek sudah makan?');
  assertEqual('integration returns success', integrationResult.ok, true);

  var failureReplies = [];
  var aiFailureResult = TranslationService.handleText(integrationEvent, {
    aiTranslate: function () {
      return { ok: false, errorType: 'AI_RATE_LIMIT', statusCode: 429 };
    },
    lineReply: function (replyToken, text) {
      failureReplies.push(text);
      return { ok: true, statusCode: 200 };
    }
  });
  assertEqual('AI failure preserves safe error type', aiFailureResult.errorType, 'AI_RATE_LIMIT');
  assertEqual('AI failure sends fixed bilingual message', failureReplies[0], TranslationService.FAILURE_MESSAGE);

  var thrownAiReplies = [];
  var thrownAiResult = TranslationService.handleText(integrationEvent, {
    aiTranslate: function () {
      throw new Error('mock AI exception containing ' + mockPrivateText);
    },
    lineReply: function (replyToken, text) {
      thrownAiReplies.push(text);
      return { ok: true, statusCode: 200 };
    }
  });
  assertEqual('unexpected AI exception is contained', thrownAiResult.errorType, 'AI_INTERNAL_ERROR');
  assertEqual('unexpected AI exception uses fixed message', thrownAiReplies[0], TranslationService.FAILURE_MESSAGE);

  var lineReplyCalls = 0;
  var lineFailureResult = TranslationService.handleText(integrationEvent, {
    aiTranslate: function () {
      return { ok: true, sourceLanguage: 'zh-TW', targetLanguage: 'id', translatedText: 'mock' };
    },
    lineReply: function () {
      lineReplyCalls += 1;
      return { ok: false, errorType: 'HTTP_ERROR', statusCode: 500 };
    }
  });
  assertEqual('LINE failure returns safe error', lineFailureResult.errorType, 'LINE_REPLY_FAILED');
  assertEqual('LINE failure records AI success', lineFailureResult.aiSucceeded, true);
  assertEqual('LINE failure does not retry', lineReplyCalls, 1);

  var invalidTextAiCalls = 0;
  var invalidTextReplyCalls = 0;
  var invalidTextEvent = mockMessageEvent_('group', 'mock-group-allowed', 'text');
  invalidTextEvent.message.text = '   ';
  invalidTextEvent.replyToken = integrationReplyToken;
  var invalidTextResult = TranslationService.handleText(invalidTextEvent, {
    aiTranslate: function () { invalidTextAiCalls += 1; },
    lineReply: function () { invalidTextReplyCalls += 1; }
  });
  assertEqual('blank text is ignored', invalidTextResult.ignored, true);
  assertEqual('blank text skips AI', invalidTextAiCalls, 0);
  assertEqual('blank text skips LINE reply', invalidTextReplyCalls, 0);

  var missingReplyAiCalls = 0;
  var missingReplyEvent = mockMessageEvent_('group', 'mock-group-allowed', 'text');
  missingReplyEvent.replyToken = '';
  var missingReplyResult = TranslationService.handleText(missingReplyEvent, {
    aiTranslate: function () { missingReplyAiCalls += 1; }
  });
  assertEqual('missing reply token is ignored before AI', missingReplyResult.ignored, true);
  assertEqual('missing reply token skips AI', missingReplyAiCalls, 0);

  console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) {
    throw new Error('PHASE5_TEST_FAILED: ' + failed);
  }

  return {
    passed: passed,
    failed: failed
  };
}

function createMockCache_(initialValues) {
  var values = initialValues || {};
  var getCalls = [];
  var putCalls = [];
  var removeCalls = [];

  return {
    get: function (key) {
      getCalls.push(key);
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
    },
    put: function (key, value, expirationSeconds) {
      putCalls.push({ key: key, value: value, expirationSeconds: expirationSeconds });
      values[key] = value;
    },
    remove: function (key) {
      removeCalls.push(key);
      delete values[key];
    },
    getCalls: getCalls,
    putCalls: putCalls,
    removeCalls: removeCalls,
    values: values
  };
}

function createMockHasher_() {
  var values = {};
  var count = 0;
  return function (value) {
    if (!values[value]) {
      count += 1;
      values[value] = 'digest-' + ('0000' + count).slice(-4);
    }
    return values[value];
  };
}

/** Phase 6 context-cache and contextual translation tests using local mocks. */
function runPhase6MockTests() {
  var passed = 0;
  var failed = 0;
  var hash = createMockHasher_();
  var groupAId = 'mock-context-group-a';
  var groupBId = 'mock-context-group-b';
  var adminId = 'mock-context-admin';
  var senderAId = 'mock-context-sender-a';
  var senderBId = 'mock-context-sender-b';

  function assertEqual(name, actual, expected) {
    if (actual === expected) {
      passed += 1;
      console.log('PASS: ' + name);
      return;
    }
    failed += 1;
    console.log('FAIL: ' + name);
  }

  function keyFor(source) {
    return ContextService.buildConversationKey(source, { hash: hash });
  }

  var groupAKey = keyFor({ type: 'group', groupId: groupAId });
  var groupBKey = keyFor({ type: 'group', groupId: groupBId });
  var adminKey = keyFor({ type: 'user', userId: adminId });
  assertEqual('group A and B keys differ', groupAKey !== groupBKey, true);
  assertEqual('group and admin keys differ', groupAKey !== adminKey, true);
  assertEqual('group key has group namespace', groupAKey.indexOf('ctx:v1:g:') === 0, true);
  assertEqual('admin key has private namespace', adminKey.indexOf('ctx:v1:u:') === 0, true);
  assertEqual('key does not expose group identifier', groupAKey.indexOf(groupAId), -1);
  assertEqual('malformed source returns null key', keyFor({ type: 'group' }), null);
  assertEqual('unsupported source returns null key', keyFor({ type: 'room', roomId: 'mock-room' }), null);

  var missCache = createMockCache_();
  var miss = ContextService.getContext(groupAKey, { cache: missCache });
  assertEqual('cache miss is successful recovery', miss.ok, true);
  assertEqual('cache miss is marked', miss.cacheMiss, true);
  assertEqual('cache miss returns empty context', miss.messages.length, 0);

  var cache = createMockCache_();
  var firstCommit = ContextService.commitMessage(groupAKey, senderAId, 'mock message 1', {
    cache: cache,
    hash: hash
  });
  assertEqual('normal context commit succeeds', firstCommit.ok, true);
  assertEqual('first sender is Speaker A', firstCommit.speaker, 'Speaker A');
  assertEqual('first commit writes once', cache.putCalls.length, 1);
  assertEqual('commit uses 3600 TTL', cache.putCalls[0].expirationSeconds, 3600);

  var firstRead = ContextService.getContext(groupAKey, { cache: cache });
  assertEqual('normal context read succeeds', firstRead.ok, true);
  assertEqual('normal context read has one message', firstRead.messages.length, 1);
  assertEqual('context stores original text', firstRead.messages[0].text, 'mock message 1');

  var sameSenderCommit = ContextService.commitMessage(groupAKey, senderAId, 'mock message 2', {
    cache: cache,
    hash: hash
  });
  assertEqual('same sender keeps speaker label', sameSenderCommit.speaker, 'Speaker A');
  assertEqual('second commit performs another put', cache.putCalls.length, 2);
  assertEqual('second commit resets TTL to 3600', cache.putCalls[1].expirationSeconds, 3600);

  var otherSenderCommit = ContextService.commitMessage(groupAKey, senderBId, 'mock message 3', {
    cache: cache,
    hash: hash
  });
  assertEqual('different sender gets different label', otherSenderCommit.speaker, 'Speaker B');

  var windowCache = createMockCache_();
  for (var index = 1; index <= 20; index += 1) {
    ContextService.commitMessage(groupAKey, senderAId, 'window message ' + index, {
      cache: windowCache,
      hash: hash
    });
  }
  var twentyMessages = ContextService.getContext(groupAKey, { cache: windowCache }).messages;
  assertEqual('twenty messages remain twenty', twentyMessages.length, 20);
  ContextService.commitMessage(groupAKey, senderAId, 'window message 21', {
    cache: windowCache,
    hash: hash
  });
  var twentyOneMessages = ContextService.getContext(groupAKey, { cache: windowCache }).messages;
  assertEqual('twenty-first commit retains twenty', twentyOneMessages.length, 20);
  assertEqual('twenty-first commit removes oldest', twentyOneMessages[0].text, 'window message 2');
  assertEqual('twenty-first commit keeps newest', twentyOneMessages[19].text, 'window message 21');

  var isolationCache = createMockCache_();
  ContextService.commitMessage(groupAKey, senderAId, 'group A history', { cache: isolationCache, hash: hash });
  ContextService.commitMessage(groupBKey, senderBId, 'group B history', { cache: isolationCache, hash: hash });
  ContextService.commitMessage(adminKey, adminId, 'admin history', { cache: isolationCache, hash: hash });
  assertEqual('group A excludes group B context', JSON.stringify(
    ContextService.getContext(groupAKey, { cache: isolationCache }).messages
  ).indexOf('group B history'), -1);
  assertEqual('group excludes admin context', JSON.stringify(
    ContextService.getContext(groupAKey, { cache: isolationCache }).messages
  ).indexOf('admin history'), -1);
  assertEqual('admin context remains isolated', ContextService.getContext(adminKey, {
    cache: isolationCache
  }).messages[0].text, 'admin history');

  var invalidJsonCache = createMockCache_({});
  invalidJsonCache.values[groupAKey] = '{';
  var invalidJson = ContextService.getContext(groupAKey, { cache: invalidJsonCache });
  assertEqual('invalid cache JSON returns empty', invalidJson.messages.length, 0);
  assertEqual('invalid cache JSON is marked', invalidJson.errorType, 'CONTEXT_INVALID_DATA');

  var invalidSchemaCache = createMockCache_({});
  invalidSchemaCache.values[groupAKey] = JSON.stringify({ version: 1, messages: {}, speakerMap: {} });
  var invalidSchema = ContextService.getContext(groupAKey, { cache: invalidSchemaCache });
  assertEqual('invalid cache schema returns empty', invalidSchema.messages.length, 0);
  assertEqual('invalid cache schema does not crash', invalidSchema.ok, true);

  var invalidMessageCache = createMockCache_({});
  invalidMessageCache.values[groupAKey] = JSON.stringify({
    version: 1,
    messages: [{ speaker: 'Speaker A', text: '' }],
    speakerMap: { digest: 'Speaker A' }
  });
  assertEqual('invalid cached message returns empty', ContextService.getContext(groupAKey, {
    cache: invalidMessageCache
  }).messages.length, 0);

  var extraFieldCache = createMockCache_({});
  extraFieldCache.values[groupAKey] = JSON.stringify({
    version: 1,
    messages: [],
    speakerMap: {},
    unexpected: 'mock'
  });
  assertEqual('extra cache field returns empty', ContextService.getContext(groupAKey, {
    cache: extraFieldCache
  }).messages.length, 0);

  var readErrorCache = {
    get: function () { throw new Error('mock cache read failure'); },
    put: function () {}
  };
  var readError = ContextService.getContext(groupAKey, { cache: readErrorCache });
  assertEqual('cache read failure returns empty', readError.messages.length, 0);
  assertEqual('cache read failure is safe', readError.errorType, 'CONTEXT_READ_ERROR');

  var contextForAi = [
    { speaker: 'Speaker A', text: '阿嬤剛剛吃過飯。' },
    { speaker: 'Speaker B', text: 'Baik.' }
  ];
  var aiRequest = AiService.buildRequest('She took it already.', contextForAi, {
    GEMINI_API_KEY: 'mock-ai-key',
    GEMINI_MODEL: 'mock-model'
  });
  var aiPayload = JSON.parse(aiRequest.options.payload);
  var aiInput = JSON.parse(aiPayload.contents[0].parts[0].text);
  assertEqual('Gemini request includes recent context', aiInput.conversationHistory.length, 2);
  assertEqual('Gemini history keeps anonymous speaker', aiInput.conversationHistory[0].speaker, 'Speaker A');
  assertEqual('Gemini current message is separate', aiInput.currentMessage, 'She took it already.');
  assertEqual('Gemini input omits sender identifier', aiPayload.contents[0].parts[0].text.indexOf(senderAId), -1);
  assertEqual('prompt says history is context only', AiService.SYSTEM_INSTRUCTION.indexOf('Conversation history is context only') >= 0, true);

  var contextualEnglish = AiService.translate('Please prepare it.', contextForAi, {
    config: { GEMINI_API_KEY: 'mock-ai-key', GEMINI_MODEL: 'mock-model' },
    transport: function () {
      return {
        getResponseCode: function () { return 200; },
        getContentText: function () {
          return JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({
            sourceLanguage: 'en', targetLanguage: 'id', translatedText: 'Tolong siapkan.'
          }) }] } }] });
        }
      };
    }
  });
  assertEqual('English with context may target Indonesian', contextualEnglish.targetLanguage, 'id');

  var noContextEnglish = AiService.translate('Please prepare it.', [], {
    config: { GEMINI_API_KEY: 'mock-ai-key', GEMINI_MODEL: 'mock-model' },
    transport: function () {
      return {
        getResponseCode: function () { return 200; },
        getContentText: function () {
          return JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({
            sourceLanguage: 'en', targetLanguage: 'zh-TW', translatedText: '請準備好。'
          }) }] } }] });
        }
      };
    }
  });
  assertEqual('English without context falls back to Traditional Chinese', noContextEnglish.targetLanguage, 'zh-TW');

  function translationEvent(text) {
    var event = mockMessageEvent_('group', groupAId, 'text');
    event.source.userId = senderAId;
    event.message.text = text;
    event.replyToken = 'mock-context-reply-token';
    return event;
  }

  function contextDependencies(testCache, behavior) {
    var options = behavior || {};
    return {
      buildConversationKey: function (source) {
        return ContextService.buildConversationKey(source, { hash: hash });
      },
      getContext: function (key) {
        return options.readResult || ContextService.getContext(key, { cache: testCache });
      },
      aiTranslate: options.aiTranslate,
      lineReply: options.lineReply,
      commitContext: options.commitContext || function (key, senderId, text) {
        return ContextService.commitMessage(key, senderId, text, { cache: testCache, hash: hash });
      }
    };
  }

  var flowCache = createMockCache_();
  var flowAiContext = null;
  var flowReplies = 0;
  var flowResult = TranslationService.handleText(translationEvent('current original'), contextDependencies(flowCache, {
    aiTranslate: function (text, history) {
      flowAiContext = history;
      return { ok: true, sourceLanguage: 'en', targetLanguage: 'zh-TW', translatedText: '目前原文' };
    },
    lineReply: function () {
      flowReplies += 1;
      return { ok: true, statusCode: 200 };
    }
  }));
  assertEqual('cache miss flow still calls AI with empty context', flowAiContext.length, 0);
  assertEqual('cache miss flow replies once', flowReplies, 1);
  assertEqual('AI and LINE success commits context', flowResult.contextCommitted, true);
  assertEqual('successful flow stores current original', ContextService.getContext(groupAKey, {
    cache: flowCache
  }).messages[0].text, 'current original');

  var existingContextCache = createMockCache_();
  ContextService.commitMessage(groupAKey, senderBId, 'existing history', {
    cache: existingContextCache, hash: hash
  });
  var historySeenByAi = null;
  TranslationService.handleText(translationEvent('new current'), contextDependencies(existingContextCache, {
    aiTranslate: function (text, history) {
      historySeenByAi = history;
      return { ok: true, sourceLanguage: 'en', targetLanguage: 'id', translatedText: 'baru' };
    },
    lineReply: function () { return { ok: true, statusCode: 200 }; }
  }));
  assertEqual('existing context reaches AI', historySeenByAi[0].text, 'existing history');
  assertEqual('current message is not precommitted', historySeenByAi.length, 1);

  var aiFailureCommits = 0;
  TranslationService.handleText(translationEvent('AI failure original'), contextDependencies(createMockCache_(), {
    aiTranslate: function () { return { ok: false, errorType: 'AI_HTTP_ERROR' }; },
    lineReply: function () { return { ok: true, statusCode: 200 }; },
    commitContext: function () { aiFailureCommits += 1; return { ok: true }; }
  }));
  assertEqual('Gemini failure does not commit', aiFailureCommits, 0);

  var lineFailureCommits = 0;
  TranslationService.handleText(translationEvent('LINE failure original'), contextDependencies(createMockCache_(), {
    aiTranslate: function () {
      return { ok: true, sourceLanguage: 'zh-TW', targetLanguage: 'id', translatedText: 'mock' };
    },
    lineReply: function () { return { ok: false, errorType: 'HTTP_ERROR', statusCode: 500 }; },
    commitContext: function () { lineFailureCommits += 1; return { ok: true }; }
  }));
  assertEqual('LINE failure does not commit', lineFailureCommits, 0);

  var cacheFailureReplies = 0;
  var cacheFailureResult = TranslationService.handleText(translationEvent('cache failure original'), contextDependencies(
    createMockCache_(), {
      aiTranslate: function () {
        return { ok: true, sourceLanguage: 'zh-TW', targetLanguage: 'id', translatedText: 'mock' };
      },
      lineReply: function () { cacheFailureReplies += 1; return { ok: true, statusCode: 200 }; },
      commitContext: function () { return { ok: false, errorType: 'CONTEXT_WRITE_ERROR' }; }
    }
  ));
  assertEqual('cache write failure keeps translation success', cacheFailureResult.ok, true);
  assertEqual('cache write failure is reported internally', cacheFailureResult.contextErrorType, 'CONTEXT_WRITE_ERROR');
  assertEqual('cache write failure does not repeat reply', cacheFailureReplies, 1);

  var throwingWriteCache = {
    get: function () { return null; },
    put: function () { throw new Error('mock write failure'); }
  };
  assertEqual('ContextService write exception is safe', ContextService.commitMessage(
    groupAKey, senderAId, 'mock', { cache: throwingWriteCache, hash: hash }
  ).errorType, 'CONTEXT_WRITE_ERROR');

  var malformedAiHistory = null;
  TranslationService.handleText(translationEvent('after malformed cache'), contextDependencies(invalidJsonCache, {
    aiTranslate: function (text, history) {
      malformedAiHistory = history;
      return { ok: true, sourceLanguage: 'en', targetLanguage: 'zh-TW', translatedText: 'mock' };
    },
    lineReply: function () { return { ok: true, statusCode: 200 }; }
  }));
  assertEqual('malformed cache is not sent to AI', malformedAiHistory.length, 0);

  var storedPayload = cache.putCalls[cache.putCalls.length - 1].value;
  assertEqual('stored context omits sender A identifier', storedPayload.indexOf(senderAId), -1);
  assertEqual('stored context omits sender B identifier', storedPayload.indexOf(senderBId), -1);
  assertEqual('stored context omits reply token', storedPayload.indexOf('mock-context-reply-token'), -1);
  assertEqual('stored context omits credentials', storedPayload.indexOf('mock-api-key'), -1);
  assertEqual('stored context omits bot translation', storedPayload.indexOf('translated result'), -1);

  console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) {
    throw new Error('PHASE6_TEST_FAILED: ' + failed);
  }

  return { passed: passed, failed: failed };
}

/**
 * Manually run this function from the Apps Script Editor only.
 * It is intentionally excluded from all mock runners and production paths.
 */
function testGeminiIntegration() {
  var testText = '阿嬤今天下午三點要吃藥。';
  var result;

  try {
    result = AiService.translate(testText, []);
  } catch (error) {
    result = { ok: false, errorType: 'AI_INTERNAL_ERROR' };
  }

  if (!result || !result.ok) {
    var errorType = result && result.errorType
      ? result.errorType
      : 'AI_INVALID_RESPONSE';
    var statusSuffix = result && typeof result.statusCode === 'number'
      ? ' (HTTP ' + result.statusCode + ')'
      : '';

    console.log('FAIL Gemini integration: ' + errorType + statusSuffix);
    throw new Error('GEMINI_INTEGRATION_FAILED: ' + errorType + statusSuffix);
  }

  if (result.targetLanguage !== 'id' ||
      typeof result.translatedText !== 'string' ||
      result.translatedText.trim() === '') {
    console.log('FAIL Gemini integration: AI_INVALID_OUTPUT');
    throw new Error('GEMINI_INTEGRATION_FAILED: AI_INVALID_OUTPUT');
  }

  console.log('PASS Gemini integration');
  console.log('Target language: ' + result.targetLanguage);
  console.log('Translation: ' + result.translatedText);

  return {
    ok: true,
    targetLanguage: result.targetLanguage,
    translatedText: result.translatedText
  };
}

/**
 * Manually run this function from the Apps Script Editor only.
 * It uses the production ContextService and GAS Script Cache, and is intentionally
 * excluded from all mock runners and production paths.
 */
function testCacheServiceIntegration() {
  var conversationId = 'integration-test-group';
  var isolationConversationId = 'integration-test-group-isolation';
  var senderAId = 'integration-test-user-a';
  var senderBId = 'integration-test-user-b';
  var conversationKey = null;
  var isolationKey = null;
  var scriptCache = null;
  var failureStage = null;
  var cleanupSucceeded = false;
  var finalMessageCount = 0;
  var speakerA = null;
  var speakerB = null;

  function fail_(stage) {
    throw new Error(stage);
  }

  function hasOnlyMessageFields_(message) {
    return message && Object.keys(message).sort().join(',') === 'speaker,text';
  }

  try {
    conversationKey = ContextService.buildConversationKey({
      type: 'group',
      groupId: conversationId
    });
    isolationKey = ContextService.buildConversationKey({
      type: 'group',
      groupId: isolationConversationId
    });
    if (!conversationKey || !isolationKey || conversationKey === isolationKey) {
      fail_('CACHE_MISS_CHECK_FAILED');
    }

    scriptCache = CacheService.getScriptCache();
    scriptCache.remove(conversationKey);
    scriptCache.remove(isolationKey);

    var miss = ContextService.getContext(conversationKey);
    if (!miss.ok || !miss.cacheMiss || miss.messages.length !== 0) {
      fail_('CACHE_MISS_CHECK_FAILED');
    }

    var firstCommit = ContextService.commitMessage(
      conversationKey,
      senderAId,
      '阿嬤吃飯了嗎？'
    );
    if (!firstCommit.ok) {
      fail_('CACHE_WRITE_FAILED');
    }
    speakerA = firstCommit.speaker;

    var firstRead = ContextService.getContext(conversationKey);
    if (!firstRead.ok ||
        firstRead.messages.length !== 1 ||
        firstRead.messages[0].text !== '阿嬤吃飯了嗎？' ||
        firstRead.messages[0].speaker !== speakerA ||
        !hasOnlyMessageFields_(firstRead.messages[0])) {
      fail_('CACHE_READ_FAILED');
    }

    var isolatedRead = ContextService.getContext(isolationKey);
    if (!isolatedRead.ok || !isolatedRead.cacheMiss || isolatedRead.messages.length !== 0) {
      fail_('CACHE_READ_FAILED');
    }

    var secondCommit = ContextService.commitMessage(
      conversationKey,
      senderBId,
      'Sudah makan.'
    );
    if (!secondCommit.ok) {
      fail_('CACHE_WRITE_FAILED');
    }
    speakerB = secondCommit.speaker;

    var secondRead = ContextService.getContext(conversationKey);
    var serializedMessages = JSON.stringify(secondRead.messages);
    if (!secondRead.ok ||
        secondRead.messages.length !== 2 ||
        speakerA === speakerB ||
        secondRead.messages[0].speaker !== speakerA ||
        secondRead.messages[1].speaker !== speakerB ||
        !secondRead.messages.every(hasOnlyMessageFields_) ||
        serializedMessages.indexOf(senderAId) !== -1 ||
        serializedMessages.indexOf(senderBId) !== -1) {
      fail_('SPEAKER_MAPPING_FAILED');
    }

    var thirdCommit = ContextService.commitMessage(
      conversationKey,
      senderAId,
      '下午三點記得吃藥。'
    );
    if (!thirdCommit.ok) {
      fail_('CACHE_WRITE_FAILED');
    }
    if (thirdCommit.speaker !== speakerA) {
      fail_('SPEAKER_MAPPING_FAILED');
    }

    scriptCache.remove(conversationKey);
    for (var index = 1; index <= 21; index += 1) {
      var sequence = ('0' + index).slice(-2);
      var windowCommit = ContextService.commitMessage(
        conversationKey,
        senderAId,
        'test message ' + sequence
      );
      if (!windowCommit.ok) {
        fail_('CACHE_WRITE_FAILED');
      }
    }

    var finalRead = ContextService.getContext(conversationKey);
    finalMessageCount = finalRead.messages.length;
    if (!finalRead.ok ||
        finalMessageCount !== ContextService.MAX_MESSAGES ||
        finalMessageCount !== 20 ||
        finalRead.messages[0].text !== 'test message 02' ||
        finalRead.messages[19].text !== 'test message 21') {
      fail_('MESSAGE_LIMIT_FAILED');
    }
    for (var messageIndex = 0; messageIndex < finalRead.messages.length; messageIndex += 1) {
      var expectedSequence = ('0' + (messageIndex + 2)).slice(-2);
      if (finalRead.messages[messageIndex].text !== 'test message ' + expectedSequence) {
        fail_('MESSAGE_LIMIT_FAILED');
      }
    }

    if (ContextService.TTL_SECONDS !== 3600) {
      fail_('CACHE_WRITE_FAILED');
    }
  } catch (error) {
    var safeStages = {
      CACHE_MISS_CHECK_FAILED: true,
      CACHE_WRITE_FAILED: true,
      CACHE_READ_FAILED: true,
      SPEAKER_MAPPING_FAILED: true,
      MESSAGE_LIMIT_FAILED: true
    };
    failureStage = error && safeStages[error.message]
      ? error.message
      : 'CACHE_READ_FAILED';
  } finally {
    try {
      scriptCache = scriptCache || CacheService.getScriptCache();
      if (conversationKey) {
        scriptCache.remove(conversationKey);
      }
      if (isolationKey) {
        scriptCache.remove(isolationKey);
      }
      cleanupSucceeded = true;
    } catch (cleanupError) {
      cleanupSucceeded = false;
    }
  }

  if (!cleanupSucceeded) {
    console.log('FAIL CacheService integration: CACHE_CLEANUP_FAILED');
    throw new Error('CACHE_SERVICE_INTEGRATION_FAILED: CACHE_CLEANUP_FAILED');
  }
  if (failureStage) {
    console.log('FAIL CacheService integration: ' + failureStage);
    throw new Error('CACHE_SERVICE_INTEGRATION_FAILED: ' + failureStage);
  }

  console.log('PASS CacheService integration');
  console.log('Final message count: ' + finalMessageCount);
  console.log('Speaker labels: ' + speakerA + ', ' + speakerB);
  console.log('Cleanup success: true');

  return {
    ok: true,
    finalMessageCount: finalMessageCount,
    speakerLabels: [speakerA, speakerB],
    cleanupSucceeded: true
  };
}
