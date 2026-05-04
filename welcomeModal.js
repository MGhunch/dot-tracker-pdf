/* =================================================================
   WELCOME MODAL — Phase D
   Self-contained module. Three public functions:

     openWelcomeModal(firstName)  — opens the modal, button starts disabled
     markWelcomeReady()           — enables the button (call when data lands)
     closeWelcomeModal()          — hides the modal, cleans ?welcome=1 from URL

   Defensive: if markWelcomeReady() hasn't been called within
   READY_FALLBACK_MS, the button enables anyway so the user is never
   trapped behind a stalled load.
   ================================================================= */

(function() {
    const READY_FALLBACK_MS = 5000;

    let readyTimer = null;
    let isOpen = false;

    function el(id) { return document.getElementById(id); }

    function openWelcomeModal(firstName) {
        const overlay = el('welcome-modal-overlay');
        const button  = el('welcome-modal-button');
        const fnEl    = el('welcome-modal-firstname');
        if (!overlay || !button) return;

        if (fnEl) fnEl.textContent = firstName || 'there';

        // Reset to loading state every time we open.
        button.disabled = true;
        button.classList.remove('is-ready');

        overlay.classList.add('visible');
        isOpen = true;

        // Defensive — if data never lands, free the user after 5s.
        if (readyTimer) clearTimeout(readyTimer);
        readyTimer = setTimeout(() => {
            markWelcomeReady();
        }, READY_FALLBACK_MS);
    }

    function markWelcomeReady() {
        const button = el('welcome-modal-button');
        if (!button) return;
        if (!isOpen) return;          // No-op when modal isn't showing
        if (!button.disabled) return; // Already ready, ignore

        if (readyTimer) {
            clearTimeout(readyTimer);
            readyTimer = null;
        }

        button.disabled = false;
        button.classList.add('is-ready');
        button.focus({ preventScroll: true });
    }

    function closeWelcomeModal() {
        const overlay = el('welcome-modal-overlay');
        if (!overlay) return;

        overlay.classList.remove('visible');
        isOpen = false;

        if (readyTimer) {
            clearTimeout(readyTimer);
            readyTimer = null;
        }

        // Strip ?welcome=1 from the URL so a refresh doesn't re-trigger.
        const params = new URLSearchParams(window.location.search);
        if (params.has('welcome')) {
            params.delete('welcome');
            const newUrl = window.location.pathname +
                (params.toString() ? '?' + params.toString() : '');
            window.history.replaceState({}, document.title, newUrl);
        }
    }

    // Wire the button click on DOM ready.
    function bind() {
        const button = el('welcome-modal-button');
        if (button) {
            button.addEventListener('click', () => {
                if (button.disabled) return;
                closeWelcomeModal();
            });
        }
        // ESC closes only when ready — same rule as the button.
        document.addEventListener('keydown', (e) => {
            if (!isOpen) return;
            if (e.key !== 'Escape') return;
            const button = el('welcome-modal-button');
            if (button && !button.disabled) closeWelcomeModal();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bind);
    } else {
        bind();
    }

    // Expose globals for app.js
    window.openWelcomeModal  = openWelcomeModal;
    window.markWelcomeReady  = markWelcomeReady;
    window.closeWelcomeModal = closeWelcomeModal;
})();
