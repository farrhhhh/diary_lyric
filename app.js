/* ========================================
   YapTrap — Application Logic v6
   Seamless audio transitions
   ======================================== */

(function () {
  'use strict';

  // ══════════════════════════════════════════════════════════════
  //  1.  GRAMMAR-ONLY STOPWORDS
  // ══════════════════════════════════════════════════════════════

  var GRAMMAR_STOP = new Set([
    'a', 'an', 'the',
    'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'and', 'but', 'or', 'nor', 'so',
    'in', 'on', 'at', 'to', 'of', 'by', 'for',
    'it', 'its',
    'that', 'this', 'these', 'those',
    'if', 'as',
  ]);

  function isEligibleWord(w) {
    return w.length >= 1 && !GRAMMAR_STOP.has(w);
  }

  // ══════════════════════════════════════════════════════════════
  //  2.  iTUNES SEARCH
  // ══════════════════════════════════════════════════════════════

  var ITUNES = 'https://itunes.apple.com/search';

  async function itunesSearch(query, playedSet) {
    var params = new URLSearchParams({
      term: query, media: 'music', entity: 'song', limit: '50',
    });
    var data;
    try {
      var r = await fetch(ITUNES + '?' + params);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      data = await r.json();
    } catch (e) {
      console.warn('[YapTrap] iTunes error:', e);
      return null;
    }
    var pool = (data.results || []).filter(function (t) { return !!t.previewUrl; });
    if (!pool.length) return null;

    var q = query.toLowerCase();

    var t1 = pool.filter(function (t) {
      return t.trackName.toLowerCase() === q && !playedSet.has(t.trackId);
    });
    if (t1.length) return fmt(pick(t1));

    var t2 = pool.filter(function (t) {
      return t.trackName.toLowerCase().includes(q) && !playedSet.has(t.trackId);
    });
    if (t2.length) return fmt(pick(t2));

    var t3 = pool.filter(function (t) { return !playedSet.has(t.trackId); });
    if (t3.length) return fmt(pick(t3));

    var t4 = pool.filter(function (t) { return t.trackName.toLowerCase() === q; });
    if (t4.length) return fmt(pick(t4));

    var t5 = pool.filter(function (t) { return t.trackName.toLowerCase().includes(q); });
    if (t5.length) return fmt(pick(t5));

    return fmt(pick(pool));
  }

  function pick(arr) {
    if (arr.length <= 3) return arr[0];
    var top = arr.slice(0, Math.min(5, arr.length));
    return top[Math.floor(Math.random() * top.length)];
  }

  function fmt(t) {
    return {
      trackId: t.trackId,
      trackName: t.trackName || 'Unknown Track',
      artistName: t.artistName || 'Unknown Artist',
      previewUrl: t.previewUrl,
    };
  }

  async function findSong(word, fallbackWords, playedSet) {
    var primary = await itunesSearch(word, playedSet);
    if (primary) return primary;
    var sorted = fallbackWords
      .filter(function (w) { return w !== word && w.length >= 1; })
      .sort(function (a, b) { return b.length - a.length; });
    for (var i = 0; i < sorted.length; i++) {
      var result = await itunesSearch(sorted[i], playedSet);
      if (result) return result;
    }
    return null;
  }

  // ══════════════════════════════════════════════════════════════
  //  3.  DOM REFS
  // ══════════════════════════════════════════════════════════════

  var landingView  = document.getElementById('landing-view');
  var diaryView    = document.getElementById('diary-view');
  var landingTitle = document.getElementById('landing-title');
  var diaryTitle   = document.getElementById('diary-title');
  var textarea     = document.getElementById('diary-textarea');
  var musicStatus  = document.getElementById('music-status');
  var musicText    = document.getElementById('music-status-text');
  var btnNewEntry  = document.getElementById('btn-new-entry');
  var modalOverlay = document.getElementById('modal-overlay');
  var modalBody    = document.getElementById('modal-body');
  var modalFooter  = document.getElementById('modal-footer');
  var modalBtn     = document.getElementById('modal-btn');

  // ══════════════════════════════════════════════════════════════
  //  3.5 POPUP / MODAL CONTROLLER
  // ══════════════════════════════════════════════════════════════

  var modalTimer = null;

  function showModal(contentHtml, buttonText, onDismiss, autoDismissMs) {
    clearTimeout(modalTimer);
    if (!modalOverlay || !modalBody) return;
    modalBody.innerHTML = contentHtml;
    
    if (buttonText) {
      modalBtn.textContent = buttonText;
      modalFooter.classList.remove('hidden');
      modalBtn.onclick = function () {
        hideModal();
        if (onDismiss) onDismiss();
      };
    } else {
      modalFooter.classList.add('hidden');
      modalBtn.onclick = null;
    }
    
    modalOverlay.classList.remove('hidden');

    if (autoDismissMs) {
      modalTimer = setTimeout(function () {
        hideModal();
        if (onDismiss) onDismiss();
      }, autoDismissMs);
    }
  }

  function hideModal() {
    clearTimeout(modalTimer);
    if (modalOverlay) modalOverlay.classList.add('hidden');
  }

  if (modalOverlay) {
    modalOverlay.addEventListener('click', function (e) {
      if (e.target === modalOverlay) {
        hideModal();
      }
    });
  }

  // ══════════════════════════════════════════════════════════════
  //  4.  STATE — two-audio-slot architecture
  // ══════════════════════════════════════════════════════════════

  var currentAudio  = null;   // the song actively playing right now
  var pendingAudio  = null;   // the next song being preloaded
  var pendingSong   = null;   // metadata for the pending song
  var requestId     = 0;      // monotonic counter — newer wins
  var playedIds     = new Set();
  var prevText      = '';
  var debounceTimer = null;
  var processedWords = new Set();

  var currentSongData = null;
  var idleTimer = null;
  var typingStartedAt = 0;
  var BANNED_WORDS = new Set(['moist', 'rizz', 'skibidi', 'yap']);
  var PLACEHOLDERS = [
    'Dear Diary...', 'Spill the tea...', 'Who hurt you?', 
    'Time to yap...', 'What\'s the vibe?', 'Write it down...'
  ];
  var placeholderIndex = 0;
  var gradientAngles = [135, 225, 315, 45, 90, 180, 270, 0];
  var gradientIndex = 0;
  var flaggedBannedWords = new Set();

  // ══════════════════════════════════════════════════════════════
  //  5.  AUDIO CONTEXT UNLOCK
  // ══════════════════════════════════════════════════════════════

  var audioCtx = null;
  function ensureAudioUnlocked() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(function () {});
    }
  }
  document.addEventListener('click', ensureAudioUnlocked);
  document.addEventListener('touchstart', ensureAudioUnlocked);

  // ══════════════════════════════════════════════════════════════
  //  6.  STATUS HELPER
  // ══════════════════════════════════════════════════════════════

  function setStatus(text) {
    if (!text) {
      if (musicStatus) musicStatus.classList.add('hidden');
      if (musicText) musicText.textContent = '';
    } else {
      if (musicText) musicText.textContent = text;
      if (musicStatus) musicStatus.classList.remove('hidden');
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  7.  AUDIO HELPERS
  // ══════════════════════════════════════════════════════════════

  /** Tear down a single Audio object completely. */
  function destroyAudio(audio) {
    if (!audio) return;
    try { audio.pause(); } catch (e) {}
    audio.onended = null;
    audio.onerror = null;
    audio.oncanplaythrough = null;
    try { audio.src = ''; audio.load(); } catch (e) {}
  }

  /** Stop the currently playing song. */
  function stopCurrent() {
    if (currentAudio) {
      console.log('[YapTrap] Stopping current audio');
      destroyAudio(currentAudio);
      currentAudio = null;
    }
  }

  /** Discard any pending preloaded audio that hasn't switched in yet. */
  function discardPending() {
    if (pendingAudio) {
      console.log('[YapTrap] Discarding pending audio');
      destroyAudio(pendingAudio);
      pendingAudio = null;
      pendingSong = null;
    }
  }

  /** Invalidate all in-flight requests so their callbacks become no-ops. */
  function invalidateRequests() {
    requestId++;
  }

  // ══════════════════════════════════════════════════════════════
  //  8.  ATOMIC SWITCH — the heart of seamless transitions
  //
  //      currentAudio keeps playing untouched.
  //      pendingAudio preloads in the background.
  //      Only when pendingAudio fires "canplaythrough" do we:
  //        1) pause + destroy currentAudio
  //        2) promote pendingAudio → currentAudio
  //        3) call play() immediately
  // ══════════════════════════════════════════════════════════════

  function switchToPending(myId) {
    // Stale guard — a newer trigger may have arrived
    if (myId !== requestId) return;
    if (!pendingAudio || !pendingSong) return;

    console.log('Switching audio');

    // 1. Kill the old song
    stopCurrent();

    // 2. Promote
    var audio = pendingAudio;
    var song  = pendingSong;
    currentAudio = audio;
    currentAudio._yapTrackId = song.trackId;
    currentSongData = song;
    pendingAudio = null;
    pendingSong  = null;

    playedIds.add(song.trackId);

    // 3. Wire up end/error handlers for the now-current song
    audio.onended = function () {
      if (currentAudio === audio) {
        currentAudio = null;
        setStatus('');
      }
    };
    audio.onerror = function () {
      if (currentAudio === audio) {
        currentAudio = null;
        setStatus('');
      }
    };

    // 4. Play immediately
    audio.play().then(function () {
      if (myId === requestId) {
        setStatus('♪ Playing: ' + song.trackName + ' \u2014 ' + song.artistName);
      }
    }).catch(function () {
      // Retry once after unlocking AudioContext
      ensureAudioUnlocked();
      setTimeout(function () {
        audio.play().then(function () {
          if (myId === requestId) {
            setStatus('♪ Playing: ' + song.trackName + ' \u2014 ' + song.artistName);
          }
        }).catch(function () {
          // Autoplay still blocked — show the title anyway
          if (myId === requestId) {
            setStatus('♪ Playing: ' + song.trackName + ' \u2014 ' + song.artistName);
          }
        });
      }, 150);
    });
  }

  // ══════════════════════════════════════════════════════════════
  //  9.  TRIGGER ENGINE — search & preload in background
  //
  //      Current song keeps playing the entire time.
  //      No fixed timeout.  No 3-second gap.
  // ══════════════════════════════════════════════════════════════

  function triggerWord(word, fallbackWords) {
    // Cancel any previous pending search, but do NOT stop currentAudio
    invalidateRequests();
    discardPending();

    var myId = requestId;
    console.log('New trigger detected');

    // Show a non-blocking "searching" status only if nothing is playing
    if (!currentAudio) {
      setStatus('');
    }

    console.log('Searching for next song');

    findSong(word, fallbackWords, playedIds).then(function (song) {
      // Stale?
      if (myId !== requestId) {
        console.log('[YapTrap] Search result arrived but request is stale — ignoring');
        return;
      }

      if (!song || !song.previewUrl) {
        console.log('Search failed — keeping current song');
        if (!currentAudio) {
          setStatus('');
        }
        return;
      }

      // Duplicate check — same song already playing
      if (currentAudio && pendingSong === null &&
          playedIds.has(song.trackId) &&
          currentAudio._yapTrackId === song.trackId) {
        console.log('Same song already playing — skipping');
        return;
      }

      console.log('[YapTrap] Preloading: ' + song.trackName + ' by ' + song.artistName);

      // Create and preload the new Audio
      var audio = new Audio();
      audio.preload = 'auto';
      audio.src = song.previewUrl;

      pendingAudio = audio;
      pendingSong  = song;

      // Wait until the browser has buffered enough to play
      audio.oncanplaythrough = function () {
        audio.oncanplaythrough = null; // fire only once
        if (myId !== requestId) {
          // A newer trigger arrived while we were loading
          console.log('[YapTrap] Preload ready but request is stale — discarding');
          destroyAudio(audio);
          if (pendingAudio === audio) {
            pendingAudio = null;
            pendingSong = null;
          }
          return;
        }
        console.log('Next song loaded');
        switchToPending(myId);
      };

      // If loading fails, keep the current song
      audio.onerror = function () {
        console.log('Search failed — keeping current song');
        if (pendingAudio === audio) {
          pendingAudio = null;
          pendingSong = null;
        }
        destroyAudio(audio);
        if (myId === requestId && !currentAudio) {
          setStatus('');
        }
      };

      // Kick off loading
      audio.load();

    }).catch(function (err) {
      console.log('Search failed — keeping current song');
      if (myId === requestId && !currentAudio) {
        setStatus('');
      }
    });
  }

  // ══════════════════════════════════════════════════════════════
  //  9.5 PLAYFUL FEATURES
  // ══════════════════════════════════════════════════════════════

  function spawnBlobs() {
    var rect = btnNewEntry.getBoundingClientRect();
    var x = rect.left + rect.width / 2;
    var y = rect.top + rect.height / 2;
    
    for (var i = 0; i < 4; i++) {
      var blob = document.createElement('div');
      blob.className = 'blob-pop';
      var colors = ['#ec4899', '#8b5cf6', '#38bdf8', '#fb923c', '#C4F542'];
      blob.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      blob.style.left = x + 'px';
      blob.style.top = y + 'px';
      
      var tx = (Math.random() - 0.5) * 80;
      var ty = (Math.random() - 0.5) * 80;
      blob.style.setProperty('--tx', tx + 'px');
      blob.style.setProperty('--ty', ty + 'px');
      
      document.body.appendChild(blob);
      
      (function(el) {
        setTimeout(function() {
          if (el.parentNode) el.parentNode.removeChild(el);
        }, 800);
      })(blob);
    }
  }

  function handleBannedWord() {
    textarea.classList.remove('shake', 'flash-warn');
    void textarea.offsetWidth; // trigger reflow
    textarea.classList.add('shake', 'flash-warn');
    
    var toast = document.createElement('div');
    toast.className = 'toast-joke';
    toast.textContent = 'caught you 👀';
    document.querySelector('.diary-container').appendChild(toast);
    
    setTimeout(function() {
      textarea.classList.remove('shake', 'flash-warn');
    }, 300);
    
    setTimeout(function() {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 1500);
  }

  function cycleBrandGradient(e) {
    gradientIndex = (gradientIndex + 1) % gradientAngles.length;
    var target = e.currentTarget;
    target.style.setProperty('--gradient-angle', gradientAngles[gradientIndex] + 'deg');
  }

  landingTitle.addEventListener('click', cycleBrandGradient);
  diaryTitle.addEventListener('click', cycleBrandGradient);

  function getStatusPrefix() {
    if (typingStartedAt > 0 && (Date.now() - typingStartedAt) > 120000) {
      return 'Long session \uD83D\uDCA6 '; // 💦
    }
    return '\uD83C\uDFB5 '; // 🎵
  }

  // ══════════════════════════════════════════════════════════════
  //  10. INPUT HANDLER
  // ══════════════════════════════════════════════════════════════

  function extractWords(text) {
    return text.toLowerCase()
      .replace(/[^a-z'\s]/g, ' ')
      .split(/\s+/)
      .map(function (w) { return w.replace(/['\u2019]/g, ''); })
      .filter(function (w) { return w.length >= 1; });
  }

  function onInput() {
    clearTimeout(debounceTimer);
    
    var cur = textarea.value;
    
    if (typingStartedAt === 0 && cur.trim() !== '') {
      typingStartedAt = Date.now();
    }
    
    clearTimeout(idleTimer);
    if (cur.trim() !== '') {
      if (currentSongData && musicText.textContent.startsWith('Still there?')) {
        setStatus('♪ Playing: ' + currentSongData.trackName + ' \u2014 ' + currentSongData.artistName);
      }
    }

    debounceTimer = setTimeout(function () {
      var cur = textarea.value;

      // Diary cleared
      if (cur.trim() === '') {
        resetSession();
        return;
      }

      // Diff detection
      var commonLen = 0;
      var minL = Math.min(prevText.length, cur.length);
      while (commonLen < minL && prevText[commonLen] === cur[commonLen]) {
        commonLen++;
      }
      var addedText = cur.slice(commonLen);
      var removedText = prevText.slice(commonLen);

      // If text was removed, update processedWords
      if (removedText.length > 0) {
        var currentWords = new Set(extractWords(cur));
        processedWords.forEach(function (w) {
          if (!currentWords.has(w)) processedWords.delete(w);
        });
      }
      
      // Scan full text for any unflagged banned word
      var allCurrentWords = extractWords(cur);
      for (var b = 0; b < allCurrentWords.length; b++) {
        if (BANNED_WORDS.has(allCurrentWords[b]) && !flaggedBannedWords.has(allCurrentWords[b])) {
          flaggedBannedWords.add(allCurrentWords[b]);
          handleBannedWord();
          break;
        }
      }

      // Deletion only — no trigger
      if (removedText.length > 0 && addedText.length === 0) {
        prevText = cur;
        return;
      }

      prevText = cur;

      // Find completed words (followed by space/punctuation)
      var completedMatch = cur.match(/^([\s\S]*[\s.,!?;:\-"()\[\]])/);
      if (!completedMatch) return;

      var allCompletedWords = extractWords(completedMatch[1]);
      var allWordsInText = extractWords(cur);

      // Find latest new eligible word
      var triggerCandidate = null;
      for (var i = allCompletedWords.length - 1; i >= 0; i--) {
        var w = allCompletedWords[i];
        if (!processedWords.has(w) && isEligibleWord(w)) {
          triggerCandidate = w;
          break;
        }
      }

      // Fallback: try ANY new word including grammar words
      if (!triggerCandidate) {
        for (var j = allCompletedWords.length - 1; j >= 0; j--) {
          var w2 = allCompletedWords[j];
          if (!processedWords.has(w2) && w2.length >= 1) {
            triggerCandidate = w2;
            break;
          }
        }
      }

      if (!triggerCandidate) return;

      // Mark all completed words as processed
      for (var k = 0; k < allCompletedWords.length; k++) {
        processedWords.add(allCompletedWords[k]);
      }

      triggerWord(triggerCandidate, allWordsInText);
    }, 150);
  }

  // ══════════════════════════════════════════════════════════════
  //  11. SESSION MANAGEMENT
  // ══════════════════════════════════════════════════════════════

  function resetSession() {
    invalidateRequests();
    discardPending();
    stopCurrent();
    clearTimeout(debounceTimer);
    clearTimeout(idleTimer);
    debounceTimer = null;
    idleTimer = null;
    typingStartedAt = 0;
    currentSongData = null;
    prevText = '';
    processedWords = new Set();
    flaggedBannedWords = new Set();
    setStatus('');
  }

  // ══════════════════════════════════════════════════════════════
  //  12. NAVIGATION
  // ══════════════════════════════════════════════════════════════

  function openDiary() {
    ensureAudioUnlocked();
    landingView.classList.add('hidden');
    diaryView.classList.remove('hidden');
    textarea.focus();
  }

  function goHome() {
    resetSession();
    textarea.value = '';
    diaryView.classList.add('hidden');
    landingView.classList.remove('hidden');
  }

  function newEntry() {
    resetSession();
    textarea.value = '';
    placeholderIndex = (placeholderIndex + 1) % PLACEHOLDERS.length;
    textarea.placeholder = PLACEHOLDERS[placeholderIndex];
    spawnBlobs();
    textarea.focus();
  }

  // ══════════════════════════════════════════════════════════════
  //  MODAL / POPUP
  // ══════════════════════════════════════════════════════════════
  
  var modalOverlay = document.getElementById('modal-overlay');
  var modalBody = document.getElementById('modal-body');
  var modalFooter = document.getElementById('modal-footer');
  var modalBtn = document.getElementById('modal-btn');

  function showModal(htmlContent, buttonText, onDismiss, autoDismissMs) {
    if (!modalOverlay || !modalBody) return;
    
    modalBody.innerHTML = htmlContent;
    
    if (buttonText) {
      modalFooter.classList.remove('hidden');
      modalBtn.textContent = buttonText;
      modalBtn.onclick = function() {
        modalOverlay.classList.add('hidden');
        if (onDismiss) onDismiss();
      };
    } else {
      modalFooter.classList.add('hidden');
    }
    
    modalOverlay.classList.remove('hidden');
    
    if (autoDismissMs) {
      setTimeout(function() {
        modalOverlay.classList.add('hidden');
        if (onDismiss) onDismiss();
      }, autoDismissMs);
    }
  }

  function checkFirstVisit() {
    try {
      if (!sessionStorage.getItem('yaptrap_visited')) {
        sessionStorage.setItem('yaptrap_visited', 'true');
        showModal(
          '<h2 class="modal-title">Terms & Conditions</h2>' +
          '<p class="modal-text">By using YapTrap, you agree to let us judge your emotional stability and musical taste. No refunds on bad vibes.</p>',
          'I agree to be judged'
        );
      }
    } catch (e) {}
  }

  checkFirstVisit();

  landingTitle.addEventListener('click', openDiary);
  landingTitle.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDiary(); }
  });

  diaryTitle.addEventListener('click', goHome);
  diaryTitle.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goHome(); }
  });

  btnNewEntry.addEventListener('click', newEntry);
  textarea.addEventListener('input', onInput);

})();
