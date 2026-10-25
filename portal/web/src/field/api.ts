/* The field app's API instance and version. The token lives in localStorage under `sw.field.token`
   so a reload (or the Android WebView restarting) keeps the session; records live in IndexedDB (offline/db.ts). */
import { createApi } from "../shared/api";

export const TOKEN_KEY = "sw.field.token";
export const UID_KEY = "sw.field.uid";
export const APP_VERSION = "2.0.0";
export const api = createApi(TOKEN_KEY);
