/** Short-lived conversation context backed by injectable GAS Script Cache. */
var ContextService = (function () {
  'use strict';

  var MAX_MESSAGES = 20;
  var TTL_SECONDS = 3600;
  var STATE_VERSION = 1;

  function isNonEmptyString_(value) {
    return typeof value === 'string' && value.trim() !== '';
  }

  function defaultHash_(value) {
    var bytes = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      value,
      Utilities.Charset.UTF_8
    );

    return bytes.map(function (byte) {
      var normalized = (byte + 256) % 256;
      return ('0' + normalized.toString(16)).slice(-2);
    }).join('');
  }

  function defaultCache_() {
    return CacheService.getScriptCache();
  }

  function emptyState_() {
    return {
      version: STATE_VERSION,
      messages: [],
      speakerMap: {}
    };
  }

  function buildConversationKey(source, dependencies) {
    if (!source || typeof source.type !== 'string') {
      return null;
    }

    var identifier;
    var namespace;
    if (source.type === 'group') {
      identifier = source.groupId;
      namespace = 'g';
    } else if (source.type === 'user') {
      identifier = source.userId;
      namespace = 'u';
    } else {
      return null;
    }

    if (!isNonEmptyString_(identifier)) {
      return null;
    }

    var hash;
    try {
      hash = dependencies && dependencies.hash
        ? dependencies.hash(identifier)
        : defaultHash_(identifier);
    } catch (error) {
      return null;
    }

    return isNonEmptyString_(hash) ? 'ctx:v1:' + namespace + ':' + hash : null;
  }

  function isValidSpeakerLabel_(label) {
    return typeof label === 'string' && /^Speaker [A-Z]+$/.test(label);
  }

  function validateState_(state) {
    if (!state ||
        Object.keys(state).sort().join(',') !== 'messages,speakerMap,version' ||
        state.version !== STATE_VERSION ||
        !Array.isArray(state.messages) ||
        state.messages.length > MAX_MESSAGES ||
        !state.speakerMap ||
        typeof state.speakerMap !== 'object' ||
        Array.isArray(state.speakerMap)) {
      return false;
    }

    var messagesValid = state.messages.every(function (message) {
      return message &&
        Object.keys(message).sort().join(',') === 'speaker,text' &&
        isValidSpeakerLabel_(message.speaker) &&
        isNonEmptyString_(message.text);
    });
    if (!messagesValid) {
      return false;
    }

    var labels = {};
    var speakerMapValid = Object.keys(state.speakerMap).every(function (senderHash) {
      var label = state.speakerMap[senderHash];
      if (!isNonEmptyString_(senderHash) ||
          !isValidSpeakerLabel_(label) ||
          labels[label]) {
        return false;
      }
      labels[label] = true;
      return true;
    });

    return speakerMapValid && state.messages.every(function (message) {
      return labels[message.speaker] === true;
    });
  }

  function parseState_(cachedValue) {
    var state;
    try {
      state = JSON.parse(cachedValue);
    } catch (error) {
      return null;
    }

    return validateState_(state) ? state : null;
  }

  function getCache_(dependencies) {
    return dependencies && dependencies.cache
      ? dependencies.cache
      : defaultCache_();
  }

  function readState_(conversationKey, dependencies) {
    var cache;
    var cachedValue;
    try {
      cache = getCache_(dependencies);
      cachedValue = cache.get(conversationKey);
    } catch (error) {
      return {
        ok: false,
        errorType: 'CONTEXT_READ_ERROR',
        state: emptyState_()
      };
    }

    if (!isNonEmptyString_(cachedValue)) {
      return {
        ok: true,
        cacheMiss: true,
        state: emptyState_()
      };
    }

    var state = parseState_(cachedValue);
    if (!state) {
      return {
        ok: true,
        invalidData: true,
        errorType: 'CONTEXT_INVALID_DATA',
        state: emptyState_()
      };
    }

    return {
      ok: true,
      state: state
    };
  }

  function copyMessages_(messages) {
    return messages.map(function (message) {
      return {
        speaker: message.speaker,
        text: message.text
      };
    });
  }

  function getContext(conversationKey, dependencies) {
    if (!isNonEmptyString_(conversationKey)) {
      return {
        ok: false,
        errorType: 'CONTEXT_INVALID_KEY',
        messages: []
      };
    }

    var readResult = readState_(conversationKey, dependencies);
    return {
      ok: readResult.ok,
      cacheMiss: Boolean(readResult.cacheMiss),
      invalidData: Boolean(readResult.invalidData),
      errorType: readResult.errorType,
      messages: copyMessages_(readResult.state.messages)
    };
  }

  function labelFromIndex_(index) {
    var value = index + 1;
    var label = '';
    while (value > 0) {
      value -= 1;
      label = String.fromCharCode(65 + (value % 26)) + label;
      value = Math.floor(value / 26);
    }
    return 'Speaker ' + label;
  }

  function assignSpeaker_(state, senderHash) {
    if (state.speakerMap[senderHash]) {
      return state.speakerMap[senderHash];
    }

    var usedLabels = {};
    Object.keys(state.speakerMap).forEach(function (key) {
      usedLabels[state.speakerMap[key]] = true;
    });

    var index = 0;
    var label = labelFromIndex_(index);
    while (usedLabels[label]) {
      index += 1;
      label = labelFromIndex_(index);
    }

    state.speakerMap[senderHash] = label;
    return label;
  }

  function pruneSpeakerMap_(state) {
    var activeLabels = {};
    state.messages.forEach(function (message) {
      activeLabels[message.speaker] = true;
    });

    Object.keys(state.speakerMap).forEach(function (senderHash) {
      if (!activeLabels[state.speakerMap[senderHash]]) {
        delete state.speakerMap[senderHash];
      }
    });
  }

  function commitMessage(conversationKey, senderId, text, dependencies) {
    if (!isNonEmptyString_(conversationKey) ||
        !isNonEmptyString_(senderId) ||
        !isNonEmptyString_(text)) {
      return { ok: false, errorType: 'CONTEXT_INVALID_INPUT' };
    }

    var senderHash;
    try {
      senderHash = dependencies && dependencies.hash
        ? dependencies.hash(senderId)
        : defaultHash_(senderId);
    } catch (error) {
      return { ok: false, errorType: 'CONTEXT_HASH_ERROR' };
    }
    if (!isNonEmptyString_(senderHash)) {
      return { ok: false, errorType: 'CONTEXT_HASH_ERROR' };
    }

    var readResult = readState_(conversationKey, dependencies);
    if (!readResult.ok) {
      return { ok: false, errorType: readResult.errorType };
    }

    var state = readResult.state;
    var speaker = assignSpeaker_(state, senderHash);
    state.messages.push({ speaker: speaker, text: text });
    if (state.messages.length > MAX_MESSAGES) {
      state.messages = state.messages.slice(-MAX_MESSAGES);
    }
    pruneSpeakerMap_(state);

    try {
      getCache_(dependencies).put(
        conversationKey,
        JSON.stringify(state),
        TTL_SECONDS
      );
    } catch (error) {
      return { ok: false, errorType: 'CONTEXT_WRITE_ERROR' };
    }

    return {
      ok: true,
      speaker: speaker,
      messageCount: state.messages.length
    };
  }

  return Object.freeze({
    MAX_MESSAGES: MAX_MESSAGES,
    TTL_SECONDS: TTL_SECONDS,
    STATE_VERSION: STATE_VERSION,
    buildConversationKey: buildConversationKey,
    getContext: getContext,
    commitMessage: commitMessage
  });
}());
