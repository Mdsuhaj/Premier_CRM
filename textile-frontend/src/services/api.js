import axios from "axios";

// Shared axios instance.
//
// LOADING FIXES (project-wide):
//  - A 60s timeout, so a hung request (e.g. Oracle/ERP not answering) ends in an
//    error the page can show, instead of leaving "Loading…" on screen forever.
//  - One automatic retry for GET requests that fail with a network error or a
//    502/503/504 (transient), so a brief hiccup doesn't leave a page half-loaded.
//  - A 401 clears the stale session and returns to /login instead of every page
//    silently failing to load.
const API = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  timeout: 60000,
});

API.interceptors.request.use((req) => {
  const token = localStorage.getItem("token");
  if (token) {
    req.headers.Authorization = `Bearer ${token}`;
  }
  return req;
});

const TRANSIENT = new Set([502, 503, 504]);

API.interceptors.response.use(
  (res) => res,
  async (err) => {
    const cfg = err.config;
    if (axios.isCancel(err) || err.code === "ERR_CANCELED") return Promise.reject(err);

    const status = err.response?.status;

    if (status === 401 && !String(cfg?.url || "").includes("/login")) {
      ["token", "user", "role"].forEach((k) => localStorage.removeItem(k));
      if (!window.location.pathname.endsWith("/login")) {
        const base = import.meta.env.VITE_DEPLOY_TARGET === "vercel" ? "" : "/Premier_crm/public";
        window.location.assign(`${base}/login`);
      }
      return Promise.reject(err);
    }

    const isGet = (cfg?.method || "get").toLowerCase() === "get";
    const retriable = isGet && (!err.response || TRANSIENT.has(status));
    if (cfg && retriable && !cfg.__retried) {
      cfg.__retried = true;
      await new Promise((r) => setTimeout(r, 600));
      return API(cfg);
    }
    return Promise.reject(err);
  }
);

export default API;
