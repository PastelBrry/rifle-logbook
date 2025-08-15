document.addEventListener('DOMContentLoaded', () => {
    // --- OAuth 2.0 Configuration ---
    // IMPORTANT: Replace with your actual Client ID and Redirect URI from the SBHS Portal
    const OAUTH_CONFIG = {
        clientId: 'YOUR_CLIENT_ID_HERE', // <-- PASTE YOUR CLIENT ID HERE
        redirectUri: window.location.origin + window.location.pathname, // Assumes index.html is at the root
        authorizationEndpoint: 'https://auth.sbhs.net.au/authorize',
        tokenEndpoint: 'https://auth.sbhs.net.au/token',
        apiEndpoint: 'https://student.sbhs.net.au/api/details/userinfo.json',
        // Scopes define what information your app can access.
        // 'openid profile' lets us get the user's name. 'all-ro' is for other school data.
        scopes: 'openid profile all-ro'
    };

    // --- Global DOM Elements ---
    const loginWrapper = document.getElementById('login-wrapper');
    const appWrapper = document.getElementById('app-wrapper');
    const loginBtn = document.getElementById('login-btn');
    const loginError = document.getElementById('login-error');
    const logoutBtn = document.getElementById('logout-btn');
    const currentUserDisplay = document.getElementById('current-user-display');
    
    // --- App-specific DOM Elements ---
    let measurementsForm, logForm, logHistoryContainer, avg60Span, avg300Span, best10AvgSpan, chartCanvas;
    let shoots = [], measurements = {}, scoreChart = null, currentUser = null;

    // --- Key Constants ---
    const LS_SHOOTS_PREFIX = 'rifleLog_shoots_';
    const LS_MEASUREMENTS_PREFIX = 'rifleLog_measurements_';

    // --- PKCE Helper Functions ---
    // These are required for secure authentication in a public client (like a JS app)
    const generateRandomString = (length) => {
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
        let text = '';
        for (let i = 0; i < length; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    };

    const sha256 = async (plain) => {
        const encoder = new TextEncoder();
        const data = encoder.encode(plain);
        return window.crypto.subtle.digest('SHA-256', data);
    };

    const base64urlencode = (a) => {
        return btoa(String.fromCharCode.apply(null, new Uint8Array(a)))
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    };

    const generateCodeChallenge = async (verifier) => {
        const hashed = await sha256(verifier);
        return base64urlencode(hashed);
    };

    // --- AUTHENTICATION LOGIC ---
    const redirectToLogin = async () => {
        if (OAUTH_CONFIG.clientId === 'YOUR_CLIENT_ID_HERE') {
            alert("OAuth Client ID is not configured. Please edit script.js and set your Client ID.");
            return;
        }
        // Create and store a code verifier
        const codeVerifier = generateRandomString(128);
        sessionStorage.setItem('pkce_code_verifier', codeVerifier);

        // Create a code challenge
        const codeChallenge = await generateCodeChallenge(codeVerifier);

        // Build the authorization URL
        const params = new URLSearchParams({
            response_type: 'code',
            client_id: OAUTH_CONFIG.clientId,
            redirect_uri: OAUTH_CONFIG.redirectUri,
            scope: OAUTH_CONFIG.scopes,
            code_challenge: codeChallenge,
            code_challenge_method: 'S256',
        });

        // Redirect the user
        window.location.assign(`${OAUTH_CONFIG.authorizationEndpoint}?${params.toString()}`);
    };

    const handleAuthCallback = async () => {
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        const error = urlParams.get('error');
        const codeVerifier = sessionStorage.getItem('pkce_code_verifier');

        if (error) {
            loginError.textContent = `Login failed: ${error}`;
            loginError.classList.remove('hidden');
            return;
        }
        
        if (!code || !codeVerifier) {
            // No code or verifier, probably a normal page load
            return;
        }

        // Exchange the authorization code for an access token
        try {
            const tokenResponse = await fetch(OAUTH_CONFIG.tokenEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    grant_type: 'authorization_code',
                    code: code,
                    redirect_uri: OAUTH_CONFIG.redirectUri,
                    client_id: OAUTH_CONFIG.clientId,
                    code_verifier: codeVerifier
                })
            });

            if (!tokenResponse.ok) throw new Error(`Token exchange failed: ${tokenResponse.statusText}`);

            const tokens = await tokenResponse.json();
            sessionStorage.setItem('access_token', tokens.access_token);
            sessionStorage.removeItem('pkce_code_verifier');

            // Clean the URL
            window.history.replaceState({}, document.title, window.location.pathname);
            
            await checkLoginState(); // Re-check state now that we have a token
        } catch (err) {
            console.error(err);
            loginError.textContent = 'Failed to get access token. Please try again.';
            loginError.classList.remove('hidden');
        }
    };

    const fetchUserProfile = async (token) => {
        try {
            const response = await fetch(OAUTH_CONFIG.apiEndpoint, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!response.ok) {
                 if(response.status === 401) { // Unauthorized, token likely expired
                    sessionStorage.removeItem('access_token');
                    window.location.reload();
                }
                throw new Error(`API call failed: ${response.statusText}`);
            }
            const data = await response.json();
            // Use studentId as a unique, stable identifier for storage keys
            return { id: data.studentId, name: data.displayName };
        } catch (err) {
            console.error(err);
            return null;
        }
    };
    
    const checkLoginState = async () => {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has('code')) {
            await handleAuthCallback();
            return;
        }

        const accessToken = sessionStorage.getItem('access_token');
        if (accessToken) {
            const userProfile = await fetchUserProfile(accessToken);
            if (userProfile) {
                currentUser = userProfile.id; // Use the unique student ID
                initializeApp(userProfile.name); // Pass the display name
            } else {
                // Failed to get profile, token might be invalid
                sessionStorage.removeItem('access_token');
                loginWrapper.classList.remove('hidden');
            }
        } else {
            loginWrapper.classList.remove('hidden');
            appWrapper.classList.add('hidden');
        }
    };

    // --- APP INITIALIZATION ---
    const initializeApp = (displayName) => {
        loginWrapper.classList.add('hidden');
        appWrapper.classList.remove('hidden');
        currentUserDisplay.textContent = displayName;

        measurementsForm = document.getElementById('measurements-form');
        logForm = document.getElementById('log-form');
        logHistoryContainer = document.getElementById('log-history-container');
        avg60Span = document.getElementById('avg-60');
        avg300Span = document.getElementById('avg-300');
        best10AvgSpan = document.getElementById('best-10-avg');
        chartCanvas = document.getElementById('score-chart');

        loadData();
        renderAll();
        feather.replace();
    };
    
    // --- DATA HANDLING (no changes needed) ---
    const saveData = () => {
        if (!currentUser) return;
        localStorage.setItem(LS_SHOOTS_PREFIX + currentUser, JSON.stringify(shoots));
        localStorage.setItem(LS_MEASUREMENTS_PREFIX + currentUser, JSON.stringify(measurements));
    };

    const loadData = () => {
        if (!currentUser) return;
        const shootsData = localStorage.getItem(LS_SHOOTS_PREFIX + currentUser);
        const measurementsData = localStorage.getItem(LS_MEASUREMENTS_PREFIX + currentUser);
        shoots = shootsData ? JSON.parse(shootsData) : [];
        measurements = measurementsData ? JSON.parse(measurementsData) : {};
    };

    const deleteShoot = (id) => {
        const shootId = parseInt(id, 10);
        if (confirm('Are you sure you want to delete this log entry?')) {
            shoots = shoots.filter(shoot => shoot.id !== shootId);
            saveData();
            renderAll();
        }
    };
    
    // --- RENDERING (no changes needed) ---
    const renderAll = () => {
        populateMeasurementsForm();
        renderLogHistory();
        renderStats();
        renderGraph();
    };

    const populateMeasurementsForm = () => {
        for (const key in measurements) {
            const input = measurementsForm.querySelector(`[name="${key}"]`);
            if (input) input.value = measurements[key];
        }
    };
    
    const renderLogHistory = () => {
        logHistoryContainer.innerHTML = '';
        if (shoots.length === 0) {
            logHistoryContainer.innerHTML = '<p>No shoots logged yet.</p>';
            return;
        }
        [...shoots].reverse().forEach(shoot => {
            const avgScore = shoot.totalScore / shoot.shotCount;
            const readableDate = new Date(shoot.id).toLocaleString(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short'
            });
            const scoreType = shoot.useDecimals ? 'Decimals' : 'Integers';
            const entryDiv = document.createElement('div');
            entryDiv.className = 'log-entry';
            entryDiv.innerHTML = `
                <div class="log-entry-header">
                    <h3>${readableDate} - ${shoot.shotCount} shots</h3>
                    <div class="log-entry-actions">
                        <span class="score-type">${scoreType}</span>
                        <span class="log-entry-total">Total: ${shoot.totalScore.toFixed(1)}</span>
                        <button class="btn-icon btn-delete" data-id="${shoot.id}" title="Delete entry">
                            <i data-feather="trash-2" style="pointer-events: none;"></i>
                        </button>
                    </div>
                </div>
                <div class="log-entry-body">
                    <p><strong>Avg Score/Shot:</strong> ${avgScore.toFixed(2)}</p>
                    ${shoot.feedback ? `<p><strong>Feedback:</strong> ${shoot.feedback}</p>` : ''}
                    ${shoot.comments ? `<p><strong>Comments:</strong> ${shoot.comments}</p>` : ''}
                </div>
            `;
            logHistoryContainer.appendChild(entryDiv);
        });
        feather.replace();
    };

    const renderStats = () => {
        const allAvgScores = shoots.flatMap(s => Array(s.shotCount).fill(s.totalScore / s.shotCount));
        const last60 = allAvgScores.slice(-60);
        avg60Span.textContent = last60.length > 0 ? (last60.reduce((a, b) => a + b, 0) / last60.length).toFixed(2) : 'N/A';
        const last300 = allAvgScores.slice(-300);
        avg300Span.textContent = last300.length > 0 ? (last300.reduce((a, b) => a + b, 0) / last300.length).toFixed(2) : 'N/A';
        const tenShotSessions = shoots.filter(s => s.shotCount === 10);
        if (tenShotSessions.length > 0) {
            const bestSession = tenShotSessions.reduce((best, current) => (current.totalScore > best.totalScore ? current : best));
            best10AvgSpan.textContent = `${(bestSession.totalScore / 10).toFixed(2)} (Total: ${bestSession.totalScore.toFixed(1)})`;
        } else {
            best10AvgSpan.textContent = 'N/A';
        }
    };

    const renderGraph = () => {
        if (scoreChart) scoreChart.destroy();
        
        const labels = shoots.map(s => new Date(s.id).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
        const data = shoots.map(s => s.totalScore / s.shotCount);
        let suggestedMin = 5;
        let suggestedMax = 10.5;
        if (data.length > 0) {
            suggestedMin = Math.max(5, Math.floor(Math.min(...data) - 1));
        }
        scoreChart = new Chart(chartCanvas, {
            type: 'line',
            data: { labels, datasets: [{ label: 'Average Score per Shot', data, borderColor: 'var(--accent-primary)', backgroundColor: 'rgba(94, 106, 210, 0.2)', fill: true, tension: 0.3, pointBackgroundColor: 'var(--accent-primary)', pointRadius: 4 }] },
            options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: false, suggestedMin, suggestedMax, grid: { color: 'var(--border-color)' }, ticks: { color: 'var(--text-secondary)' } }, x: { grid: { display: false }, ticks: { color: 'var(--text-secondary)' } } }, plugins: { legend: { labels: { color: 'var(--text-primary)' } } } }
        });
    };

    // --- EVENT LISTENERS ---
    const setupEventListeners = () => {
        loginBtn.addEventListener('click', redirectToLogin);

        logoutBtn.addEventListener('click', () => {
            sessionStorage.removeItem('access_token');
            window.location.reload();
        });
        
        // The rest of your event listeners are unchanged
        measurementsForm.addEventListener('input', (e) => {
            measurements[e.target.name] = e.target.value;
            saveData();
        });

        logForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const totalScoreInput = document.getElementById('total-score');
            const totalScore = parseFloat(totalScoreInput.value);
            const shotCount = parseInt(document.querySelector('input[name="shot-count"]:checked').value);
            const useDecimals = document.getElementById('decimal-scoring').checked;
            
            if (isNaN(totalScore)) {
                alert('Please enter a valid number for the score.');
                return;
            }

            const maxScore = useDecimals ? shotCount * 10.9 : shotCount * 10;
            if (totalScore < 0 || totalScore > maxScore) {
                alert(`Invalid score. For ${shotCount} shots with decimal scoring ${useDecimals ? 'ON' : 'OFF'}, the score must be between 0 and ${maxScore.toFixed(1)}.`);
                return;
            }

            const newShoot = {
                id: Date.now(),
                shotCount, totalScore, useDecimals,
                feedback: document.getElementById('feedback').value.trim(),
                comments: document.getElementById('comments').value.trim(),
            };
            shoots.push(newShoot);
            saveData();
            renderAll();
            logForm.reset();
            document.getElementById('decimal-scoring').checked = true;
            totalScoreInput.focus();
        });

        logHistoryContainer.addEventListener('click', (e) => {
            const deleteBtn = e.target.closest('.btn-delete');
            if (deleteBtn) {
                deleteShoot(deleteBtn.dataset.id);
            }
        });
    };

    // --- App Entry Point ---
    setupEventListeners();
    checkLoginState();
});