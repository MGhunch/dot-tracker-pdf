/** 
 * Dot Hub - Unified Interface
 * Simplified: Claude responds naturally, frontend renders
 */

// ===== CONFIGURATION =====
const API_BASE = '/api';
const PROXY_BASE = 'https://dot-proxy.up.railway.app';
const TRAFFIC_BASE = 'https://dot-traffic-2.up.railway.app';

const KEY_CLIENTS = ['ONE', 'ONB', 'ONS', 'SKY', 'TOW'];

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
    if (view && ['wip', 'tracker', 'home'].includes(view)) {
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
    // Login form - Desktop
    $('login-send')?.addEventListener('click', () => requestLogin('desktop'));
    $('login-email')?.addEventListener('keypress', (e) => { if (e.key === 'Enter') requestLogin('desktop'); });
    $('login-try-again')?.addEventListener('click', (e) => { e.preventDefault(); resetLoginForm(); });
    
    // Login form - Phone
    $('phone-login-send')?.addEventListener('click', () => requestLogin('phone'));
    $('phone-login-email')?.addEventListener('keypress', (e) => { if (e.key === 'Enter') requestLogin('phone'); });
    $('phone-login-try-again')?.addEventListener('click', (e) => { e.preventDefault(); resetLoginForm(); });

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
            } else if (action === 'files') {
                openFilesModal();
            } else if (action === 'wip-email') {
                openWipEmailModal();
            } else {
                showComingSoonModal(action);
            }
        });
    });

    // Job modal textarea auto-resize
    $('job-edit-message')?.addEventListener('input', (e) => autoResizeTextarea(e.target));
    $('job-edit-description')?.addEventListener('input', (e) => autoResizeTextarea(e.target));
    
    // Job name modal close on overlay click
    $('job-name-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'job-name-modal') closeJobNameModal();
    });
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
        fetch(`${TRAFFIC_BASE}/traffic/clear`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: state.currentUser.name })
        }).catch(() => {});
    }
}

// ===== AUTH HANDLING =====
async function checkSession() {
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
            return;
        }
    } catch (e) {
        console.error('Session check failed:', e);
    }
    
    // No valid session - check for URL error params from magic link
    const params = new URLSearchParams(window.location.search);
    const error = params.get('error');
    
    if (error) {
        window.history.replaceState({}, document.title, window.location.pathname);
        
        const errorMsg = error === 'expired' 
            ? "Sorry, that link's run out of juice. Try again?"
            : "That link didn't work. Try again?";
        
        const errorEl = $('login-error');
        const phoneErrorEl = $('phone-login-error');
        if (errorEl) errorEl.textContent = errorMsg;
        if (phoneErrorEl) phoneErrorEl.textContent = errorMsg;
    }
}

async function requestLogin(source = 'desktop') {
    const isPhone = source === 'phone';
    const emailInput = isPhone ? $('phone-login-email') : $('login-email');
    const errorEl = isPhone ? $('phone-login-error') : $('login-error');
    const btn = isPhone ? $('phone-login-send') : $('login-send');
    
    const email = emailInput?.value.trim().toLowerCase();
    
    if (!email) {
        if (errorEl) errorEl.textContent = 'Pop in your email address';
        return;
    }
    
    // Basic email validation
    if (!email.includes('@') || !email.includes('.')) {
        if (errorEl) errorEl.textContent = "That doesn't look like an email";
        return;
    }
    
    // Disable button while requesting
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Sending...';
    }
    if (errorEl) errorEl.textContent = '';
    
    try {
        const response = await fetch('/api/request-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Show "link sent" state on both phone and desktop
            $('desktop-login-input')?.classList.add('hidden');
            $('desktop-login-sent')?.classList.remove('hidden');
            $('phone-login-input')?.classList.add('hidden');
            $('phone-login-sent')?.classList.remove('hidden');
        } else {
            if (errorEl) errorEl.textContent = data.message || "Something went wrong. Try again?";
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Send link';
            }
        }
    } catch (e) {
        console.error('Login request failed:', e);
        if (errorEl) errorEl.textContent = "Couldn't connect. Try again?";
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Send link';
        }
    }
}

function resetLoginForm() {
    // Reset both phone and desktop login forms
    $('desktop-login-sent')?.classList.add('hidden');
    $('desktop-login-input')?.classList.remove('hidden');
    $('phone-login-sent')?.classList.add('hidden');
    $('phone-login-input')?.classList.remove('hidden');
    
    // Clear inputs and errors
    const loginEmail = $('login-email');
    const phoneLoginEmail = $('phone-login-email');
    if (loginEmail) loginEmail.value = '';
    if (phoneLoginEmail) phoneLoginEmail.value = '';
    
    $('login-error')?.textContent && ($('login-error').textContent = '');
    $('phone-login-error')?.textContent && ($('phone-login-error').textContent = '');
    
    // Re-enable buttons
    const loginSend = $('login-send');
    const phoneLoginSend = $('phone-login-send');
    if (loginSend) {
        loginSend.disabled = false;
        loginSend.textContent = 'Send link';
    }
    if (phoneLoginSend) {
        phoneLoginSend.disabled = false;
        phoneLoginSend.textContent = 'Send link';
    }
}

function unlockApp() {
    // Remove logged-out state
    document.body.classList.remove('logged-out');
    
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
            { question: 'Check the WIP', label: 'Check the WIP' },
            { question: 'Meet Dot', label: 'Meet Dot' }
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
        
        const response = await fetch(`${TRAFFIC_BASE}/hub`, {
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
        await fetch(`${TRAFFIC_BASE}/traffic/clear`, {
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
    
    response.querySelectorAll('.job-header[data-job-id]').forEach(header => {
        header.addEventListener('click', () => {
            document.getElementById(header.dataset.jobId)?.classList.toggle('expanded');
        });
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
let currentEditJob = null;

async function openJobModal(jobNumber) {
    const job = state.allJobs.find(j => j.jobNumber === jobNumber);
    if (!job) return;
    
    currentEditJob = job;
    
    // Populate modal fields
    const modal = $('job-edit-modal');
    if (!modal) return;
    
    $('job-modal-title').textContent = `${jobNumber} | ${job.jobName || 'Untitled'}`;
    $('job-modal-logo').src = getLogoUrl(job.clientCode);
    $('job-modal-logo').onerror = function() { this.src = 'images/logos/Unknown.png'; };
    $('job-modal-logo').alt = job.clientCode;
    
    // Hero section
    $('job-edit-message').value = job.update || '';
    $('job-edit-update-due').value = formatDateForInput(job.updateDue);
    
    // Details section
    $('job-edit-description').value = job.description || '';
    $('job-edit-status').value = job.status || 'Incoming';
    $('job-edit-live').value = job.liveDate || 'Tbc';  // Now a dropdown with month values
    $('job-edit-with-client').checked = job.withClient || false;
    
    // Auto-resize textareas
    autoResizeTextarea($('job-edit-message'));
    autoResizeTextarea($('job-edit-description'));
    
    // Set Teams link
    const teamsLink = $('job-modal-teams-link');
    if (job.channelUrl) {
        teamsLink.href = job.channelUrl;
        teamsLink.style.display = 'inline-flex';
    } else {
        teamsLink.style.display = 'none';
    }
    
    // Set Tracker link (opens tracker filtered to this client and current month)
    const trackerLink = $('job-modal-tracker-link');
    trackerLink.onclick = (e) => {
        e.preventDefault();
        closeJobModal();
        const month = new Date().toLocaleString('en-US', { month: 'long' });
        window.location.href = `?view=tracker&client=${job.clientCode}&month=${month}`;
    };
    
    // Set WIP link (opens WIP filtered to this client)
    const wipLink = $('job-modal-wip-link');
    wipLink.onclick = (e) => {
        e.preventDefault();
        closeJobModal();
        state.wipClient = job.clientCode;
        navigateTo('wip');
    };
    
    // Set edit pencil handler
    $('job-modal-edit-btn').onclick = () => openJobNameModal();
    
    // Populate client owner dropdown
    const ownerSelect = $('job-edit-owner');
    ownerSelect.innerHTML = '<option value="">Loading...</option>';
    
    // Show modal immediately
    modal.classList.add('visible');
    
    // Fetch people for this client
    try {
        const clientCode = job.clientCode;
        const response = await fetch(`${API_BASE}/people/${clientCode}`);
        if (response.ok) {
            const people = await response.json();
            console.log(`Loaded ${people.length} people for ${clientCode}`);
            
            ownerSelect.innerHTML = '<option value="">Select...</option>';
            
            // Check if current owner is in the list
            const currentOwner = job.projectOwner || '';
            let ownerFound = false;
            
            people.forEach(person => {
                const option = document.createElement('option');
                option.value = person.name;
                option.textContent = person.name;
                if (person.name === currentOwner) {
                    option.selected = true;
                    ownerFound = true;
                }
                ownerSelect.appendChild(option);
            });
            
            // If current owner not in list but exists, add them at top
            if (currentOwner && !ownerFound) {
                const option = document.createElement('option');
                option.value = currentOwner;
                option.textContent = currentOwner;
                option.selected = true;
                ownerSelect.insertBefore(option, ownerSelect.options[1]);
            }
        } else {
            // Fallback to current owner only
            console.log('People API failed:', response.status);
            ownerSelect.innerHTML = `<option value="${job.projectOwner || ''}">${job.projectOwner || 'Select...'}</option>`;
        }
    } catch (e) {
        console.log('Failed to load people:', e);
        ownerSelect.innerHTML = `<option value="${job.projectOwner || ''}">${job.projectOwner || 'Select...'}</option>`;
    }
}

function autoResizeTextarea(textarea) {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
}

function closeJobModal() {
    $('job-edit-modal')?.classList.remove('visible');
    currentEditJob = null;
}

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

// Helper: open the right view based on access level
function openJobDetail(jobNumber) {
    if (state.currentUser?.accessLevel === 'Full') {
        openJobBag(jobNumber);
    } else {
        openJobSummary(jobNumber);
    }
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
        if (budgetBody) budgetBody.innerHTML = '<div style="font-size:12px;color:#999;">Loading…</div>';

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
    
    // Go to WIP filtered by current client
    if (currentBagJob) {
        state.wipClient = currentBagJob.clientCode;
    }
    navigateTo('wip');
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
    threadBody.innerHTML = '<div class="jb-thread-loading">Loading updates...</div>';

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
    budgetBody.innerHTML = '<div class="jb-thread-loading">Loading...</div>';

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
    // Pre-fill date if backdated
    const dateInput = $('update-edit-date');
    if (dateInput) dateInput.value = entry.backdate || '';
    // Reset confirm state
    const footer = $('update-edit-footer');
    const confirm = $('update-delete-confirm');
    if (footer) footer.style.display = 'flex';
    if (confirm) confirm.style.display = 'none';
    modal.classList.add('visible');
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
}

function closeUpdateEditModal() {
    $('update-edit-modal')?.classList.remove('visible');
    currentEditEntry = null;
}

function confirmDeleteUpdate() {
    $('update-edit-footer').style.display = 'none';
    $('update-delete-confirm').style.display = 'flex';
}

function cancelDeleteUpdate() {
    $('update-edit-footer').style.display = 'flex';
    $('update-delete-confirm').style.display = 'none';
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
        btn.textContent = 'Yes, delete';
    }
}

window.editEntry = editEntry;
window.closeUpdateEditModal = closeUpdateEditModal;
window.confirmDeleteUpdate = confirmDeleteUpdate;
window.cancelDeleteUpdate = cancelDeleteUpdate;
window.saveUpdateEdit = saveUpdateEdit;
window.executeDeleteUpdate = executeDeleteUpdate;



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

async function saveJobUpdate() {
    if (!currentEditJob) return;
    
    const jobNumber = currentEditJob.jobNumber;
    const btn = $('job-save-btn');
    
    const status = $('job-edit-status').value;
    const updateDue = $('job-edit-update-due').value;
    const liveDate = $('job-edit-live').value;  // Now a month string from dropdown
    const message = $('job-edit-message').value.trim();
    const withClient = $('job-edit-with-client').checked;
    const description = $('job-edit-description').value.trim();
    const projectOwner = $('job-edit-owner').value;
    
    // Validation: if posting an update, must set next update due date
    const originalDue = formatDateForInput(currentEditJob.updateDue);
    if (message && message !== currentEditJob.update && (!updateDue || updateDue === originalDue)) {
        showToast("When's the update due?", 'error');
        $('job-edit-update-due').focus();
        return;
    }
    
    btn.disabled = true;
    btn.textContent = 'Updating...';
    
    // Build payload for Hub's unified update endpoint
    const authorName = state.currentUser?.firstName || state.currentUser?.name || 'Dot';
    const payload = { status, withClient, author: authorName };
    if (updateDue) payload.updateDue = updateDue;
    if (liveDate) payload.liveDate = liveDate;
    if (message && message !== currentEditJob.update) payload.message = message;
    if (description !== currentEditJob.description) payload.description = description;
    if (projectOwner !== currentEditJob.projectOwner) payload.projectOwner = projectOwner;
    
    try {
        // Single call to Hub - handles both Projects update and Updates record creation
        const response = await fetch(`${API_BASE}/job/${encodeURIComponent(jobNumber)}/update`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) throw new Error('Update failed');
        
        // Also post to Teams if there's a new message
        if (message && message !== currentEditJob.update) {
            fetch(`${PROXY_BASE}/proxy/update`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    clientCode: jobNumber.split(' ')[0],
                    jobNumber,
                    message
                })
            }).catch(e => console.log('Teams post failed:', e));
        }
        
        // Update local state
        const job = state.allJobs.find(j => j.jobNumber === jobNumber);
        if (job) {
            job.status = status;
            job.withClient = withClient;
            if (updateDue) job.updateDue = updateDue;
            if (liveDate) job.liveDate = liveDate;
            if (message) job.update = message;
            if (description) job.description = description;
            if (projectOwner) job.projectOwner = projectOwner;
        }
        
        showToast('Job updated.', 'success');
        btn.textContent = 'UPDATE';
        btn.disabled = false;
        closeJobModal();

        // Refresh thread if we're in the Job Bag and a message was posted
        if (message && message !== currentEditJob.update && currentBagJob?.jobNumber === jobNumber) {
            loadJobBagUpdates(jobNumber);
        }

        // Refresh WIP if visible
        if (state.currentView === 'wip') {
            renderWip();
        }
        
    } catch (e) {
        console.error('Save failed:', e);
        showToast("Hmm, that didn't work.", 'error');
        btn.textContent = 'UPDATE';
        btn.disabled = false;
    }
}

// Make modal functions global
window.openJobModal = openJobModal;
window.closeJobModal = closeJobModal;
window.openJobSummary = openJobSummary;
window.closeJobSummary = closeJobSummary;
window.openJobDetail = openJobDetail;
window.openJobBag = openJobBag;
window.closeJobBag = closeJobBag;
window.saveJobUpdate = saveJobUpdate;
window.openJobNameModal = openJobNameModal;
window.closeJobNameModal = closeJobNameModal;
window.saveJobName = saveJobName;

// ===== JOB NAME EDIT MODAL =====
function openJobNameModal() {
    if (!currentEditJob) return;
    
    $('job-edit-number').value = currentEditJob.jobNumber;
    $('job-edit-job-name').value = currentEditJob.jobName || '';
    $('job-name-modal').classList.add('visible');
}

function closeJobNameModal() {
    $('job-name-modal')?.classList.remove('visible');
}

async function saveJobName() {
    if (!currentEditJob) return;
    
    const newJobNumber = $('job-edit-number').value.trim();
    const newJobName = $('job-edit-job-name').value.trim();
    
    if (!newJobNumber || !newJobName) {
        showToast("Hmm, that didn't work.", 'error');
        return;
    }
    
    try {
        const jobNumber = currentEditJob.jobNumber;
        const payload = {
            projectName: newJobName
        };
        
        // Only include job number change if it's different
        if (newJobNumber !== jobNumber) {
            payload.newJobNumber = newJobNumber;
        }
        
        const response = await fetch(`${API_BASE}/job/${encodeURIComponent(jobNumber)}/update`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) throw new Error('Update failed');
        
        // Update local state
        const job = state.allJobs.find(j => j.jobNumber === currentEditJob.jobNumber);
        if (job) {
            job.jobName = newJobName;
            if (newJobNumber !== currentEditJob.jobNumber) {
                job.jobNumber = newJobNumber;
            }
        }
        
        // Update the main modal title
        $('job-modal-title').textContent = `${newJobNumber} | ${newJobName}`;
        currentEditJob.jobNumber = newJobNumber;
        currentEditJob.jobName = newJobName;
        
        closeJobNameModal();
        showToast('Job updated.', 'success');
        
        // Refresh WIP if visible
        if (state.currentView === 'wip') {
            renderWip();
        }
        
    } catch (e) {
        console.error('Save job name failed:', e);
        showToast("Hmm, that didn't work.", 'error');
    }
}

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
    
    // Add client options
    let selectedText = 'All Clients';
    state.allClients.forEach(c => {
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
        showLoadingModal('Grabbing all your jobs...');
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
    
    state.allClients.forEach(c => {
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
        showLoadingModal('Grabbing all your jobs...');
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
            html += `<div class="empty-section"><img src="images/dot-sitting.png" alt="Dot"><span>Nothing to see here</span></div>`;
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
// (Keeping tracker code as-is since it's separate from Ask Dot)

let trackerClients = {};
let trackerData = [];
let trackerCurrentMonth = 'January';
let trackerIsQuarterView = false;
let trackerCurrentEditData = null;

const calendarQuarters = {
    'Q1-cal': { months: ['January', 'February', 'March'], label: 'Jan > Mar' },
    'Q2-cal': { months: ['April', 'May', 'June'], label: 'Apr > Jun' },
    'Q3-cal': { months: ['July', 'August', 'September'], label: 'Jul > Sep' },
    'Q4-cal': { months: ['October', 'November', 'December'], label: 'Oct > Dec' }
};

const currentCalendarQuarter = (() => {
    const month = new Date().getMonth(); // 0-11
    if (month <= 2) return 'Q1-cal';
    if (month <= 5) return 'Q2-cal';
    if (month <= 8) return 'Q3-cal';
    return 'Q4-cal';
})();

const clientQuarterLabels = {
    'ONE': 'Q4', 'ONS': 'Q4', 'ONB': 'Q4',
    'SKY': 'Q3', 'TOW': 'Q2', 'FIS': 'Q4'
};

const fallbackTrackerClients = [
    { code: 'ONS', name: 'One NZ - Simplification', committed: 25000, rollover: 0, rolloverUseIn: '', yearEnd: 'March', currentQuarter: 'Q4' },
    { code: 'ONE', name: 'One NZ - Marketing', committed: 12500, rollover: 2400, rolloverUseIn: 'JAN-MAR', yearEnd: 'March', currentQuarter: 'Q4' },
    { code: 'ONB', name: 'One NZ - Business', committed: 12500, rollover: 0, rolloverUseIn: '', yearEnd: 'March', currentQuarter: 'Q4' },
    { code: 'SKY', name: 'Sky', committed: 10000, rollover: 0, rolloverUseIn: '', yearEnd: 'June', currentQuarter: 'Q3' },
    { code: 'TOW', name: 'Tower', committed: 10000, rollover: 1500, rolloverUseIn: 'JAN-MAR', yearEnd: 'September', currentQuarter: 'Q2' },
    { code: 'FIS', name: 'Fisher Funds', committed: 4500, rollover: 500, rolloverUseIn: 'JAN-MAR', yearEnd: 'March', currentQuarter: 'Q4' }
];

function formatTrackerCurrency(amount) {
    if (Math.abs(amount) >= 1000) {
        return '$' + (amount / 1000).toFixed(Math.abs(amount) % 1000 === 0 ? 0 : 1) + 'K';
    }
    return '$' + Math.abs(amount).toLocaleString();
}

function getQuarterForMonth(month) {
    for (const key in calendarQuarters) {
        if (calendarQuarters[key].months.includes(month)) return key;
    }
    return currentCalendarQuarter;
}

function getQuarterInfoForMonth(clientCode, month) {
    const calQ = getQuarterForMonth(month);
    const quarter = calendarQuarters[calQ];
    const calQNum = parseInt(calQ.replace('Q', '').replace('-cal', ''));
    const clientCurrentCalQ = parseInt(currentCalendarQuarter.replace('Q', '').replace('-cal', ''));
    const clientCurrentLabel = parseInt(clientQuarterLabels[clientCode]?.replace('Q', '') || '1');
    let clientQNum = clientCurrentLabel + (calQNum - clientCurrentCalQ);
    if (clientQNum > 4) clientQNum -= 4;
    if (clientQNum < 1) clientQNum += 4;
    return { quarter: 'Q' + clientQNum, months: quarter.months, label: quarter.label };
}

function getCurrentQuarterInfo(clientCode) {
    const quarter = calendarQuarters[currentCalendarQuarter];
    const clientLabel = clientQuarterLabels[clientCode] || 'Q1';
    return { quarter: clientLabel, months: quarter.months, label: quarter.label };
}

function getPreviousQuarter(clientCode) {
    const quarter = calendarQuarters['Q4-cal'];
    const clientCurrentQ = parseInt((clientQuarterLabels[clientCode] || 'Q1').replace('Q', ''));
    const prevQ = clientCurrentQ === 1 ? 'Q4' : 'Q' + (clientCurrentQ - 1);
    return { quarter: prevQ, months: quarter.months, label: quarter.label };
}

function getTrackerMonthSpend(client, month) {
    return trackerData.filter(d => d.client === client && d.month === month && d.spendType === 'Project budget').reduce((sum, d) => sum + d.spend, 0);
}

function getTrackerProjectsForMonth(client, month) {
    return trackerData.filter(d => d.client === client && d.month === month);
}

async function loadTrackerClients() {
    try {
        const response = await fetch(`${API_BASE}/tracker/clients`);
        if (!response.ok) throw new Error('API returned ' + response.status);
        const data = await response.json();
        populateTrackerClients(data);
        return true;
    } catch (e) {
        console.log('Using fallback tracker clients');
        populateTrackerClients(fallbackTrackerClients);
        return true;
    }
}

function populateTrackerClients(data) {
    trackerClients = {};
    
    // If user has client filter, only show their client
    let filteredData = data;
    if (state.clientFilter) {
        filteredData = data.filter(c => c.code === state.clientFilter);
    }
    
    filteredData.forEach(c => {
        trackerClients[c.code] = {
            name: c.name,
            committed: c.committed,
            quarterlyCommitted: c.committed * 3,
            rollover: c.rollover || 0,
            rolloverUseIn: c.rolloverUseIn || '',
            yearEnd: c.yearEnd,
            currentQuarter: c.currentQuarter
        };
    });
    
    const menu = $('tracker-client-menu');
    const trigger = $('tracker-client-trigger');
    if (!menu || !trigger) return;
    
    // If user has client filter, lock the dropdown
    if (state.clientFilter && filteredData.length > 0) {
        const client = filteredData[0];
        trigger.querySelector('span').textContent = client.name;
        trigger.style.pointerEvents = 'none'; // Disable dropdown
        trigger.querySelector('svg')?.classList.add('hidden'); // Hide chevron
        state.trackerClient = client.code;
        return;
    }
    
    menu.innerHTML = '';
    
    // Check if we already have a client set (from deep link)
    const presetClient = state.trackerClient;
    const lastClient = presetClient || localStorage.getItem('trackerLastClient');
    let defaultClient = null;
    let defaultName = '';
    
    filteredData.forEach((c, idx) => {
        const option = document.createElement('div');
        const isDefault = lastClient ? (c.code === lastClient) : (idx === 0);
        option.className = 'custom-dropdown-option' + (isDefault ? ' selected' : '');
        option.dataset.value = c.code;
        option.textContent = c.name;
        menu.appendChild(option);
        if (isDefault) { defaultClient = c.code; defaultName = c.name; }
    });
    
    if (defaultClient) {
        state.trackerClient = defaultClient;
        trigger.querySelector('span').textContent = defaultName;
    } else if (filteredData.length > 0) {
        state.trackerClient = filteredData[0].code;
        trigger.querySelector('span').textContent = filteredData[0].name;
    }
}

async function loadTrackerData(clientCode) {
    try {
        const response = await fetch(`${API_BASE}/tracker/data?client=${clientCode}`);
        if (!response.ok) throw new Error('API returned ' + response.status);
        const data = await response.json();
        trackerData = data.map(d => ({
            id: d.id, client: d.client, jobNumber: d.jobNumber, projectName: d.projectName,
            owner: d.owner, description: d.description, spend: d.spend, month: d.month,
            spendType: d.spendType, ballpark: d.ballpark
        }));
        return true;
    } catch (e) {
        console.log('Using empty tracker data for:', clientCode);
        trackerData = [];
        return true;
    }
}

function setupTrackerDropdowns() {
    setupTrackerDropdown('tracker-client-trigger', 'tracker-client-menu', async (value) => {
        state.trackerClient = value;
        localStorage.setItem('trackerLastClient', value);
        $('tracker-content').style.opacity = '0.5';
        await loadTrackerData(value);
        $('tracker-content').style.opacity = '1';
        renderTrackerContent();
    });
    
    setupTrackerDropdown('tracker-month-trigger', 'tracker-month-menu', (value) => {
        trackerCurrentMonth = value;
        renderTrackerContent();
    });
    
    // Sync month dropdown display with current value (for deep links)
    const monthTrigger = $('tracker-month-trigger');
    const monthMenu = $('tracker-month-menu');
    if (monthTrigger && monthMenu && trackerCurrentMonth) {
        const opt = monthMenu.querySelector(`[data-value="${trackerCurrentMonth}"]`);
        if (opt) {
            monthMenu.querySelectorAll('.custom-dropdown-option').forEach(o => o.classList.remove('selected'));
            opt.classList.add('selected');
            monthTrigger.querySelector('span').textContent = opt.textContent;
        }
    }
    
    const toggle = $('tracker-mode-switch');
    const labelMonth = $('tracker-mode-spend');
    const labelQuarter = $('tracker-mode-pipeline');
    
    // Sync quarter toggle with current value (for deep links)
    if (toggle) {
        toggle.checked = trackerIsQuarterView;
        labelMonth?.classList.toggle('active', !trackerIsQuarterView);
        labelQuarter?.classList.toggle('active', trackerIsQuarterView);
    }
    
    if (toggle) {
        toggle.addEventListener('change', function() {
            trackerIsQuarterView = this.checked;
            labelMonth?.classList.toggle('active', !trackerIsQuarterView);
            labelQuarter?.classList.toggle('active', trackerIsQuarterView);
            renderTrackerContent();
        });
    }
    
    labelMonth?.addEventListener('click', () => {
        if (toggle) toggle.checked = false;
        trackerIsQuarterView = false;
        labelMonth.classList.add('active');
        labelQuarter?.classList.remove('active');
        renderTrackerContent();
    });
    
    labelQuarter?.addEventListener('click', () => {
        if (toggle) toggle.checked = true;
        trackerIsQuarterView = true;
        labelMonth?.classList.remove('active');
        labelQuarter.classList.add('active');
        renderTrackerContent();
    });
}

function setupTrackerDropdown(triggerId, menuId, onChange) {
    const trigger = $(triggerId);
    const menu = $(menuId);
    if (!trigger || !menu) return;
    
    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        $$('.custom-dropdown-menu.open').forEach(m => {
            if (m.id !== menuId) { m.classList.remove('open'); m.previousElementSibling?.classList.remove('open'); }
        });
        trigger.classList.toggle('open');
        menu.classList.toggle('open');
    });
    
    menu.querySelectorAll('.custom-dropdown-option').forEach(opt => {
        opt.addEventListener('click', function() {
            const value = this.dataset.value;
            menu.querySelectorAll('.custom-dropdown-option').forEach(o => o.classList.remove('selected'));
            this.classList.add('selected');
            trigger.querySelector('span').textContent = this.textContent;
            trigger.classList.remove('open');
            menu.classList.remove('open');
            if (onChange) onChange(value);
        });
    });
}

async function renderTracker() {
    const content = $('tracker-content');
    if (!content) return;
    
    // Show loading modal and clear content
    content.innerHTML = '';
    showLoadingModal('Digging for the numbers...');
    
    if (Object.keys(trackerClients).length === 0) {
        await loadTrackerClients();
    }
    
    if (state.trackerClient) {
        await loadTrackerData(state.trackerClient);
    }
    
    // Hide loading modal once data is ready
    hideLoadingModal();
    
    setupTrackerDropdowns();
    renderTrackerContent();
}

function renderTrackerContent() {
    const content = $('tracker-content');
    if (!content || !state.trackerClient) return;
    
    const client = trackerClients[state.trackerClient];
    if (!client) {
        content.innerHTML = `<div class="empty-section"><img src="images/dot-sitting.png" alt="Dot"><span>Select a client to view tracker</span></div>`;
        return;
    }
    
    const committed = client.committed;
    const rollover = client.rollover || 0;
    const rolloverUseIn = client.rolloverUseIn || '';
    const qInfo = getQuarterInfoForMonth(state.trackerClient, trackerCurrentMonth);
    const prevQ = getPreviousQuarter(state.trackerClient);
    
    const labelMap = { 'Jan > Mar': 'JAN-MAR', 'Apr > Jun': 'APR-JUN', 'Jul > Sep': 'JUL-SEP', 'Oct > Dec': 'OCT-DEC' };
    const viewedQuarterKey = labelMap[qInfo.label] || '';
    
    let toDate, projects, monthsInQuarter;
    if (trackerIsQuarterView) {
        toDate = qInfo.months.reduce((sum, m) => sum + getTrackerMonthSpend(state.trackerClient, m), 0);
        projects = trackerData.filter(d => d.client === state.trackerClient && qInfo.months.includes(d.month));
        monthsInQuarter = qInfo.months.length;
    } else {
        toDate = getTrackerMonthSpend(state.trackerClient, trackerCurrentMonth);
        projects = getTrackerProjectsForMonth(state.trackerClient, trackerCurrentMonth);
        monthsInQuarter = 1;
    }
    
    const totalBudget = committed * monthsInQuarter;
    const remaining = totalBudget - toDate;
    const progress = totalBudget > 0 ? Math.min((toDate / totalBudget) * 100, 100) : 0;
    const isOver = toDate > totalBudget;
    const showRollover = rollover > 0 && rolloverUseIn && viewedQuarterKey === rolloverUseIn;
    
    const mainProjects = projects.filter(p => p.spendType === 'Project budget');
    const otherProjects = projects.filter(p => p.spendType === 'Extra budget' || p.spendType === 'Project on us');
    
    const groupProjects = (arr) => {
        if (!trackerIsQuarterView) return arr;
        const grouped = {};
        arr.forEach(p => {
            const key = p.jobNumber + '|' + p.projectName;
            if (!grouped[key]) grouped[key] = { ...p, spend: 0, _isGrouped: true };
            grouped[key].spend += p.spend;
        });
        return Object.values(grouped);
    };
    
    const displayMainProjects = groupProjects(mainProjects).sort((a, b) => {
        const aNum = a.jobNumber.split(' ')[1] || '';
        const bNum = b.jobNumber.split(' ')[1] || '';
        if (aNum === '000') return 1;
        if (bNum === '000') return -1;
        return 0;
    });
    const displayOtherProjects = groupProjects(otherProjects);
    
    const spendToDate = {};
    if (!trackerIsQuarterView) {
        const monthOrder = ['October', 'November', 'December', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September'];
        const currentMonthIndex = monthOrder.indexOf(trackerCurrentMonth);
        
        trackerData.forEach(d => {
            const dataMonthIndex = monthOrder.indexOf(d.month);
            if (dataMonthIndex !== -1 && currentMonthIndex !== -1 && dataMonthIndex < currentMonthIndex) {
                spendToDate[d.jobNumber] = (spendToDate[d.jobNumber] || 0) + d.spend;
            }
        });
    }
    
    const numbersTitle = trackerIsQuarterView ? `${qInfo.quarter} Numbers` : `${trackerCurrentMonth} Numbers`;
    const amountHeader = trackerIsQuarterView ? `${qInfo.quarter} Total` : trackerCurrentMonth;
    
    content.innerHTML = `
        <div class="tracker-inner">
            <div class="section-title"><span>${numbersTitle}</span> <span class="quarter-context">${qInfo.quarter} (${qInfo.label})</span></div>
            <div class="numbers-section">
                <div class="numbers-grid">
                    <div class="stat-box">
                        <div class="stat-value grey">${formatTrackerCurrency(committed * monthsInQuarter)}</div>
                        <div class="stat-label">Committed</div>
                    </div>
                    <div class="stat-box">
                        <div class="stat-value">${formatTrackerCurrency(toDate)}</div>
                        <div class="stat-label">To Date</div>
                    </div>
                    <div class="stat-box">
                        <div class="stat-value ${isOver ? 'orange' : 'red'}">${isOver ? '-' : ''}${formatTrackerCurrency(Math.abs(remaining))}</div>
                        <div class="stat-label">To Spend</div>
                    </div>
                </div>
                <div class="tracker-progress-bar">
                    <div class="tracker-progress-fill ${isOver ? 'over' : ''}" style="width: ${progress}%"></div>
                </div>
                ${showRollover ? `
                    <div class="rollover-credit">
                        <div class="rollover-label">Rollover</div>
                        <div class="rollover-amount"><strong>+${formatTrackerCurrency(rollover)}</strong> credit from ${prevQ.quarter}</div>
                    </div>
                ` : ''}
            </div>
            
            <div class="section-title">The Work</div>
            <div class="projects-section">
                <table class="projects-table">
                    <thead>
                        <tr>
                            <th class="chevron-col"></th>
                            <th class="project-col">Project Name</th>
                            <th class="owner-col">Owner</th>
                            <th>Description</th>
                            ${!trackerIsQuarterView ? '<th class="amount-col">To Date</th>' : ''}
                            <th class="amount-col">${amountHeader}</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${displayMainProjects.length === 0 ? `
                            <tr><td colspan="${trackerIsQuarterView ? 5 : 6}" style="text-align:center;color:var(--grey-400);padding:24px;">No projects for ${trackerIsQuarterView ? qInfo.quarter : trackerCurrentMonth}</td></tr>
                        ` : displayMainProjects.map(p => {
                            const jobNum = p.jobNumber.split(' ')[1] || '';
                            const showToDateCol = !trackerIsQuarterView && jobNum !== '000' && jobNum !== '001' && (spendToDate[p.jobNumber] || 0) > 0;
                            const chevronDisabled = p._isGrouped ? 'style="color:var(--grey-200);cursor:default;"' : '';
                            return `
                                <tr>
                                    <td class="chevron-cell"><button class="chevron-btn" ${chevronDisabled} onclick="${p._isGrouped ? '' : `openTrackerDetail('${p.jobNumber}', '${trackerCurrentMonth}')`}">${ICON_CHEVRON_RIGHT}</button></td>
                                    <td class="project-name">${p.jobNumber}  -  ${p.projectName}</td>
                                    <td>${p.owner || ''}</td>
                                    <td>${p.description || ''}</td>
                                    ${!trackerIsQuarterView ? `<td class="amount" style="color:var(--grey-400);font-weight:normal;">${showToDateCol ? '(' + formatTrackerCurrency(spendToDate[p.jobNumber]) + ')' : ''}</td>` : ''}
                                    <td class="amount ${p.ballpark ? 'ballpark' : ''}">${formatTrackerCurrency(p.spend)}</td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
            
            ${displayOtherProjects.length > 0 ? `
                <div class="section-title">Other Stuff</div>
                <div class="projects-section">
                    <table class="projects-table">
                        <thead>
                            <tr>
                                <th class="chevron-col"></th>
                                <th class="project-col">Project Name</th>
                                <th class="owner-col">Owner</th>
                                <th>Description</th>
                                ${!trackerIsQuarterView ? '<th class="amount-col">To Date</th>' : ''}
                                <th class="amount-col">${amountHeader}</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${displayOtherProjects.map(p => {
                                const jobNum = p.jobNumber.split(' ')[1] || '';
                                const showToDateCol = !trackerIsQuarterView && jobNum !== '000' && jobNum !== '001' && (spendToDate[p.jobNumber] || 0) > 0;
                                const chevronDisabled = p._isGrouped ? 'style="color:var(--grey-200);cursor:default;"' : '';
                                return `
                                    <tr>
                                        <td class="chevron-cell"><button class="chevron-btn" ${chevronDisabled} onclick="${p._isGrouped ? '' : `openTrackerDetail('${p.jobNumber}', '${trackerCurrentMonth}')`}">${ICON_CHEVRON_RIGHT}</button></td>
                                        <td class="project-name">${p.jobNumber}  -  ${p.projectName}</td>
                                        <td>${p.owner || ''}</td>
                                        <td>${p.description || ''}</td>
                                        ${!trackerIsQuarterView ? `<td class="amount" style="color:var(--grey-400);font-weight:normal;">${showToDateCol ? '(' + formatTrackerCurrency(spendToDate[p.jobNumber]) + ')' : ''}</td>` : ''}
                                        <td class="amount">${formatTrackerCurrency(p.spend)}</td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            ` : ''}
            
            <div class="tracker-bottom-row">
                <div>
                    <div class="section-title">Tracker</div>
                    <div class="chart-section">
                        <div class="chart-wrapper">
                            <div class="y-axis" id="tracker-y-axis"></div>
                            <div class="committed-line" id="tracker-committed-line"></div>
                            <div class="chart-container" id="tracker-chart-container"></div>
                        </div>
                        <div class="chart-legend">
                            <div class="legend-item"><div class="legend-swatch projects"></div><span>Projects</span></div>
                            <div class="legend-item"><div class="legend-swatch committed-swatch"></div><span>Committed</span></div>
                            <div class="legend-item"><div class="legend-swatch incoming-swatch"></div><span>Ballpark</span></div>
                        </div>
                    </div>
                </div>
                <div>
                    <div class="section-title">Notes</div>
                    <div class="notes-section">
                        <ul class="notes-list">
                            <li><strong>Ballparks</strong> - Red numbers are ballparks. Most jobs start as a $5K ballpark before we lock in scope.</li>
                            <li><strong>Rollover</strong> - You can use your rollover credit any time during the quarter. It's extra on top of committed spend.</li>
                        </ul>
                        <button class="pdf-btn" onclick="getTrackerPDF()">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                <polyline points="14 2 14 8 20 8"></polyline>
                                <line x1="12" y1="18" x2="12" y2="12"></line>
                                <line x1="9" y1="15" x2="15" y2="15"></line>
                            </svg>
                            Get PDF
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    setTimeout(renderTrackerChart, 0);
    setupTrackerModalListeners();
}

function renderTrackerChart() {
    const client = trackerClients[state.trackerClient];
    if (!client) return;
    
    const committed = client.committed;
    const qInfo = getCurrentQuarterInfo(state.trackerClient);
    const prevQ = getPreviousQuarter(state.trackerClient);
    const chartHeight = 160;
    const yMax = committed + 10000;
    
    const prevSpends = prevQ.months.map(m => 
        trackerData.filter(d => d.client === state.trackerClient && d.month === m && d.spendType === 'Project budget')
            .reduce((sum, d) => sum + d.spend, 0)
    );
    
    const currentConfirmed = [], currentBallpark = [];
    qInfo.months.forEach(m => {
        const monthProjects = trackerData.filter(d => d.client === state.trackerClient && d.month === m && d.spendType === 'Project budget');
        currentConfirmed.push(monthProjects.filter(d => !d.ballpark).reduce((sum, d) => sum + d.spend, 0));
        currentBallpark.push(monthProjects.filter(d => d.ballpark).reduce((sum, d) => sum + d.spend, 0));
    });
    
    const yAxis = $('tracker-y-axis');
    if (yAxis) {
        yAxis.innerHTML = '';
        for (let i = 5; i >= 0; i--) {
            const label = document.createElement('span');
            label.className = 'y-label';
            label.textContent = '$' + Math.round(yMax * i / 5 / 1000) + 'k';
            yAxis.appendChild(label);
        }
    }
    
    const greyBarHeight = chartHeight - (10000 / yMax * chartHeight);
    const committedLine = $('tracker-committed-line');
    if (committedLine) {
        committedLine.style.bottom = (greyBarHeight + 20) + 'px';
        committedLine.style.top = 'auto';
    }
    
    const container = $('tracker-chart-container');
    if (!container) return;
    container.innerHTML = '';
    
    const prevMonthLabels = prevQ.months.map(m => m.substring(0, 3));
    const currMonthLabels = qInfo.months.map(m => m.substring(0, 3));
    const today = new Date();
    const currentMonthName = today.toLocaleString('en-US', { month: 'long' });
    const currentMonthIndex = qInfo.months.indexOf(currentMonthName);
    
    prevMonthLabels.forEach((label, i) => {
        const group = document.createElement('div');
        group.className = 'bar-group';
        const barStack = document.createElement('div');
        barStack.className = 'bar-stack';
        barStack.style.height = greyBarHeight + 'px';
        
        const greyBar = document.createElement('div');
        greyBar.className = 'bar-committed';
        greyBar.style.height = '100%';
        greyBar.title = 'Committed: ' + formatTrackerCurrency(committed);
        barStack.appendChild(greyBar);
        
        const redBar = document.createElement('div');
        redBar.className = 'bar-spend';
        redBar.style.height = (prevSpends[i] / committed * 100) + '%';
        redBar.title = 'Actual: ' + formatTrackerCurrency(prevSpends[i]);
        barStack.appendChild(redBar);
        
        const labelEl = document.createElement('span');
        labelEl.className = 'bar-label';
        labelEl.textContent = label;
        
        group.appendChild(barStack);
        group.appendChild(labelEl);
        container.appendChild(group);
    });
    
    currMonthLabels.forEach((label, i) => {
        const group = document.createElement('div');
        group.className = 'bar-group';
        const barStack = document.createElement('div');
        barStack.className = 'bar-stack';
        barStack.style.height = greyBarHeight + 'px';
        
        const isFuture = currentMonthIndex !== -1 && i > currentMonthIndex;
        
        const greyBar = document.createElement('div');
        greyBar.className = isFuture ? 'bar-committed future' : 'bar-committed';
        greyBar.style.height = '100%';
        greyBar.title = 'Committed: ' + formatTrackerCurrency(committed);
        barStack.appendChild(greyBar);
        
        const confirmedSpend = currentConfirmed[i] || 0;
        if (!isFuture && confirmedSpend > 0) {
            const redBar = document.createElement('div');
            redBar.className = 'bar-spend';
            redBar.style.height = (confirmedSpend / committed * 100) + '%';
            redBar.title = 'Actual: ' + formatTrackerCurrency(confirmedSpend);
            barStack.appendChild(redBar);
        }
        
        const ballparkSpend = currentBallpark[i] || 0;
        if (ballparkSpend > 0) {
            const dashedBar = document.createElement('div');
            dashedBar.className = 'bar-ballpark';
            dashedBar.style.height = (ballparkSpend / committed * 100) + '%';
            dashedBar.style.bottom = (!isFuture && confirmedSpend > 0) ? (confirmedSpend / committed * 100) + '%' : '0';
            dashedBar.title = 'Ballpark: ' + formatTrackerCurrency(ballparkSpend);
            barStack.appendChild(dashedBar);
        }
        
        const labelEl = document.createElement('span');
        labelEl.className = 'bar-label';
        labelEl.textContent = label;
        
        group.appendChild(barStack);
        group.appendChild(labelEl);
        container.appendChild(group);
    });
}

function setupTrackerModalListeners() {
    const modal = $('tracker-edit-modal');
    const ballparkToggle = $('tracker-edit-ballpark');
    
    if (modal) {
        modal.addEventListener('click', (e) => { if (e.target === modal) closeTrackerModal(); });
    }
    
    if (ballparkToggle) {
        ballparkToggle.addEventListener('change', function() {
            updateTrackerBallparkUI(this.checked);
        });
    }
}

function updateTrackerBallparkUI(isBallpark) {
    const modal = document.querySelector('.tracker-modal');
    const label = $('tracker-ballpark-label');
    if (isBallpark) {
        modal?.classList.add('ballpark-active');
        label?.classList.add('active');
    } else {
        modal?.classList.remove('ballpark-active');
        label?.classList.remove('active');
    }
}

function openTrackerEditModal(jobNumber, month) {
    const project = trackerData.find(p => p.jobNumber === jobNumber && p.month === month) ||
                    trackerData.find(p => p.jobNumber === jobNumber);

    if (!project) {
        showToast('No tracker entry found for this job.', 'error');
        return;
    }

    trackerCurrentEditData = project;

    $('tracker-modal-title').textContent = 'Update ' + jobNumber;
    $('tracker-edit-name').value = project.projectName;
    $('tracker-edit-description').value = project.description || '';
    $('tracker-edit-spend').value = project.spend;
    $('tracker-edit-month').value = project.month;
    $('tracker-edit-spendtype').value = project.spendType;

    // Stage — read from allJobs state
    const job = state.allJobs?.find(j => j.jobNumber === jobNumber);
    const stageEl = $('tracker-edit-stage');
    if (stageEl) stageEl.value = job?.stage || 'Triage';

    const isBallpark = project.ballpark || false;
    $('tracker-edit-ballpark').checked = isBallpark;
    updateTrackerBallparkUI(isBallpark);

    $('tracker-edit-modal')?.classList.add('visible');
}

// Helper: open the right modal for Tracker based on access level
function openTrackerDetail(jobNumber, month) {
    if (state.currentUser?.accessLevel === 'Full') {
        openTrackerEditModal(jobNumber, month);
    } else {
        openJobSummary(jobNumber);
    }
}

function closeTrackerModal() {
    $('tracker-edit-modal')?.classList.remove('visible');
    document.querySelector('.tracker-modal')?.classList.remove('ballpark-active');
    const saveBtn = $('tracker-save-btn');
    if (saveBtn) { saveBtn.textContent = 'Save Changes'; saveBtn.disabled = false; }
    trackerCurrentEditData = null;
}

async function saveTrackerProject() {
    if (!trackerCurrentEditData) return;
    
    const updates = {
        id: trackerCurrentEditData.id,
        jobNumber: trackerCurrentEditData.jobNumber,
        description: $('tracker-edit-description').value,
        spend: parseFloat($('tracker-edit-spend').value) || 0,
        month: $('tracker-edit-month').value,
        spendType: $('tracker-edit-spendtype').value,
        ballpark: $('tracker-edit-ballpark').checked,
        stage: $('tracker-edit-stage')?.value || 'Triage'
    };
    
    const saveBtn = $('tracker-save-btn');
    if (saveBtn) { saveBtn.textContent = 'Saving...'; saveBtn.disabled = true; }
    
    try {
        const response = await fetch(`${API_BASE}/tracker/update`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        });
        
        if (!response.ok) throw new Error('Failed to save');
        
        Object.assign(trackerCurrentEditData, updates);
        closeTrackerModal();
        
        await loadTrackerData(state.trackerClient);
        renderTrackerContent();
        showToast('On it.', 'success');
        
    } catch (e) {
        console.error('Save failed:', e);
        showToast("Doh, that didn't work.", 'error');
        if (saveBtn) { saveBtn.textContent = 'Save Changes'; saveBtn.disabled = false; }
    }
}

function getTrackerPDF() {
    const url = `https://dot-tracker-pdf.up.railway.app/pdf?client=${state.trackerClient}&month=${trackerCurrentMonth}${trackerIsQuarterView ? '&quarter=true' : ''}`;
    window.open(url, '_blank');
}

// ===== NEW JOB MODAL =====
let newJobState = {
    clientCode: null,
    clientName: null,
    jobNumber: null,
    owner: '',
    status: 'Incoming',
    ballpark: '5000',
    live: 'Tbc'
};

// Helper to set dropdown value
function setNewJobDropdown(id, value, label) {
    const trigger = $(`new-job-${id}-trigger`);
    const menu = $(`new-job-${id}-menu`);
    if (trigger) trigger.querySelector('span').textContent = label || value;
    if (menu) {
        menu.querySelectorAll('.custom-dropdown-option').forEach(opt => {
            opt.classList.toggle('selected', opt.dataset.value === value);
        });
    }
}

// Helper to get dropdown value
function getNewJobDropdownValue(id) {
    const menu = $(`new-job-${id}-menu`);
    if (!menu) return '';
    const selected = menu.querySelector('.custom-dropdown-option.selected');
    return selected ? selected.dataset.value : '';
}

// Toggle dropdown open/close
function toggleNewJobDropdown(id) {
    const dropdown = $(`new-job-${id}-dropdown`);
    const trigger = $(`new-job-${id}-trigger`);
    const menu = $(`new-job-${id}-menu`);
    
    if (!dropdown || !trigger || !menu) return;
    
    const isOpen = menu.classList.contains('open');
    
    // Close all other dropdowns first
    document.querySelectorAll('.new-job-modal .custom-dropdown-menu.open').forEach(m => {
        m.classList.remove('open');
        m.previousElementSibling?.classList.remove('open');
    });
    
    if (!isOpen) {
        trigger.classList.add('open');
        menu.classList.add('open');
    }
}

// Select dropdown option
function selectNewJobOption(id, value, label) {
    const menu = $(`new-job-${id}-menu`);
    const trigger = $(`new-job-${id}-trigger`);
    
    // Update selected state
    menu.querySelectorAll('.custom-dropdown-option').forEach(opt => {
        opt.classList.toggle('selected', opt.dataset.value === value);
    });
    
    // Update trigger text
    trigger.querySelector('span').textContent = label;
    
    // Close dropdown
    trigger.classList.remove('open');
    menu.classList.remove('open');
    
    // Update state
    if (id === 'client') {
        newJobState.clientCode = value;
        newJobState.clientName = label;
        onClientSelected(value, label);
    } else if (id === 'owner') {
        newJobState.owner = value;
    } else if (id === 'status') {
        newJobState.status = value;
    } else if (id === 'ballpark') {
        newJobState.ballpark = value;
    } else if (id === 'live') {
        newJobState.live = value;
    }
}

// Close dropdowns when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.new-job-modal .custom-dropdown')) {
        document.querySelectorAll('.new-job-modal .custom-dropdown-menu.open').forEach(m => {
            m.classList.remove('open');
            m.previousElementSibling?.classList.remove('open');
        });
    }
});

async function openNewJobModal() {
    const modal = $('new-job-modal');
    if (!modal) return;
    
    // Reset state
    newJobState = { 
        clientCode: null, 
        clientName: null, 
        jobNumber: null,
        owner: '',
        status: 'Incoming',
        ballpark: '5000',
        live: 'Tbc'
    };
    
    // Reset form inputs
    $('new-job-name').value = '';
    $('new-job-description').value = '';
    $('new-job-with-client').checked = false;
    $('new-job-logo').src = 'images/logos/Unknown.png';
    $('new-job-number-wrapper').style.display = 'none';
    
    // Reset create button (in case previous attempt was interrupted)
    const createBtn = $('new-job-create-btn');
    if (createBtn) {
        createBtn.disabled = false;
        createBtn.textContent = 'CREATE JOB';
    }
    
    // Reset dropdowns
    $('new-job-client-trigger').querySelector('span').textContent = 'Select client...';
    $('new-job-client-menu').innerHTML = '<div class="custom-dropdown-option" style="color: var(--grey-400)">Loading...</div>';
    $('new-job-owner-trigger').querySelector('span').textContent = 'Select client first...';
    $('new-job-owner-menu').innerHTML = '';
    setNewJobDropdown('status', 'Incoming', 'Incoming');
    setNewJobDropdown('ballpark', '5000', '$5,000');
    setNewJobDropdown('live', 'Tbc', 'Tbc');
    
    // Set default update due (+5 working days)
    const updateDue = getWorkingDaysFromNow(5);
    $('new-job-update-due').value = updateDue;
    
    // Show form and confirmation hidden
    $('new-job-form').style.display = 'block';
    $('new-job-step-3').style.display = 'none';
    
    modal.classList.add('visible');
    
    // Load clients into dropdown
    try {
        const response = await fetch('/api/clients');
        const clients = await response.json();
        
        // Top clients to show first
        const topClientCodes = ['ONE', 'ONS', 'ONB', 'SKY', 'TOW', 'FIS', 'HUN'];
        const topClients = [];
        const otherClients = [];
        
        clients.forEach(c => {
            if (topClientCodes.includes(c.code)) {
                topClients.push(c);
            } else {
                otherClients.push(c);
            }
        });
        
        // Sort top clients by the order in topClientCodes
        topClients.sort((a, b) => topClientCodes.indexOf(a.code) - topClientCodes.indexOf(b.code));
        
        let html = '';
        
        // Add top clients
        topClients.forEach(c => {
            html += `<div class="custom-dropdown-option" data-value="${c.code}" onclick="selectNewJobOption('client', '${c.code}', '${c.name.replace(/'/g, "\\'")}')">${c.name}</div>`;
        });
        
        // Add other clients with header
        if (otherClients.length > 0) {
            html += '<div class="custom-dropdown-option section-header">Other</div>';
            otherClients.forEach(c => {
                html += `<div class="custom-dropdown-option" data-value="${c.code}" onclick="selectNewJobOption('client', '${c.code}', '${c.name.replace(/'/g, "\\'")}')">${c.name}</div>`;
            });
        }
        
        $('new-job-client-menu').innerHTML = html;
    } catch (err) {
        console.error('Error loading clients:', err);
        $('new-job-client-menu').innerHTML = '<div class="custom-dropdown-option" style="color: var(--red)">Failed to load</div>';
    }
    
    // Add click handlers for static dropdowns
    setupStaticDropdownHandlers();
}

function setupStaticDropdownHandlers() {
    // Status options
    $('new-job-status-menu').querySelectorAll('.custom-dropdown-option').forEach(opt => {
        opt.onclick = () => selectNewJobOption('status', opt.dataset.value, opt.textContent);
    });
    
    // Ballpark options
    $('new-job-ballpark-menu').querySelectorAll('.custom-dropdown-option').forEach(opt => {
        opt.onclick = () => selectNewJobOption('ballpark', opt.dataset.value, opt.textContent);
    });
    
    // Live options
    $('new-job-live-menu').querySelectorAll('.custom-dropdown-option').forEach(opt => {
        opt.onclick = () => selectNewJobOption('live', opt.dataset.value, opt.textContent);
    });
}

async function onClientSelected(code, name) {
    if (!code) {
        // Reset if no client selected
        newJobState.clientCode = null;
        newJobState.clientName = null;
        newJobState.jobNumber = null;
        $('new-job-logo').src = 'images/logos/Unknown.png';
        $('new-job-number-wrapper').style.display = 'none';
        $('new-job-owner-trigger').querySelector('span').textContent = 'Select client first...';
        $('new-job-owner-menu').innerHTML = '';
        return;
    }
    
    newJobState.clientCode = code;
    newJobState.clientName = name;
    
    // Update logo
    const logo = $('new-job-logo');
    logo.src = getLogoUrl(code);
    logo.onerror = function() { this.src = 'images/logos/Unknown.png'; };
    
    // Show number wrapper with loading state
    $('new-job-number').textContent = '...';
    $('new-job-number-wrapper').style.display = 'inline';
    
    // Preview job number
    try {
        const response = await fetch(`/api/preview-job-number/${code}`);
        const data = await response.json();
        
        if (data.error) {
            $('new-job-number').textContent = 'Error';
            console.error('Preview error:', data.error);
        } else {
            newJobState.jobNumber = data.previewJobNumber;
            $('new-job-number').textContent = data.previewJobNumber;
        }
    } catch (err) {
        console.error('Error previewing job number:', err);
        $('new-job-number').textContent = 'Error';
    }
    
    // Load owners for this client
    $('new-job-owner-trigger').querySelector('span').textContent = 'Loading...';
    $('new-job-owner-menu').innerHTML = '';
    
    try {
        const response = await fetch(`/api/people/${code}`);
        const people = await response.json();
        
        let html = `<div class="custom-dropdown-option" data-value="" onclick="selectNewJobOption('owner', '', 'Select...')">Select...</div>`;
        people.forEach(p => {
            html += `<div class="custom-dropdown-option" data-value="${p.name}" onclick="selectNewJobOption('owner', '${p.name.replace(/'/g, "\\'")}', '${p.name.replace(/'/g, "\\'")}')">${p.name}</div>`;
        });
        
        $('new-job-owner-menu').innerHTML = html;
        $('new-job-owner-trigger').querySelector('span').textContent = 'Select...';
        newJobState.owner = '';
    } catch (err) {
        console.error('Error loading owners:', err);
        $('new-job-owner-trigger').querySelector('span').textContent = 'Failed to load';
    }
}

async function submitNewJob() {
    // Prevent double submit
    const createBtn = $('new-job-create-btn');
    if (createBtn.disabled) return;
    
    // Validate client selected
    if (!newJobState.clientCode) {
        $('new-job-client-trigger').classList.add('input-error');
        setTimeout(() => $('new-job-client-trigger').classList.remove('input-error'), 2000);
        return;
    }
    
    // Validate job name
    const jobName = $('new-job-name').value.trim();
    if (!jobName) {
        $('new-job-name').focus();
        $('new-job-name').classList.add('input-error');
        setTimeout(() => $('new-job-name').classList.remove('input-error'), 2000);
        return;
    }
    
    createBtn.disabled = true;
    createBtn.textContent = 'CREATING...';
    
    // Show processing toast
    showToast('Setting up job...', 'info');
    
    // Get form values
    const description = $('new-job-description').value.trim();
    const ballpark = parseInt(newJobState.ballpark, 10);
    
    // Build brief object for Setup Worker
    // Map form fields → brief fields (Worker expects brief format from Claude extraction)
    // Form uses UI-friendly names, brief uses extraction schema names
    const brief = {
        jobName: jobName,           // same
        theJob: description || null, // form: description → brief: theJob
        owner: newJobState.owner || null,  // same
        costs: ballpark ? `$${ballpark.toLocaleString()}` : null,  // form: ballpark (number) → brief: costs (string)
        when: newJobState.live || null,    // form: live → brief: when
        updateDue: $('new-job-update-due').value || null  // same
    };
    
    // Build payload for Setup Worker
    const payload = {
        clientCode: newJobState.clientCode,
        clientName: newJobState.clientName,
        senderEmail: `${state.currentUser?.name?.toLowerCase() || 'hub'}@hunch.co.nz`,
        senderName: state.currentUser?.fullName || state.currentUser?.name || 'Hub User',
        subjectLine: `New job: ${jobName}`,
        brief: brief
    };
    
    try {
        // Call Setup Worker directly - it handles everything
        const response = await fetch('https://dot-workers.up.railway.app/setup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        const data = await response.json();
        
        if (!data.success) {
            alert('Error creating job: ' + (data.error || 'Unknown error'));
            createBtn.disabled = false;
            createBtn.textContent = 'CREATE JOB';
            return;
        }
        
        // Use the actual job number from the response
        const createdJobNumber = data.jobNumber;
        
        // Show confirmation
        const confirmLogo = $('new-job-confirm-logo');
        confirmLogo.src = getLogoUrl(newJobState.clientCode);
        confirmLogo.onerror = function() { this.src = 'images/logos/Unknown.png'; };
        $('new-job-confirm-title').textContent = createdJobNumber;
        $('new-job-confirm-text').textContent = 'Job created';
        
        // Show results summary
        const results = data.results || {};
        if (results.channel?.success) {
            $('new-job-confirm-subtext').textContent = 'Teams channel ready ✓';
            $('new-job-confirm-subtext').style.display = 'block';
        } else if (results.channel?.skipped) {
            $('new-job-confirm-subtext').textContent = 'Teams not configured for this client';
            $('new-job-confirm-subtext').style.display = 'block';
        } else {
            $('new-job-confirm-subtext').style.display = 'none';
        }
        
        $('new-job-form').style.display = 'none';
        $('new-job-step-3').style.display = 'block';
        
        // Refresh jobs list (don't let this fail the whole thing)
        try {
            await loadJobs();
        } catch (refreshErr) {
            console.error('Error refreshing jobs list:', refreshErr);
        }
        
    } catch (err) {
        console.error('Error creating job:', err);
        alert('Failed to create job. Please try again.');
        createBtn.disabled = false;
        createBtn.textContent = 'CREATE JOB';
    }
}

function closeNewJobModal() {
    $('new-job-modal')?.classList.remove('visible');
    newJobState = { clientCode: null, clientName: null, jobNumber: null, status: 'soon' };
}

function getWorkingDaysFromNow(days) {
    const date = new Date();
    let added = 0;
    while (added < days) {
        date.setDate(date.getDate() + 1);
        const dayOfWeek = date.getDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
            added++;
        }
    }
    return date.toISOString().split('T')[0];
}

// Close new job modal on overlay click
document.addEventListener('click', (e) => {
    if (e.target.id === 'new-job-modal') {
        closeNewJobModal();
    }
});

// Make new job functions globally available
window.openNewJobModal = openNewJobModal;
window.onClientSelected = onClientSelected;
window.toggleNewJobDropdown = toggleNewJobDropdown;
window.selectNewJobOption = selectNewJobOption;
window.submitNewJob = submitNewJob;
window.closeNewJobModal = closeNewJobModal;

// ===== COMING SOON MODAL =====
function showComingSoonModal(action) {
    const modal = $('coming-soon-modal');
    const text = $('coming-soon-text');
    if (!modal || !text) return;
    
    if (action === 'upload') {
        text.textContent = 'Uploads coming soon';
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

// ===== LOADING MODAL =====
function showLoadingModal(message = 'Loading...') {
    let overlay = $('loading-modal');
    
    // Create modal HTML if it doesn't exist
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
                <div class="loading-modal-text"></div>
            </div>
        `;
        document.body.appendChild(overlay);
    }
    
    // Set message and show
    overlay.querySelector('.loading-modal-text').textContent = message;
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
    $('wip-email-note-group').style.display = 'none';
    $('wip-email-note').value = '';
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
        html += `<div class="custom-dropdown-option" data-value="${c.code}" onclick="selectWipEmailClient('${c.code}', '${c.name.replace(/'/g, "\\'")}')">${c.name}</div>`;
    });
    
    if (otherClients.length > 0) {
        html += '<div class="custom-dropdown-option section-header">Other</div>';
        otherClients.forEach(c => {
            html += `<div class="custom-dropdown-option" data-value="${c.code}" onclick="selectWipEmailClient('${c.code}', '${c.name.replace(/'/g, "\\'")}')">${c.name}</div>`;
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
    wipEmailState.recipients = [];
    
    // Update UI
    $('wip-email-client-trigger').querySelector('span').textContent = name;
    $('wip-email-client-trigger').classList.remove('open');
    $('wip-email-client-menu').classList.remove('open');
    
    // Update logo
    const logo = $('wip-email-modal-logo');
    logo.src = getLogoUrl(code);
    logo.onerror = function() { this.src = 'images/logos/Unknown.png'; };
    
    // Fetch people for this client
    $('wip-email-people-list').innerHTML = '<div style="color: #999; font-size: 14px;">Loading contacts...</div>';
    $('wip-email-people-group').style.display = 'block';
    
    try {
        const response = await fetch(`${API_BASE}/people/${code}`);
        const people = await response.json();
        
        // Filter to people with email addresses
        const withEmail = people.filter(p => p.email);
        
        if (withEmail.length === 0) {
            $('wip-email-people-list').innerHTML = '<div style="color: #999; font-size: 14px;">No contacts with email addresses</div>';
            $('wip-email-note-group').style.display = 'none';
            $('wip-email-footer').style.display = 'none';
            return;
        }
        
        let peopleHtml = '';
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
        $('wip-email-note-group').style.display = 'block';
        $('wip-email-note').value = "Here's what's new, what's due and what's cooking.";
        $('wip-email-footer').style.display = 'none';
        
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
    
    const payload = {
        clientCode: wipEmailState.clientCode,
        recipients: wipEmailState.recipients,
        customNote: $('wip-email-note').value.trim() || null
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

// Make functions available globally
window.openTrackerEditModal = openTrackerEditModal;
window.openTrackerDetail = openTrackerDetail;
window.closeTrackerModal = closeTrackerModal;
window.saveTrackerProject = saveTrackerProject;
window.getTrackerPDF = getTrackerPDF;
window.navigateTo = navigateTo;
window.setWipMode = setWipMode;
window.toggleWipMode = toggleWipMode;
window.submitWipUpdate = submitWipUpdate;
window.toggleWipWithClient = toggleWipWithClient;
