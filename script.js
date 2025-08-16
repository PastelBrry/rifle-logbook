document.addEventListener('DOMContentLoaded', () => {
    // Sanity check for secure context
    if (!window.isSecureContext) {
        const message = "CRITICAL ERROR: The browser does not consider this a secure context.\n\n" +
            "The crypto API required for login is disabled.\n\n" +
            "Please ensure:\n" +
            "1. You are running a server using HTTPS (e.g., 'http-server -S').\n" +
            "2. Your URL starts with 'https://' (e.g., https://127.0.0.1:8080).\n" +
            "3. You are NOT opening the file directly (file:///...).";
        console.error(message);
        alert(message);
    }

    // --- OAuth 2.0 Configuration ---
    const OAUTH_CONFIG = {
        clientId: '01k2ps6rwmewxtr69wqad8j41a', 
        redirectUri: 'http://127.0.0.1:3000/markr/index.html',
        authorizationEndpoint: 'https://auth.sbhs.net.au/authorize',
        tokenEndpoint: 'https://auth.sbhs.net.au/token',
        apiEndpoint: 'https://student.sbhs.net.au/api/details/userinfo.json',
        scopes: 'openid profile all-ro'
    };

    // --- Global DOM Elements (Declared here, assigned after DOM loads) ---
    let loginWrapper, appWrapper, loginBtn, loginError, logoutBtn, currentUserDisplay;
    let measurementsForm, logForm, logHistoryContainer, avg60Span, avg300Span, best10AvgSpan, chartCanvas;
    
    // --- App State ---
    let shoots = [], measurements = {}, scoreChart = null, currentUser = null;

    const LS_SHOOTS_PREFIX = 'markr_shoots_';
    const LS_MEASUREMENTS_PREFIX = 'markr_measurements_';

    // --- PKCE Helper Functions ---
    const generateRandomString = (length) => {
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
        let text = '';
        for (let i = 0; i < length; i++) text += possible.charAt(Math.floor(Math.random() * possible.length));
        return text;
    };
    
    const sha256 = (plain) => new TextEncoder().encode(plain);
    
    // FIXED: Corrected typo from UintArray to Uint8Array
    const base64urlencode = (a) => btoa(String.fromCharCode.apply(null, new Uint8Array(a)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    
    const generateCodeChallenge = async (verifier) => base64urlencode(await window.crypto.subtle.digest('SHA-256', sha256(verifier)));

    // --- AUTHENTICATION LOGIC ---
    const redirectToLogin = async () => {
        if (OAUTH_CONFIG.clientId === 'YOUR_CLIENT_ID_HERE') {
            alert("CRITICAL ERROR: OAuth Client ID is not configured.\nPlease edit script.js and set your Client ID.");
            return;
        }
        try {
            const codeVerifier = generateRandomString(128);
            sessionStorage.setItem('pkce_code_verifier', codeVerifier);
            const codeChallenge = await generateCodeChallenge(codeVerifier);
            const params = new URLSearchParams({
                response_type: 'code', 
                client_id: OAUTH_CONFIG.clientId, 
                redirect_uri: OAUTH_CONFIG.redirectUri,
                scope: OAUTH_CONFIG.scopes, 
                code_challenge: codeChallenge, 
                code_challenge_method: 'S256',
            });
            window.location.assign(`${OAUTH_CONFIG.authorizationEndpoint}?${params.toString()}`);
        } catch (error) {
            console.error("Crypto function failed. Ensure you are running on localhost or https.", error);
            alert("Could not initiate login. Make sure you are running the page from a secure context (localhost or https), not a file:// URL.");
        }
    };

    const handleAuthCallback = async (code, codeVerifier) => {
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
            return true;
        } catch (err) {
            console.error(err);
            return false;
        }
    };
    
    const fetchUserProfile = async (token) => {
        try {
            const response = await fetch(OAUTH_CONFIG.apiEndpoint, { 
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.status === 401) {
                sessionStorage.removeItem('access_token');
                window.location.reload();
                return null;
            }
            if (!response.ok) throw new Error(`API call failed: ${response.statusText}`);
            const data = await response.json();
            return { id: data.studentId, name: data.displayName };
        } catch (err) {
            console.error(err);
            return null;
        }
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
            initializeApp(userProfile.name);
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
            if (success) {
                await runMainApp();
            } else {
                loginError.textContent = 'Authentication failed. Please try again.';
                loginError.classList.remove('hidden');
                loginWrapper.classList.remove('hidden');
            }
        } else {
            await runMainApp();
        }
    };

    // --- APP INITIALIZATION ---
    const initializeApp = (displayName) => {
        loginWrapper.classList.add('hidden');
        appWrapper.classList.remove('hidden');
        currentUserDisplay.textContent = displayName;
        loadData();
        renderAll();
        feather.replace();
    };
    
    // --- DATA HANDLING ---
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

    // --- RENDERING ---
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
        avg60Span.textContent = last60.length > 0 ? 
            (last60.reduce((a, b) => a + b, 0) / last60.length).toFixed(2) : 'N/A'; 
            
        const last300 = allAvgScores.slice(-300); 
        avg300Span.textContent = last300.length > 0 ? 
            (last300.reduce((a, b) => a + b, 0) / last300.length).toFixed(2) : 'N/A'; 
            
        const tenShotSessions = shoots.filter(s => s.shotCount === 10); 
        if (tenShotSessions.length > 0) { 
            const bestSession = tenShotSessions.reduce((best, current) => 
                (current.totalScore > best.totalScore ? current : best)); 
            best10AvgSpan.textContent = `${(bestSession.totalScore / 10).toFixed(2)} (Total: ${bestSession.totalScore.toFixed(1)})`; 
        } else { 
            best10AvgSpan.textContent = 'N/A'; 
        } 
    };
    
    const renderGraph = () => { 
        if (scoreChart) scoreChart.destroy(); 
        
        const labels = shoots.map(s => new Date(s.id).toLocaleDateString(undefined, { 
            month: 'short', 
            day: 'numeric' 
        })); 
        const data = shoots.map(s => s.totalScore / s.shotCount); 
        
        let suggestedMin = 5; 
        let suggestedMax = 10.5; 
        if (data.length > 0) { 
            suggestedMin = Math.max(5, Math.floor(Math.min(...data) - 1)); 
        } 
        
        scoreChart = new Chart(chartCanvas, { 
            type: 'line', 
            data: { 
                labels, 
                datasets: [{ 
                    label: 'Average Score per Shot', 
                    data, 
                    borderColor: 'var(--accent-primary)', 
                    backgroundColor: 'rgba(94, 106, 210, 0.2)', 
                    fill: true, 
                    tension: 0.3, 
                    pointBackgroundColor: 'var(--accent-primary)', 
                    pointRadius: 4 
                }] 
            }, 
            options: { 
                responsive: true, 
                maintainAspectRatio: false, 
                scales: { 
                    y: { 
                        beginAtZero: false, 
                        suggestedMin, 
                        suggestedMax, 
                        grid: { color: 'var(--border-color)' }, 
                        ticks: { color: 'var(--text-secondary)' } 
                    }, 
                    x: { 
                        grid: { display: false }, 
                        ticks: { color: 'var(--text-secondary)' } 
                    } 
                }, 
                plugins: { 
                    legend: { 
                        labels: { color: 'var(--text-primary)' } 
                    } 
                } 
            } 
        }); 
    };

    // --- EVENT LISTENERS ---
    const setupEventListeners = () => {
        loginBtn.addEventListener('click', redirectToLogin);
        
        logoutBtn.addEventListener('click', () => { 
            sessionStorage.removeItem('access_token'); 
            window.location.reload(); 
        });
        
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
                shotCount, 
                totalScore, 
                useDecimals, 
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
    const main = () => {
        // FIXED: Assign element variables now that the DOM is loaded
        loginWrapper = document.getElementById('login-wrapper');
        appWrapper = document.getElementById('app-wrapper');
        loginBtn = document.getElementById('login-btn');
        loginError = document.getElementById('login-error');
        logoutBtn = document.getElementById('logout-btn');
        currentUserDisplay = document.getElementById('current-user-display');
        measurementsForm = document.getElementById('measurements-form');
        logForm = document.getElementById('log-form');
        logHistoryContainer = document.getElementById('log-history-container');
        avg60Span = document.getElementById('avg-60');
        avg300Span = document.getElementById('avg-300');
        best10AvgSpan = document.getElementById('best-10-avg');
        chartCanvas = document.getElementById('score-chart');

        // FIXED: Check that all required elements exist before proceeding
        if (!loginWrapper || !appWrapper || !loginBtn || !measurementsForm) {
            console.error('Critical DOM elements are missing. Check your HTML structure.');
            return;
        }

        // Now it's safe to set up event listeners
        setupEventListeners();
        // And then start the application flow
        initializeAppFlow();
    };

    // Run the main function
    main();
});