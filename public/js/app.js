(function () {
  'use strict';

  // State
  let stagedFiles = [];
  let maxFileSizeMb = 50;
  let currentRetrievedCode = null;
  let currentRetrievedFiles = [];
  let currentRetrievedPassword = null;
  let currentActiveEditKey = null;
  let currentSharedCode = null;
  let activeEventSource = null;
  let senderDebounceTimer = null;

  // DOM Elements
  const tabSend = document.getElementById('tabSend');
  const tabReceive = document.getElementById('tabReceive');
  const sendPanel = document.getElementById('sendPanel');
  const receivePanel = document.getElementById('receivePanel');

  const shareForm = document.getElementById('shareForm');
  const primaryTextCard = document.getElementById('primaryTextCard');
  const primaryFileCard = document.getElementById('primaryFileCard');
  const textContent = document.getElementById('textContent');
  const charCounter = document.getElementById('charCounter');
  const clearTextBtn = document.getElementById('clearTextBtn');
  const pasteClipboardBtn = document.getElementById('pasteClipboardBtn');
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const stagedFileList = document.getElementById('stagedFileList');
  const stagedFilesWrap = document.getElementById('stagedFilesWrap');
  const selectAllFilesCheckbox = document.getElementById('selectAllFilesCheckbox');
  const selectedFilesCountText = document.getElementById('selectedFilesCountText');
  const deleteSelectedFilesBtn = document.getElementById('deleteSelectedFilesBtn');
  const uploadLimitLabel = document.getElementById('uploadLimitLabel');

  const optionsToggleBtn = document.getElementById('optionsToggleBtn');
  const optionsCaret = document.getElementById('optionsCaret');
  const optionsBody = document.getElementById('optionsBody');
  const submitShareBtn = document.getElementById('submitShareBtn');
  const liveSyncToggle = document.getElementById('liveSyncToggle');

  const shareResultCard = document.getElementById('shareResultCard');
  const displayCode = document.getElementById('displayCode');
  const displayDirectUrl = document.getElementById('displayDirectUrl');
  const copyCodeBtn = document.getElementById('copyCodeBtn');
  const copyLinkBtn = document.getElementById('copyLinkBtn');
  const shareNativeBtn = document.getElementById('shareNativeBtn');
  const qrImage = document.getElementById('qrImage');
  const shareSummaryStats = document.getElementById('shareSummaryStats');
  const newShareBtn = document.getElementById('newShareBtn');
  const returnToEditBtn = document.getElementById('returnToEditBtn');
  const senderActiveLiveBadge = document.getElementById('senderActiveLiveBadge');
  const senderLiveStatusText = document.getElementById('senderLiveStatusText');

  const receivePrompt = document.getElementById('receivePrompt');
  const receiveForm = document.getElementById('receiveForm');
  const codeEntryInput = document.getElementById('codeEntryInput');
  const pasteCodeBtn = document.getElementById('pasteCodeBtn');
  const passcodeEntryRow = document.getElementById('passcodeEntryRow');
  const receivePassword = document.getElementById('receivePassword');
  const retrieveBtn = document.getElementById('retrieveBtn');
  const receiveErrorBanner = document.getElementById('receiveErrorBanner');

  const payloadDisplay = document.getElementById('payloadDisplay');
  const burnBadge = document.getElementById('burnBadge');
  const payloadExpiryText = document.getElementById('payloadExpiryText');
  const manualBurnBtn = document.getElementById('manualBurnBtn');
  const receiveAnotherBtn = document.getElementById('receiveAnotherBtn');

  const payloadTextCard = document.getElementById('payloadTextCard');
  const payloadTextContent = document.getElementById('payloadTextContent');
  const payloadTextMeta = document.getElementById('payloadTextMeta');
  const receiverLiveBadge = document.getElementById('receiverLiveBadge');
  const copyPayloadTextBtn = document.getElementById('copyPayloadTextBtn');
  const downloadTextFileBtn = document.getElementById('downloadTextFileBtn');

  const payloadFilesCard = document.getElementById('payloadFilesCard');
  const payloadFilesList = document.getElementById('payloadFilesList');
  const payloadFileCountMeta = document.getElementById('payloadFileCountMeta');
  const downloadAllFilesBtn = document.getElementById('downloadAllFilesBtn');
  const fileSearchWrap = document.getElementById('fileSearchWrap');
  const fileSearchInput = document.getElementById('fileSearchInput');
  const fileSearchCount = document.getElementById('fileSearchCount');
  const noFilesMatchNotice = document.getElementById('noFilesMatchNotice');

  // Format bytes to human readable string
  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  // Inline button feedback helper (tactile feedback without floating overlays)
  function inlineBtnFeedback(btn, feedbackText = 'Copied!') {
    if (!btn) return;
    const labelSpan = btn.querySelector('span');
    const originalText = labelSpan ? labelSpan.textContent : btn.textContent;
    if (labelSpan) {
      labelSpan.textContent = feedbackText;
    } else {
      btn.textContent = feedbackText;
    }
    btn.classList.add('btn-copied-state');
    setTimeout(() => {
      if (labelSpan) {
        labelSpan.textContent = originalText;
      } else {
        btn.textContent = originalText;
      }
      btn.classList.remove('btn-copied-state');
    }, 1400);
  }

  // Universal clipboard copy helper (works in HTTPS, HTTP, and mobile browsers without navigator.clipboard)
  async function copyToClipboard(text) {
    if (!text) return false;

    // Try modern Clipboard API if supported in secure context
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {}
    }

    // Universal DOM fallback using execCommand for HTTP (e.g. mobile over local IP 192.168.x.x)
    try {
      const el = document.createElement('textarea');
      el.value = text;
      el.setAttribute('readonly', '');
      el.style.position = 'fixed';
      el.style.left = '-9999px';
      el.style.top = '0';
      el.style.opacity = '0';
      document.body.appendChild(el);

      const selected =
        document.getSelection && document.getSelection().rangeCount > 0
          ? document.getSelection().getRangeAt(0)
          : false;

      el.select();
      el.setSelectionRange(0, text.length);

      const successful = document.execCommand('copy');
      document.body.removeChild(el);

      if (selected && document.getSelection) {
        document.getSelection().removeAllRanges();
        document.getSelection().addRange(selected);
      }
      return successful;
    } catch {
      return false;
    }
  }

  // Tabs Management
  function switchTab(mode) {
    if (mode === 'send') {
      tabSend.classList.add('active');
      tabSend.setAttribute('aria-selected', 'true');
      tabReceive.classList.remove('active');
      tabReceive.setAttribute('aria-selected', 'false');
      sendPanel.classList.add('active');
      receivePanel.classList.remove('active');
      window.location.hash = '';
    } else {
      tabReceive.classList.add('active');
      tabReceive.setAttribute('aria-selected', 'true');
      tabSend.classList.remove('active');
      tabSend.setAttribute('aria-selected', 'false');
      receivePanel.classList.add('active');
      sendPanel.classList.remove('active');
      setTimeout(() => codeEntryInput.focus(), 50);
    }
  }

  tabSend.addEventListener('click', () => switchTab('send'));
  tabReceive.addEventListener('click', () => switchTab('receive'));

  // Fetch Server Limits
  fetch('/api/limits')
    .then(r => r.json())
    .then(data => {
      if (data.maxFileSizeMb) {
        maxFileSizeMb = data.maxFileSizeMb;
        uploadLimitLabel.textContent = `Max ${maxFileSizeMb}MB total`;
      }
    })
    .catch(() => {});

  // Textarea tracking
  function updateTextCounter() {
    const len = textContent.value.length;
    charCounter.textContent = `${len.toLocaleString()} characters`;
    clearTextBtn.style.display = len > 0 ? 'inline-flex' : 'none';
  }

  textContent.addEventListener('input', () => {
    updateTextCounter();
    if (primaryTextCard && primaryTextCard.classList.contains('compressed')) {
      primaryTextCard.classList.remove('compressed');
    }
  });

  // Smart Card Accordion Logic
  // Default state: Text card open, File card compressed
  function expandFileCard() {
    if (!primaryFileCard) return;
    const isTextEmpty = !textContent.value || textContent.value.trim() === '';

    // If text field is empty -> compress text field and expand files section
    if (isTextEmpty) {
      if (primaryTextCard) primaryTextCard.classList.add('compressed');
    }
    // If text field has content -> do not compress anything (both stay expanded)

    primaryFileCard.classList.remove('compressed');
  }

  function expandTextCard() {
    if (!primaryTextCard) return;
    primaryTextCard.classList.remove('compressed');
    // If no files attached, compress files back
    if (stagedFiles.length === 0 && primaryFileCard) {
      primaryFileCard.classList.add('compressed');
    }
    textContent.focus();
  }

  if (primaryFileCard) {
    primaryFileCard.addEventListener('click', (e) => {
      if (primaryFileCard.classList.contains('compressed')) {
        expandFileCard();
      }
    });

    const fileLabelRow = primaryFileCard.querySelector('.field-label-row');
    if (fileLabelRow) {
      fileLabelRow.addEventListener('click', (e) => {
        if (!primaryFileCard.classList.contains('compressed') && stagedFiles.length === 0) {
          primaryFileCard.classList.add('compressed');
          if (primaryTextCard) primaryTextCard.classList.remove('compressed');
        }
      });
    }
  }

  if (primaryTextCard) {
    primaryTextCard.addEventListener('click', (e) => {
      if (primaryTextCard.classList.contains('compressed')) {
        expandTextCard();
      }
    });

    const textLabelRow = primaryTextCard.querySelector('.field-label-row');
    if (textLabelRow) {
      textLabelRow.addEventListener('click', (e) => {
        if (!primaryTextCard.classList.contains('compressed') && (!textContent.value || textContent.value.trim() === '')) {
          primaryTextCard.classList.add('compressed');
          if (primaryFileCard) primaryFileCard.classList.remove('compressed');
        }
      });
    }
  }

  clearTextBtn.addEventListener('click', () => {
    textContent.value = '';
    updateTextCounter();
    textContent.focus();
  });

  // Direct Paste from Clipboard helper
  if (pasteClipboardBtn) {
    pasteClipboardBtn.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          textContent.value = text;
          updateTextCounter();
          inlineBtnFeedback(pasteClipboardBtn, 'Pasted!');
        } else {
          inlineBtnFeedback(pasteClipboardBtn, 'Empty');
        }
      } catch (err) {
        textContent.focus();
        inlineBtnFeedback(pasteClipboardBtn, 'Press Ctrl+V');
      }
    });
  }

  // Staged Files Handling
  function updateSelectedCount() {
    if (!stagedFileList || !selectedFilesCountText || !selectAllFilesCheckbox || !deleteSelectedFilesBtn) return;
    const total = stagedFiles.length;
    const checkedBoxes = stagedFileList.querySelectorAll('.file-item-select:checked');
    const checkedCount = checkedBoxes.length;

    if (checkedCount === 0) {
      selectedFilesCountText.textContent = `Select All (${total})`;
      selectAllFilesCheckbox.checked = false;
      selectAllFilesCheckbox.indeterminate = false;
      deleteSelectedFilesBtn.title = 'Delete all attached files';
    } else if (checkedCount === total) {
      selectedFilesCountText.textContent = `All Selected (${total})`;
      selectAllFilesCheckbox.checked = true;
      selectAllFilesCheckbox.indeterminate = false;
      deleteSelectedFilesBtn.title = 'Delete all attached files';
    } else {
      selectedFilesCountText.textContent = `${checkedCount} of ${total} selected`;
      selectAllFilesCheckbox.checked = false;
      selectAllFilesCheckbox.indeterminate = true;
      deleteSelectedFilesBtn.title = `Delete ${checkedCount} selected file(s)`;
    }
  }

  function renderStagedFiles() {
    stagedFileList.innerHTML = '';
    if (stagedFiles.length === 0) {
      if (stagedFilesWrap) stagedFilesWrap.style.display = 'none';
      if (selectAllFilesCheckbox) {
        selectAllFilesCheckbox.checked = false;
        selectAllFilesCheckbox.indeterminate = false;
      }
      return;
    }

    if (stagedFilesWrap) stagedFilesWrap.style.display = 'flex';
    let totalBytes = 0;

    stagedFiles.forEach((file, index) => {
      totalBytes += file.size;
      const item = document.createElement('div');
      item.className = 'file-item';
      item.innerHTML = `
        <input type="checkbox" class="file-item-select staged-checkbox" data-index="${index}" title="Select file">
        <div class="file-item-info">
          <svg class="file-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
          </svg>
          <span class="file-item-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
          <span class="file-item-size">${formatBytes(file.size)}</span>
        </div>
        <button type="button" class="file-item-remove" data-index="${index}" title="Remove file">&times;</button>
      `;
      stagedFileList.appendChild(item);
    });

    const maxBytes = maxFileSizeMb * 1024 * 1024;
    uploadLimitLabel.textContent = `${stagedFiles.length} file(s) &bull; ${formatBytes(totalBytes)} of ${maxFileSizeMb}MB`;
    updateSelectedCount();
  }

  if (selectAllFilesCheckbox) {
    selectAllFilesCheckbox.addEventListener('change', () => {
      const isChecked = selectAllFilesCheckbox.checked;
      const checkboxes = stagedFileList.querySelectorAll('.file-item-select');
      checkboxes.forEach(cb => cb.checked = isChecked);
      updateSelectedCount();
    });
  }

  if (stagedFileList) {
    stagedFileList.addEventListener('change', (e) => {
      if (e.target.classList.contains('file-item-select')) {
        updateSelectedCount();
      }
    });

    stagedFileList.addEventListener('click', (e) => {
      const removeBtn = e.target.closest('.file-item-remove');
      if (!removeBtn) return;
      const index = parseInt(removeBtn.getAttribute('data-index'), 10);
      stagedFiles.splice(index, 1);
      renderStagedFiles();
    });
  }

  if (deleteSelectedFilesBtn) {
    deleteSelectedFilesBtn.addEventListener('click', () => {
      if (stagedFiles.length === 0) return;
      const checkedBoxes = Array.from(stagedFileList.querySelectorAll('.file-item-select:checked'));

      if (checkedBoxes.length > 0) {
        // Delete selected files
        const selectedIndices = new Set(checkedBoxes.map(cb => parseInt(cb.getAttribute('data-index'), 10)));
        stagedFiles = stagedFiles.filter((_, idx) => !selectedIndices.has(idx));
      } else {
        // If none specifically checked, delete all
        stagedFiles = [];
      }
      renderStagedFiles();
    });
  }

  function addFiles(files) {
    expandFileCard();
    const maxBytes = maxFileSizeMb * 1024 * 1024;
    let currentTotal = stagedFiles.reduce((acc, f) => acc + f.size, 0);

    for (const file of files) {
      if (currentTotal + file.size > maxBytes) {
        uploadLimitLabel.textContent = `Limit exceeded (${maxFileSizeMb}MB max)`;
        uploadLimitLabel.style.color = 'var(--danger-primary)';
        setTimeout(() => {
          uploadLimitLabel.style.color = '';
          renderStagedFiles();
        }, 3000);
        break;
      }
      // Avoid duplicate filename additions in same batch
      const exists = stagedFiles.some(f => f.name === file.name && f.size === file.size);
      if (!exists) {
        stagedFiles.push(file);
        currentTotal += file.size;
      }
    }
    renderStagedFiles();
  }

  // Dropzone drag-and-drop
  ['dragenter', 'dragover'].forEach(event => {
    dropzone.addEventListener(event, (e) => {
      e.preventDefault();
      dropzone.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach(event => {
    dropzone.addEventListener(event, (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    if (e.dataTransfer && e.dataTransfer.files) {
      addFiles(e.dataTransfer.files);
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files) {
      addFiles(fileInput.files);
      fileInput.value = '';
    }
  });

  // Options drawer toggle
  optionsToggleBtn.addEventListener('click', () => {
    const isHidden = optionsBody.style.display === 'none';
    optionsBody.style.display = isHidden ? 'flex' : 'none';
    optionsCaret.classList.toggle('open', isHidden);
  });

  // Password visibility eye toggles
  function setupPasswordToggle(toggleBtnId, inputId) {
    const btn = document.getElementById(toggleBtnId);
    const input = document.getElementById(inputId);
    if (!btn || !input) return;

    const openIcon = btn.querySelector('.eye-open');
    const closedIcon = btn.querySelector('.eye-closed');

    btn.addEventListener('click', () => {
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      if (openIcon) openIcon.style.display = isPassword ? 'none' : 'block';
      if (closedIcon) closedIcon.style.display = isPassword ? 'block' : 'none';
      btn.title = isPassword ? 'Hide passcode' : 'Show passcode';
      input.focus();
    });
  }

  setupPasswordToggle('togglePasscodeEye', 'passcode');
  setupPasswordToggle('toggleReceivePasswordEye', 'receivePassword');

  // Share Form Submission
  shareForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const text = textContent.value.trim();
    if (!text && stagedFiles.length === 0) {
      textContent.focus();
      return;
    }

    submitShareBtn.disabled = true;
    submitShareBtn.querySelector('span').textContent = 'Uploading...';

    const isLiveSync = liveSyncToggle && liveSyncToggle.checked && !document.getElementById('burnToggle').checked;
    const isBurn = document.getElementById('burnToggle').checked;

    const formData = new FormData();
    formData.append('text', text);
    formData.append('expiration', document.getElementById('expirySelect').value);
    formData.append('password', document.getElementById('passcode').value);
    formData.append('burnAfterRead', isBurn);
    formData.append('liveSync', isLiveSync);

    stagedFiles.forEach(file => {
      formData.append('files', file);
    });

    try {
      const response = await fetch('/api/share', {
        method: 'POST',
        body: formData
      });

      const resData = await response.json();

      if (!response.ok) {
        throw new Error(resData.error || 'Failed to generate code.');
      }

      // Display results
      shareForm.style.display = 'none';
      shareResultCard.style.display = 'flex';

      const codeStr = resData.code;
      // Format with gap e.g. 123 456
      displayCode.textContent = codeStr.length === 6 ? `${codeStr.slice(0, 3)} ${codeStr.slice(3)}` : codeStr;
      displayDirectUrl.value = resData.directUrl;

      if (resData.qrCode) {
        qrImage.src = resData.qrCode;
        qrImage.parentElement.style.display = 'flex';
      } else {
        qrImage.parentElement.style.display = 'none';
      }

      const expiryDate = new Date(resData.expiresAt);
      shareSummaryStats.innerHTML = `
        <div>Expires: <strong>${expiryDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong></div>
        <div>Mode: <strong>${resData.burnAfterRead ? 'Self-Destruct on read' : (resData.liveSync ? 'Real-time Live Sync' : 'Standard TTL')}</strong></div>
        <div>Passcode: <strong>${resData.hasPassword ? 'Protected' : 'None'}</strong></div>
        <div>Payload: <strong>${resData.hasText ? 'Text' : ''} ${resData.fileCount > 0 ? `+ ${resData.fileCount} file(s)` : ''}</strong></div>
      `;

      const isLiveSync = resData.liveSync;

      // Set state for real-time live sync
      currentSharedCode = resData.code;
      currentActiveEditKey = resData.editKey;

      if (isLiveSync) {
        // KEEP PRIMARY TEXT FIELD VISIBLE for live editing!
        shareForm.style.display = 'flex';
        // Hide file dropzone, options and generate button during live session
        document.getElementById('dropzone').closest('.field-card').style.display = 'none';
        optionsToggleBtn.closest('.options-container').style.display = 'none';
        submitShareBtn.style.display = 'none';

        // Show result card with code/link/QR right below it
        shareResultCard.style.display = 'flex';
        returnToEditBtn.style.display = 'none';

        // Show pulsing live badge on primary field
        senderActiveLiveBadge.style.display = 'inline-flex';
        senderLiveStatusText.textContent = `Live Synced (${codeStr})`;

        // Auto-focus primary field for immediate live typing
        textContent.focus();
      } else {
        // Standard static share: switch to result card
        shareForm.style.display = 'none';
        shareResultCard.style.display = 'flex';
        returnToEditBtn.style.display = 'none';
        senderActiveLiveBadge.style.display = 'none';
      }
    } catch (err) {
      alert(err.message || 'Error uploading content.');
    } finally {
      submitShareBtn.disabled = false;
      submitShareBtn.querySelector('span').textContent = 'Generate Receive Code';
    }
  });

  // Return to Edit in the primary textarea
  if (returnToEditBtn) {
    returnToEditBtn.addEventListener('click', () => {
      shareResultCard.style.display = 'none';
      shareForm.style.display = 'flex';
      submitShareBtn.style.display = 'none';
      textContent.focus();
    });
  }

  // Real-time live synchronization directly on primary textarea
  textContent.addEventListener('input', () => {
    if (!currentSharedCode || !currentActiveEditKey || !liveSyncToggle || !liveSyncToggle.checked) {
      return;
    }

    senderActiveLiveBadge.style.display = 'inline-flex';
    senderLiveStatusText.textContent = 'Syncing...';

    if (senderDebounceTimer) clearTimeout(senderDebounceTimer);

    senderDebounceTimer = setTimeout(async () => {
      try {
        const res = await fetch('/api/update-text', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: currentSharedCode,
            editKey: currentActiveEditKey,
            text: textContent.value
          })
        });

        if (res.ok) {
          senderLiveStatusText.textContent = 'Live Synced';
        } else {
          senderLiveStatusText.textContent = 'Sync failed';
        }
      } catch {
        senderLiveStatusText.textContent = 'Offline';
      }
    }, 350); // 350ms debounce
  });

  // Copy Code
  copyCodeBtn.addEventListener('click', async () => {
    const raw = displayCode ? displayCode.textContent.replace(/\s+/g, '') : '';
    const success = await copyToClipboard(raw);
    if (success) {
      inlineBtnFeedback(copyCodeBtn, 'Copied!');
    }
  });

  // Copy Link
  copyLinkBtn.addEventListener('click', async () => {
    const val = displayDirectUrl ? displayDirectUrl.value : '';
    const success = await copyToClipboard(val);
    if (success) {
      inlineBtnFeedback(copyLinkBtn, 'Copied!');
    } else {
      if (displayDirectUrl) {
        displayDirectUrl.focus();
        displayDirectUrl.select();
      }
      inlineBtnFeedback(copyLinkBtn, 'Selected');
    }
  });

  // System Default Share Sheet (Mobile / Desktop)
  if (shareNativeBtn) {
    shareNativeBtn.addEventListener('click', async () => {
      const url = displayDirectUrl ? displayDirectUrl.value : window.location.href;
      const code = displayCode ? displayCode.textContent.replace(/\s+/g, '') : '';
      const shareText = code
        ? `Retrieve clipboard note with code ${code}: ${url}`
        : `Retrieve clipboard note: ${url}`;

      // 1. Try standard Web Share API (native share sheet on HTTPS / supported mobile browsers)
      if (navigator.share) {
        try {
          await navigator.share({
            title: 'Online Clipboard',
            text: code ? `Retrieve clipboard note with code: ${code}` : 'Retrieve clipboard note',
            url: url
          });
          return;
        } catch (err) {
          if (err && err.name === 'AbortError') return; // User closed the native share menu
        }
      }

      // 2. Android System Default Share Intent (opens Android system share sheet on HTTP / local Wi-Fi)
      const isAndroid = /Android/i.test(navigator.userAgent);
      if (isAndroid) {
        const intentUri = `intent:#Intent;action=android.intent.action.SEND;type=text/plain;S.android.intent.extra.TEXT=${encodeURIComponent(shareText)};end`;
        window.location.href = intentUri;
        return;
      }

      // 3. iOS / Mobile fallback (opens native share / messages composer)
      const isIosDevice = /iPad|iPhone|iPod/.test(navigator.userAgent);
      if (isIosDevice) {
        window.location.href = `sms:&body=${encodeURIComponent(shareText)}`;
        return;
      }

      // 4. Desktop fallback (opens system default mail / share composer)
      window.location.href = `mailto:?subject=${encodeURIComponent('Online Clipboard Note')}&body=${encodeURIComponent(shareText)}`;
    });
  }

  // Reset Share Form
  newShareBtn.addEventListener('click', () => {
    shareForm.reset();
    stagedFiles = [];
    renderStagedFiles();
    textContent.value = '';
    charCounter.textContent = '0 characters';
    clearTextBtn.style.display = 'none';
    currentSharedCode = null;
    currentActiveEditKey = null;
    senderActiveLiveBadge.style.display = 'none';

    // Restore default smart accordion: text expanded, files compressed
    if (primaryTextCard) {
      primaryTextCard.style.display = 'flex';
      primaryTextCard.classList.remove('compressed');
    }
    if (primaryFileCard) {
      primaryFileCard.style.display = 'flex';
      primaryFileCard.classList.add('compressed');
    }
    optionsToggleBtn.closest('.options-container').style.display = 'block';
    submitShareBtn.style.display = 'flex';
    returnToEditBtn.style.display = 'none';
    shareResultCard.style.display = 'none';
    shareForm.style.display = 'flex';
  });

  // Receive Form Handling
  function formatCodeInput(val) {
    const clean = val.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6);
    if (clean.length > 3) {
      return `${clean.slice(0, 3)} ${clean.slice(3)}`;
    }
    return clean;
  }

  codeEntryInput.addEventListener('input', () => {
    const cursor = codeEntryInput.selectionStart;
    const prevLen = codeEntryInput.value.length;
    codeEntryInput.value = formatCodeInput(codeEntryInput.value);

    // Auto-fetch if 6 alphanumeric characters are provided
    const raw = codeEntryInput.value.replace(/\s+/g, '');
    if (raw.length === 6 && passcodeEntryRow.style.display === 'none') {
      fetchPayload();
    }
  });

  // Quick Paste Code Button
  if (pasteCodeBtn) {
    pasteCodeBtn.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          codeEntryInput.value = formatCodeInput(text.trim());
          const raw = codeEntryInput.value.replace(/\s+/g, '');
          if (raw.length === 6 && passcodeEntryRow.style.display === 'none') {
            fetchPayload();
          }
          inlineBtnFeedback(pasteCodeBtn, 'Pasted!');
        } else {
          inlineBtnFeedback(pasteCodeBtn, 'Empty');
        }
      } catch (err) {
        codeEntryInput.focus();
        inlineBtnFeedback(pasteCodeBtn, 'Press Ctrl+V');
      }
    });
  }

  receiveForm.addEventListener('submit', (e) => {
    e.preventDefault();
    fetchPayload();
  });

  async function fetchPayload() {
    const rawCode = codeEntryInput.value.replace(/\s+/g, '').trim();
    if (!rawCode) {
      showError('Please enter a receive code.');
      return;
    }

    hideError();
    retrieveBtn.disabled = true;
    retrieveBtn.querySelector('span').textContent = 'Fetching...';

    const password = receivePassword.value.trim();

    try {
      const response = await fetch('/api/receive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: rawCode, password: password || null })
      });

      const resData = await response.json();

      if (!response.ok) {
        if (resData.code === 'PASSWORD_REQUIRED') {
          passcodeEntryRow.style.display = 'flex';
          receivePassword.focus();
          showError('Passcode required. Please enter the passcode to view.');
          return;
        }
        if (resData.code === 'INVALID_PASSWORD') {
          showError('Incorrect passcode. Access denied.');
          receivePassword.focus();
          return;
        }
        throw new Error(resData.error || 'Content not found or expired.');
      }

      currentRetrievedCode = rawCode;
      renderPayload(resData.data, password);
    } catch (err) {
      showError(err.message);
    } finally {
      retrieveBtn.disabled = false;
      retrieveBtn.querySelector('span').textContent = 'Fetch Content';
    }
  }

  function showError(msg) {
    receiveErrorBanner.textContent = msg;
    receiveErrorBanner.style.display = 'block';
  }

  function hideError() {
    receiveErrorBanner.style.display = 'none';
  }

  // Render Retrieved Payload
  function renderPayload(data, password) {
    receivePrompt.style.display = 'none';
    payloadDisplay.style.display = 'flex';

    burnBadge.style.display = data.burnAfterRead ? 'inline-block' : 'none';

    // Expiry time
    const expiresDate = new Date(data.expiresAt);
    const now = Date.now();
    const minsLeft = Math.max(1, Math.round((data.expiresAt - now) / 60000));
    payloadExpiryText.textContent = data.burnAfterRead
      ? 'Self-destructed from server (Viewed)'
      : `Expires in ${minsLeft}m (${expiresDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;

    // Render Text
    if (data.text) {
      payloadTextCard.style.display = 'block';
      payloadTextContent.textContent = data.text;
      payloadTextMeta.textContent = `${data.text.length} chars &bull; ${data.text.split(/\s+/).filter(Boolean).length} words`;
    } else {
      payloadTextCard.style.display = 'none';
    }

    // Connect to real-time SSE stream only if sender enabled Real-time Live Share
    if (data.liveSync && !data.burnAfterRead) {
      connectLiveStream(data.code);
    } else {
      if (receiverLiveBadge) receiverLiveBadge.style.display = 'none';
    }

    // Render Files
    if (data.files && data.files.length > 0) {
      currentRetrievedFiles = data.files;
      currentRetrievedPassword = password;
      payloadFilesCard.style.display = 'block';
      payloadFileCountMeta.textContent = `${data.files.length} file(s)`;
      if (downloadAllFilesBtn) {
        downloadAllFilesBtn.style.display = data.files.length > 1 ? 'inline-flex' : 'none';
      }
      renderFilesList(data.files, data.code, password);
    } else {
      currentRetrievedFiles = [];
      currentRetrievedPassword = null;
      payloadFilesCard.style.display = 'none';
      if (downloadAllFilesBtn) {
        downloadAllFilesBtn.style.display = 'none';
      }
    }
  }

  // Live SSE stream connection for receiver
  function connectLiveStream(code) {
    if (activeEventSource) {
      activeEventSource.close();
      activeEventSource = null;
    }

    try {
      activeEventSource = new EventSource(`/api/stream/${encodeURIComponent(code)}`);

      activeEventSource.addEventListener('connected', () => {
        if (receiverLiveBadge) receiverLiveBadge.style.display = 'inline-flex';
      });

      activeEventSource.addEventListener('text-update', (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (payloadTextCard && payloadTextContent) {
            payloadTextCard.style.display = 'block';
            payloadTextContent.textContent = payload.text;
            payloadTextMeta.textContent = `${payload.text.length} chars &bull; ${payload.text.split(/\s+/).filter(Boolean).length} words`;
          }
        } catch {}
      });

      activeEventSource.addEventListener('deleted', () => {
        resetReceiveScreen();
        showError('Clipboard was deleted by sender.');
      });

      activeEventSource.onerror = () => {
        // EventSource will auto-reconnect if network drops
      };
    } catch {}
  }

  // Optimal File Search Index & Logic
  let currentFileIndex = [];

  function normalizeSearchStr(str) {
    return (str || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  function applyFileFilter() {
    if (!fileSearchInput || !payloadFilesList) return;
    const rawQuery = fileSearchInput.value;
    const query = normalizeSearchStr(rawQuery);
    const qTokens = query.split(/\s+/).filter(Boolean);
    const cards = payloadFilesList.querySelectorAll('.file-preview-card');

    if (qTokens.length === 0) {
      cards.forEach(card => card.style.display = 'flex');
      if (fileSearchCount) fileSearchCount.style.display = 'none';
      if (noFilesMatchNotice) noFilesMatchNotice.style.display = 'none';
      return;
    }

    let matchCount = 0;
    currentFileIndex.forEach(item => {
      // Optimal token-based match: every query token must match either filename substring or a token prefix
      const matches = qTokens.every(q => {
        return item.normName.includes(q) || item.tokens.some(t => t.startsWith(q));
      });

      const card = cards[item.index];
      if (card) {
        if (matches) {
          card.style.display = 'flex';
          matchCount++;
        } else {
          card.style.display = 'none';
        }
      }
    });

    if (fileSearchCount) {
      fileSearchCount.style.display = 'inline-block';
      fileSearchCount.textContent = `${matchCount} of ${currentFileIndex.length}`;
    }
    if (noFilesMatchNotice) {
      noFilesMatchNotice.style.display = matchCount === 0 ? 'block' : 'none';
    }
  }

  if (fileSearchInput) {
    fileSearchInput.addEventListener('input', applyFileFilter);
  }

  function renderFilesList(files, code, password) {
    payloadFilesList.innerHTML = '';
    currentFileIndex = [];

    // Show search bar only if more than 1 file is present
    if (files.length > 1) {
      if (fileSearchWrap) fileSearchWrap.style.display = 'flex';
      if (fileSearchInput) {
        fileSearchInput.value = '';
        fileSearchInput.placeholder = `Filter ${files.length} files by name...`;
      }
      if (fileSearchCount) fileSearchCount.style.display = 'none';
    } else {
      if (fileSearchWrap) fileSearchWrap.style.display = 'none';
    }
    if (noFilesMatchNotice) noFilesMatchNotice.style.display = 'none';

    // Pre-build optimal search index
    files.forEach((file, index) => {
      const normName = normalizeSearchStr(file.name);
      currentFileIndex.push({
        index,
        file,
        normName,
        tokens: normName.split(/[\s._-]+/).filter(Boolean)
      });
    });

    files.forEach((file, index) => {
      const card = document.createElement('div');
      card.className = 'file-preview-card';
      card.setAttribute('data-index', index);

      const pwdParam = password ? `?pwd=${encodeURIComponent(password)}` : '';
      const downloadUrl = `/api/file/${encodeURIComponent(code)}/${encodeURIComponent(file.id)}${pwdParam}`;
      const inlineUrl = `/api/file/${encodeURIComponent(code)}/${encodeURIComponent(file.id)}${pwdParam ? pwdParam + '&' : '?'}inline=true`;

      const mime = (file.mimeType || '').toLowerCase();
      const isPreviewable = mime.startsWith('image/') || mime.startsWith('video/') || mime.startsWith('audio/') || mime === 'application/pdf';

      const caretSvg = isPreviewable
        ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="file-expand-caret">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>`
        : '';

      card.innerHTML = `
        <div class="file-meta-row">
          <div class="file-title-wrap" ${isPreviewable ? 'title="Click to preview file"' : ''}>
            ${caretSvg}
            <svg class="file-type-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
            </svg>
            <span class="file-name-text" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
            <span class="file-size-text">${formatBytes(file.size)}</span>
          </div>
          <a href="${downloadUrl}" class="file-download-btn" download="${escapeHtml(file.name)}" title="Download ${escapeHtml(file.name)}" aria-label="Download ${escapeHtml(file.name)}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
          </a>
        </div>
        ${isPreviewable ? `<div class="preview-media-container" data-loaded="false"></div>` : ''}
      `;

      if (isPreviewable) {
        const titleWrap = card.querySelector('.file-title-wrap');
        const mediaContainer = card.querySelector('.preview-media-container');

        titleWrap.addEventListener('click', () => {
          const isExpanded = card.classList.contains('expanded');

          if (isExpanded) {
            card.classList.remove('expanded');
          } else {
            // Lazy load the preview element on demand
            if (mediaContainer && mediaContainer.getAttribute('data-loaded') === 'false') {
              mediaContainer.setAttribute('data-loaded', 'true');
              let innerMedia = '';
              if (mime.startsWith('image/')) {
                innerMedia = `<img src="${inlineUrl}" alt="${escapeHtml(file.name)}" loading="lazy">`;
              } else if (mime.startsWith('video/')) {
                innerMedia = `<video controls preload="metadata"><source src="${inlineUrl}" type="${mime}">Your browser does not support video playback.</video>`;
              } else if (mime.startsWith('audio/')) {
                innerMedia = `<audio controls preload="metadata"><source src="${inlineUrl}" type="${mime}">Your browser does not support audio playback.</audio>`;
              } else if (mime === 'application/pdf') {
                innerMedia = `<iframe src="${inlineUrl}" title="${escapeHtml(file.name)}"></iframe>`;
              }
              mediaContainer.innerHTML = innerMedia;
            }
            card.classList.add('expanded');
          }
        });
      }

      payloadFilesList.appendChild(card);
    });
  }

  // Download All Files in payload
  if (downloadAllFilesBtn) {
    downloadAllFilesBtn.addEventListener('click', async () => {
      if (!currentRetrievedFiles || currentRetrievedFiles.length === 0 || !currentRetrievedCode) return;

      const btnSpan = downloadAllFilesBtn.querySelector('span');
      const originalText = btnSpan ? btnSpan.textContent : 'Download All';
      if (btnSpan) btnSpan.textContent = 'Downloading...';
      downloadAllFilesBtn.disabled = true;

      try {
        const pwdParam = currentRetrievedPassword ? `?pwd=${encodeURIComponent(currentRetrievedPassword)}` : '';
        for (let i = 0; i < currentRetrievedFiles.length; i++) {
          const file = currentRetrievedFiles[i];
          const downloadUrl = `/api/file/${encodeURIComponent(currentRetrievedCode)}/${encodeURIComponent(file.id)}${pwdParam}`;

          const a = document.createElement('a');
          a.href = downloadUrl;
          a.download = file.name;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);

          // Stagger downloads by 250ms so browser doesn't block or drop concurrent downloads
          if (i < currentRetrievedFiles.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
        }
        if (btnSpan) btnSpan.textContent = 'Downloaded!';
        setTimeout(() => {
          if (btnSpan) btnSpan.textContent = originalText;
          downloadAllFilesBtn.disabled = false;
        }, 1500);
      } catch (err) {
        if (btnSpan) btnSpan.textContent = originalText;
        downloadAllFilesBtn.disabled = false;
      }
    });
  }

  // Copy Payload Text
  copyPayloadTextBtn.addEventListener('click', async () => {
    const text = payloadTextContent ? payloadTextContent.textContent : '';
    const success = await copyToClipboard(text);
    if (success) {
      inlineBtnFeedback(copyPayloadTextBtn, 'Copied!');
    }
  });

  // Download Text as .txt
  downloadTextFileBtn.addEventListener('click', () => {
    const blob = new Blob([payloadTextContent.textContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clipboard-note-${currentRetrievedCode || 'content'}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  // Manual Burn Action
  manualBurnBtn.addEventListener('click', async () => {
    if (!currentRetrievedCode) return;
    if (!confirm('Are you sure? This will delete the content permanently right now.')) return;

    try {
      const response = await fetch(`/api/burn/${encodeURIComponent(currentRetrievedCode)}`, {
        method: 'DELETE'
      });
      if (response.ok) {
        resetReceiveScreen();
      }
    } catch {
      alert('Could not delete payload.');
    }
  });

  // Reset Receive Screen for new lookup
  receiveAnotherBtn.addEventListener('click', () => {
    resetReceiveScreen();
  });

  function resetReceiveScreen() {
    if (activeEventSource) {
      activeEventSource.close();
      activeEventSource = null;
    }
    if (receiverLiveBadge) {
      receiverLiveBadge.style.display = 'none';
    }
    payloadDisplay.style.display = 'none';
    if (downloadAllFilesBtn) {
      downloadAllFilesBtn.style.display = 'none';
    }
    currentRetrievedFiles = [];
    currentRetrievedPassword = null;
    if (fileSearchWrap) fileSearchWrap.style.display = 'none';
    if (fileSearchInput) fileSearchInput.value = '';
    if (fileSearchCount) fileSearchCount.style.display = 'none';
    if (noFilesMatchNotice) noFilesMatchNotice.style.display = 'none';
    receivePrompt.style.display = 'flex';
    receiveForm.reset();
    passcodeEntryRow.style.display = 'none';
    hideError();
    currentRetrievedCode = null;
    codeEntryInput.value = '';
    codeEntryInput.focus();
  }

  // Deep-link check for hash or query param: #code=123456 or ?code=123456
  function checkUrlHash() {
    let code = null;
    if (window.location.hash.startsWith('#code=')) {
      code = window.location.hash.replace('#code=', '').trim();
    } else {
      const params = new URLSearchParams(window.location.search);
      code = params.get('code');
    }

    if (code) {
      switchTab('receive');
      codeEntryInput.value = formatCodeInput(code);
      fetchPayload();
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Legal Modal Dialog Handlers
  const openTermsBtn = document.getElementById('openTermsBtn');
  const closeTermsBtn = document.getElementById('closeTermsBtn');
  const dismissTermsBtn = document.getElementById('dismissTermsBtn');
  const legalModal = document.getElementById('legalModal');
  const currentYear = document.getElementById('currentYear');

  if (currentYear) {
    currentYear.textContent = new Date().getFullYear();
  }

  function openLegalModal() {
    if (legalModal) {
      legalModal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
    }
  }

  function closeLegalModal() {
    if (legalModal) {
      legalModal.style.display = 'none';
      document.body.style.overflow = '';
    }
  }

  if (openTermsBtn) openTermsBtn.addEventListener('click', openLegalModal);
  if (closeTermsBtn) closeTermsBtn.addEventListener('click', closeLegalModal);
  if (dismissTermsBtn) dismissTermsBtn.addEventListener('click', closeLegalModal);

  if (legalModal) {
    legalModal.addEventListener('click', (e) => {
      if (e.target === legalModal) {
        closeLegalModal();
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && legalModal && legalModal.style.display === 'flex') {
      closeLegalModal();
    }
  });

  // Desktop & Mobile PWA Installation Logic
  const desktopInstallBtn = document.getElementById('desktopInstallBtn');
  const floatingShortcutWrap = document.getElementById('floatingShortcutWrap');
  const installShortcutBtn = document.getElementById('installShortcutBtn');
  const dismissShortcutBtn = document.getElementById('dismissShortcutBtn');
  const installGuideSheet = document.getElementById('installGuideSheet');
  const installGuideTitle = document.getElementById('installGuideTitle');
  const installGuideBody = document.getElementById('installGuideBody');
  const closeInstallGuideBtn = document.getElementById('closeInstallGuideBtn');
  const gotItInstallGuideBtn = document.getElementById('gotItInstallGuideBtn');

  let deferredInstallPrompt = null;
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isMobileOrTablet = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 820;

  // Show desktop header install button if not already running as installed app
  if (desktopInstallBtn && !isStandalone) {
    desktopInstallBtn.style.display = 'inline-flex';
  }

  function shouldShowMobileShortcut() {
    if (isStandalone) return false;
    if (sessionStorage.getItem('clipboard_shortcut_dismissed') === 'true') return false;
    return isMobileOrTablet;
  }

  if (floatingShortcutWrap && shouldShowMobileShortcut()) {
    floatingShortcutWrap.style.display = 'flex';
  }

  // Register Service Worker to satisfy PWA desktop and mobile installation criteria
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  // Intercept PWA install prompt (Chrome, Edge, Brave, Android, Windows, Mac)
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (desktopInstallBtn && !isStandalone) {
      desktopInstallBtn.style.display = 'inline-flex';
    }
    if (floatingShortcutWrap && !isStandalone && sessionStorage.getItem('clipboard_shortcut_dismissed') !== 'true') {
      floatingShortcutWrap.style.display = 'flex';
    }
  });

  window.addEventListener('appinstalled', () => {
    if (desktopInstallBtn) desktopInstallBtn.style.display = 'none';
    if (floatingShortcutWrap) floatingShortcutWrap.style.display = 'none';
    deferredInstallPrompt = null;
  });

  function showInstallGuide() {
    if (!installGuideSheet || !installGuideBody) return;

    if (!isMobileOrTablet) {
      // Desktop Instructions (Windows, Mac, Linux)
      if (installGuideTitle) installGuideTitle.textContent = 'Install as Desktop App';
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      installGuideBody.innerHTML = `
        <p>Run Online Clipboard directly on your desktop with its own window, taskbar icon, and offline support:</p>
        <ol class="ios-steps-list">
          <li>Look for the <strong>Install</strong> icon <svg class="inline-sheet-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> in the right side of your browser's address bar.</li>
          <li>Or click your browser menu (<strong>&vellip;</strong> in Chrome/Brave or <strong>&hellip;</strong> in Edge) &rarr; <strong>Apps</strong> &rarr; <strong>Install Online Clipboard</strong>.</li>
          ${isMac ? '<li>In Safari (macOS Sonoma+): Click <strong>File</strong> &rarr; <strong>Add to Dock</strong>.</li>' : ''}
          <li>Click <strong>Install</strong> to place a shortcut on your desktop and taskbar.</li>
        </ol>
      `;
    } else if (isIos) {
      // iOS Instructions
      if (installGuideTitle) installGuideTitle.textContent = 'Add to Home Screen (iOS)';
      installGuideBody.innerHTML = `
        <p>To open this clipboard directly from your phone's home screen:</p>
        <ol class="ios-steps-list">
          <li>Tap the <strong>Share</strong> button <svg class="inline-sheet-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path><polyline points="16 6 12 2 8 6"></polyline><line x1="12" y1="2" x2="12" y2="15"></line></svg> at the bottom of Safari.</li>
          <li>Scroll down and tap <strong>Add to Home Screen</strong> <svg class="inline-sheet-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>.</li>
        </ol>
      `;
    } else {
      // Android Instructions
      if (installGuideTitle) installGuideTitle.textContent = 'Add to Home Screen (Android)';
      installGuideBody.innerHTML = `
        <p>Directly open your clipboard from your phone's home screen:</p>
        <ol class="ios-steps-list">
          <li>Tap the <strong>3 dots (&vellip;)</strong> at the top right of Chrome.</li>
          <li>Tap <strong>Add to Home screen</strong> (or <strong>Install app</strong>).</li>
        </ol>
      `;
    }
    installGuideSheet.style.display = 'flex';
  }

  function closeInstallGuide() {
    if (installGuideSheet) installGuideSheet.style.display = 'none';
  }

  async function triggerInstallFlow() {
    if (deferredInstallPrompt) {
      try {
        deferredInstallPrompt.prompt();
        const { outcome } = await deferredInstallPrompt.userChoice;
        if (outcome === 'accepted') {
          if (desktopInstallBtn) desktopInstallBtn.style.display = 'none';
          if (floatingShortcutWrap) floatingShortcutWrap.style.display = 'none';
        }
        deferredInstallPrompt = null;
      } catch {
        showInstallGuide();
      }
    } else {
      showInstallGuide();
    }
  }

  if (desktopInstallBtn) {
    desktopInstallBtn.addEventListener('click', triggerInstallFlow);
  }

  if (installShortcutBtn) {
    installShortcutBtn.addEventListener('click', triggerInstallFlow);
  }

  if (dismissShortcutBtn) {
    dismissShortcutBtn.addEventListener('click', () => {
      if (floatingShortcutWrap) floatingShortcutWrap.style.display = 'none';
      sessionStorage.setItem('clipboard_shortcut_dismissed', 'true');
    });
  }

  if (closeInstallGuideBtn) closeInstallGuideBtn.addEventListener('click', closeInstallGuide);
  if (gotItInstallGuideBtn) gotItInstallGuideBtn.addEventListener('click', closeInstallGuide);
  if (installGuideSheet) {
    installGuideSheet.addEventListener('click', (e) => {
      if (e.target === installGuideSheet) closeInstallGuide();
    });
  }

  // Initialize
  checkUrlHash();

})();
