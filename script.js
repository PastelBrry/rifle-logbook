document.addEventListener('DOMContentLoaded', () => {
    // --- THEME HANDLING LOGIC ---
    const THEME_KEY = 'markr_theme';
    const ACCENT_KEY = 'markr_accent_color';

    const lightenHexColor = (hex, amount) => {
        let usePound = false;
        if (hex[0] === "#") {
            hex = hex.slice(1);
            usePound = true;
        }
        const num = parseInt(hex, 16);
        let r = (num >> 16) + amount;
        if (r > 255) r = 255;
        let b = ((num >> 8) & 0x00FF) + amount;
        if (b > 255) b = 255;
        let g = (num & 0x0000FF) + amount;
        if (g > 255) g = 255;
        return (usePound ? "#" : "") + (g | (b << 8) | (r << 16)).toString(16);
    };

    const applyTheme = (theme) => {
        const themeToggle = document.getElementById('theme-toggle');
        if (theme === 'light') {
            document.body.classList.add('light-mode');
            if (themeToggle) themeToggle.checked = true;
        } else {
            document.body.classList.remove('light-mode');
            if (themeToggle) themeToggle.checked = false;
        }
    };

    const applyAccentColor = (hexColor) => {
        const root = document.documentElement;
        const hoverColor = lightenHexColor(hexColor, 20);
        root.style.setProperty('--accent-primary', hexColor);
        root.style.setProperty('--accent-hover', hoverColor);
        document.querySelectorAll('.color-swatch').forEach(swatch => {
            swatch.classList.toggle('active', swatch.dataset.color === hexColor);
        });
    };
    
    const savedTheme = localStorage.getItem(THEME_KEY) || 'dark';
    const savedAccent = localStorage.getItem(ACCENT_KEY) || '#5e6ad2';
    applyTheme(savedTheme);
    applyAccentColor(savedAccent);
    
    // --- Firebase Configuration ---
    const firebaseConfig = {
        apiKey: "YOUR_API_KEY",
        authDomain: "YOUR_AUTH_DOMAIN",
        projectId: "YOUR_PROJECT_ID",
        storageBucket: "YOUR_STORAGE_BUCKET",
        messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
        appId: "YOUR_APP_ID"
    };

    // Initialize Firebase
    const app = firebase.initializeApp(firebaseConfig);
    const db = firebase.firestore();

    // --- Initialize App Check ---
    const appCheck = firebase.appCheck(app);
    appCheck.activate(
      'YOUR_RECAPTCHA_V3_SITE_KEY_HERE',
      true);

    // --- OAuth 2.0 Configuration ---
    const OAUTH_CONFIG = {
        clientId: '01k2ps6rwmewxtr69wqad8j41a', 
        redirectUri: 'https://your-username.github.io/markr-app/index.html', // 👈 UPDATE THIS
        authorizationEndpoint: 'https://auth.sbhs.net.au/authorize',
        tokenEndpoint: 'https://auth.sbhs.net.au/token',
        apiEndpoint: 'https://student.sbhs.net.au/api/details/userinfo.json',
        scopes: 'openid profile all-ro'
    };

    // --- Global DOM Elements ---
    let loginWrapper, appWrapper, loginBtn, loginError, logoutBtn, currentUserDisplay;
    let measurementsForm, logForm, logHistoryContainer, avg60Span, avg300Span, best10AvgSpan, chartCanvas;
    
    // --- App State ---
    let shoots = [], measurements = {}, scoreChart = null, currentUser = null;

    // --- PKCE Helper Functions ---
    const generateRandomString = (length) => {
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
        let text = '';
        for (let i = 0; i < length; i++) text += possible.charAt(Math.floor(Math.random() * possible.length));
        return text;
    };
    const sha256 = (plain) => new TextEncoder().encode(plain);
    const base64urlencode = (a) => btoa(String.fromCharCode.apply(null, new Uint8Array(a)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const generateCodeChallenge = async (verifier) => base64urlencode(await window.crypto.subtle.digest('SHA-256', sha256(verifier)));

    // --- ⬇️ REFACTORED LOGIN LOGIC TO FIX MOBILE REDIRECTS ⬇️ ---
    const prepareLogin = async () => {
        try {
            const codeVerifier = generateRandomString(128);
            const codeChallenge = await generateCodeChallenge(codeVerifier);
            sessionStorage.setItem('pkce_code_verifier', codeVerifier);
            sessionStorage.setItem('pkce_code_challenge', codeChallenge);
        } catch (error) {
            console.error("Crypto function failed.", error);
            loginError.textContent = "Could not prepare login. Please ensure you are on a secure connection (https).";
            loginError.classList.remove('hidden');
            if(loginBtn) loginBtn.disabled = true;
        }
    };

    const redirectToLogin = () => {
        const codeChallenge = sessionStorage.getItem('pkce_code_challenge');
        if (!codeChallenge) {
            alert("Login details not ready. Please refresh the page and try again.");
            return;
        }
        const params = new URLSearchParams({
            response_type: 'code', 
            client_id: OAUTH_CONFIG.clientId, 
            redirect_uri: OAUTH_CONFIG.redirectUri,
            scope: OAUTH_CONFIG.scopes, 
            code_challenge: codeChallenge, 
            code_challenge_method: 'S256',
        });
        window.location.assign(`${OAUTH_CONFIG.authorizationEndpoint}?${params.toString()}`);
    };

    const handleAuthCallback = async (code, codeVerifier) => {
        try {
            const tokenResponse = await fetch(OAUTH_CONFIG.tokenEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    grant_type: 'authorization_code', code: code, redirect_uri: OAUTH_CONFIG.redirectUri,
                    client_id: OAUTH_CONFIG.clientId, code_verifier: codeVerifier
                })
            });
            if (!tokenResponse.ok) throw new Error(`Token exchange failed: ${tokenResponse.statusText}`);
            const tokens = await tokenResponse.json();
            sessionStorage.setItem('access_token', tokens.access_token);
            return true;
        } catch (err) { console.error(err); return false; }
    };
    
    const fetchUserProfile = async (token) => {
        try {
            const response = await fetch(OAUTH_CONFIG.apiEndpoint, { headers: { 'Authorization': `Bearer ${token}` }});
            if (response.status === 401) { sessionStorage.removeItem('access_token'); window.location.reload(); return null; }
            if (!response.ok) throw new Error(`API call failed: ${response.statusText}`);
            const data = await response.json();
            return { id: data.studentId, name: data.displayName };
        } catch (err) { console.error(err); return null; }
    };
    
    const runMainApp = async () => {
        const accessToken = sessionStorage.getItem('access_token');
        if (!accessToken) {
            loginWrapper.classList.remove('hidden');
            appWrapper.classList.add('hidden');
            return;
        }
        const userProfile = await fetchUserProfile(accessToken);
        if (userProfile) {
            currentUser = userProfile.id;
            await initializeApp(userProfile.name);
        } else {
            loginWrapper.classList.remove('hidden');
            appWrapper.classList.add('hidden');
        }
    };

    const initializeAppFlow = async () => {
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        if (code) {
            const codeVerifier = sessionStorage.getItem('pkce_code_verifier');
            const success = await handleAuthCallback(code, codeVerifier);
            window.history.replaceState({}, document.title, window.location.pathname);
            sessionStorage.removeItem('pkce_code_verifier');
            sessionStorage.removeItem('pkce_code_challenge');
            if (success) {
                await runMainApp();
            } else {
                loginError.textContent = 'Authentication failed. Please try again.';
                loginError.classList.remove('hidden');
                loginWrapper.classList.remove('hidden');
                await prepareLogin();
            }
        } else {
            const accessToken = sessionStorage.getItem('access_token');
            if (!accessToken) {
                await prepareLogin();
            }
            await runMainApp();
        }
    };

    const initializeApp = async (displayName) => {
        loginWrapper.classList.add('hidden');
        appWrapper.classList.remove('hidden');
        currentUserDisplay.textContent = displayName;
        await loadData();
        renderAll();
        feather.replace();
    };
    
    // --- Data Handling ---
    const loadData = async () => { /* ... (unchanged) ... */ };
    const saveMeasurements = async () => { /* ... (unchanged) ... */ };
    const addShoot = async (shootData) => { /* ... (unchanged) ... */ };
    const deleteShoot = async (id) => { /* ... (unchanged) ... */ };

    // --- Rendering ---
    const renderAll = () => { /* ... (unchanged) ... */ };
    const populateMeasurementsForm = () => { /* ... (unchanged) ... */ };
    const renderLogHistory = () => { /* ... (unchanged) ... */ };
    const renderStats = () => { /* ... (unchanged) ... */ };
    const renderGraph = () => { /* ... (unchanged) ... */ };

    // --- EVENT LISTENERS ---
    const setupEventListeners = () => {
        loginBtn.addEventListener('click', redirectToLogin);
        logoutBtn.addEventListener('click', () => { sessionStorage.removeItem('access_token'); window.location.reload(); });
        measurementsForm.addEventListener('input', (e) => { measurements[e.target.name] = e.target.value; saveMeasurements(); });

        logForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const totalScoreInput = document.getElementById('total-score');
            const totalScore = parseFloat(totalScoreInput.value);
            const shotCount = parseInt(document.querySelector('input[name="shot-count"]:checked').value);
            const useDecimals = document.getElementById('decimal-scoring').checked;
            const ammunition = document.getElementById('ammunition').value;
            if (isNaN(totalScore)) { alert('Please enter a valid number for the score.'); return; }
            const maxScore = useDecimals ? shotCount * 10.9 : shotCount * 10;
            if (totalScore < 0 || totalScore > maxScore) { alert(`Invalid score...`); return; }
            const newShoot = { id: Date.now(), shotCount, totalScore, useDecimals, ammunition, feedback: document.getElementById('feedback').value.trim(), comments: document.getElementById('comments').value.trim() };
            await addShoot(newShoot);
            await loadData();
            renderAll();
            logForm.reset();
            document.getElementById('decimal-scoring').checked = false;
            totalScoreInput.step = "1";
            totalScoreInput.placeholder = "e.g., 98";
            totalScoreInput.focus();
        });

        document.getElementById('decimal-scoring').addEventListener('change', (e) => {
            const totalScoreInput = document.getElementById('total-score');
            if (e.target.checked) {
                totalScoreInput.step = "0.1";
                totalScoreInput.placeholder = "e.g., 98.5";
            } else {
                totalScoreInput.step = "1";
                totalScoreInput.placeholder = "e.g., 98";
            }
        });

        logHistoryContainer.addEventListener('click', async (e) => {
            const deleteBtn = e.target.closest('.btn-delete');
            if (deleteBtn) { const shootId = parseInt(deleteBtn.dataset.id, 10); await deleteShoot(shootId); }
        });

        const themeToggle = document.getElementById('theme-toggle');
        const colorSwatchesContainer = document.getElementById('color-swatches-container');
        themeToggle.addEventListener('change', () => {
            const newTheme = themeToggle.checked ? 'light' : 'dark';
            localStorage.setItem(THEME_KEY, newTheme);
            applyTheme(newTheme);
        });
        colorSwatchesContainer.addEventListener('click', (e) => {
            const target = e.target.closest('.color-swatch');
            if (target) { const newColor = target.dataset.color; localStorage.setItem(ACCENT_KEY, newColor); applyAccentColor(newColor); }
        });
    };

    // --- App Entry Point ---
    const main = () => {
        loginWrapper = document.getElementById('login-wrapper');
        appWrapper = document.getElementById('app-wrapper');
        loginBtn = document.getElementById('login-btn');
        loginError = document.getElementById('login-error');
        // ... (rest of element assignments)
        
        if (!loginWrapper || !appWrapper || !loginBtn || !measurementsForm) {
            console.error('Critical DOM elements are missing. Check your HTML structure.');
            return;
        }
        setupEventListeners();
        initializeAppFlow();
    };

    main();
});