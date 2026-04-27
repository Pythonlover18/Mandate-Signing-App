# Mandate & Pipeline CRM

Simple internal CRM for financing advisory teams with:

- Employee/admin login
- `Signed Mandates` module
- `Pipeline` module
- Automatic move from pipeline to signed mandate
- Admin consolidated signed mandate view with filters by mandate type and employee

## Run

```bash
npm start
```

Open:

`http://127.0.0.1:4000`

## Default Admin

- Email: `admin@crm.local`
- Password: `admin123`

You can create separate employee/admin accounts from:

- `Admin View` -> `Create Employee Login`

## Data Storage

All data is saved to:

`data/store.json`

No document upload is included yet.

## Publish For Team (Cloud)

This app is now cloud-ready and supports env-based admin setup.

Set these environment variables on your host:

- `NODE_ENV=production`
- `HOST=0.0.0.0`
- `PORT` (your platform usually sets this automatically)
- `DATA_DIR` (path mounted to persistent storage, e.g. `/data`)
- `ADMIN_FULL_NAME` (only used for first-ever startup)
- `ADMIN_EMAIL` (only used for first-ever startup)
- `ADMIN_PASSWORD` (only used for first-ever startup)
- `COOKIE_SECURE=true`

Important:

- Set up persistent disk/volume and point `DATA_DIR` there.
- If persistent storage is not configured, data can be lost on redeploys.
