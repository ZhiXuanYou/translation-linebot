/** Coordinates context read, AI translation, LINE reply, then context commit. */
var TranslationService = (function () {
  'use strict';

  var FAILURE_MESSAGE = '🇹🇼 暫時無法翻譯，請稍後再試。\n' +
    '🇮🇩 Terjemahan sementara tidak tersedia. Silakan coba lagi nanti.';

  function isNonEmptyString_(value) {
    return typeof value === 'string' && value.trim() !== '';
  }

  function formatTranslation(result) {
    if (!result || !isNonEmptyString_(result.translatedText)) {
      return null;
    }

    if (result.targetLanguage === 'id') {
      return '🇮🇩：' + result.translatedText;
    }

    if (result.targetLanguage === 'zh-TW') {
      return '🇹🇼：' + result.translatedText;
    }

    return null;
  }

  function replySafely_(lineReply, replyToken, text) {
    try {
      return lineReply(replyToken, text);
    } catch (error) {
      return { ok: false, errorType: 'LINE_REPLY_EXCEPTION' };
    }
  }

  function getSenderId_(event) {
    var source = event && event.source;
    if (!source) {
      return null;
    }
    return source.type === 'group' ? source.userId : source.userId;
  }

  function handleText(event, dependencies) {
    var text = event && event.message && event.message.text;
    var replyToken = event && event.replyToken;

    if (!isNonEmptyString_(text)) {
      return { ok: false, ignored: true, errorType: 'INVALID_TEXT' };
    }

    if (!isNonEmptyString_(replyToken)) {
      return { ok: false, ignored: true, errorType: 'INVALID_REPLY_TOKEN' };
    }

    var deps = dependencies || {};
    var conversationKey = null;
    try {
      conversationKey = (deps.buildConversationKey || ContextService.buildConversationKey)(event.source);
    } catch (error) {
      conversationKey = null;
    }
    var contextResult = {
      ok: false,
      errorType: 'CONTEXT_INVALID_KEY',
      messages: []
    };
    if (conversationKey) {
      try {
        contextResult = (deps.getContext || ContextService.getContext)(conversationKey);
      } catch (error) {
        contextResult = {
          ok: false,
          errorType: 'CONTEXT_READ_ERROR',
          messages: []
        };
      }
    }
    var contextMessages = contextResult && Array.isArray(contextResult.messages)
      ? contextResult.messages
      : [];

    var aiResult;
    try {
      aiResult = (deps.aiTranslate || function (inputText, recentContext) {
        return AiService.translate(inputText, recentContext);
      })(text, contextMessages);
    } catch (error) {
      aiResult = { ok: false, errorType: 'AI_INTERNAL_ERROR' };
    }

    if (!aiResult || !aiResult.ok) {
      var failureReply = replySafely_(deps.lineReply || LineService.reply, replyToken, FAILURE_MESSAGE);
      return {
        ok: false,
        errorType: aiResult && aiResult.errorType ? aiResult.errorType : 'AI_INVALID_RESPONSE',
        failureReplyOk: Boolean(failureReply && failureReply.ok)
      };
    }

    var displayText = formatTranslation(aiResult);
    if (!displayText) {
      var invalidOutputReply = replySafely_(deps.lineReply || LineService.reply, replyToken, FAILURE_MESSAGE);
      return {
        ok: false,
        errorType: 'AI_INVALID_OUTPUT',
        failureReplyOk: Boolean(invalidOutputReply && invalidOutputReply.ok)
      };
    }

    var replyResult = replySafely_(deps.lineReply || LineService.reply, replyToken, displayText);
    if (!replyResult || !replyResult.ok) {
      return {
        ok: false,
        aiSucceeded: true,
        errorType: 'LINE_REPLY_FAILED',
        replyStatusCode: replyResult && replyResult.statusCode
      };
    }

    var commitResult = { ok: false, errorType: 'CONTEXT_INVALID_INPUT' };
    var senderId = getSenderId_(event);
    if (conversationKey && isNonEmptyString_(senderId)) {
      try {
        commitResult = (deps.commitContext || ContextService.commitMessage)(
          conversationKey,
          senderId,
          text
        );
      } catch (error) {
        commitResult = { ok: false, errorType: 'CONTEXT_WRITE_ERROR' };
      }
    }

    return {
      ok: true,
      targetLanguage: aiResult.targetLanguage,
      replyStatusCode: replyResult.statusCode,
      contextCommitted: Boolean(commitResult && commitResult.ok),
      contextErrorType: commitResult && commitResult.ok ? undefined : commitResult.errorType,
      contextReadErrorType: contextResult && contextResult.errorType
    };
  }

  function handleEvent(event) {
    return handleText(event);
  }

  return Object.freeze({
    FAILURE_MESSAGE: FAILURE_MESSAGE,
    handleText: handleText,
    handleEvent: handleEvent,
    formatTranslation: formatTranslation
  });
}());
