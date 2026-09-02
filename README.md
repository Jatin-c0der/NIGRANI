# NIGRANI

**AI-powered civic safety platform for anonymized hazard reporting.**

NIGRANI turns a single street photograph into structured safety intelligence. A citizen captures a photo of a hazard — exposed wiring, a blocked fire exit, unsafe scaffolding, an illegal extra floor — adds an optional description, and Google Gemini analyzes the image to identify violations, assess urgency, and draft a formal complaint letter. The report is then routed by email to the relevant authority (and CC'd to an NGO) and surfaced on a public Safety Map and Community Feed, with no personally identifying information attached.

**Live demo:** [nigrani-1.onrender.com](https://nigrani-1.onrender.com/)

> Anonymous by design. Built for civic action.

---

## Table of contents

- [How it works](#how-it-works)
- [Project structure](#project-structure)
- [Tech stack](#tech-stack)
- [Backend setup](#backend-setup)
- [Frontend setup](#frontend-setup)
- [API reference](#api-reference)
- [Data model](#data-model)
- [Security notes](#security-notes)

---

## How it works

1. **Capture** — The user takes a live photo (via the browser's camera) of a visible hazard at a construction worksite or inside/around a building, and optionally writes a short description.
2. **Understand** — The photo (and description) is sent to the `/analyze/` endpoint, which passes it to Gemini with a structured prompt. Gemini identifies every visible violation across two domains:
   - **Worksite**: exposed wiring, missing fall protection, unsafe scaffolding, unguarded machinery, blocked emergency access, etc.
   - **Building**: unsanctioned extra floors, missing/expired fire extinguishers, blocked fire exits, overcrowding, structural damage, etc.

   Gemini returns a structured JSON payload: the list of violations, a plain-language `why_dangerous` explanation, an `urgency` rating (`Critical` / `High` / `Medium`), and a full formal `complaint_draft` letter — all grounded strictly in what's visible in the photo.
3. **Review** — The analysis is returned to the user along with a signed, time-limited `analysis_token` binding the result to the exact image (via a SHA-256 hash), so the report can't later be swapped for a different photo.
4. **Route** — On confirmation, `/send/` re-verifies the token, emails the complaint (with the photo attached) to the configured authority and NGO addresses, and persists the report — which then appears on the Safety Map and Community Feed.

## Project structure

```
NIGRANI/
├── .gitignore
└── nigrani combined/
    ├── backend/
    │   └── nigrani/                   # Django project root
    │       ├── manage.py
    │       ├── build.sh               # install deps, collectstatic, migrate (used on Render)
    │       ├── requirements.txt
    │       ├── nigrani/               # project config
    │       │   ├── settings.py
    │       │   ├── urls.py            # mounts reports app at /api/reports/
    │       │   ├── asgi.py / wsgi.py
    │       └── reports/                # core app
    │           ├── models.py          # Report model
    │           ├── serializers.py     # DRF serializers
    │           ├── views.py           # AnalyzeView, SendView, ReportListView
    │           ├── urls.py            # analyze/, send/, list
    │           ├── gemini_client.py   # Gemini prompt + schema + call
    │           ├── tokens.py          # signed analysis-token issue/verify
    │           ├── email_utils.py     # builds & sends the complaint email
    │           ├── admin.py
    │           └── migrations/
    └── frontend/
        ├── index.html                 # single-page app (Overview, Report, Map, Feed, AI assistant)
        ├── script.js                  # camera capture, API calls, Leaflet map, feed rendering
        ├── style.css
        └── nigrani-logo.png
```

## Tech stack

**Backend**
- [Django](https://www.djangoproject.com/) 5+ with [Django REST Framework](https://www.django-rest-framework.org/)
- [google-genai](https://pypi.org/project/google-genai/) — calls the `gemini-3.6-flash` model with a JSON response schema for structured output
- SQLite (default `DATABASES` config — swappable for production)
- `django-cors-headers` for cross-origin requests from the frontend
- `whitenoise` for static file serving, `gunicorn` as the WSGI server
- Django's SMTP email backend (configured for Gmail) to dispatch complaint emails
- Pillow for image validation

**Frontend**
- Plain HTML/CSS/JavaScript — no build step or framework
- [Leaflet.js](https://leafletjs.com/) with OpenStreetMap tiles for the Safety Map
- Browser `MediaDevices` API for live camera capture

## Backend setup

```bash
cd "nigrani combined/backend/nigrani"
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

Create a `.env` file in this directory (loaded via `python-dotenv`):

```env
DJANGO_SECRET_KEY=your-secret-key
DJANGO_DEBUG=True
DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1
DJANGO_CSRF_TRUSTED_ORIGINS=http://localhost:5173

# Gemini
GEMINI_API_KEY=your-gemini-api-key

# Email (Gmail SMTP)
EMAIL_HOST_USER=your-email@gmail.com
EMAIL_HOST_PASSWORD=your-app-password

# Routing
AUTHORITY_EMAIL=authority@example.com
NGO_EMAIL=ngo@example.com

# CORS
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
```

Then run:

```bash
python manage.py migrate
python manage.py runserver
```

The API will be available at `http://127.0.0.1:8000/api/reports/`.

## Frontend setup

The frontend is static — no build step required. Just serve the `frontend/` folder:

```bash
cd "nigrani combined/frontend"
python -m http.server 5173
```

By default it points at a deployed backend (`https://nigrani-eg4p.onrender.com/api/reports`). To point it at your local backend instead, set it before the page loads, e.g. in the browser console or a small inline script:

```js
window.NIGRANI_API_BASE_URL = "http://127.0.0.1:8000/api/reports";
```

(it also checks `localStorage.getItem('NIGRANI_API_BASE_URL')` as a fallback).

## API reference

Base path: `/api/reports/`

| Method | Endpoint | Description | Throttle |
|---|---|---|---|
| `POST` | `/analyze/` | Accepts an `image` file + optional `description`; returns Gemini's structured analysis plus a signed `analysis_token`. | 10/hour |
| `POST` | `/send/` | Accepts the same `image`, `analysis_token`, and optional `latitude`/`longitude`; re-verifies the token against the image, emails the complaint, and persists the `Report`. | 5/hour |
| `GET` | `/` | Lists all reports with `status='Sent'`, newest first — powers the Community Feed and Safety Map. | — |

**`/analyze/` response shape**

```json
{
  "violations": [
    { "domain": "Worksite", "category": "Exposed live wiring", "detail": "..." }
  ],
  "why_dangerous": "...",
  "urgency": "Critical",
  "complaint_draft": "...",
  "analysis_token": "signed-token-string"
}
```

Images are limited to 10MB, and to `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `image/heif`; descriptions are capped at 500 characters.

## Data model

**`Report`**

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | primary key |
| `latitude`, `longitude` | float, nullable | optional approximate location |
| `violations` | JSON | list of `{domain, category, detail}` |
| `why_dangerous` | text | |
| `urgency` | choice | `Critical` / `High` / `Medium` |
| `complaint_draft` | text | the anonymous letter sent to authorities |
| `status` | choice | `Pending` / `Sent` / `Failed` |
| `created_at` | datetime | auto-set |

No reporter identity, contact info, or account data is ever stored — the platform is anonymous by design.

## Security notes

- **Analysis binding**: the `analysis_token` returned from `/analyze/` is a signed payload containing a SHA-256 hash of the exact image bytes, valid for 15 minutes. `/send/` re-verifies the hash so a report can't be created with a different image than the one analyzed.
- **Rate limiting**: `analyze` and `send` are throttled per DRF's `ScopedRateThrottle` to limit abuse of the Gemini API and email dispatch.
- **Image validation**: uploads are checked for MIME type, size, and actually decoded/verified with Pillow before being processed.
- Secrets (Gemini key, email credentials, Django secret key) are all read from environment variables — never commit a real `.env` file.
