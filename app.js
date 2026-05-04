/** 
 * Dot Hub - Unified Interface
 * Simplified: Claude responds naturally, frontend renders
 */

// ===== CONFIGURATION =====
const API_BASE = '/api';
const PROXY_BASE = 'https://dot-proxy.up.railway.app';
const BRAIN_BASE = 'https://dot-brain.up.railway.app';

const KEY_CLIENTS = ['ONE', 'ONB', 'ONS', 'SKY', 'TOW'];

// Clients to hide from WIP dropdown (cleanup later)
const HIDDEN_CLIENTS = ['DEM', 'FIR', 'EON', 'N4L', 'WHA'];

const CLIENT_DISPLAY_NAMES = {
    'ONE': 'One NZ (Marketing)',
    'ONB': 'One NZ (Business)',
    'ONS': 'One NZ (Simplification)'
};

const INACTIVITY_TIMEOUT = 15 * 60 * 1000; // 15 minutes

// ===== STATE =====
const state = {
    currentUser: null,
    currentView: 'home',
    allClients: [],
    allJobs: [],
    jobsLoaded: false,
    wipMode: 'desktop',
    wipClient: 'all',
    trackerClient: null,
    trackerQuarter: (() => { const m = new Date().getMonth(); return m <= 2 ? 'Q1' : m <= 5 ? 'Q2' : m <= 8 ? 'Q3' : 'Q4'; })(),
    trackerMode: 'spend',
    lastActivity: Date.now(),
    conversationHistory: []
};

let inactivityTimer = null;

const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', init);

function init() {
    handleDeepLink();    // First - capture URL params
    checkSession();      // Then - check session (auto-login if deep link)
    setupEventListeners();
}

// ===== DEEP LINK HANDLING =====
function handleDeepLink() {
    const params = new URLSearchParams(window.location.search);
    const view = params.get('view');       // wip, tracker, home
    const client = params.get('client');   // SKY, TOW, etc.
    const job = params.get('job');         // TOW066
    const month = params.get('month');     // January, February, etc. or 'current'
    const quarter = params.get('quarter'); // 'true' for quarter view
    
    // Store for after login/data load
    if (view || client || job || month || quarter) {
        state.deepLink = { view, client, job, month, quarter };
    }
}

function applyDeepLink() {
    if (!state.deepLink) return;
    
    const { view, client, job, month, quarter } = state.deepLink;
    
    // Clear deep link first to prevent re-application
    state.deepLink = null;
    
    // Clear URL params without reload (do this early)
    if (window.history.replaceState) {
        window.history.replaceState({}, document.title, window.location.pathname);
    }
    
    // Set state BEFORE navigating so render functions use our values
    
    if (view === 'wip' && client) {
        state.wipClient = client;
    }
    
    if (view === 'tracker') {
        if (client) {
            state.trackerClient = client;
            // Don't set localStorage - deep links shouldn't affect future visits
        }
        
        if (month) {
            let targetMonth = month;
            if (month === 'current') {
                const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                                  'July', 'August', 'September', 'October', 'November', 'December'];
                targetMonth = monthNames[new Date().getMonth()];
            }
            trackerCurrentMonth = targetMonth;
        }
        
        if (quarter === 'true') {
            trackerIsQuarterView = true;
        }
    }
    
    // Now navigate - render functions will use our pre-set values
    if (view && ['wip', 'tracker', 'home', 'todo'].includes(view)) {
        navigateTo(view);
    }
    
    // Open job modal if job param provided (after navigation and data load)
    if (job) {
        // Format job number: "ONS078" -> "ONS 078"
        const formattedJob = job.replace(/([A-Z]+)(\d+)/, '$1 $2');
        // Wait for jobs to load, then open modal
        const waitForJobs = setInterval(() => {
            if (state.jobsLoaded) {
                clearInterval(waitForJobs);
                openJobDetail(formattedJob);
            }
        }, 100);
        // Timeout after 10 seconds
        setTimeout(() => clearInterval(waitForJobs), 10000);
    }
}

function setupEventListeners() {
    // TBC pills on date inputs
    setupTbcPill('job-edit-update-due', 'job-edit-tbc-pill');
    setupTbcPill('new-job-update-due', 'new-job-tbc-pill');
    
    // Auth overlay (Phase D)
    $('auth-signin-form')?.addEventListener('submit', (e) => { e.preventDefault(); requestLogin(); });
    $('auth-expired-form')?.addEventListener('submit', (e) => { e.preventDefault(); requestLogin('expired'); });
    $('auth-try-again')?.addEventListener('click', (e) => { e.preventDefault(); resetLoginForm(); });

    // Phone navigation
    $('phone-hamburger')?.addEventListener('click', togglePhoneMenu);
    $('phone-overlay')?.addEventListener('click', closePhoneMenu);
    $('phone-home-btn')?.addEventListener('click', () => goHome());
    
    // User dropdown
    $('user-dropdown-trigger')?.addEventListener('click', toggleUserDropdown);
    document.querySelector('.user-dropdown-item[data-action="signout"]')?.addEventListener('click', signOut);
    
    $$('#phone-dropdown .dropdown-item').forEach(item => {
        item.addEventListener('click', () => {
            closePhoneMenu();
            const view = item.dataset.view;
            const action = item.dataset.action;
            if (view) navigateTo(view);
            if (action === 'signout') signOut();
        });
    });

    // Desktop navigation
    $('desktop-home-btn')?.addEventListener('click', () => goHome());
    $$('.nav-tab').forEach(tab => {
        tab.addEventListener('click', () => navigateTo(tab.dataset.view));
    });

    // Home inputs
    $('phone-home-input')?.addEventListener('keypress', (e) => { if (e.key === 'Enter') startConversation('phone'); });
    $('phone-home-send')?.addEventListener('click', () => startConversation('phone'));
    $('desktop-home-input')?.addEventListener('keypress', (e) => { if (e.key === 'Enter') startConversation('desktop'); });
    $('desktop-home-send')?.addEventListener('click', () => startConversation('desktop'));

    // Chat inputs
    $('phone-chat-input')?.addEventListener('keypress', (e) => { if (e.key === 'Enter') continueConversation('phone'); });
    $('phone-chat-send')?.addEventListener('click', () => continueConversation('phone'));
    $('desktop-chat-input')?.addEventListener('keypress', (e) => { if (e.key === 'Enter') continueConversation('desktop'); });
    $('desktop-chat-send')?.addEventListener('click', () => continueConversation('desktop'));

    // Example buttons
    $$('.example-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const question = btn.dataset.question;
            
            // Special handling for "Find a job" - open modal instead
            if (question === 'Find a job') {
                openJobFinder();
                return;
            }
            
            // Special handling for "Send a wip" - open modal instead
            if (question === 'Send a wip') {
                openWipEmailModal();
                return;
            }
            
            const layout = isDesktop() ? 'desktop' : 'phone';
            const input = $(layout + '-home-input');
            if (input) input.value = question;
            startConversation(layout);
        });
    });

    // Check for stale session when tab becomes visible
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            checkIfStale();
        }
    });

    // Close dropdowns on outside click
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.custom-dropdown')) {
            $$('.custom-dropdown-menu.open').forEach(m => {
                m.classList.remove('open');
                m.previousElementSibling?.classList.remove('open');
            });
        }
        // Close plus menus on outside click
        if (!e.target.closest('.input-plus') && !e.target.closest('.plus-menu')) {
            $$('.plus-menu.open').forEach(m => m.classList.remove('open'));
        }
        // Close user dropdown on outside click
        if (!e.target.closest('.user-dropdown')) {
            document.querySelector('.user-dropdown')?.classList.remove('open');
        }
    });

    // Plus button click handlers
    $$('.input-plus').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const menu = btn.nextElementSibling;
            // Close other plus menus first
            $$('.plus-menu.open').forEach(m => {
                if (m !== menu) m.classList.remove('open');
            });
            menu?.classList.toggle('open');
        });
    });

    // Plus menu item click handlers
    $$('.plus-menu-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = item.dataset.action;
            // Close the menu
            item.closest('.plus-menu')?.classList.remove('open');
            // Route to appropriate handler
            if (action === 'new-job') {
                openNewJobModal();
            } else if (action === 'find-job') {
                openJobFinder();
            } else if (action === 'files') {
                openFilesModal();
            } else if (action === 'wip-email') {
                openWipEmailModal();
            } else {
                showComingSoonModal(action);
            }
        });
    });

    // Edit job modal listeners (textarea auto-resize, job-name overlay click)
    // are wired up in editJobModal.js via setupEditJobModalListeners() (A3)
}

function isDesktop() { return window.innerWidth >= 900; }
function getActiveConversationArea() { return isDesktop() ? $('desktop-conversation-area') : $('phone-conversation-area'); }
function getClientDisplayName(client) { return CLIENT_DISPLAY_NAMES[client.code] || client.name; }

// ===== INACTIVITY TIMER =====
function resetInactivityTimer() {
    state.lastActivity = Date.now();
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => clearSessionSilently(), INACTIVITY_TIMEOUT);
}

function checkIfStale() {
    if (Date.now() - state.lastActivity > INACTIVITY_TIMEOUT) {
        clearSessionSilently();
    }
}

function clearSessionSilently() {
    if (state.currentUser) {
        // Clear session via Traffic (the brain)
        fetch(`${BRAIN_BASE}/traffic/clear`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: state.currentUser.name })
        }).catch(() => {});
    }
}

// ===== AUTH HANDLING =====
async function checkSession() {
    const params = new URLSearchParams(window.location.search);

    // Check for existing session first - valid cookie always wins
    try {
        const response = await fetch('/api/check-session');
        const data = await response.json();
        
        if (data.authenticated && data.user) {
            state.currentUser = {
                name: data.user.firstName,
                fullName: data.user.firstName,
                email: data.user.email,
                client: data.user.clientCode,
                accessLevel: data.user.accessLevel
            };
            unlockApp();

            // If we just arrived from a magic-link verify, open the Welcome
            // modal over the destination view. The modal sits while initial
            // data loads; loadJobs() calls markWelcomeReady() when it lands.
            if (params.get('welcome') === '1') {
                if (typeof window.openWelcomeModal === 'function') {
                    window.openWelcomeModal(state.currentUser.name);
                }
            }
            return;
        }
    } catch (e) {
        console.error('Session check failed:', e);
    }
    
    // No valid session - check for URL error params from magic link
    const error = params.get('error');
    
    if (error) {
        // Strip the error param so a refresh doesn't keep showing it
        const cleanParams = new URLSearchParams(window.location.search);
        cleanParams.delete('error');
        const newUrl = window.location.pathname + (cleanParams.toString() ? '?' + cleanParams.toString() : '');
        window.history.replaceState({}, document.title, newUrl);

        // Both 'expired' and 'invalid' surface as the OOPS face
        showAuthFace('expired');
    }
    
    // Auth check complete - show login
    document.body.classList.remove('loading');
}

// ----- Auth overlay face helpers (Phase D) -----

function showAuthFace(faceName) {
    const faces = document.querySelectorAll('.auth-face');
    for (let i = 0; i < faces.length; i++) {
        faces[i].hidden = (faces[i].dataset.face !== faceName);
    }
}

function showAuthError(faceName, message) {
    const errorId = (faceName === 'expired') ? 'auth-error-expired' : 'auth-error';
    const errorEl = $(errorId);
    if (errorEl) errorEl.textContent = message || '';
}

function clearAuthErrors() {
    const e1 = $('auth-error');
    const e2 = $('auth-error-expired');
    if (e1) e1.textContent = '';
    if (e2) e2.textContent = '';
}

// ----- Magic link request -----

async function requestLogin(fromFace = 'signin') {
    // Both signin and expired faces have an email input + submit button.
    const emailInput = (fromFace === 'expired') ? $('auth-email-expired') : $('auth-email');
    const btn = emailInput?.closest('form')?.querySelector('.auth-button');

    const email = emailInput?.value.trim().toLowerCase();

    if (!email) {
        showAuthError(fromFace, 'Pop in your email address');
        return;
    }
    if (!email.includes('@') || !email.includes('.')) {
        showAuthError(fromFace, "That doesn't look like an email");
        return;
    }

    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Sending...';
    }
    clearAuthErrors();

    try {
        const response = await fetch('/api/request-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });

        const data = await response.json();

        if (data.success) {
            showAuthFace('sent');
        } else {
            showAuthError(fromFace, data.message || "Something went wrong. Try again?");
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Get a link';
            }
        }
    } catch (e) {
        console.error('Login request failed:', e);
        showAuthError(fromFace, "Couldn't connect. Try again?");
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Get a link';
        }
    }
}

function resetLoginForm() {
    showAuthFace('signin');

    // Clear inputs and errors
    const e1 = $('auth-email');
    const e2 = $('auth-email-expired');
    if (e1) e1.value = '';
    if (e2) e2.value = '';
    clearAuthErrors();

    // Re-enable buttons + restore label
    document.querySelectorAll('.auth-button').forEach(btn => {
        btn.disabled = false;
        btn.textContent = 'Get a link';
    });
}

function unlockApp() {
    // Remove logged-out and loading states
    document.body.classList.remove('logged-out');
    document.body.classList.remove('loading');
    
    const placeholder = `What's cooking ${state.currentUser.name}?`;
    if ($('phone-home-input')) $('phone-home-input').placeholder = placeholder;
    if ($('desktop-home-input')) $('desktop-home-input').placeholder = placeholder;
    
    // Set user display name in header dropdown
    const displayName = state.currentUser?.name || 'User';
    const userNameEl = $('user-display-name');
    if (userNameEl) userNameEl.textContent = displayName;
    
    // Apply access level filtering
    applyAccessLevel();
    
    loadClients();
    loadJobs();
    resetInactivityTimer();
    
    // Apply deep link immediately after unlock
    applyDeepLink();
}

function applyAccessLevel() {
    const level = state.currentUser?.accessLevel || 'Client WIP';
    const client = state.currentUser?.client;
    
    // Get nav elements
    const trackerNavPhone = document.querySelector('#phone-dropdown .dropdown-item[data-view="tracker"]');
    const trackerNavDesktop = document.querySelector('.nav-tab[data-view="tracker"]');
    
    if (level === 'Client WIP') {
        // Hide Tracker nav entirely
        trackerNavPhone?.classList.add('hidden');
        trackerNavDesktop?.classList.add('hidden');
    } else {
        // Show Tracker nav
        trackerNavPhone?.classList.remove('hidden');
        trackerNavDesktop?.classList.remove('hidden');
    }
    
    // Hide whole Plus dock + phone bar for non-Full users (read-only tiers see no create actions)
    const plusDock = document.getElementById('plus-dock');
    const plusBar = document.getElementById('plus-bar');
    const plusBackdrop = document.getElementById('plus-backdrop');
    if (level !== 'Full') {
        plusDock?.classList.add('hidden');
        plusBar?.classList.add('hidden');
        plusBackdrop?.classList.add('hidden');
    } else {
        plusDock?.classList.remove('hidden');
        plusBar?.classList.remove('hidden');
        plusBackdrop?.classList.remove('hidden');
    }
    
    // Hide New Job, Files and Send WIP from plus menus for non-Full users
    const newJobItems = document.querySelectorAll('.plus-menu-item[data-action="new-job"]');
    const filesItems = document.querySelectorAll('.plus-menu-item[data-action="files"]');
    const wipEmailItems = document.querySelectorAll('.plus-menu-item[data-action="wip-email"]');
    
    if (level !== 'Full') {
        newJobItems.forEach(item => item.classList.add('hidden'));
        filesItems.forEach(item => item.classList.add('hidden'));
        wipEmailItems.forEach(item => item.classList.add('hidden'));
    } else {
        newJobItems.forEach(item => item.classList.remove('hidden'));
        filesItems.forEach(item => item.classList.remove('hidden'));
        wipEmailItems.forEach(item => item.classList.remove('hidden'));
    }
    
    // Store client filter for WIP/Tracker views
    if (level !== 'Full' && client && client !== 'ALL') {
        state.clientFilter = client;
    } else {
        state.clientFilter = null;
    }
    
    // Update example buttons based on access level
    updateExampleButtons();
}

function updateExampleButtons() {
    const level = state.currentUser?.accessLevel || 'Client WIP';
    
    let buttons;
    if (level === 'Full') {
        buttons = [
            { question: 'Find a job', label: 'Find a job' },
            { question: 'Send a wip', label: 'Send a wip' },
            { question: 'Show me jobs due today and tomorrow', label: 'Deadlines' }
        ];
    } else if (level === 'Client Tracker') {
        buttons = [
            { question: 'Find a job', label: 'Find a job' },
            { question: 'Track numbers', label: 'Track numbers' },
            { question: 'Meet Dot', label: 'Meet Dot' }
        ];
    } else {
        // Client WIP
        buttons = [
            { question: 'Find a job', label: 'Find a job' },
            { question: "See what's due", label: "See what's due" },
            { question: 'Meet Dot', label: 'Meet Dot' }
        ];
    }
    
    // Update all example button sets
    $$('.examples').forEach(container => {
        const btns = container.querySelectorAll('.example-btn');
        btns.forEach((btn, i) => {
            if (buttons[i]) {
                btn.dataset.question = buttons[i].question;
                btn.textContent = buttons[i].label;
            }
        });
    });
}

async function signOut() {
    clearDotSession();  // Clear conversation memory on Traffic
    
    try {
        await fetch('/api/logout', { method: 'POST' });
    } catch (e) {
        console.error('Logout failed:', e);
    }
    
    sessionStorage.removeItem('dotUser');
    state.currentUser = null;
    state.clientFilter = null;
    
    // Reset login screen and show it
    resetLoginForm();
    document.body.classList.add('logged-out');
    
    goHome();
}

// ===== NAVIGATION =====
function navigateTo(view) {
    state.currentView = view;
    // Job Bag is a sub-view of WIP — keep WIP tab highlighted
    const tabView = view === 'job-bag' ? 'wip' : view;
    $$('.nav-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.view === tabView));
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
    
    // Footer: only show on home view when NOT in conversation
    const footer = $('desktop-footer');
    
    if (!isDesktop()) {
        $('phone-home')?.classList.add('hidden');
        $('phone-conversation')?.classList.remove('visible');
        $('phone-wip')?.classList.remove('visible');
        $('phone-tracker-message')?.classList.remove('visible');
        $('phone-todo')?.classList.remove('visible');
        if (view === 'home') {
            // Check if there's an active conversation
            const hasConversation = $('phone-conversation-area')?.children.length > 0;
            if (hasConversation) {
                $('phone-conversation')?.classList.add('visible');
            } else {
                $('phone-home')?.classList.remove('hidden');
            }
        }
        else if (view === 'wip') {
            $('phone-wip')?.classList.add('visible');
            setupPhoneWipDropdown();
            renderPhoneWip();
        }
        else if (view === 'tracker') $('phone-tracker-message')?.classList.add('visible');
        else if (view === 'todo') $('phone-todo')?.classList.add('visible');
    } else {
        // Desktop: restore conversation state if exists
        if (view === 'home') {
            const hasConversation = $('desktop-conversation-area')?.children.length > 0;
            if (hasConversation) {
                $('desktop-home-state')?.classList.add('hidden');
                $('desktop-conversation-state')?.classList.add('visible');
                footer?.classList.add('hidden');
            } else {
                $('desktop-home-state')?.classList.remove('hidden');
                $('desktop-conversation-state')?.classList.remove('visible');
                footer?.classList.remove('hidden');
            }
        } else {
            // Non-home views: hide footer
            footer?.classList.add('hidden');
        }
    }
    
    if (view === 'wip' && isDesktop()) { setupWipDropdown(); renderWip(); }
    if (view === 'tracker') renderTracker();
    if (view === 'todo') renderTodos();
}

function goHome() {
    // Clear conversation history for fresh start
    state.conversationHistory = [];
    
    $('phone-home')?.classList.remove('hidden');
    $('phone-conversation')?.classList.remove('visible');
    if ($('phone-home-input')) $('phone-home-input').value = '';
    if ($('phone-conversation-area')) $('phone-conversation-area').innerHTML = '';
    $('desktop-home-state')?.classList.remove('hidden');
    $('desktop-conversation-state')?.classList.remove('visible');
    $('desktop-footer')?.classList.remove('hidden');
    if ($('desktop-home-input')) $('desktop-home-input').value = '';
    if ($('desktop-conversation-area')) $('desktop-conversation-area').innerHTML = '';
    navigateTo('home');
}

function togglePhoneMenu() {
    $('phone-hamburger')?.classList.toggle('open');
    $('phone-dropdown')?.classList.toggle('open');
    $('phone-overlay')?.classList.toggle('open');
}

function closePhoneMenu() {
    $('phone-hamburger')?.classList.remove('open');
    $('phone-dropdown')?.classList.remove('open');
    $('phone-overlay')?.classList.remove('open');
}

function toggleUserDropdown(e) {
    e.stopPropagation();
    document.querySelector('.user-dropdown')?.classList.toggle('open');
}

// ===== DATA LOADING =====
async function loadClients() {
    try {
        const response = await fetch(`${API_BASE}/clients`);
        state.allClients = await response.json();
    } catch (e) { state.allClients = []; }
}

async function loadJobs() {
    try {
        const response = await fetch(`${API_BASE}/jobs/all`);
        state.allJobs = await response.json();
    } catch (e) { state.allJobs = []; }
    state.jobsLoaded = true;
    
    // Re-render WIP if we're on that view
    if (state.currentView === 'wip') {
        renderWip();
    }

    // Welcome modal — flip its button to ready when initial data lands
    if (typeof window.markWelcomeReady === 'function') {
        window.markWelcomeReady();
    }
}

// ===== CONVERSATION =====
function startConversation(layout) {
    const input = $(layout + '-home-input');
    const question = input?.value.trim() || 'What can Dot do?';
    if (layout === 'phone') {
        $('phone-home')?.classList.add('hidden');
        $('phone-conversation')?.classList.add('visible');
    } else {
        $('desktop-home-state')?.classList.add('hidden');
        $('desktop-conversation-state')?.classList.add('visible');
        $('desktop-footer')?.classList.add('hidden');
    }
    addUserMessage(question);
    processQuestion(question);
}

function continueConversation(layout) {
    const input = $(layout + '-chat-input');
    const question = input?.value.trim();
    if (!question) return;
    addUserMessage(question);
    input.value = '';
    processQuestion(question);
}

function addUserMessage(text) {
    const area = getActiveConversationArea();
    const msg = document.createElement('div');
    msg.className = 'user-message fade-in';
    msg.textContent = text;
    area?.appendChild(msg);
    if (area) area.scrollTop = area.scrollHeight;
}

// Thinking helper messages
const thinkingMessages = {
    stage1: ["Let's have a look...", "Gimme a sec...", "Hunting that down..."],
    stage2: ["Digging the data...", "Joining the dots...", "Piecing bits together..."],
    stage3: ["Lining it all up...", "Checking for tickety boo...", "Quick lick of polish..."],
    stage4: ["Dotting my eyes...", "One more thing...", "Nearly there..."],
    countdown: ["five...", "four...", "three...", "two...", "one..."]
};

let thinkingTimeouts = [];

function addThinkingDots() {
    const area = getActiveConversationArea();
    const dots = document.createElement('div');
    dots.className = 'thinking-dots';
    dots.id = 'currentThinking';
    
    // Pick random message from each stage
    const msg1 = thinkingMessages.stage1[Math.floor(Math.random() * thinkingMessages.stage1.length)];
    const msg2 = thinkingMessages.stage2[Math.floor(Math.random() * thinkingMessages.stage2.length)];
    const msg3 = thinkingMessages.stage3[Math.floor(Math.random() * thinkingMessages.stage3.length)];
    const msg4 = thinkingMessages.stage4[Math.floor(Math.random() * thinkingMessages.stage4.length)];
    
    // Start with just Dot, no text
    dots.innerHTML = `
        <div class="dot-thinking">
            <img src="images/Robot_01.svg" alt="Dot" class="dot-robot">
            <img src="images/Heart_01.svg" alt="" class="dot-heart-svg">
        </div>
        <span class="thinking-helper"></span>
    `;
    
    area?.appendChild(dots);
    if (area) area.scrollTop = area.scrollHeight;
    
    const helper = dots.querySelector('.thinking-helper');
    
    // Helper to fade in new text
    const fadeToText = (text) => {
        helper.classList.remove('visible');
        setTimeout(() => {
            helper.textContent = text;
            helper.classList.add('visible');
        }, 200); // Brief pause during fade out before new text
    };
    
    // Stage timings: 800ms start, then 1600ms between stages
    thinkingTimeouts.push(setTimeout(() => {
        helper.textContent = msg1;
        helper.classList.add('visible');
    }, 800));
    
    thinkingTimeouts.push(setTimeout(() => fadeToText(msg2), 2400));
    thinkingTimeouts.push(setTimeout(() => fadeToText(msg3), 4000));
    thinkingTimeouts.push(setTimeout(() => fadeToText(msg4), 5600));
    
    // Countdown: 500ms apart starting at 7200ms
    thinkingMessages.countdown.forEach((word, i) => {
        thinkingTimeouts.push(setTimeout(() => fadeToText(word), 7200 + (i * 500)));
    });
}

function removeThinkingDots() {
    thinkingTimeouts.forEach(t => clearTimeout(t));
    thinkingTimeouts = [];
    $('currentThinking')?.remove();
}

// ===== QUERY PROCESSING (Unified - routes through Traffic) =====
async function processQuestion(question) {
    resetInactivityTimer();
    addThinkingDots();
    
    console.log('Query:', question);
    
    const response = await askDot(question);
    
    removeThinkingDots();
    
    console.log('Dot response:', response);
    
    // Resolve job numbers to full objects (Claude now returns just job numbers for speed)
    let resolvedJobs = [];
    if (response && response.jobs && Array.isArray(response.jobs) && response.jobs.length > 0) {
        // Check if it's job numbers (strings) or already full objects
        if (typeof response.jobs[0] === 'string') {
            resolvedJobs = resolveJobNumbers(response.jobs);
            console.log('Resolved jobs:', resolvedJobs.map(j => j.jobNumber));
        } else {
            // Already full objects (backwards compatibility)
            resolvedJobs = response.jobs;
        }
    }
    
    if (!response) {
        const failMessages = [
            "Hmm, I'm having trouble thinking right now. Try again?",
            "Sorry, my brain just glitched. Give it another go?",
            "Oops, something went sideways. Mind trying that again?",
            "My wires got crossed for a sec. One more time?",
            "That one got away from me. Try again?"
        ];
        renderResponse({ 
            message: failMessages[Math.floor(Math.random() * failMessages.length)],
            nextPrompt: "What can Dot do?"
        });
        return;
    }
    
    // Handle different response types
    switch (response.type) {
        case 'answer':
            // Simple answer, maybe with job cards
            renderResponse({
                message: response.message,
                jobs: resolvedJobs,
                nextPrompt: response.nextPrompt
            });
            break;
            
        case 'action':
            // Worker was called (or will be called)
            renderResponse({
                message: response.message,
                jobs: [],
                nextPrompt: response.nextPrompt
            });
            break;
            
        case 'confirm':
            // Need user to pick a job
            renderResponse({
                message: response.message,
                jobs: resolvedJobs,
                nextPrompt: null
            });
            break;
            
        case 'clarify':
            // Need more info from user - may have job options
            renderResponse({
                message: response.message,
                jobs: resolvedJobs,
                nextPrompt: null
            });
            break;
            
        case 'redirect':
            // Redirect to WIP or Tracker
            renderResponse({
                message: response.message,
                jobs: [],
                nextPrompt: null
            });
            // Navigate to the view
            if (response.redirectTo) {
                setTimeout(() => {
                    navigateTo(response.redirectTo);
                    // Apply filters if provided
                    if (response.redirectParams?.client) {
                        if (response.redirectTo === 'wip') {
                            state.wipClient = response.redirectParams.client;
                            renderWip();
                        } else if (response.redirectTo === 'tracker') {
                            state.trackerClient = response.redirectParams.client;
                            renderTracker();
                        }
                    }
                }, 1500);  // Short delay so user sees the message
            }
            break;
            
        case 'horoscope':
            // Horoscope response - sass from the stars
            renderResponse({
                message: response.message,
                jobs: [],
                nextPrompt: response.nextPrompt
            });
            break;
            
        case 'error':
            // Something went wrong
            renderResponse({
                message: response.message || "Sorry, I got in a muddle over that one.",
                jobs: [],
                nextPrompt: "What can Dot do?"
            });
            break;
            
        default:
            // Fallback - treat as answer
            renderResponse({
                message: response.message || "I'm not sure what happened there.",
                jobs: resolvedJobs,
                nextPrompt: response.nextPrompt
            });
    }
}

// ===== DOT API (Simple Claude - Fast) =====
async function askDot(question) {
    try {
        const sessionId = state.currentUser?.name || 'anonymous';
        
        // Add user message to history BEFORE sending
        state.conversationHistory.push({
            role: 'user',
            content: question
        });
        
        const response = await fetch(`${BRAIN_BASE}/hub`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                content: question,
                senderName: state.currentUser?.name || 'Hub User',
                sessionId: sessionId,
                jobs: getAccessFilteredJobs(),
                history: state.conversationHistory.slice(0, -1),  // Send history WITHOUT current message
                accessLevel: state.currentUser?.accessLevel || 'Client WIP'
            })
        });
        
        if (!response.ok) {
            console.log('Hub API error:', response.status);
            // Remove the user message we just added since request failed
            state.conversationHistory.pop();
            return null;
        }
        
        const result = await response.json();
        
        // Add assistant response to history
        if (result && result.message) {
            state.conversationHistory.push({
                role: 'assistant',
                content: result.message
            });
        }
        
        // Keep history manageable (last 20 messages = 10 exchanges)
        if (state.conversationHistory.length > 20) {
            state.conversationHistory = state.conversationHistory.slice(-20);
        }
        
        return result;
    } catch (e) {
        console.log('Hub API error:', e);
        // Remove the user message we just added since request failed
        if (state.conversationHistory.length > 0) {
            state.conversationHistory.pop();
        }
        return null;
    }
}

async function clearDotSession() {
    try {
        const sessionId = state.currentUser?.name || 'anonymous';
        await fetch(`${BRAIN_BASE}/traffic/clear`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId })
        });
    } catch (e) {
        console.log('Failed to clear session:', e);
    }
}

/**
 * Resolve job numbers to full job objects from state.allJobs
 * Claude returns ["TOW 088", "TOW 087"], we need full objects for rendering
 */
function resolveJobNumbers(jobNumbers) {
    if (!jobNumbers || !Array.isArray(jobNumbers)) return [];
    
    return jobNumbers
        .map(jobNum => {
            // Handle both "TOW 088" and "TOW088" formats
            const normalized = jobNum.replace(/\s+/g, ' ').trim().toUpperCase();
            return state.allJobs.find(j => {
                const jobNormalized = j.jobNumber.replace(/\s+/g, ' ').trim().toUpperCase();
                return jobNormalized === normalized;
            });
        })
        .filter(Boolean); // Remove any nulls (jobs not found)
}

// ===== JOB FILTERING (DEPRECATED - backend now returns jobs directly) =====
// Keeping for reference in case we need local filtering again
/*
function getFilteredJobsFromResponse(jobFilter) {
    if (!jobFilter) return [];
    
    let jobs = [...state.allJobs];
    
    // Filter by client
    if (jobFilter.client) {
        jobs = jobs.filter(j => j.clientCode === jobFilter.client);
    }
    
    // Filter by status
    if (jobFilter.status) {
        jobs = jobs.filter(j => j.status === jobFilter.status);
    } else {
        // Default to active jobs only
        jobs = jobs.filter(j => j.status === 'In Progress');
    }
    
    // Filter by with client
    if (jobFilter.withClient === true) {
        jobs = jobs.filter(j => j.withClient === true);
    } else if (jobFilter.withClient === false) {
        jobs = jobs.filter(j => !j.withClient);
    }
    
    // Filter by date range
    if (jobFilter.dateRange) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        jobs = jobs.filter(j => {
            if (!j.updateDue) return false;
            const due = new Date(j.updateDue);
            due.setHours(0, 0, 0, 0);
            
            switch (jobFilter.dateRange) {
                case 'today':
                    return due <= today;
                case 'tomorrow':
                    const tomorrow = new Date(today);
                    tomorrow.setDate(tomorrow.getDate() + 1);
                    return due <= tomorrow;
                case 'week':
                    const week = new Date(today);
                    week.setDate(week.getDate() + 7);
                    return due <= week;
                default:
                    return true;
            }
        });
    }
    
    // Search filter
    if (jobFilter.search?.length) {
        jobs = jobs.filter(job => {
            const searchable = `${job.jobNumber} ${job.jobName} ${job.description || ''} ${job.update || ''}`.toLowerCase();
            return jobFilter.search.some(term => searchable.includes(term.toLowerCase()));
        });
    }
    
    // Sort by due date
    jobs.sort((a, b) => {
        const aDate = a.updateDue ? new Date(a.updateDue) : new Date('9999-12-31');
        const bDate = b.updateDue ? new Date(b.updateDue) : new Date('9999-12-31');
        return aDate - bDate;
    });
    
    // Exclude 000 and 999 jobs
    jobs = jobs.filter(j => {
        const num = j.jobNumber.split(' ')[1];
        return num !== '000' && num !== '999';
    });
    
    return jobs;
}
*/

// ===== RENDERING =====
function renderResponse({ message, jobs = [], nextPrompt = null }) {
    const area = getActiveConversationArea();
    const response = document.createElement('div');
    response.className = 'dot-response fade-in';
    
    // Format message - handle bullets and line breaks
    let formattedMessage = formatMessage(message);
    
    let html = `<div class="dot-text">${formattedMessage}`;
    
    if (nextPrompt) {
        html += `<p class="next-prompt" data-question="${nextPrompt}">${nextPrompt}</p>`;
    }
    
    html += `</div>`;
    
    if (jobs.length > 0) {
        html += '<div class="job-cards">';
        jobs.forEach((job, i) => {
            html += createJobCard(job, i);
        });
        html += '</div>';
    }
    
    response.innerHTML = html;
    area?.appendChild(response);
    
    // Bind click handlers
    response.querySelectorAll('.next-prompt').forEach(el => {
        el.addEventListener('click', () => {
            addUserMessage(el.dataset.question);
            processQuestion(el.dataset.question);
        });
    });
    
    response.querySelectorAll('.job-card').forEach(card => {
        card.addEventListener('click', () => openJobDetail(card.dataset.job));
    });
    
    if (area) area.scrollTop = area.scrollHeight;
}

function createJobCard(job, index) {
    // Use universal card for Ask Dot results
    return createUniversalCard(job, `job-${Date.now()}-${index}`);
}

// ===== UNIVERSAL JOB CARD =====
function createUniversalCard(job, id) {
    const dueDate = formatDueDate(job.updateDue, job.withClient);
    const daysSinceUpdate = job.daysSinceUpdate || '-';
    
    // Check if stale (contains ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¾ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¤)
    const isStale = daysSinceUpdate.includes('ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¾ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¤');
    
    // Build summary line: Stage - Live Date - With client
    let summaryParts = [];
    if (job.stage) summaryParts.push(job.stage);
    if (job.liveDate) summaryParts.push(`Live ${formatDueDate(job.liveDate)}`);
    if (job.withClient) summaryParts.push('With client');
    const summaryLine = summaryParts.join(' - ') || '';
    
    // Build recent activity HTML
    const recentActivity = formatRecentActivity(job.updateHistory);
    
    return `
        <div class="job-card" id="${id}" data-job="${job.jobNumber}">
            <div class="job-header" data-job-id="${id}">
                <div class="job-logo">
                    <img src="${getLogoUrl(job.clientCode)}" alt="${job.clientCode}" onerror="this.src='images/logos/Unknown.png'">
                </div>
                <div class="job-main">
                    <div class="job-title-row">
                        <span class="job-title">${job.jobNumber} | ${job.jobName}</span>
                        <span class="bag-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg></span>
                    </div>
                    <div class="job-update-preview">${job.update || 'No updates yet'}</div>
                    <div class="job-meta-compact">
                        ${ICON_CLOCK} ${dueDate}
                    </div>
                </div>
            </div>
        </div>
    `;
}

function formatRecentActivity(updateHistory) {
    if (!updateHistory || updateHistory.length === 0) {
        return '<div class="no-activity">No recent activity</div>';
    }
    
    // Reverse to get newest first, then take up to 3
    const recent = [...updateHistory].reverse().slice(0, 3);
    
    let html = '<div class="recent-activity">';
    recent.forEach((update, i) => {
        // Handle different formats - could be "12 Jan | Update text" or just text
        const isFirst = i === 0;
        html += `<div class="activity-item ${isFirst ? 'latest' : ''}">${update}</div>`;
    });
    html += '</div>';
    
    return html;
}

// ===== JOB EDIT MODAL =====
// All edit modal logic (state, open, close, save, job-name sub-modal)
// lives in editJobModal.js (28 Apr 2026, A3)

// openJobModal moved to editJobModal.js (28 Apr 2026, A3)

function autoResizeTextarea(textarea) {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
}

// closeJobModal moved to editJobModal.js (28 Apr 2026, A3)

// ===== JOB SUMMARY MODAL (read-only for clients) =====
function openJobSummary(jobNumber) {
    const job = state.allJobs.find(j => j.jobNumber === jobNumber);
    if (!job) return;
    
    const modal = $('job-summary-modal');
    if (!modal) return;
    
    // Populate header
    $('job-summary-title').textContent = `${jobNumber} | ${job.jobName || 'Untitled'}`;
    $('job-summary-logo').src = getLogoUrl(job.clientCode);
    $('job-summary-logo').onerror = function() { this.src = 'images/logos/Unknown.png'; };
    $('job-summary-logo').alt = job.clientCode;
    
    // Populate fields
    $('job-summary-desc').textContent = job.description || 'No description';
    $('job-summary-owner').textContent = job.projectOwner || 'Unassigned';
    $('job-summary-story').textContent = job.theStory || 'Still working on it';
    $('job-summary-update').textContent = job.update || 'No updates yet';
    
    // Format dates
    if (job.updateDue) {
        const date = new Date(job.updateDue);
        $('job-summary-due').textContent = date.toLocaleDateString('en-GB', { 
            day: 'numeric', month: 'short', year: 'numeric' 
        });
    } else {
        $('job-summary-due').textContent = 'Not set';
    }
    
    $('job-summary-live').textContent = job.liveDate || 'TBC';
    
    // Show modal
    modal.classList.add('visible');
}

function closeJobSummary() {
    $('job-summary-modal')?.classList.remove('visible');
}

// Helper: open Job Bag for any user
function openJobDetail(jobNumber) {
    // Track as recent
    trackRecentJob(jobNumber);
    openJobBag(jobNumber);
}

// ===== JOB BAG =====

let currentBagJob = null;

async function openJobBag(jobNumber) {
    const job = state.allJobs.find(j => j.jobNumber === jobNumber);
    if (!job) return;

    currentBagJob = job;

    // Reset thread height before loading new job
    const thread = document.querySelector('.jb-thread');
    if (thread) {
        thread.style.height = 'auto';
    }

    // Job header — combined title
    const jobNameParts = `<span style="font-weight:700">${job.jobNumber}</span> <span style="font-weight:300">— ${job.jobName || 'Untitled'}</span>`;
    $('jb-job-title').innerHTML = jobNameParts;
    $('jb-job-desc').textContent = job.description || '';

    const logo = $('jb-logo');
    logo.src = getLogoUrl(job.clientCode);
    logo.alt = job.clientCode;
    logo.onerror = function() { this.src = 'images/logos/Unknown.png'; };

    // With client toggle in header
    const checkbox = $('jb-with-client-checkbox');
    if (checkbox) checkbox.checked = !!job.withClient;
    updateWithClientLabels(!!job.withClient);

    // Story
    const storyEl = $('jb-story-text');
    const storyMore = $('jb-story-more');
    storyEl.textContent = job.theStory || 'Watch this space. Currently working on a tight two sentence story that shows what we\'re trying to do and why anyone will care. This will get replaced when the thinking is done.';
    storyExpanded = false;
    if ($('jb-story-card')) $('jb-story-card').classList.remove('expanded');
    if ($('jb-story-more')) $('jb-story-more').style.display = 'none';
    // Show fade+more only if text overflows 3 lines
    requestAnimationFrame(() => {
        const wrap = $('jb-story-wrap');
        const fade = $('jb-story-fade');
        if (wrap && fade) {
            fade.style.display = wrap.scrollHeight > wrap.clientHeight ? 'flex' : 'none';
        }
    });

    // Summary — client name fetched from API below
    $('jb-client-name').textContent = '…';
    $('jb-status').textContent = job.status || '—';

    const dueEl = $('jb-update-due');
    if (job.updateDue) {
        const due = new Date(job.updateDue);
        const today = new Date();
        today.setHours(0,0,0,0);
        const dueDay = new Date(due);
        dueDay.setHours(0,0,0,0);
        const diffDays = Math.round((dueDay - today) / 86400000);

        let dueText;
        if (diffDays === 0) dueText = 'Today';
        else if (diffDays === 1) dueText = 'Tomorrow';
        else if (diffDays === -1) dueText = 'Yesterday';
        else if (diffDays < 0) dueText = `${Math.abs(diffDays)} days overdue`;
        else dueText = due.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

        dueEl.textContent = dueText;
        dueEl.className = diffDays < 0 ? 'jb-meta-val overdue' : 'jb-meta-val';
    } else {
        dueEl.textContent = 'Not set';
        dueEl.className = 'jb-meta-val';
    }

    $('jb-live').textContent = job.liveDate || 'Tbc';

    // Edit link
    $('jb-edit-link').onclick = (e) => {
        e.preventDefault();
        openJobModal(jobNumber);
    };

    // Story edit link
    $('jb-story-edit-link').onclick = (e) => {
        e.preventDefault();
        openStoryModal(currentBagJob);
    };

    // Tracker link — load data then open modal
    $('jb-tracker-link').onclick = async (e) => {
        e.preventDefault();
        const pencil = $('jb-tracker-link');
        const budgetBody = $('jb-budget-body');
        const originalTitle = pencil.title;

        pencil.style.opacity = '0.4';
        pencil.style.pointerEvents = 'none';
        if (budgetBody) budgetBody.innerHTML = loadingDots('small');

        await loadTrackerData(job.clientCode);

        pencil.style.opacity = '';
        pencil.style.pointerEvents = '';
        pencil.title = originalTitle;

        loadJobBagBudget(jobNumber);

        const month = new Date().toLocaleString('en-US', { month: 'long' });
        openTrackerEditModal(jobNumber, month);
    };

    // Files
    renderJobBagFiles(job);

    // Navigate to Job Bag view
    navigateTo('job-bag');

    // Hide interactive elements for non-Full users (read-only mode)
    const isFullAccess = state.currentUser?.accessLevel === 'Full';
    const toggleWrap = document.querySelector('.jb-wc-toggle-wrap');
    const compose = document.querySelector('.jb-compose');
    const editLink = $('jb-edit-link');
    const storyEditLink = $('jb-story-edit-link');
    const trackerLink = $('jb-tracker-link');
    
    if (toggleWrap) toggleWrap.style.display = isFullAccess ? '' : 'none';
    if (compose) compose.style.display = isFullAccess ? '' : 'none';
    if (editLink) editLink.style.display = isFullAccess ? '' : 'none';
    if (storyEditLink) storyEditLink.style.display = isFullAccess ? '' : 'none';
    if (trackerLink) trackerLink.style.display = isFullAccess ? '' : 'none';

    // Make cards clickable for Full access users
    const storyCard = $('jb-story-card');
    const summaryBody = document.querySelector('.jb-summary-body');
    const summaryCardEl = summaryBody?.closest('.jb-card');
    const budgetBody = $('jb-budget-body');
    const budgetCard = budgetBody?.closest('.jb-card');

    if (isFullAccess) {
        // Story card → Story modal
        if (storyCard) {
            storyCard.style.cursor = 'pointer';
            storyCard.onclick = (e) => {
                if (e.target.closest('.jb-story-fade-btn') || e.target.closest('.jb-story-more')) return;
                openStoryModal(currentBagJob);
            };
        }

        // Summary card → Job Edit modal
        if (summaryCardEl) {
            summaryCardEl.style.cursor = 'pointer';
            summaryCardEl.onclick = () => openJobModal(jobNumber);
        }

        // Budget card → Tracker modal (with loading)
        if (budgetCard) {
            budgetCard.style.cursor = 'pointer';
            budgetCard.onclick = async () => {
                budgetBody.innerHTML = loadingDots('small');
                await loadTrackerData(job.clientCode);
                loadJobBagBudget(jobNumber);
                const month = new Date().toLocaleString('en-US', { month: 'long' });
                openTrackerEditModal(jobNumber, month);
            };
        }
    } else {
        // Remove clickability for non-Full users
        if (storyCard) { storyCard.style.cursor = ''; storyCard.onclick = null; }
        if (summaryCardEl) { summaryCardEl.style.cursor = ''; summaryCardEl.onclick = null; }
        if (budgetCard) { budgetCard.style.cursor = ''; budgetCard.onclick = null; }
    }

    // Update URL so refresh returns to this job
    const compactJob = jobNumber.replace(/\s+/g, '');
    window.history.replaceState({}, '', `?job=${compactJob}`);

    // Load updates + budget in parallel
    loadJobBagUpdates(jobNumber);
    loadJobBagBudget(jobNumber);

    // Client field shows project owner
    $('jb-client-name').textContent = job.projectOwner || '—';

    // Fix thread height to match left column, then scroll to bottom
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const left = document.querySelector('.jb-left');
            const thread = document.querySelector('.jb-thread');
            const threadBody = $('jb-thread-body');
            if (left && thread) {
                thread.style.height = left.offsetHeight + 'px';
                thread.style.minHeight = 'unset';
                thread.style.flex = 'none';
            }
            if (threadBody) threadBody.scrollTop = threadBody.scrollHeight;
        });
    });
    
    // Render job switcher dropdown
    renderJobSwitcher();
}

function closeJobBag() {
    currentBagJob = null;
    window.history.replaceState({}, '', window.location.pathname);
    navigateTo('wip');
}

// Refresh the Job Bag left column from currentBagJob state
function refreshJobBagLeft() {
    if (!currentBagJob) return;
    const job = currentBagJob;

    // Summary fields
    $('jb-client-name').textContent = job.projectOwner || '—';
    $('jb-status').textContent = job.status || '—';
    $('jb-live').textContent = job.liveDate || 'Tbc';

    // Update due with formatting
    const dueEl = $('jb-update-due');
    if (job.updateDue) {
        const due = new Date(job.updateDue);
        const today = new Date();
        today.setHours(0,0,0,0);
        const dueDay = new Date(due);
        dueDay.setHours(0,0,0,0);
        const diffDays = Math.round((dueDay - today) / 86400000);

        let dueText;
        if (diffDays === 0) dueText = 'Today';
        else if (diffDays === 1) dueText = 'Tomorrow';
        else if (diffDays === -1) dueText = 'Yesterday';
        else if (diffDays < 0) dueText = `${Math.abs(diffDays)} days overdue`;
        else dueText = due.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

        dueEl.textContent = dueText;
        dueEl.className = diffDays < 0 ? 'jb-meta-val overdue' : 'jb-meta-val';
    } else {
        dueEl.textContent = 'Not set';
        dueEl.className = 'jb-meta-val';
    }

    // Story
    const storyEl = $('jb-story-text');
    if (storyEl) storyEl.textContent = job.theStory || 'Watch this space.';

    // Budget — reload from API
    loadJobBagBudget(job.jobNumber);
}

// ===== JOB BAG SWITCHER =====

function getClientActiveJobs(clientCode) {
    const activeStatuses = ['In Progress', 'On Hold', 'Always on'];
    const financeNumbers = ['000', '001', '998', '999'];
    
    return state.allJobs
        .filter(j => {
            if (j.clientCode !== clientCode) return false;
            if (!activeStatuses.includes(j.status)) return false;
            // Exclude finance jobs
            const num = j.jobNumber.replace(/\D/g, '');
            if (financeNumbers.includes(num)) return false;
            return true;
        })
        .sort((a, b) => {
            // Sort by job number (extract numeric part)
            const numA = parseInt(a.jobNumber.replace(/\D/g, '')) || 0;
            const numB = parseInt(b.jobNumber.replace(/\D/g, '')) || 0;
            return numA - numB;
        });
}

function renderJobSwitcher() {
    if (!currentBagJob) return;
    
    const dropdown = $('jb-job-dropdown');
    const chevron = $('jb-job-chevron');
    if (!dropdown) return;
    
    const jobs = getClientActiveJobs(currentBagJob.clientCode);
    
    // Hide chevron if only one job
    if (chevron) {
        chevron.style.display = jobs.length > 1 ? 'flex' : 'none';
    }
    
    if (jobs.length <= 1) {
        dropdown.innerHTML = '';
        return;
    }
    
    let html = '';
    jobs.forEach(j => {
        const isActive = j.jobNumber === currentBagJob.jobNumber ? ' active' : '';
        const name = j.jobName || 'Untitled';
        html += `<div class="jb-job-dropdown-item${isActive}" onclick="selectJob('${j.jobNumber}')">
            <span class="jb-job-dropdown-num">${j.jobNumber}</span>
            <span class="jb-job-dropdown-name">${name}</span>
        </div>`;
    });
    
    // Add divider and "All jobs" link
    html += '<div class="jb-job-dropdown-divider"></div>';
    html += `<div class="jb-job-dropdown-item all-jobs" onclick="goToAllJobs()">All jobs</div>`;
    
    dropdown.innerHTML = html;
}

function toggleJobSwitcher() {
    const chevron = $('jb-job-chevron');
    const dropdown = $('jb-job-dropdown');
    if (!chevron || !dropdown) return;
    
    chevron.classList.toggle('open');
    dropdown.classList.toggle('open');
}

function selectJob(jobNumber) {
    // Close dropdown
    $('jb-job-chevron')?.classList.remove('open');
    $('jb-job-dropdown')?.classList.remove('open');
    
    openJobBag(jobNumber);
}

function goToAllJobs() {
    // Close dropdown
    $('jb-job-chevron')?.classList.remove('open');
    $('jb-job-dropdown')?.classList.remove('open');
    
    // Open Job Finder
    openJobFinder();
}

// Close dropdown on outside click
document.addEventListener('click', (e) => {
    if (!e.target.closest('.jb-job-title-row')) {
        $('jb-job-chevron')?.classList.remove('open');
        $('jb-job-dropdown')?.classList.remove('open');
    }
});

// Make functions globally available
window.toggleJobSwitcher = toggleJobSwitcher;
window.selectJob = selectJob;
window.goToAllJobs = goToAllJobs;

// ===== JOB FINDER MODAL =====

const RECENT_JOBS_KEY = 'dot_recent_jobs';
const MAX_RECENT_JOBS = 10;

// Client name to code mapping for search
const CLIENT_NAME_MAP = {
    'tower': ['TOW'],
    'sky': ['SKY'],
    'fisher': ['FIS'],
    'fisher funds': ['FIS'],
    'one': ['ONE', 'ONS', 'ONB'],
    'one nz': ['ONE', 'ONS', 'ONB'],
    'hunch': ['HUN'],
    'labour': ['LAB'],
    'labor': ['LAB']
};

// Debounce for search
let jobFinderDebounceTimer = null;

function openJobFinder() {
    const modal = $('job-finder-modal');
    if (!modal) return;
    
    // Reset state
    $('job-finder-search-input').value = '';
    
    // Render and show
    renderJobFinderList();
    modal.classList.add('visible');
    
    // Focus search after animation
    setTimeout(() => $('job-finder-search-input')?.focus(), 200);
}

function closeJobFinder() {
    const modal = $('job-finder-modal');
    if (modal) modal.classList.remove('visible');
}

function debouncedFilterJobFinder() {
    clearTimeout(jobFinderDebounceTimer);
    jobFinderDebounceTimer = setTimeout(() => {
        renderJobFinderList();
    }, 150);
}

function renderJobFinderList() {
    const container = $('job-finder-list');
    const searchInput = $('job-finder-search-input');
    if (!container) return;
    
    const searchTerm = (searchInput?.value || '').toLowerCase().trim();
    
    // Get active jobs
    let jobs = state.allJobs.filter(job => job.status !== 'Completed');
    
    // Filter by client (for client access users)
    if (state.clientFilter) {
        jobs = jobs.filter(job => job.clientCode === state.clientFilter);
    }
    
    // Filter by search term
    if (searchTerm) {
        // Check if search matches a client name
        let matchingClientCodes = [];
        for (const [name, codes] of Object.entries(CLIENT_NAME_MAP)) {
            if (name.includes(searchTerm)) {
                matchingClientCodes = matchingClientCodes.concat(codes);
            }
        }
        
        jobs = jobs.filter(job => {
            const jobNum = (job.jobNumber || '').toLowerCase();
            const jobName = (job.jobName || '').toLowerCase();
            const matchesJobNum = jobNum.includes(searchTerm);
            const matchesJobName = jobName.includes(searchTerm);
            const matchesClientName = matchingClientCodes.includes(job.clientCode);
            return matchesJobNum || matchesJobName || matchesClientName;
        });
    }
    
    // Sort by recent views first, then by last update
    const recentJobs = getRecentJobs();
    jobs.sort((a, b) => {
        const aRecent = recentJobs.indexOf(a.jobNumber);
        const bRecent = recentJobs.indexOf(b.jobNumber);
        
        // Both in recent - sort by recency
        if (aRecent !== -1 && bRecent !== -1) {
            return aRecent - bRecent;
        }
        // Only a in recent
        if (aRecent !== -1) return -1;
        // Only b in recent
        if (bRecent !== -1) return 1;
        
        // Neither in recent - sort by last update
        const aDate = a.lastUpdateMade ? new Date(a.lastUpdateMade) : new Date(0);
        const bDate = b.lastUpdateMade ? new Date(b.lastUpdateMade) : new Date(0);
        return bDate - aDate;
    });
    
    if (jobs.length === 0) {
        container.innerHTML = '<div class="job-finder-empty">No jobs found</div>';
        return;
    }
    
    let html = '';
    jobs.forEach(job => {
        html += `
            <div class="job-finder-row" onclick="selectJobFromFinder('${job.jobNumber}')">
                <div class="job-finder-row-logo">
                    <img src="${getLogoUrl(job.clientCode)}" alt="${job.clientCode}" onerror="this.src='images/logos/Unknown.png'">
                </div>
                <div class="job-finder-row-info">
                    <span class="job-finder-row-number">${job.jobNumber}</span>
                    <span class="job-finder-row-name">${job.jobName || ''}</span>
                </div>
                <svg class="job-finder-row-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

function selectJobFromFinder(jobNumber) {
    // Track as recent
    trackRecentJob(jobNumber);
    
    // Close modal
    closeJobFinder();
    
    // Open job bag
    openJobDetail(jobNumber);
}

// Recent jobs tracking (localStorage)
function getRecentJobs() {
    try {
        const stored = localStorage.getItem(RECENT_JOBS_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch {
        return [];
    }
}

function trackRecentJob(jobNumber) {
    try {
        let recent = getRecentJobs();
        // Remove if already exists
        recent = recent.filter(j => j !== jobNumber);
        // Add to front
        recent.unshift(jobNumber);
        // Limit size
        recent = recent.slice(0, MAX_RECENT_JOBS);
        localStorage.setItem(RECENT_JOBS_KEY, JSON.stringify(recent));
    } catch {
        // Ignore localStorage errors
    }
}

// Make functions globally available
window.openJobFinder = openJobFinder;
window.closeJobFinder = closeJobFinder;
window.debouncedFilterJobFinder = debouncedFilterJobFinder;
window.selectJobFromFinder = selectJobFromFinder;

// Close on overlay click
document.addEventListener('click', (e) => {
    if (e.target.id === 'job-finder-modal') {
        closeJobFinder();
    }
});

// ===== STORY EDITOR =====

function openStoryModal(job) {
    const modal = $('story-edit-modal');
    const input = $('story-edit-input');
    const counter = $('story-char-count');
    if (!modal || !input) return;

    input.value = job.theStory || '';
    counter.textContent = input.value.length;

    input.oninput = () => {
        counter.textContent = input.value.length;
    };

    modal.classList.add('visible');
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
}

function closeStoryModal() {
    $('story-edit-modal')?.classList.remove('visible');
}

async function saveStory() {
    if (!currentBagJob) return;
    const input = $('story-edit-input');
    const btn = $('story-save-btn');
    const text = input.value.trim();

    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
        const response = await fetch(`${API_BASE}/job/${encodeURIComponent(currentBagJob.jobNumber)}/story`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ story: text })
        });

        if (!response.ok) throw new Error('Save failed');

        // Update in place
        currentBagJob.theStory = text;
        const storyEl = $('jb-story-text');
        const storyMore = $('jb-story-more');
        if (storyEl) storyEl.textContent = text || 'Watch this space.';

        // Re-check if fade is needed
        requestAnimationFrame(() => {
            const wrap = $('jb-story-wrap');
            const fade = $('jb-story-fade');
            const btn = $('jb-story-more');
            if (wrap && fade) {
                const overflows = wrap.scrollHeight > wrap.clientHeight;
                fade.style.display = overflows ? 'flex' : 'none';
                if (btn) btn.style.display = 'none';
            }
        });

        // Update allJobs state
        const stateJob = state.allJobs.find(j => j.jobNumber === currentBagJob.jobNumber);
        if (stateJob) stateJob.theStory = text;

        closeStoryModal();
        showToast('Story updated.', 'success');

    } catch (e) {
        console.error('[Story] Save failed:', e);
        showToast("Couldn't save story.", 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save';
    }
}

window.closeStoryModal = closeStoryModal;
window.saveStory = saveStory;

function renderJobBagFiles(job) {
    const filesBody = $('jb-files-body');
    if (!job.filesUrl) {
        filesBody.innerHTML = '<span class="jb-files-empty">No files URL set</span>';
        return;
    }

    const base = job.filesUrl.replace(/\/$/, '');
    const folders = [
        { name: 'Briefs', path: `${base}/Briefs` },
        { name: 'Finals', path: `${base}/Finals` },
        { name: 'Working', path: `${base}/Working` },
    ];

    const folderIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#E8291C" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;

    filesBody.innerHTML = folders.map(f => `
        <a class="jb-file-row" href="${f.path}" target="_blank" rel="noopener">
            <div class="jb-file-left">
                <span class="jb-file-icon">${folderIcon}</span>
                <span class="jb-file-name">${f.name}</span>
            </div>
        </a>
    `).join('');
}

async function loadJobBagUpdates(jobNumber) {
    const threadBody = $('jb-thread-body');
    threadBody.innerHTML = loadingDots();

    try {
        const response = await fetch(`${API_BASE}/job/${encodeURIComponent(jobNumber)}/updates`);
        if (!response.ok) throw new Error('Failed to load updates');
        const updates = await response.json();

        const countEl = $('jb-thread-count');
        if (countEl) countEl.textContent = '';

        if (updates.length === 0) {
            threadBody.innerHTML = '<div class="jb-empty-thread">No updates yet. Add the first one below.</div>';
            return;
        }

        threadBody.innerHTML = renderThreadEntries(updates);
        threadBody.scrollTop = threadBody.scrollHeight;

    } catch (e) {
        console.error('[Job Bag] Failed to load updates:', e);
        threadBody.innerHTML = '<div class="jb-empty-thread">Couldn\'t load updates.</div>';
    }
}

// Registry for thread entries — keyed by record ID for safe onclick access
const threadEntryRegistry = {};

function renderThreadEntries(updates) {
    let html = '';
    let lastDateKey = null;

    // Sort by effective date (backdate takes priority over created_time)
    const sorted = [...updates].sort((a, b) => {
        const dateA = new Date(a.backdate ? a.backdate + 'T12:00:00' : a.created_time);
        const dateB = new Date(b.backdate ? b.backdate + 'T12:00:00' : b.created_time);
        return dateA - dateB;
    });

    sorted.forEach(entry => {
        // Use backdate if present, otherwise created_time
        const effectiveDate = entry.backdate ? entry.backdate + 'T12:00:00' : entry.created_time;
        const dt = effectiveDate ? new Date(effectiveDate) : null;
        const dateKey = dt ? dt.toDateString() : null;

        if (dateKey && dateKey !== lastDateKey) {
            const today = new Date().toDateString();
            const yesterday = new Date(Date.now() - 86400000).toDateString();
            let label;
            if (dateKey === today) label = 'Today';
            else if (dateKey === yesterday) label = 'Yesterday';
            else label = dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

            html += `
                <div class="jb-date-sep">
                    <div class="jb-date-line"></div>
                    <div class="jb-date-label">${label}</div>
                    <div class="jb-date-line"></div>
                </div>`;
            lastDateKey = dateKey;
        }

        const author = entry.author || 'Dot';
        // Show time only for non-backdated entries
        const timeStr = (!entry.backdate && dt) ? dt.toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase() : '';
        const avatarClass = getAvatarClass(author);
        const initials = getInitials(author);
        // Store in registry so onclick can look it up safely
        threadEntryRegistry[entry.id] = entry;

        html += `
            <div class="jb-entry">
                <div class="jb-avatar ${avatarClass}">${initials}</div>
                <div class="jb-entry-content">
                    <div class="jb-entry-header">
                        <span class="jb-entry-author">${escapeHtml(author)}</span>
                        <span class="jb-entry-time">${timeStr}</span>
                        <button class="jb-entry-edit" onclick="editEntry('${entry.id}')" title="Edit">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                    </div>
                    <div class="jb-entry-body">
                        <div class="jb-entry-text">${escapeHtml(entry.update || '')}</div>
                    </div>
                </div>
            </div>`;
    });

    return html;
}

function getAvatarClass(author) {
    const lower = (author || '').toLowerCase();
    if (lower === 'dot') return 'jb-av-dot';
    if (lower.includes('michael') || lower.startsWith('mg')) return 'jb-av-michael';
    if (lower.includes('stu') || lower.startsWith('sh')) return 'jb-av-stu';
    return 'jb-av-client';
}

function getInitials(name) {
    if (!name) return '?';
    const words = name.trim().split(/\s+/);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

async function loadJobBagBudget(jobNumber) {
    const budgetBody = $('jb-budget-body');
    budgetBody.innerHTML = loadingDots('small');

    try {
        const response = await fetch(`${API_BASE}/job/${encodeURIComponent(jobNumber)}/budget`);
        if (!response.ok) throw new Error('Failed to load budget');
        const data = await response.json();

        const total = data.total || 0;
        const entries = data.entries || [];

        const stageProgress = { 'Triage': 20, 'Clarify': 40, 'Simplify': 60, 'Craft': 60, 'Refine': 75, 'Deliver': 85 };
        const stage = currentBagJob?.stage || '';
        const progress = stageProgress[stage] || 0;

        let html = `
            <div class="jb-spend-total">$${Math.round(total).toLocaleString()}</div>
            <div class="jb-spend-label">${stage || 'No stage set'}</div>
            <div class="jb-progress-bar"><div class="jb-progress-fill" style="width: ${progress}%"></div></div>`;

        budgetBody.innerHTML = html;

    } catch (e) {
        console.error('[Job Bag] Failed to load budget:', e);
        budgetBody.innerHTML = '<div style="font-size:12px;color:#999;">Couldn\'t load budget</div>';
    }
}

async function toggleWithClient() {
    if (!currentBagJob) return;
    const newVal = !currentBagJob.withClient;

    // Optimistic UI
    const checkbox = $('jb-with-client-checkbox');
    if (checkbox) checkbox.checked = newVal;
    updateWithClientLabels(newVal);
    currentBagJob.withClient = newVal;

    try {
        const response = await fetch(`${API_BASE}/job/${encodeURIComponent(currentBagJob.jobNumber)}/update`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ withClient: newVal })
        });
        if (!response.ok) throw new Error('Failed to update');

        // Update state
        const stateJob = state.allJobs.find(j => j.jobNumber === currentBagJob.jobNumber);
        if (stateJob) stateJob.withClient = newVal;

    } catch (e) {
        // Revert on failure
        currentBagJob.withClient = !newVal;
        if (checkbox) checkbox.checked = !newVal;
        updateWithClientLabels(!newVal);
        console.error('[Job Bag] Toggle failed:', e);
    }
}

// Compose bar — post update
document.addEventListener('DOMContentLoaded', () => {
    const input = $('jb-compose-input');
    const btn = $('jb-post-btn');

    if (input) {
        input.addEventListener('input', () => {
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 80) + 'px';
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                postJobBagUpdate();
            }
        });
    }

    if (btn) btn.addEventListener('click', postJobBagUpdate);

    // Paperclip button → open file picker
    const attachBtn = $('jb-attach-btn');
    const fileInput = $('jb-file-input');
    if (attachBtn && fileInput) {
        attachBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', () => {
            if (fileInput.files.length > 0) setAttachedFile(fileInput.files[0]);
        });
    }

    // Remove attachment
    const removeBtn = $('jb-attach-remove');
    if (removeBtn) removeBtn.addEventListener('click', clearAttachedFile);

    // Subfolder picker
    document.querySelectorAll('.jb-subfolder-btn').forEach(b => {
        b.addEventListener('click', () => {
            document.querySelectorAll('.jb-subfolder-btn').forEach(x => x.classList.remove('active'));
            b.classList.add('active');
        });
    });

    // Drag and drop on thread
    const thread = document.querySelector('.jb-thread');
    if (thread) {
        thread.addEventListener('dragover', (e) => { e.preventDefault(); thread.classList.add('jb-drag-over'); });
        thread.addEventListener('dragleave', () => thread.classList.remove('jb-drag-over'));
        thread.addEventListener('drop', (e) => {
            e.preventDefault();
            thread.classList.remove('jb-drag-over');
            const file = e.dataTransfer.files[0];
            if (file) setAttachedFile(file);
        });
    }
});

// Attached file state
let attachedFile = null;

function setAttachedFile(file) {
    attachedFile = file;
    $('jb-attach-name').textContent = file.name;
    $('jb-attach-preview').style.display = 'block';
    $('jb-attach-btn').classList.add('active');
    // Update label with job number
    const label = $('jb-subfolder-label');
    if (label && currentBagJob) {
        label.textContent = `SAVE IN ${currentBagJob.jobNumber}`;
    }
}

function clearAttachedFile() {
    attachedFile = null;
    $('jb-attach-preview').style.display = 'none';
    $('jb-attach-btn').classList.remove('active');
    const fileInput = $('jb-file-input');
    if (fileInput) fileInput.value = '';
}

function getSelectedSubfolder() {
    const active = document.querySelector('.jb-subfolder-btn.active');
    return active ? active.dataset.folder : 'Workings';
}

function updateWithClientLabels(isWithClient) {
    const left = $('jb-wc-label-left');
    const right = $('jb-wc-label-right');
    if (!left || !right) return;
    left.className = isWithClient ? 'jb-wc-label jb-wc-left inactive' : 'jb-wc-label jb-wc-left active';
    right.className = isWithClient ? 'jb-wc-label jb-wc-right active' : 'jb-wc-label jb-wc-right inactive';
}

let storyExpanded = false;
function toggleStory() {
    storyExpanded = !storyExpanded;
    const card = $('jb-story-card');
    const btn = $('jb-story-more');
    if (!card) return;
    card.classList.toggle('expanded', storyExpanded);
    if (btn) btn.style.display = storyExpanded ? 'block' : 'none';

    // Recalculate thread height after story expands
    requestAnimationFrame(() => {
        const left = document.querySelector('.jb-left');
        const thread = document.querySelector('.jb-thread');
        if (left && thread) {
            thread.style.height = left.offsetHeight + 'px';
        }
    });
}

// ===== UPDATE EDIT MODAL =====

let currentEditEntry = null;

function editEntry(entryId) {
    const entry = threadEntryRegistry[entryId];
    if (!entry) return;
    currentEditEntry = entry;
    const modal = $('update-edit-modal');
    const input = $('update-edit-input');
    if (!modal || !input) return;
    input.value = entry.update || '';
    
    // Pre-fill date with effective date (backdate or created_time)
    const dateInput = $('update-edit-date');
    if (dateInput) {
        let effectiveDate = entry.backdate || '';
        if (!effectiveDate && entry.created_time) {
            // Extract YYYY-MM-DD from created_time
            effectiveDate = entry.created_time.split('T')[0];
        }
        dateInput.value = effectiveDate;
    }
    
    // Reset delete confirm state
    resetDeleteConfirmState();
    
    modal.classList.add('visible');
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
}

function closeUpdateEditModal() {
    $('update-edit-modal')?.classList.remove('visible');
    currentEditEntry = null;
    resetDeleteConfirmState();
}

function resetDeleteConfirmState() {
    const icon = $('update-delete-icon');
    const btn = $('update-delete-confirm-btn');
    if (icon) icon.style.display = 'flex';
    if (btn) {
        btn.style.display = 'none';
        btn.disabled = false;
        btn.textContent = 'Delete?';
    }
}

function confirmDeleteUpdate() {
    const icon = $('update-delete-icon');
    const btn = $('update-delete-confirm-btn');
    if (icon) icon.style.display = 'none';
    if (btn) btn.style.display = 'block';
}

function cancelDeleteUpdate() {
    resetDeleteConfirmState();
}

function handleUpdateModalBackdrop(event) {
    // Clicking the overlay background closes modal
    if (event.target.id === 'update-edit-modal') {
        closeUpdateEditModal();
    }
}

async function saveUpdateEdit() {
    if (!currentEditEntry || !currentBagJob) return;
    const input = $('update-edit-input');
    const dateInput = $('update-edit-date');
    const btn = $('update-save-btn');
    const text = input.value.trim();
    if (!text) return;

    const body = { text };
    const dateVal = dateInput?.value || '';
    if (dateVal) body.backdate = dateVal;

    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
        const response = await fetch(`${API_BASE}/job/${encodeURIComponent(currentBagJob.jobNumber)}/updates/${currentEditEntry.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!response.ok) throw new Error('Save failed');
        closeUpdateEditModal();
        loadJobBagUpdates(currentBagJob.jobNumber);
        showToast('Update saved.', 'success');
    } catch (e) {
        console.error('[Job Bag] Edit save failed:', e);
        showToast("Couldn't save update.", 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save';
    }
}

async function executeDeleteUpdate() {
    if (!currentEditEntry || !currentBagJob) return;
    const btn = $('update-delete-confirm-btn');
    btn.disabled = true;
    btn.textContent = 'Deleting…';

    try {
        const response = await fetch(`${API_BASE}/job/${encodeURIComponent(currentBagJob.jobNumber)}/updates/${currentEditEntry.id}`, {
            method: 'DELETE'
        });
        if (!response.ok) throw new Error('Delete failed');
        closeUpdateEditModal();
        loadJobBagUpdates(currentBagJob.jobNumber);
        showToast('Update deleted.', 'success');
    } catch (e) {
        console.error('[Job Bag] Delete failed:', e);
        showToast("Couldn't delete update.", 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Delete?';
    }
}

window.editEntry = editEntry;
window.closeUpdateEditModal = closeUpdateEditModal;
window.confirmDeleteUpdate = confirmDeleteUpdate;
window.cancelDeleteUpdate = cancelDeleteUpdate;
window.resetDeleteConfirmState = resetDeleteConfirmState;
window.saveUpdateEdit = saveUpdateEdit;
window.executeDeleteUpdate = executeDeleteUpdate;
window.handleUpdateModalBackdrop = handleUpdateModalBackdrop;



async function postJobBagUpdate() {
    if (!currentBagJob) return;

    const input = $('jb-compose-input');
    const btn = $('jb-post-btn');
    const text = input?.value.trim();

    // Need text or a file (or both)
    if (!text && !attachedFile) return;

    const authorName = state.currentUser?.firstName || state.currentUser?.name || 'Dot';

    btn.disabled = true;
    btn.textContent = '...';

    try {
        // If there's a file, upload it first
        if (attachedFile) {
            const subfolder = getSelectedSubfolder();
            const formData = new FormData();
            formData.append('file', attachedFile);
            formData.append('jobNumber', currentBagJob.jobNumber);
            formData.append('jobName', currentBagJob.jobName || '');
            formData.append('clientCode', currentBagJob.clientCode || '');
            formData.append('subfolder', subfolder);

            const uploadRes = await fetch('https://dot-workers.up.railway.app/upload', {
                method: 'POST',
                body: formData
            });

            const uploadData = await uploadRes.json();

            if (!uploadData.success) {
                throw new Error(uploadData.error || 'Upload failed');
            }

            // Show success tick on the attach preview
            $('jb-attach-name').textContent = `✓ ${attachedFile.name} → ${subfolder}`;
            setTimeout(clearAttachedFile, 2000);
        }

        // If there's text, post the update entry
        if (text) {
            const body = { text, author: authorName };

            const response = await fetch(`${API_BASE}/job/${encodeURIComponent(currentBagJob.jobNumber)}/updates`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (!response.ok) throw new Error('Post failed');
            const newEntry = await response.json();

            // Clear input
            input.value = '';
            input.style.height = 'auto';

            // Append to thread
            const threadBody = $('jb-thread-body');
            const entryHtml = renderThreadEntries([newEntry]);
            const emptyEl = threadBody.querySelector('.jb-empty-thread');
            if (emptyEl) emptyEl.remove();
            threadBody.insertAdjacentHTML('beforeend', entryHtml);
            threadBody.scrollTop = threadBody.scrollHeight;

            // Update count (element may not exist)
            const countEl = $('jb-thread-count');
            if (countEl) {
                const current = parseInt(countEl.textContent) || 0;
                const newCount = current + 1;
                countEl.textContent = `${newCount} ${newCount === 1 ? 'entry' : 'entries'}`;
            }
        } else {
            // File only — clear text input just in case
            input.value = '';
            input.style.height = 'auto';
        }

    } catch (e) {
        console.error('[Job Bag] Post failed:', e);
        showToast('Couldn\'t post update. Try again.', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Update';
    }
}

// saveJobUpdate moved to editJobModal.js (28 Apr 2026, A3)

// Make modal functions global
window.openJobSummary = openJobSummary;
window.closeJobSummary = closeJobSummary;
window.openJobDetail = openJobDetail;
window.openJobBag = openJobBag;
window.closeJobBag = closeJobBag;
// openJobModal, closeJobModal, saveJobUpdate, openJobNameModal, closeJobNameModal, saveJobName
// exported from editJobModal.js (28 Apr 2026, A3)

// Job name (pencil) sub-modal: openJobNameModal, closeJobNameModal, saveJobName
// moved to editJobModal.js (28 Apr 2026, A3)

// ===== SVG ICONS =====
const ICON_CLOCK = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#ED1C24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
const ICON_REFRESH = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#ED1C24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>`;
const ICON_EXCHANGE = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#ED1C24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h12l-3-3M20 15H8l3 3"/></svg>`;
const ICON_CHEVRON = `<svg class="chevron-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#ED1C24" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
const ICON_CHEVRON_RIGHT = `<svg class="chevron-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>`;

// ===== MESSAGE FORMATTING =====
function formatMessage(message) {
    if (!message) return '';
    
    // Split into lines
    const lines = message.split('\n').map(l => l.trim()).filter(l => l);
    
    // Check if we have bullet points
    const hasBullets = lines.some(l => /^[\u2022\-\*]\s/.test(l));
    
    if (!hasBullets) {
        return lines.map(l => `<p>${l}</p>`).join('');
    }
    
    // Process bullets into proper lists
    let html = '';
    let inList = false;
    
    lines.forEach(line => {
        const isBullet = /^[\u2022\-\*]\s/.test(line);
        
        if (isBullet) {
            if (!inList) {
                html += '<ul class="dot-list">';
                inList = true;
            }
            html += `<li>${line.replace(/^[\u2022\-\*]\s*/, '')}</li>`;
        } else {
            if (inList) {
                html += '</ul>';
                inList = false;
            }
            html += `<p>${line}</p>`;
        }
    });
    
    if (inList) html += '</ul>';
    
    return html;
}


// ===== HELPERS =====
function formatDueDate(isoDate, withClient = false) {
    if (!isoDate) return 'TBC';
    const date = new Date(isoDate);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    const dateOnly = new Date(date); dateOnly.setHours(0, 0, 0, 0);
    if (dateOnly.getTime() === today.getTime()) return 'Today';
    if (dateOnly.getTime() === tomorrow.getTime()) return 'Tomorrow';
    if (dateOnly < today) return withClient ? 'TBC' : 'Overdue';
    return date.toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' });
}

function formatDateForInput(d) { if (!d) return ''; return new Date(d).toISOString().split('T')[0]; }

// ===== TBC PILL =====
// Wires a TBC pill to a date input. Click pill → clears date + activates pill.
// Pick date → deactivates pill. Use isTbcActive() to check intent at save time.
function setupTbcPill(inputId, pillId) {
    const input = $(inputId);
    const pill = $(pillId);
    if (!input || !pill) return;
    pill.addEventListener('click', () => {
        const willActivate = !pill.classList.contains('active');
        if (willActivate) {
            input.value = '';
            pill.classList.add('active');
        } else {
            pill.classList.remove('active');
            input.focus();
        }
    });
    input.addEventListener('input', () => {
        if (input.value) pill.classList.remove('active');
    });
}

function setTbcPillState(pillId, active) {
    const pill = $(pillId);
    if (!pill) return;
    pill.classList.toggle('active', !!active);
}

function isTbcActive(pillId) {
    return $(pillId)?.classList.contains('active') || false;
}
function getDaysUntilDue(d) { if (!d) return 999; return Math.ceil((new Date(d) - new Date()) / 86400000); }
function getDaysSinceUpdate(d) { if (!d) return 999; return Math.floor((new Date() - new Date(d)) / 86400000); }
function getDaysAgoClass(days) { return days > 7 ? 'days-ago stale' : 'days-ago'; }
function getLogoUrl(code) { const logoCode = (code === 'ONB' || code === 'ONS') ? 'ONE' : code; return `images/logos/${logoCode}.png`; }

function showToast(message, type) {
    const toast = $('toast');
    if (toast) { 
        toast.textContent = message; 
        toast.className = `toast ${type} visible`; 
        setTimeout(() => toast.classList.remove('visible'), 2500); 
    }
}

// ===== WIP VIEW =====
async function setupWipDropdown() {
    const trigger = $('wip-client-trigger');
    const menu = $('wip-client-menu');
    if (!trigger || !menu) return;
    
    // Wait for clients to load if not already
    if (state.allClients.length === 0) {
        await loadClients();
    }
    
    // If user has client filter (non-Full access), lock to their client
    if (state.clientFilter) {
        const client = state.allClients.find(c => c.code === state.clientFilter);
        const displayName = client ? getClientDisplayName(client) : state.clientFilter;
        trigger.querySelector('span').textContent = displayName;
        trigger.style.pointerEvents = 'none'; // Disable dropdown
        trigger.querySelector('svg')?.classList.add('hidden'); // Hide chevron
        state.wipClient = state.clientFilter;
        return;
    }
    
    // Full access - show all options
    const presetClient = state.wipClient || 'all';
    
    menu.innerHTML = '';
    
    // Add "All Clients" option
    const allOpt = document.createElement('div');
    allOpt.className = 'custom-dropdown-option' + (presetClient === 'all' ? ' selected' : '');
    allOpt.dataset.value = 'all';
    allOpt.textContent = 'All Clients';
    menu.appendChild(allOpt);
    
    // Add client options (excluding hidden)
    let selectedText = 'All Clients';
    state.allClients.filter(c => !HIDDEN_CLIENTS.includes(c.code)).forEach(c => {
        const opt = document.createElement('div');
        const isSelected = (c.code === presetClient);
        opt.className = 'custom-dropdown-option' + (isSelected ? ' selected' : '');
        opt.dataset.value = c.code;
        opt.textContent = getClientDisplayName(c);
        menu.appendChild(opt);
        if (isSelected) selectedText = opt.textContent;
    });
    
    // Update trigger text to match selection
    trigger.querySelector('span').textContent = selectedText;
    
    trigger.onclick = (e) => { e.stopPropagation(); trigger.classList.toggle('open'); menu.classList.toggle('open'); };
    menu.onclick = (e) => {
        const opt = e.target.closest('.custom-dropdown-option');
        if (!opt) return;
        menu.querySelectorAll('.custom-dropdown-option').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        trigger.querySelector('span').textContent = opt.textContent;
        trigger.classList.remove('open'); menu.classList.remove('open');
        state.wipClient = opt.dataset.value;
        renderWip();
    };
}

function setWipMode(mode) {
    state.wipMode = mode;
    $('wip-mode-switch').checked = (mode === 'desktop');
    updateWipModeLabels();
    renderWip();
}

function toggleWipMode() {
    state.wipMode = $('wip-mode-switch').checked ? 'desktop' : 'mobile';
    updateWipModeLabels();
    renderWip();
}

function openWipPdf() {
    if (state.wipClient === 'all') {
        showToast('Select a client first');
        return;
    }
    window.open(`https://dot-tracker-pdf.up.railway.app/wip?client=${state.wipClient}`, '_blank');
}

function updateWipModeLabels() {
    $('mode-mobile')?.classList.toggle('active', state.wipMode === 'mobile');
    $('mode-desktop')?.classList.toggle('active', state.wipMode === 'desktop');
}

function getAccessFilteredJobs() {
    // For chat: return only jobs the user has access to
    if (state.clientFilter) {
        return state.allJobs.filter(j => j.clientCode === state.clientFilter);
    }
    return state.allJobs;
}

function getWipFilteredJobs() {
    let jobs = state.allJobs.slice();
    
    // Apply access level filter first (restricts to client's jobs)
    if (state.clientFilter) {
        jobs = jobs.filter(j => j.clientCode === state.clientFilter);
    }
    
    // Then apply user's view filter (if they're allowed to see all)
    if (state.wipClient !== 'all' && !state.clientFilter) {
        jobs = jobs.filter(j => j.clientCode === state.wipClient);
    }
    
    return jobs.filter(j => { const num = j.jobNumber.split(' ')[1]; return num !== '000' && num !== '999'; });
}

function getWipSectionLabels() {
    // Dynamic labels based on selected client
    if (state.wipClient === 'all') {
        return { withUs: 'WITH US', withClient: 'WITH CLIENT' };
    }
    
    // Find client name for the filtered client
    const client = state.allClients.find(c => c.code === state.wipClient);
    const clientName = client ? client.name.toUpperCase() : state.wipClient;
    
    return { withUs: 'WITH HUNCH', withClient: `WITH ${clientName}` };
}

function groupByWip(jobs) {
    const g = { withUs: [], withYou: [], incoming: [], onHold: [] };
    jobs.forEach(j => {
        if (j.status === 'Incoming') g.incoming.push(j);
        else if (j.status === 'On Hold') g.onHold.push(j);
        else if (j.status === 'Completed' || j.status === 'Archived') return;
        else if (j.withClient) g.withYou.push(j);
        else g.withUs.push(j);
    });
    const s = (a, b) => getDaysUntilDue(a.updateDue) - getDaysUntilDue(b.updateDue);
    Object.values(g).forEach(arr => arr.sort(s));
    
    const labels = getWipSectionLabels();
    return { 
        leftTop: { title: labels.withUs, jobs: g.withUs }, 
        rightTop: { title: labels.withClient, jobs: g.withYou }, 
        leftBottom: { title: 'INCOMING', jobs: g.incoming }, 
        rightBottom: { title: 'ON HOLD', jobs: g.onHold } 
    };
}

function renderWip() {
    const content = $('wip-content');
    if (!content) return;
    
    // Show loading modal if jobs haven't loaded yet
    if (!state.jobsLoaded) {
        content.innerHTML = '';
        showLoadingModal();
        return;
    }
    
    // Hide loading modal once data is ready
    hideLoadingModal();
    
    const jobs = getWipFilteredJobs();
    const sections = groupByWip(jobs);
    const isMobileMode = state.wipMode === 'mobile';
    
    if (isMobileMode) {
        // Single column list view - all sections stacked
        content.innerHTML = `
            <div class="wip-list-single">
                ${renderWipSection(sections.leftTop, true)}
                ${renderWipSection(sections.rightTop, true)}
                ${renderWipSection(sections.leftBottom, true)}
                ${renderWipSection(sections.rightBottom, true)}
            </div>
        `;
    } else {
        // Two column cards view
        content.innerHTML = `
            <div class="wip-column">
                ${renderWipSection(sections.leftTop, false)}
                ${renderWipSection(sections.leftBottom, false)}
            </div>
            <div class="wip-column">
                ${renderWipSection(sections.rightTop, false)}
                ${renderWipSection(sections.rightBottom, false)}
            </div>
        `;
    }
    
    // Add click handlers
    if (isMobileMode) {
        content.querySelectorAll('.list-row').forEach(row => {
            row.addEventListener('click', () => {
                const jobNumber = row.dataset.jobNumber;
                if (jobNumber) openJobDetail(jobNumber);
            });
        });
    } else {
        content.querySelectorAll('.job-card').forEach(card => {
            card.addEventListener('click', () => openJobDetail(card.dataset.job));
        });
    }
}

// ===== PHONE WIP (Mobile List View) =====
async function setupPhoneWipDropdown() {
    const trigger = $('phone-wip-client-trigger');
    const menu = $('phone-wip-client-menu');
    if (!trigger || !menu) return;
    
    if (state.allClients.length === 0) {
        await loadClients();
    }
    
    // If user has client filter (non-Full access), lock to their client
    if (state.clientFilter) {
        const client = state.allClients.find(c => c.code === state.clientFilter);
        const displayName = client ? getClientDisplayName(client) : state.clientFilter;
        trigger.querySelector('span').textContent = displayName;
        trigger.style.pointerEvents = 'none'; // Disable dropdown
        trigger.querySelector('svg')?.classList.add('hidden'); // Hide chevron
        state.wipClient = state.clientFilter;
        return;
    }
    
    menu.innerHTML = '';
    
    const allOpt = document.createElement('div');
    allOpt.className = 'custom-dropdown-option selected';
    allOpt.dataset.value = 'all';
    allOpt.textContent = 'All Clients';
    menu.appendChild(allOpt);
    
    state.allClients.filter(c => !HIDDEN_CLIENTS.includes(c.code)).forEach(c => {
        const opt = document.createElement('div');
        opt.className = 'custom-dropdown-option';
        opt.dataset.value = c.code;
        opt.textContent = getClientDisplayName(c);
        menu.appendChild(opt);
    });
    
    trigger.onclick = (e) => { 
        e.stopPropagation(); 
        trigger.classList.toggle('open'); 
        menu.classList.toggle('open'); 
    };
    
    menu.onclick = (e) => {
        const opt = e.target.closest('.custom-dropdown-option');
        if (!opt) return;
        menu.querySelectorAll('.custom-dropdown-option').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        trigger.querySelector('span').textContent = opt.textContent;
        trigger.classList.remove('open'); 
        menu.classList.remove('open');
        state.wipClient = opt.dataset.value;
        renderPhoneWip();
    };
}

function renderPhoneWip() {
    const content = $('phone-wip-content');
    if (!content) return;
    
    if (!state.jobsLoaded) {
        content.innerHTML = '';
        showLoadingModal();
        return;
    }
    
    // Hide loading modal once data is ready
    hideLoadingModal();
    
    const jobs = getWipFilteredJobs();
    const sections = groupByWip(jobs);
    
    // Always use list view on phone
    content.innerHTML = `
        <div class="wip-list-single">
            ${renderWipSection(sections.leftTop, true)}
            ${renderWipSection(sections.rightTop, true)}
            ${renderWipSection(sections.leftBottom, true)}
            ${renderWipSection(sections.rightBottom, true)}
        </div>
    `;
    
    // Add click handlers
    content.querySelectorAll('.list-row').forEach(row => {
        row.addEventListener('click', () => {
            const jobNumber = row.dataset.jobNumber;
            if (jobNumber) openJobDetail(jobNumber);
        });
    });
}

function renderWipSection(section, isListMode = false) {
    // In list mode, hide empty sections entirely
    if (isListMode && section.jobs.length === 0) {
        return '';
    }
    
    if (isListMode) {
        // List mode: title outside the white box
        let html = `<div class="section">`;
        html += `<div class="section-title">${section.title}</div>`;
        html += '<div class="section-card"><div class="list-view">';
        section.jobs.forEach(job => {
            html += createListRow(job);
        });
        html += '</div></div></div>';
        return html;
    } else {
        // Cards mode: title inside the section
        let html = `<div class="section"><div class="section-title">${section.title}</div>`;
        if (section.jobs.length === 0) {
            html += `<div class="job-card empty-section"><img src="images/dot-sitting.png" alt="Dot"><span>Nothing to see here</span></div>`;
        } else {
            section.jobs.forEach((job, i) => {
                html += createUniversalCard(job, `wip-${section.title.replace(/\s+/g, '-')}-${i}`);
            });
        }
        return html + '</div>';
    }
}

function createListRow(job) {
    const dueDate = formatDueDate(job.updateDue, job.withClient);
    const isOverdue = dueDate === 'Overdue' || dueDate === 'Today';
    
    // Truncate job name to 25 characters
    const jobName = job.jobName.length > 25 ? job.jobName.substring(0, 25) + '...' : job.jobName;
    
    // Truncate description to 50 characters
    const description = job.description 
        ? (job.description.length > 50 ? job.description.substring(0, 50) + '...' : job.description)
        : '';
    
    return `
        <div class="list-row" data-job-number="${job.jobNumber}">
            <div class="list-logo">
                <img src="${getLogoUrl(job.clientCode)}" alt="${job.clientCode}" onerror="this.src='images/logos/Unknown.png'">
            </div>
            <div class="list-main">
                <div class="list-title-row">
                    <span class="list-job-num">${job.jobNumber}</span>
                    <span class="list-job-name">${jobName}</span>
                </div>
                ${description ? `<div class="list-description">${description}</div>` : ''}
            </div>
            <div class="list-meta">
                <span class="list-due ${isOverdue ? 'overdue' : ''}">
                    ${ICON_CLOCK}
                    ${dueDate}
                </span>
            </div>
            <svg class="list-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ED1C24" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>
        </div>
    `;
}

// Old submitWipUpdate - redirects to modal
async function submitWipUpdate(jobNumber, btn) {
    openJobDetail(jobNumber);
}

function toggleWipWithClient(jobNumber, isWithClient) {
    const job = state.allJobs.find(j => j.jobNumber === jobNumber);
    const oldValue = job?.withClient;
    if (job) { job.withClient = isWithClient; renderWip(); }
    
    fetch(`${API_BASE}/job/${encodeURIComponent(jobNumber)}/update`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ withClient: isWithClient }) })
        .then(res => { if (!res.ok) throw new Error(); showToast('On it.', 'success'); })
        .catch(() => { if (job) { job.withClient = oldValue; renderWip(); } showToast("Doh, that didn't work.", 'error'); });
}


// ===== TRACKER VIEW =====
// Moved to tracker.js

// ===== NEW JOB MODAL =====
// Moved to newJobModal.js

// ===== COMING SOON MODAL =====
function showComingSoonModal(action) {
    const modal = $('coming-soon-modal');
    const text = $('coming-soon-text');
    if (!modal || !text) return;
    
    if (action === 'upload') {
        text.textContent = 'Uploads coming soon';
    } else if (action === 'edit-job') {
        text.textContent = 'Pick a job from WIP to edit for now.';
    } else if (action === 'tracker') {
        text.textContent = 'Pick a job from Tracker to edit for now.';
    } else if (action === 'ask-dot') {
        text.textContent = "Hey, what's cooking? Chat coming soon.";
    } else {
        text.textContent = 'Coming soon';
    }
    
    modal.classList.add('visible');
}

function closeComingSoonModal() {
    $('coming-soon-modal')?.classList.remove('visible');
}

// Close modal on overlay click
document.addEventListener('click', (e) => {
    if (e.target.id === 'coming-soon-modal') {
        closeComingSoonModal();
    }
});

// Make functions available globally
window.showComingSoonModal = showComingSoonModal;
window.closeComingSoonModal = closeComingSoonModal;

// ===== LOADING STATES =====

/**
 * Returns HTML for inline loading dots
 * @param {string} size - 'default' or 'small'
 * @returns {string} HTML string
 */
function loadingDots(size = 'default') {
    const sizeClass = size === 'small' ? ' loading-dots--small' : '';
    return `<div class="loading-dots${sizeClass}">
        <div class="loading-dots__dot"></div>
        <div class="loading-dots__dot"></div>
        <div class="loading-dots__dot"></div>
    </div>`;
}

/**
 * Shows the loading modal with Dot + heart animation
 */
function showLoadingModal() {
    let overlay = $('loading-modal');
    
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'loading-modal';
        overlay.className = 'loading-modal-overlay';
        overlay.innerHTML = `
            <div class="loading-modal">
                <div class="dot-thinking">
                    <img src="images/Robot_01.svg" alt="Dot" class="dot-robot">
                    <img src="images/Heart_01.svg" alt="" class="dot-heart-svg">
                </div>
                <div class="loading-modal-text">Just a sec</div>
            </div>
        `;
        document.body.appendChild(overlay);
    }
    
    overlay.classList.add('visible');
}

function hideLoadingModal() {
    $('loading-modal')?.classList.remove('visible');
}

// Make functions available globally
window.showComingSoonModal = showComingSoonModal;
window.closeComingSoonModal = closeComingSoonModal;

// ===== FILES MODAL =====
let filesState = { clientCode: null, jobNumber: null, filesUrl: null };

async function openFilesModal() {
    const modal = $('files-modal');
    if (!modal) return;
    
    // Reset state
    filesState = { clientCode: null, jobNumber: null, filesUrl: null };
    
    // Reset UI
    $('files-modal-logo').src = 'images/logos/Unknown.png';
    $('files-client-trigger').querySelector('span').textContent = 'Select client...';
    $('files-job-trigger').querySelector('span').textContent = 'Select client first...';
    $('files-job-trigger').classList.add('disabled');
    $('files-modal-footer').style.display = 'none';
    
    // Wait for clients to load if not already
    if (state.allClients.length === 0) {
        await loadClients();
    }
    
    // Populate clients from state.allClients
    const topClientCodes = ['ONE', 'ONS', 'ONB', 'SKY', 'TOW', 'FIS', 'HUN'];
    const topClients = [];
    const otherClients = [];
    
    state.allClients.forEach(c => {
        if (topClientCodes.includes(c.code)) {
            topClients.push(c);
        } else {
            otherClients.push(c);
        }
    });
    
    topClients.sort((a, b) => topClientCodes.indexOf(a.code) - topClientCodes.indexOf(b.code));
    
    let html = '';
    topClients.forEach(c => {
        html += `<div class="custom-dropdown-option" data-value="${c.code}" onclick="selectFilesClient('${c.code}', '${c.name.replace(/'/g, "\\'")}')">${c.name}</div>`;
    });
    
    if (otherClients.length > 0) {
        html += '<div class="custom-dropdown-option section-header">Other</div>';
        otherClients.forEach(c => {
            html += `<div class="custom-dropdown-option" data-value="${c.code}" onclick="selectFilesClient('${c.code}', '${c.name.replace(/'/g, "\\'")}')">${c.name}</div>`;
        });
    }
    
    $('files-client-menu').innerHTML = html;
    modal.classList.add('visible');
}

function closeFilesModal() {
    $('files-modal')?.classList.remove('visible');
    filesState = { clientCode: null, jobNumber: null, filesUrl: null };
}

function toggleFilesDropdown(id) {
    const trigger = $(`files-${id}-trigger`);
    const menu = $(`files-${id}-menu`);
    
    if (!trigger || !menu) return;
    if (trigger.classList.contains('disabled')) return;
    
    const isOpen = menu.classList.contains('open');
    
    // Close all files dropdowns first
    document.querySelectorAll('#files-modal .custom-dropdown-menu.open').forEach(m => {
        m.classList.remove('open');
        m.previousElementSibling?.classList.remove('open');
    });
    
    if (!isOpen) {
        trigger.classList.add('open');
        menu.classList.add('open');
    }
}

function selectFilesClient(code, name) {
    filesState.clientCode = code;
    filesState.jobNumber = null;
    filesState.filesUrl = null;
    
    // Update UI
    $('files-client-trigger').querySelector('span').textContent = name;
    $('files-client-trigger').classList.remove('open');
    $('files-client-menu').classList.remove('open');
    
    // Update logo
    const logo = $('files-modal-logo');
    logo.src = getLogoUrl(code);
    logo.onerror = function() { this.src = 'images/logos/Unknown.png'; };
    
    // Populate jobs dropdown from state.allJobs
    const clientJobs = state.allJobs.filter(j => j.clientCode === code && j.filesUrl);
    
    let html = '';
    clientJobs.forEach(j => {
        const label = `${j.jobNumber} | ${j.jobName}`;
        const filesUrl = j.filesUrl || '';
        html += `<div class="custom-dropdown-option" data-value="${j.jobNumber}" onclick="selectFilesJob('${j.jobNumber}', '${j.jobName.replace(/'/g, "\\'")}', '${filesUrl.replace(/'/g, "\\'")}')">${label}</div>`;
    });
    
    if (clientJobs.length === 0) {
        html = '<div class="custom-dropdown-option" style="color: var(--grey-400)">No jobs found</div>';
    }
    
    $('files-job-menu').innerHTML = html;
    $('files-job-trigger').querySelector('span').textContent = 'Select job...';
    $('files-job-trigger').classList.remove('disabled');
    
    // Hide button until job is selected
    $('files-modal-footer').style.display = 'none';
}

function selectFilesJob(jobNumber, jobName, filesUrl) {
    filesState.jobNumber = jobNumber;
    filesState.filesUrl = filesUrl;
    
    // Update UI
    $('files-job-trigger').querySelector('span').textContent = `${jobNumber} | ${jobName}`;
    $('files-job-trigger').classList.remove('open');
    $('files-job-menu').classList.remove('open');
    
    // Show button - the payoff moment
    $('files-modal-footer').style.display = 'flex';
}

function goToFiles() {
    if (!filesState.jobNumber) return;
    
    if (!filesState.filesUrl) {
        showToast('No files link set up for this job', 'error');
        return;
    }
    
    // Open in new tab
    window.open(filesState.filesUrl, '_blank');
    closeFilesModal();
}

// Close files modal on overlay click
document.addEventListener('click', (e) => {
    if (e.target.id === 'files-modal') {
        closeFilesModal();
    }
});

// Close files dropdowns on outside click  
document.addEventListener('click', (e) => {
    if (!e.target.closest('#files-modal .custom-dropdown')) {
        document.querySelectorAll('#files-modal .custom-dropdown-menu.open').forEach(m => {
            m.classList.remove('open');
            m.previousElementSibling?.classList.remove('open');
        });
    }
});

// Make files functions globally available
window.openFilesModal = openFilesModal;
window.closeFilesModal = closeFilesModal;
window.toggleFilesDropdown = toggleFilesDropdown;
window.selectFilesClient = selectFilesClient;
window.selectFilesJob = selectFilesJob;
window.goToFiles = goToFiles;


// === WIP EMAIL MODAL ===

let wipEmailState = { clientCode: null, recipients: [] };

async function openWipEmailModal() {
    const modal = $('wip-email-modal');
    if (!modal) return;
    
    // Reset state
    wipEmailState = { clientCode: null, recipients: [] };
    
    // Reset UI
    $('wip-email-modal-logo').src = 'images/logos/Unknown.png';
    $('wip-email-client-trigger').querySelector('span').textContent = 'Select client...';
    $('wip-email-people-group').style.display = 'none';
    $('wip-email-people-list').innerHTML = '';
    $('wip-email-intro-group').style.display = 'none';
    $('wip-email-intro').value = "Here's what's new, what's due and what needs a nudge.";
    $('wip-email-footer').style.display = 'none';
    
    // Wait for clients to load if not already
    if (state.allClients.length === 0) {
        await loadClients();
    }
    
    // Populate clients dropdown (same pattern as Files modal)
    const topClientCodes = ['ONE', 'ONS', 'ONB', 'SKY', 'TOW', 'FIS', 'HUN'];
    const topClients = [];
    const otherClients = [];
    
    state.allClients.forEach(c => {
        if (topClientCodes.includes(c.code)) {
            topClients.push(c);
        } else {
            otherClients.push(c);
        }
    });
    
    topClients.sort((a, b) => topClientCodes.indexOf(a.code) - topClientCodes.indexOf(b.code));
    
    let html = '';
    topClients.forEach(c => {
        html += `<div class="custom-dropdown-option" data-value="${c.code}" onclick="selectWipEmailClient('${c.code}', '${c.name.replace(/'/g, "\\'")}')"><img src="${getLogoUrl(c.code)}" alt="${c.code}" style="width: 24px; height: 24px; border-radius: 50%; margin-right: 10px; vertical-align: middle;" onerror="this.src='images/logos/Unknown.png'">${c.name}</div>`;
    });
    
    if (otherClients.length > 0) {
        html += '<div class="custom-dropdown-option section-header">Other</div>';
        otherClients.forEach(c => {
            html += `<div class="custom-dropdown-option" data-value="${c.code}" onclick="selectWipEmailClient('${c.code}', '${c.name.replace(/'/g, "\\'")}')"><img src="${getLogoUrl(c.code)}" alt="${c.code}" style="width: 24px; height: 24px; border-radius: 50%; margin-right: 10px; vertical-align: middle;" onerror="this.src='images/logos/Unknown.png'">${c.name}</div>`;
        });
    }
    
    $('wip-email-client-menu').innerHTML = html;
    modal.classList.add('visible');
}

function closeWipEmailModal() {
    $('wip-email-modal')?.classList.remove('visible');
    wipEmailState = { clientCode: null, recipients: [] };
}

function toggleWipEmailDropdown() {
    const trigger = $('wip-email-client-trigger');
    const menu = $('wip-email-client-menu');
    if (!trigger || !menu) return;
    
    const isOpen = menu.classList.contains('open');
    menu.classList.toggle('open');
    trigger.classList.toggle('open');
}

async function selectWipEmailClient(code, name) {
    wipEmailState.clientCode = code;
    // Pre-add Michael as default recipient
    wipEmailState.recipients = [{ email: 'michael@hunch.co.nz', firstName: 'Michael', accessLevel: 'Full' }];
    
    // Update UI
    $('wip-email-client-trigger').querySelector('span').textContent = name;
    $('wip-email-client-trigger').classList.remove('open');
    $('wip-email-client-menu').classList.remove('open');
    
    // Update logo
    const logo = $('wip-email-modal-logo');
    logo.src = getLogoUrl(code);
    logo.onerror = function() { this.src = 'images/logos/Unknown.png'; };
    
    // Fetch people for this client
    $('wip-email-people-list').innerHTML = loadingDots('small');
    $('wip-email-people-group').style.display = 'flex';
    
    try {
        const response = await fetch(`${API_BASE}/people/${code}`);
        const people = await response.json();
        
        // Filter to people with email addresses
        const withEmail = people.filter(p => p.email);
        
        // Build people list - Michael first (pre-checked), then client contacts
        let peopleHtml = `<label style="display: flex; align-items: center; padding: 10px 0; border-bottom: 1px solid #f0f0f0; cursor: pointer;">
            <input type="checkbox" checked style="margin-right: 12px; width: 18px; height: 18px; accent-color: #ED1C24;" onchange="toggleWipEmailRecipient('michael@hunch.co.nz', 'Michael', 'Full')">
            <div>
                <div style="font-size: 15px; font-weight: 500; color: #333;">Michael</div>
                <div style="font-size: 13px; color: #999;">michael@hunch.co.nz</div>
            </div>
        </label>`;
        
        withEmail.forEach(p => {
            const escapedEmail = p.email.replace(/'/g, "\\'");
            const escapedName = (p.firstName || p.name).replace(/'/g, "\\'");
            const escapedAccess = (p.accessLevel || 'Client WIP').replace(/'/g, "\\'");
            peopleHtml += `<label style="display: flex; align-items: center; padding: 10px 0; border-bottom: 1px solid #f0f0f0; cursor: pointer;">
                <input type="checkbox" style="margin-right: 12px; width: 18px; height: 18px; accent-color: #ED1C24;" onchange="toggleWipEmailRecipient('${escapedEmail}', '${escapedName}', '${escapedAccess}')">
                <div>
                    <div style="font-size: 15px; font-weight: 500; color: #333;">${p.name}</div>
                    <div style="font-size: 13px; color: #999;">${p.email}</div>
                </div>
            </label>`;
        });
        
        $('wip-email-people-list').innerHTML = peopleHtml;
        // Show intro field and send button since Michael is pre-checked
        $('wip-email-intro-group').style.display = 'flex';
        $('wip-email-footer').style.display = 'flex';
        
    } catch (e) {
        console.error('Failed to load people:', e);
        $('wip-email-people-list').innerHTML = '<div style="color: #999; font-size: 14px;">Failed to load contacts</div>';
    }
}

function toggleWipEmailRecipient(email, firstName, accessLevel) {
    const idx = wipEmailState.recipients.findIndex(r => r.email === email);
    if (idx >= 0) {
        wipEmailState.recipients.splice(idx, 1);
    } else {
        wipEmailState.recipients.push({ email, firstName, accessLevel });
    }
    
    // Show/hide send button
    $('wip-email-footer').style.display = wipEmailState.recipients.length > 0 ? 'flex' : 'none';
}

async function sendWipEmail() {
    if (wipEmailState.recipients.length === 0) return;
    
    const sendBtn = $('wip-email-send-btn');
    if (sendBtn.disabled) return;
    sendBtn.disabled = true;
    sendBtn.textContent = 'SENDING...';
    
    const intro = $('wip-email-intro')?.value?.trim() || null;
    
    const payload = {
        clientCode: wipEmailState.clientCode,
        recipients: wipEmailState.recipients,
        intro: intro,
        senderEmail: state.currentUser?.email
    };
    
    try {
        const response = await fetch('https://dot-workers.up.railway.app/wip/email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        const result = await response.json();
        
        if (result.success) {
            const count = wipEmailState.recipients.length;
            showToast(`WIP sent to ${count} ${count === 1 ? 'person' : 'people'}`, 'success');
            closeWipEmailModal();
        } else {
            showToast(result.error || 'Failed to send', 'error');
        }
    } catch (e) {
        console.error('Failed to send WIP email:', e);
        showToast('Failed to send WIP email', 'error');
    } finally {
        sendBtn.disabled = false;
        sendBtn.textContent = 'SEND WIP';
    }
}

// Close WIP email modal on overlay click
document.addEventListener('click', (e) => {
    if (e.target.id === 'wip-email-modal') {
        closeWipEmailModal();
    }
});

// Close WIP email dropdown on outside click
document.addEventListener('click', (e) => {
    if (!e.target.closest('#wip-email-client-dropdown')) {
        $('wip-email-client-menu')?.classList.remove('open');
        $('wip-email-client-trigger')?.classList.remove('open');
    }
});

// Make WIP email functions globally available
window.openWipEmailModal = openWipEmailModal;
window.closeWipEmailModal = closeWipEmailModal;
window.toggleWipEmailDropdown = toggleWipEmailDropdown;
window.selectWipEmailClient = selectWipEmailClient;
window.toggleWipEmailRecipient = toggleWipEmailRecipient;
window.sendWipEmail = sendWipEmail;

// Shared utilities for tracker.js (and other future modules)
window.$ = $;
window.$$ = $$;
window.API_BASE = API_BASE;
window.state = state;
window.showLoadingModal = showLoadingModal;
window.hideLoadingModal = hideLoadingModal;
window.showToast = showToast;
window.getLogoUrl = getLogoUrl;
window.ICON_CHEVRON_RIGHT = ICON_CHEVRON_RIGHT;
window.loadJobBagBudget = loadJobBagBudget;
window.openJobBag = openJobBag;

// Use getter for currentBagJob since it's a let that changes
Object.defineProperty(window, 'currentBagJob', {
    get: () => currentBagJob
});

// Make functions available globally
window.navigateTo = navigateTo;
window.setWipMode = setWipMode;
window.toggleWipMode = toggleWipMode;
window.openWipPdf = openWipPdf;
window.submitWipUpdate = submitWipUpdate;
window.toggleWipWithClient = toggleWipWithClient;
