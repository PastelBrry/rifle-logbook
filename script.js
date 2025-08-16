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

    // --- ⬇️ 1. PASTE YOUR FIREBASE CONFIG OBJECT HERE ⬇️ ---
    const firebaseConfig = {
    apiKey: "AIzaSyDdy986ysjeRzyUKrn60esd_YP5bMYrTmg",
    authDomain: "markr-app-e1aae.firebaseapp.com",
    projectId: "markr-app-e1aae",
    storageBucket: "markr-app-e1aae.firebasestorage.app",
    messagingSenderId: "933217486480",
    appId: "1:933217486480:web:c5ee51cbd0234c8e883a15",
    measurementId: "G-PBB2KK8B8T"
    };

    // Initialize Firebase
    firebase.initializeApp(firebaseConfig);
    const db = firebase.firestore(); // Get a reference to the Firestore service

    // --- OAuth 2.0 Configuration ---
    const OAUTH_CONFIG = {
        clientId: '01k2ps6rwmewxtr69wqad8j41a', 
        redirectUri: 'https://pastelbrry.github.io/rifle-logbook/', // 👈 UPDATE THIS to your GitHub Pages URL
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

    // --- PKCE Helper Functions ---
    const generateRandomString = (length) => {
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
        let text = '';
        for (let i = 0; i < length; i++) text += possible.charAt(Math.floor(Math.random() * possible.length));
        return text;
    };
    
    const sha256 = (plain) => new TextEncoder().encode(plain);
    
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
            await initializeApp(userProfile.name); // Wait for app initialization
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

    // --- APP INITIALIZATION (MODIFIED) ---
    const initializeApp = async (displayName) => {
        loginWrapper.classList.add('hidden');
        appWrapper.classList.remove('hidden');
        currentUserDisplay.textContent = displayName;
        
        await loadData(); // Load data from Firestore
        
        renderAll();
        feather.replace();
    };
    
    // --- ⬇️ DATA HANDLING (REFACTORED FOR FIRESTORE) ⬇️ ---

    const loadData = async () => { 
        if (!currentUser) return; 
        
        try {
            const measurementsRef = db.collection('users').doc(currentUser).collection('data').doc('measurements');
            const measurementsDoc = await measurementsRef.get();
            measurements = measurementsDoc.exists ? measurementsDoc.data() : {};

            const shootsRef = db.collection('users').doc(currentUser).collection('shoots').orderBy('id', 'desc');
            const shootsSnapshot = await shootsRef.get();
            shoots = shootsSnapshot.docs.map(doc => doc.data());
        } catch (error) {
            console.error("Error loading data from Firestore: ", error);
            alert("Could not load your data. Please check the console for errors.");
        }
    };

    const saveMeasurements = async () => {
        if (!currentUser) return;
        try {
            const measurementsRef = db.collection('users').doc(currentUser).collection('data').doc('measurements');
            await measurementsRef.set(measurements, { merge: true });
        } catch (error) {
            console.error("Error saving measurements: ", error);
        }
    };

    const addShoot = async (shootData) => {
        if (!currentUser) return;
        try {
            // Firestore will auto-generate a unique ID for the document.
            // We still store our own timestamp `id` inside the document for sorting.
            const shootsCollectionRef = db.collection('users').doc(currentUser).collection('shoots');
            await shootsCollectionRef.add(shootData);
        } catch (error) {
            console.error("Error adding shoot: ", error);
        }
    };
    
    const deleteShoot = async (id) => { 
        if (!currentUser) return;
        if (confirm('Are you sure you want to delete this log entry?')) { 
            try {
                const shootQuery = db.collection('users').doc(currentUser).collection('shoots').where('id', '==', id);
                const shootSnapshot = await shootQuery.get();
                
                if (!shootSnapshot.empty) {
                    const docIdToDelete = shootSnapshot.docs[0].id;
                    await db.collection('users').doc(currentUser).collection('shoots').doc(docIdToDelete).delete();
                    
                    await loadData();
                    renderAll();
                } else {
                    console.error("Could not find shoot with that ID to delete.");
                }
            } catch (error) {
                console.error("Error deleting shoot: ", error);
            }
        } 
    };

    // --- ⬇️ RENDERING (NO CHANGES NEEDED) ⬇️ ---
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
        
        shoots.forEach(shoot => {
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
                    <!-- MODIFIED: Display ammunition for each shoot -->
                    ${shoot.ammunition ? `<p><strong>Ammo:</strong> ${shoot.ammunition}</p>` : ''}
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
        
        // NEW: Color mapping for different ammo types
        const ammoColorMap = {
            'CCI': '#facc15', // Yellow
            'ELEY Training': '#38bdf8', // Blue
            'ELEY Match': '#f59e0b', // Gold/Orange
            'default': '#a1a1aa' // Grey for unknown/old data
        };

        const chronologicalShoots = [...shoots].reverse();
        
        // Prepare data in a format Chart.js can use, including all relevant info
        const chartData = chronologicalShoots.map(s => ({
            x: new Date(s.id),
            y: s.totalScore / s.shotCount,
            totalScore: s.totalScore,
            shotCount: s.shotCount,
            ammunition: s.ammunition || 'N/A' // Handle old data without ammo
        }));

        let minY = 8.5;
        let maxY = 10.9;
        if(chartData.length > 0) {
            const scores = chartData.map(d => d.y);
            // Give a bit of padding to the y-axis to make it look nicer
            minY = Math.max(0, Math.min(...scores) - 0.2);
            maxY = Math.min(10.9, Math.max(...scores) + 0.2);
        }
        
        scoreChart = new Chart(chartCanvas, { 
            type: 'line', 
            data: { 
                datasets: [{ 
                    label: 'Average Score per Shot', 
                    data: chartData,
                    borderColor: 'var(--accent-primary)', 
                    backgroundColor: 'rgba(94, 106, 210, 0.2)', 
                    fill: true, 
                    tension: 0.3, 
                    // NEW: Dynamic point colors based on ammunition
                    pointBackgroundColor: context => ammoColorMap[context.raw.ammunition] || ammoColorMap.default,
                    pointRadius: 5,
                    pointHoverRadius: 7
                }] 
            }, 
            options: { 
                responsive: true, 
                maintainAspectRatio: false,
                scales: { 
                    x: {
                        type: 'time',
                        time: {
                            unit: 'day',
                            tooltipFormat: 'MMM dd, yyyy',
                            displayFormats: {
                                day: 'MMM dd'
                            }
                        },
                        grid: { display: false }, 
                        ticks: { color: 'var(--text-secondary)' },
                        // NEW: Axis Title
                        title: {
                            display: true,
                            text: 'Date',
                            color: 'var(--text-secondary)'
                        }
                    },
                    y: { 
                        beginAtZero: false,
                        // NEW: Smarter min/max for better visual range
                        min: minY,
                        max: maxY,
                        grid: { color: 'var(--border-color)' }, 
                        ticks: { color: 'var(--text-secondary)' },
                        // NEW: Axis Title
                        title: {
                            display: true,
                            text: 'Average Score per Shot',
                            color: 'var(--text-secondary)'
                        }
                    }
                }, 
                plugins: {
                    legend: { labels: { color: 'var(--text-primary)' } },
                    // NEW: Custom, more detailed tooltips
                    tooltip: {
                        callbacks: {
                            title: context => new Date(context[0].raw.x).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
                            label: context => `Avg Score: ${context.raw.y.toFixed(2)}`,
                            afterLabel: context => [
                                `Total: ${context.raw.totalScore.toFixed(1)} (${context.raw.shotCount} shots)`,
                                `Ammo: ${context.raw.ammunition}`
                            ]
                        }
                    }
                } 
            } 
        }); 
    };
    // --- ⬇️ EVENT LISTENERS (MODIFIED) ⬇️ ---
        const setupEventListeners = () => {
        // ... (login, logout, measurements listeners are the same) ...
        
        logForm.addEventListener('submit', async (e) => { // Now async
            e.preventDefault(); 
            const totalScoreInput = document.getElementById('total-score'); 
            const totalScore = parseFloat(totalScoreInput.value); 
            const shotCount = parseInt(document.querySelector('input[name="shot-count"]:checked').value); 
            const useDecimals = document.getElementById('decimal-scoring').checked; 
            
            // MODIFIED: Get ammunition value from the form
            const ammunition = document.getElementById('ammunition').value;
            
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
                ammunition, // MODIFIED: Add ammunition to the shoot object
                feedback: document.getElementById('feedback').value.trim(), 
                comments: document.getElementById('comments').value.trim(), 
            }; 
            
            await addShoot(newShoot); 
            await loadData();
            renderAll(); 

            logForm.reset(); 
            // MODIFIED: Set decimal scoring to false after reset
            document.getElementById('decimal-scoring').checked = false;
            totalScoreInput.focus(); 
        });

        // Add a listener to change the step of the score input based on the decimal toggle
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
            if (deleteBtn) { 
                const shootId = parseInt(deleteBtn.dataset.id, 10);
                await deleteShoot(shootId);
            } 
        });
    };


    // --- App Entry Point ---
    const main = () => {
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

        if (!loginWrapper || !appWrapper || !loginBtn || !measurementsForm) {
            console.error('Critical DOM elements are missing. Check your HTML structure.');
            return;
        }

        setupEventListeners();
        initializeAppFlow();
    };

    main();
});