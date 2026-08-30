// NIGRANI — exact integration for the supplied Django REST backend.
// Anonymous reporting: no login/signup/account.
// Backend endpoints:
//   POST /api/reports/analyze/
//   POST /api/reports/send/
//   GET  /api/reports/

const API_BASE_URL =
  window.NIGRANI_API_BASE_URL ||
  localStorage.getItem('NIGRANI_API_BASE_URL') ||
  'https://nigrani-eg4p.onrender.com';

let cameraStream = null;
let capturedBlob = null;
let currentLocation = { latitude: null, longitude: null, accuracy: null };
let lastAnalysisToken = null;

const camera = document.querySelector('#camera');
const canvas = document.querySelector('#canvas');
const startCamera = document.querySelector('#startCamera');
const capturePhoto = document.querySelector('#capturePhoto');
const preview = document.querySelector('#preview');
const cameraIcon = document.querySelector('#cameraIcon');
const descriptionInput = document.querySelector('#complaintDescription');

// ---------- Live camera ----------
startCamera?.addEventListener('click', async () => {
  if (!navigator.mediaDevices?.getUserMedia) {
    return toast('Live camera is not supported by this browser');
  }

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false
    });

    camera.srcObject = cameraStream;
    camera.hidden = false;
    cameraIcon.hidden = true;
    startCamera.hidden = true;
    capturePhoto.hidden = false;
    toast('Camera ready — point it at the hazard');
  } catch (error) {
    console.error(error);
    toast('Camera permission is required to capture a live photo');
  }
});

capturePhoto?.addEventListener('click', () => {
  if (!cameraStream || !camera.videoWidth) {
    return toast('Camera is not ready');
  }

  canvas.width = camera.videoWidth;
  canvas.height = camera.videoHeight;
  canvas.getContext('2d').drawImage(
    camera, 0, 0, canvas.width, canvas.height
  );

  canvas.toBlob(blob => {
    if (!blob) return toast('Could not capture the photo');

    capturedBlob = blob;
    lastAnalysisToken = null;

    preview.innerHTML = `
      <img src="${URL.createObjectURL(blob)}" alt="Captured hazard photo">
      <button class="btn" id="retakePhoto">Retake ↻</button>
      <button class="btn" id="analyzePhoto">Analyze ✦</button>
      <div id="analysisResult"></div>
    `;

    stopCamera();
    toast('Live photo captured — ready for NIGRANI AI');

    document.querySelector('#retakePhoto')
      ?.addEventListener('click', resetCapture);

    document.querySelector('#analyzePhoto')
      ?.addEventListener('click', analyzeCapturedPhoto);
  }, 'image/jpeg', 0.9);
});

function resetCapture() {
  stopCamera();
  capturedBlob = null;
  lastAnalysisToken = null;
  preview.innerHTML = '';
  if (descriptionInput) descriptionInput.value = '';
  startCamera.hidden = false;
  capturePhoto.hidden = true;
  camera.hidden = true;
  cameraIcon.hidden = false;
}

// ---------- GPS ----------
async function getLocation(showToast = true) {
  if (!navigator.geolocation) {
    if (showToast) toast('Location is not supported by this browser');
    return currentLocation;
  }

  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      pos => {
        currentLocation = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy
        };
        if (showToast) {
          toast(`Location attached • ±${Math.round(pos.coords.accuracy)}m`);
        }
        resolve(currentLocation);
      },
      error => {
        console.warn('Geolocation:', error);
        if (showToast) toast('Location permission was not granted');
        resolve(currentLocation);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  });
}

// ---------- Exact backend: AnalyzeView ----------
async function analyzeCapturedPhoto() {
  if (!capturedBlob) return toast('Capture a photo first');

  const description = descriptionInput?.value.trim() || '';
  if (description.length > 500) {
    return toast('Description must be 500 characters or less');
  }

  // Description is accepted by AnalyzeView.
  const formData = new FormData();
  formData.append('image', capturedBlob, 'nigrani-live-capture.jpg');
  if (description) formData.append('description', description);

  // GPS is not required by AnalyzeView, but we collect it before submission
  // so the final SendView receives the exact coordinates.
  await getLocation(false);

  setAnalysisState('Sending photo to NIGRANI AI…');

  try {
    const response = await fetch(`${API_BASE_URL}/analyze/`, {
      method: 'POST',
      body: formData
    });

    const data = await parseJSON(response);

    if (!response.ok) {
      throw new Error(data.error || `Analysis failed (${response.status})`);
    }

    // Supplied backend returns this token and requires it on /send/.
    lastAnalysisToken = data.analysis_token;

    const violationsText = formatViolations(data.violations);

    setAnalysisState(`
      <strong>${escapeHTML(data.urgency || 'Analyzed')}</strong>
      ${violationsText ? `<br>${violationsText}` : ''}
      ${data.why_dangerous ? `<br>${escapeHTML(data.why_dangerous)}` : ''}
      <br>
      <button class="btn" id="submitReport">Submit complaint ↗</button>
    `);

    document.querySelector('#submitReport')
      ?.addEventListener('click', () => sendReport());

    toast('AI analysis complete');
  } catch (error) {
    console.error(error);
    setAnalysisState(`<strong>Analysis failed:</strong> ${escapeHTML(error.message)}`);
    toast(error.message || 'Could not connect to backend');
  }
}

// ---------- Exact backend: SendView ----------
async function sendReport() {
  if (!capturedBlob) return toast('Capture a photo first');
  if (!lastAnalysisToken) {
    return toast('Please analyze the photo before submitting');
  }

  const formData = new FormData();
  formData.append('image', capturedBlob, 'nigrani-live-capture.jpg');
  formData.append('analysis_token', lastAnalysisToken);

  // SendReportSerializer accepts ONLY latitude, longitude and analysis_token.
  // Do not send the original description here because the supplied backend
  // does not define a description field on SendReportSerializer.
  if (currentLocation.latitude !== null && currentLocation.longitude !== null) {
    formData.append('latitude', currentLocation.latitude);
    formData.append('longitude', currentLocation.longitude);
  }

  setAnalysisState('Submitting anonymous complaint…');

  try {
    const response = await fetch(`${API_BASE_URL}/send/`, {
      method: 'POST',
      body: formData
    });

    const data = await parseJSON(response);

    if (!response.ok) {
      throw new Error(data.error || `Submission failed (${response.status})`);
    }

    toast('Complaint submitted successfully');

    // Immediately update map/feed with the newly stored report.
    await loadLiveReports();

    resetCapture();
  } catch (error) {
    console.error(error);
    setAnalysisState(`<strong>Submission failed:</strong> ${escapeHTML(error.message)}`);
    toast(error.message || 'Could not submit report');
  }
}

// ---------- Exact backend: ReportListView ----------
async function loadLiveReports() {
  try {
    const response = await fetch(`${API_BASE_URL}/`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      cache: 'no-store'
    });

    const data = await parseJSON(response);

    if (!response.ok) {
      throw new Error(data.error || `Reports failed (${response.status})`);
    }

    // ReportListView returns a DRF list by default.
    const reports = Array.isArray(data)
      ? data
      : (Array.isArray(data.results) ? data.results : []);

    renderLiveData(reports);
  } catch (error) {
    console.warn('Live reports unavailable:', error.message);
    renderFallbackState();
  }
}

// ---------- Backend response mapping ----------
function normalizeSeverity(report) {
  const raw = String(report.urgency || 'Medium').toLowerCase();

  if (raw === 'critical') return 'critical';
  if (raw === 'high') return 'high';
  return 'medium';
}

function formatViolations(violations) {
  if (!Array.isArray(violations) || !violations.length) return '';

  return violations.map(v => {
    const category = v?.category || 'Safety issue';
    const detail = v?.detail || '';
    return `${escapeHTML(category)}${detail ? ` — ${escapeHTML(detail)}` : ''}`;
  }).join('<br>');
}

function reportTitle(report) {
  // Supplied backend has no title/type/category field at report level.
  // violations[] is the authoritative incident information.
  if (Array.isArray(report.violations) && report.violations.length) {
    const first = report.violations[0];
    if (first?.category && first?.detail) {
      return `${first.category}: ${first.detail}`;
    }
    if (first?.detail) return first.detail;
    if (first?.category) return first.category;
  }

  if (report.complaint_draft) return report.complaint_draft;
  return 'Civic safety report';
}

function reportLocation(report) {
  const lat = Number(report.latitude);
  const lon = Number(report.longitude);

  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  }

  return 'Location not provided';
}

function reportTime(report) {
  if (!report.created_at) return 'LIVE';

  const d = new Date(report.created_at);
  if (Number.isNaN(d.getTime())) return 'LIVE';

  const mins = Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000));

  if (mins < 1) return 'NOW';
  if (mins < 60) return `${mins} MIN`;

  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} HR`;

  return `${Math.floor(hours / 24)} DAY`;
}

function coordinates(report) {
  const lat = Number(report.latitude);
  const lon = Number(report.longitude);

  return Number.isFinite(lat) && Number.isFinite(lon)
    ? { lat, lon }
    : null;
}

// ---------- Render everything supported by the backend ----------
function renderLiveData(reports) {
  const counts = { critical: 0, high: 0, medium: 0 };

  reports.forEach(report => {
    counts[normalizeSeverity(report)]++;
  });

  // Overview cards.
  const total = reports.length;
  setText('#overviewActiveReports', String(total).padStart(2, '0'));
  setText('#overviewRouted', String(total).padStart(2, '0'));
  setText('#overviewTotalReports', String(total).padStart(2, '0'));
  setText('#sideLiveCount', String(total).padStart(2, '0'));

  // Safety Map cards.
  const statCards = document.querySelectorAll('#map .mapstats article');
  if (statCards.length >= 3) {
    setStrong(statCards[0], counts.critical);
    setStrong(statCards[1], counts.high);
    setStrong(statCards[2], counts.medium);
  }

  // Dynamic markers.
  const markers = document.querySelector('#dynamicMapMarkers');

  if (markers) {
    markers.innerHTML = '';

    reports.forEach(report => {
      const point = coordinates(report);
      if (!point) return;

      // Preserves the existing stylized Delhi NCR map.
      const x = Math.max(
        5,
        Math.min(95, ((point.lon - 76.80) / (77.50 - 76.80)) * 100)
      );
      const y = Math.max(
        8,
        Math.min(92, (1 - (point.lat - 28.45) / (28.85 - 28.45)) * 100)
      );

      const severity = normalizeSeverity(report);
      const pin = document.createElement('i');

      pin.className = `dynamic-pin ${severity}`;
      pin.style.left = `${x}%`;
      pin.style.top = `${y}%`;
      pin.textContent = '!';
      pin.title =
        `${severity.toUpperCase()} — ${reportTitle(report)} — ${reportLocation(report)}`;

      pin.addEventListener('click', () => {
        toast(`${severity.toUpperCase()}: ${reportTitle(report)}`);
      });

      markers.appendChild(pin);
    });
  }

  // Community Feed.
  const feed = document.querySelector('#communityFeed');
  if (!feed) return;

  if (!reports.length) {
    feed.innerHTML =
      '<div class="feed-empty">No live reports yet. New citizen complaints will appear here.</div>';
    return;
  }

  feed.innerHTML = reports.slice(0, 8).map(report => {
    const severity = normalizeSeverity(report);
    const icon =
      severity === 'critical' ? '⚡' :
      severity === 'high' ? '▣' : '⌁';

    return `
      <article>
        <b>${severity.toUpperCase()}</b>
        <div>${icon}</div>
        <section>
          <h3>${escapeHTML(reportTitle(report))}</h3>
          <small>${escapeHTML(reportLocation(report))}</small>
        </section>
        <time>${reportTime(report)}</time>
      </article>
    `;
  }).join('');
}

function setStrong(card, value) {
  const strong = card.querySelector('strong');
  if (strong) strong.textContent = String(value).padStart(2, '0');
}

function setText(selector, value) {
  const el = document.querySelector(selector);
  if (el) el.textContent = value;
}

function setAnalysisState(html) {
  const target = document.querySelector('#analysisResult');
  if (target) target.innerHTML = html;
}

function renderFallbackState() {
  const feed = document.querySelector('#communityFeed');

  if (feed) {
    feed.innerHTML =
      '<div class="feed-empty">Backend is offline or unreachable. Start Django to load live reports.</div>';
  }

  // Do not overwrite map cards with fake values.
  setText('#overviewActiveReports', '--');
  setText('#overviewRouted', '--');
  setText('#overviewTotalReports', '--');
  setText('#sideLiveCount', '--');
}

// ---------- Helpers ----------
function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
  }

  cameraStream = null;
  camera.srcObject = null;
  camera.hidden = true;
  capturePhoto.hidden = true;
}

async function parseJSON(response) {
  const text = await response.text();

  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error: `Server returned HTTP ${response.status}` };
  }
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[ch]));
}

function toast(message) {
  let element = document.querySelector('#toast');

  if (!element) {
    element = document.createElement('div');
    element.id = 'toast';

    Object.assign(element.style, {
      position: 'fixed',
      right: '20px',
      bottom: '20px',
      padding: '12px 15px',
      background: '#b7ff42',
      color: '#071009',
      borderRadius: '8px',
      zIndex: 10000,
      fontWeight: '700',
      fontSize: '10px'
    });

    document.body.appendChild(element);
  }

  element.textContent = message;
  setTimeout(() => element.remove(), 2200);
}

// ---------- Existing cinematic loader ----------
let n = 0;
const pct = document.querySelector('#percent');
const loader = document.querySelector('#loader');

const timer = setInterval(() => {
  n += Math.floor(Math.random() * 8) + 4;

  if (n >= 100) {
    n = 100;
    clearInterval(timer);
    setTimeout(() => loader?.classList.add('hide'), 350);
  }

  if (pct) pct.textContent = String(n).padStart(2, '0');
}, 90);

// ---------- Location button ----------
const detectButton = document.querySelector('.upload footer button');

if (detectButton) {
  detectButton.addEventListener('click', () => getLocation(true));
}

// Load live backend data immediately and every 15 seconds.
loadLiveReports();
setInterval(loadLiveReports, 15000);
