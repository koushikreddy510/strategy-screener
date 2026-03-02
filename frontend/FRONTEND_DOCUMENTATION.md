# Frontend Application Documentation

This document describes the React frontend structure, available pages, and how each page interacts with the FastAPI backend.

## Environment

- .env  
  REACT_APP_API_URL=http://localhost:8000  

- API helper: `src/api.js`  
  Axios instance configured with `baseURL: process.env.REACT_APP_API_URL`

## Pages

1. **StrategiesList** (`/strategies`)  
   - Fetch: `GET /strategies/`  
   - Displays all strategies (id, name).  
   - Links:  
     - “View Conditions” → `/strategies/{id}/conditions`  
     - “Run” → `/run/{id}`  
     - “New Strategy” → `/strategies/new`

2. **NewStrategy** (`/strategies/new`)  
   - Form fields: name, description  
   - Submit: `POST /strategies/`  
   - Redirects to `/strategies` on success  

3. **ConditionsList** (`/strategies/:id/conditions`)  
   - Fetch: `GET /strategies/{id}/conditions/`  
   - Displays each condition (indicator_type, params JSON, lookback_days, operator, threshold)  
   - Link: “Add New Condition” → `/strategies/{id}/conditions/new`  

4. **NewCondition** (`/strategies/:id/conditions/new`)  
   - Form fields:  
     - indicator_type (ema, rsi, supertrend)  
     - params (JSON textarea)  
     - lookback_days (number)  
     - operator (>, <, ==, cross_above, cross_below)  
     - threshold (JSON textarea)  
   - Submit: `POST /strategies/{id}/conditions/`  
   - Redirects to `/strategies/{id}/conditions` on success  

5. **RunScreen** (`/run/:id`)  
   - Fetch: `GET /run/{id}`  
   - Runs the screener on the backend for strategy `id`  
   - Displays a list of matching symbols, or “No symbols matched.”  

## Data Flow

- All pages use `src/api.js` to call the FastAPI backend at `http://localhost:8000`.
- CRUD operations for strategies and conditions are performed via the defined FastAPI endpoints.
- Screener execution is triggered by `GET /run/{strategy_id}`, returning an array of symbol strings.

## Next Steps

- Implement navigation links between pages.  
- Add “Edit Strategy” and “Delete Strategy” functionality.  
- Enhance error handling and validation.  
- Style the UI and add loading spinners.  
- Write end-to-end tests.  
- Deploy frontend (e.g., Netlify) and backend (e.g., Heroku/AWS).